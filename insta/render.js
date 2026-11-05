#!/usr/bin/env node
// Usage: node insta/render.js 2026-11-04 [2026-11-05 ...]   (dates or paths to post JSON)
// Writes insta/out/<date>/: 01.jpg… (feed carousel), story.jpg (yesterday's quiz answer),
// reel.mp4 (9:16 slideshow), caption.txt, alt.txt
const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");
const { DIR, config, loadPost, addDays, weekFor } = require("./lib");

function loadPlaywright() {
  try { return require("playwright"); } catch {
    const root = execFileSync("npm", ["root", "-g"]).toString().trim();
    return require(path.join(root, "playwright"));
  }
}

const REEL = { cover: 2.5, item: 4.5, last: 5, fade: 0.4, bg: "0x141a33" };

function makeReel(jpgs, out) {
  const durs = jpgs.map((_, i) => i === 0 ? REEL.cover : i === jpgs.length - 1 ? REEL.last : REEL.item);
  const args = ["-y", "-loglevel", "error"];
  jpgs.forEach((f, i) => args.push("-loop", "1", "-t", String(durs[i]), "-i", f));
  const total = durs.reduce((a, b) => a + b, 0) - REEL.fade * (jpgs.length - 1);
  args.push("-f", "lavfi", "-t", String(total), "-i", "anullsrc=r=44100:cl=stereo");
  const f = jpgs.map((_, i) =>
    `[${i}:v]scale=1080:1350,pad=1080:1920:0:285:color=${REEL.bg},setsar=1,fps=30,format=yuv420p[v${i}]`);
  let prev = "v0", offset = 0;
  for (let i = 1; i < jpgs.length; i++) {
    offset += durs[i - 1] - REEL.fade;
    const o = i === jpgs.length - 1 ? "vout" : `x${i}`;
    f.push(`[${prev}][v${i}]xfade=transition=slideleft:duration=${REEL.fade}:offset=${offset.toFixed(2)}[${o}]`);
    prev = o;
  }
  args.push("-filter_complex", f.join(";"), "-map", "[vout]", "-map", `${jpgs.length}:a`,
    "-c:v", "libx264", "-preset", "medium", "-crf", "20", "-pix_fmt", "yuv420p", "-r", "30",
    "-c:a", "aac", "-b:a", "128k", "-shortest", "-movflags", "+faststart", out);
  execFileSync("ffmpeg", args);
}

function altText(post) {
  if (post.kind === "review") return `Weekly review of this week's English expressions. ${post.theme.en}`;
  return post.items.map((it, i) => `Slide ${i + 2}: ${it.term} — ${it.ja}. ${it.definition} Example: ${it.example.replace(/\*\*/g, "")}`).join("\n");
}

(async () => {
  const args = process.argv.slice(2);
  if (!args.length) { console.error("Usage: node insta/render.js <date|post.json> ..."); process.exit(1); }
  const cfg = config();
  const { chromium } = loadPlaywright();
  const proxy = process.env.HTTPS_PROXY || process.env.https_proxy;
  const browser = await chromium.launch(proxy ? { proxy: { server: proxy } } : {});
  const page = await browser.newPage({ viewport: { width: 1200, height: 2000 }, deviceScaleFactor: 1 });
  let warnings = 0;

  for (const arg of args) {
    const date = path.basename(arg, ".json");
    const post = loadPost(date);
    const prev = loadPost(addDays(date, -1));
    if (!post && !prev) { console.error(`No post for ${date} or the day before`); warnings++; continue; }
    if (!post) {
      // No post today: still make the morning story that answers yesterday's quiz.
      const outDir = path.join(DIR, "out", date);
      fs.mkdirSync(outDir, { recursive: true });
      await page.goto("file://" + path.join(DIR, "template.html"));
      await page.waitForLoadState("networkidle");
      await page.evaluate(a => window.renderStoryOnly(a), { prev, cfg });
      await page.waitForLoadState("networkidle");
      await (await page.$(".story")).screenshot({ path: path.join(outDir, "story.jpg"), type: "jpeg", quality: 92 });
      console.log(`${date}: story only (answer to ${prev.date}) → ${path.relative(process.cwd(), outDir)}`);
      continue;
    }
    const week = post.kind === "review" ? weekFor(date) : null;
    const outDir = path.join(DIR, "out", date);
    fs.rmSync(outDir, { recursive: true, force: true });
    fs.mkdirSync(outDir, { recursive: true });

    await page.goto("file://" + path.join(DIR, "template.html"));
    await page.waitForLoadState("networkidle");
    const overflow = await page.evaluate(a => window.renderAll(a), { post, cfg, week, prev });
    await page.waitForLoadState("networkidle");
    if (overflow.length) { warnings++; console.warn(`! ${date} overflow:\n  ` + overflow.join("\n  ")); }

    const slides = await page.$$(".slide");
    const jpgs = [];
    for (let i = 0; i < slides.length; i++) {
      const f = path.join(outDir, String(i + 1).padStart(2, "0") + ".jpg");
      await slides[i].screenshot({ path: f, type: "jpeg", quality: 92 });
      jpgs.push(f);
    }
    const story = await page.$(".story");
    if (story) await story.screenshot({ path: path.join(outDir, "story.jpg"), type: "jpeg", quality: 92 });
    makeReel(jpgs, path.join(outDir, "reel.mp4"));
    fs.writeFileSync(path.join(outDir, "caption.txt"), (post.caption || "").trim() + "\n");
    fs.writeFileSync(path.join(outDir, "alt.txt"), altText(post) + "\n");
    console.log(`${date}: ${jpgs.length} slides${story ? " + story" : ""} + reel → ${path.relative(process.cwd(), outDir)}`);
  }
  await browser.close();
  if (warnings) process.exitCode = 2;
})().catch(e => { console.error(e); process.exit(1); });
