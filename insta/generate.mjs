#!/usr/bin/env node
// Daily content loop for @articulate.eng.jp, run by GitHub Actions (no chat session needed).
//   1. learn: update learnings.md from metrics/latest.json (posts older than 48h)
//   2. fill:  write every missing post for the next BUFFER_DAYS days with Claude,
//             have a second, independent Claude call fact-check and correct it,
//             validate it in code, and mark it approved.
// Usage: node insta/generate.mjs [--days 3] [--start YYYY-MM-DD] [--no-learn]
// Env: ANTHROPIC_API_KEY. Prints the dates it wrote (one per line, prefixed "WROTE ") for the workflow to render.
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";

const require = createRequire(import.meta.url);
const { DIR, POSTS, allPosts, addDays, todayJST, slotFor, loadPost, postPath, config } = require("./lib.js");

const MODEL = process.env.CLAUDE_MODEL || "claude-opus-5-5";
const args = process.argv.slice(2);
const opt = (name, dflt) => (args.includes(name) ? args[args.indexOf(name) + 1] : dflt);
const BUFFER_DAYS = Number(opt("--days", 3));
const START = opt("--start", addDays(todayJST(), 1));
const LEARN = !args.includes("--no-learn");
const WD = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

if (!process.env.ANTHROPIC_API_KEY) {
  console.log("::warning::ANTHROPIC_API_KEY is not set. Skipping generation.");
  process.exit(0);
}
const client = new Anthropic();

// ---------- schemas ----------
const Theme = z.object({ en: z.string(), ja: z.string() });
const Quiz = z.object({
  sentence: z.string().describe("Fill-in-the-blank sentence containing exactly one ____"),
  options: z.array(z.string()).length(3),
  answer: z.enum(["A", "B", "C"]),
  why: z.string().describe("One short Japanese line explaining the answer"),
});
const Item = z.object({
  term: z.string(),
  ipa: z.string().describe("General American IPA in slashes, or empty string for long idioms"),
  pos: z.string(),
  ja: z.string(),
  definition: z.string(),
  example: z.string().describe("Original sentence; the target words wrapped in **...**"),
  example_ja: z.string(),
  note: z.string(),
});
const DailyPost = z.object({ theme: Theme, items: z.array(Item).length(5), quiz: Quiz, caption: z.string() });
const ReviewPost = z.object({ theme: Theme, quizzes: z.array(Quiz).length(3), caption: z.string() });
const checked = schema => z.object({
  issues: z.array(z.object({ field: z.string(), problem: z.string(), fix: z.string() })),
  post: schema,
});

// ---------- shared context ----------
const read = f => (fs.existsSync(path.join(DIR, f)) ? fs.readFileSync(path.join(DIR, f), "utf8") : "");
const RULES = `You write one day's Instagram carousel for "Articulate English" (${config().handle}), an account that teaches
intermediate-to-advanced (B2–C2) Japanese learners, in American English.

Rules for a daily post (phrasal verbs / idioms / words):
- Exactly 5 items, all of the day's kind, tied together by one theme (work, emotions, travel, money, relationships, news, health, tech, etc.).
  Do not reuse a theme from the recent list.
- B2+ only. Skip beginner items (give up, look for, piece of cake, break a leg...). Word posts use the given CEFR level.
- Never reuse a term from the used list.
- term; ipa: General American in slashes ("" allowed for long idioms); pos; ja: short Japanese meaning;
  definition: one plain English sentence ≤ 110 chars; example: an ORIGINAL natural sentence ≤ 90 chars with the target wrapped in **...**
  (separable phrasal verbs may mark both parts, e.g. "**move** the deadline **up**"); example_ja: faithful natural Japanese;
  note: one Japanese tip (usage, origin, register, related form, US/UK difference) ≤ 45 chars, factually exact, no misleading absolutes.
- quiz: one sentence with "____", 3 options from today's items, exactly one correct (distractors must clearly not fit), answer letter, why (short Japanese).
- caption (Japanese): hook line with one emoji, numbered "term｜meaning" list, ask for quiz answers in the comments,
  say the answer comes in tomorrow morning's story, a save reminder, then three lines of ".", then 12–15 hashtags mixing Japanese and English.

Rules for a Sunday review: no items. theme summarizes the week. quizzes: 3 questions, each from a different day's post of that week,
same quiz rules. caption lists the week's days and themes, asks how many they got right, says answers come in tomorrow's story, then hashtags.`;

const CHECKER = `You are a strict editor: native-level American English and fluent Japanese. You review an Instagram post for
B2–C2 Japanese learners. Check every item: meaning (ja, definition) accurate; IPA correct General American; part of speech;
example natural, grammatical and using the target correctly, with ** markers around it; example_ja faithful and natural;
note factually right and not misleading; level B2+. Each quiz: exactly one option fits, the answer letter matches it,
no distractor could also fit, why is right. Caption matches the items and has no typos.
Return every real problem in "issues" (empty if none) and the full corrected post in "post" (unchanged where fine).
Replace an item entirely if it cannot be made accurate. Do not change things that are already correct.`;

async function ask(system, user, schema, effort = "high") {
  const res = await client.messages.parse({
    model: MODEL,
    max_tokens: 16000,
    output_config: { effort, format: zodOutputFormat(schema) },
    system,
    messages: [{ role: "user", content: user }],
  });
  if (res.stop_reason === "refusal") throw new Error(`Refused: ${res.stop_details?.category ?? "unknown"}`);
  if (res.stop_reason === "max_tokens") throw new Error("Hit max_tokens");
  if (!res.parsed_output) throw new Error("Response did not match the schema");
  const u = res.usage;
  console.log(`  usage: in ${u.input_tokens} out ${u.output_tokens}`);
  return res.parsed_output;
}

// ---------- code-side validation ----------
function validate(post, kind, used) {
  const errs = [];
  const quizzes = post.quizzes || [post.quiz];
  for (const q of quizzes) {
    if ((q.sentence.match(/_{2,}/g) || []).length !== 1) errs.push(`quiz "${q.sentence}" must contain exactly one ____`);
    if (new Set(q.options.map(o => o.toLowerCase())).size !== 3) errs.push(`quiz options repeat: ${q.options}`);
  }
  if (kind !== "review") {
    for (const it of post.items) {
      if (!/\*\*.+?\*\*/.test(it.example)) errs.push(`${it.term}: example has no **marker**`);
      if (used.has(it.term.toLowerCase())) errs.push(`${it.term}: already used in an earlier post`);
      if (it.definition.length > 130) errs.push(`${it.term}: definition too long`);
      if (it.example.replace(/\*/g, "").length > 100) errs.push(`${it.term}: example too long`);
      if (it.note.length > 60) errs.push(`${it.term}: note too long`);
    }
    if (new Set(post.items.map(i => i.term.toLowerCase())).size !== 5) errs.push("terms repeat within the post");
  }
  return errs;
}

// ---------- 1. learn ----------
async function learn() {
  const metricsFile = path.join(DIR, "metrics", "latest.json");
  if (!fs.existsSync(metricsFile)) { console.log("learn: no metrics yet"); return false; }
  const cutoff = addDays(todayJST(), -2);
  const rows = Object.entries(JSON.parse(fs.readFileSync(metricsFile, "utf8"))).filter(([d]) => d <= cutoff);
  if (!rows.length) { console.log("learn: no post is 48h old yet"); return false; }
  console.log(`learn: ${rows.length} posts with settled numbers`);
  const out = await ask(
    "You analyze Instagram results for an English-learning account and keep a short Japanese notes file that guides future posts.",
    `Current notes file (Markdown, Japanese):\n\n${read("learnings.md")}\n\nPer-post metrics (JSON; feed/reel/story insights):\n\n${JSON.stringify(Object.fromEntries(rows), null, 1)}\n\n` +
    `Rewrite the notes file. Keep its headings. Rank by saves÷reach, then shares÷reach, then follows and comments; compare by kind, level, theme type, reel vs none. ` +
    `Each finding states the numbers and how many posts it rests on, and what to do differently. Mark findings from fewer than 3 posts per group as 暫定. ` +
    `Remove findings newer data contradicts. Do not propose changing the weekday rotation or posting times as an instruction; list such ideas under a "提案" line instead. Keep it under 60 lines.`,
    z.object({ markdown: z.string() }), "medium");
  fs.writeFileSync(path.join(DIR, "learnings.md"), out.markdown.trim() + "\n");
  return true;
}

// ---------- 2. fill ----------
async function writePost(date, slot, no, posts) {
  const used = new Set(posts.flatMap(p => (p.items || []).map(i => i.term.toLowerCase())));
  const recentThemes = posts.filter(p => p.date >= addDays(date, -21)).map(p => `${p.date} ${p.kind}: ${p.theme.ja}`);
  const kindLine = slot.kind === "review" ? "Sunday weekly review"
    : slot.kind === "word" ? `5 ${slot.level}-level words (adjectives, verbs, adverbs or nouns)` : slot.kind === "phrasal" ? "5 phrasal verbs" : "5 idioms";
  let context = `Date: ${date} (${WD[new Date(date + "T00:00:00Z").getUTCDay()]}). Post: ${kindLine}.\n\n` +
    `Recent themes (do not repeat):\n${recentThemes.join("\n") || "(none)"}\n\n` +
    `Lessons from results (follow them):\n${read("learnings.md")}\n\nEditor feedback (follow it):\n${read("feedback.md")}\n\n`;
  if (slot.kind === "review") {
    const week = [6, 5, 4, 3, 2, 1].map(n => loadPost(addDays(date, -n))).filter(p => p && p.status === "approved");
    if (!week.length) { console.log(`${date}: no approved posts this week; skipping the review`); return null; }
    context += `This week's posts:\n${week.map(p => `${p.date} ${WD[new Date(p.date + "T00:00:00Z").getUTCDay()]} ${p.kind}${p.level ? " " + p.level : ""} — ${p.theme.ja}: ` +
      p.items.map(i => `${i.term} (${i.ja})`).join("; ")).join("\n")}\n`;
  } else {
    context += `Used terms (never reuse):\n${[...used].sort().join(", ")}\n`;
  }
  const schema = slot.kind === "review" ? ReviewPost : DailyPost;

  let draft = await ask(RULES, context + "\nWrite the post.", schema);
  let errs = validate(draft, slot.kind, used);
  if (errs.length) {
    console.log(`  rewrite: ${errs.join(" | ")}`);
    draft = await ask(RULES, context + `\nWrite the post. A previous attempt had these problems; avoid them:\n- ${errs.join("\n- ")}`, schema);
  }

  // Independent check: a fresh call that sees only the post, not the writer's reasoning.
  const review = await ask(CHECKER, `Post for ${date} (${kindLine}${slot.kind === "review" ? "; quizzes must use this week's terms" : ""}):\n\n${JSON.stringify(draft, null, 2)}`, checked(schema));
  for (const i of review.issues) console.log(`  fixed ${i.field}: ${i.problem}`);
  const final = review.post;
  errs = validate(final, slot.kind, used);
  if (errs.length) throw new Error(`${date} still invalid after review: ${errs.join(" | ")}`);

  const post = { date, no, kind: slot.kind, ...(slot.level ? { level: slot.level } : {}), status: "approved", ...final };
  if (post.items) post.items = post.items.map(({ ipa, ...rest }) => (ipa ? { ...rest, ipa } : rest));
  fs.writeFileSync(postPath(date), JSON.stringify(post, null, 2) + "\n");
  return post;
}

(async () => {
  if (LEARN) { try { await learn(); } catch (e) { console.log(`::warning::learn step failed: ${e.message}`); } }
  let posts = allPosts();
  let nextNo = Math.max(0, ...posts.map(p => p.no || 0)) + 1;
  let failed = 0;
  for (let i = 0; i < BUFFER_DAYS; i++) {
    const date = addDays(START, i);
    if (loadPost(date)) continue;
    const slot = slotFor(date);
    console.log(`${date}: writing ${slot.kind}${slot.level ? " " + slot.level : ""} (no.${nextNo})`);
    try {
      const post = await writePost(date, slot, nextNo, posts);
      if (post) { nextNo++; posts = allPosts(); console.log(`WROTE ${date}`); }
    } catch (e) {
      failed++;
      console.log(`::error::${date}: ${e.message}`);
      break; // later days (e.g. a Sunday review) depend on earlier ones
    }
  }
  if (failed) process.exitCode = 1;
})();
