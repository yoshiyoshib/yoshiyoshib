#!/usr/bin/env node
// ベトナム語アカウントのコマンド集（オーケストレーター）
//
// ■ 通常運用（API キー不要）
//   生成と評価は Claude Code の定期実行が .claude/skills/vietnam-daily/SKILL.md の手順で行い、
//   posts/<日付>.json を 3 日先まで作り置きする。投稿は GitHub Actions が毎晩行う。
//
//   node src/index.js status [--from D] [--days 3]   3日先までの作り置き状況（missing / approved）
//   node src/index.js brief <D>                       その日の生成指示（曜日テーマ・学習ログ・スキーマ）を表示
//   node src/index.js rubric                          評価者（厳格なベトナム語教師）の採点基準を表示
//   node src/index.js check <D>                       機械検査 + 描画 + はみ出し検知（問題があれば終了コード 2）
//   node src/index.js record <D>                      posts/<D>.json の評価履歴を data/learning-log.md に追記
//   node src/index.js prepare [--date D]              画像・音声・リールを output/<D>/ に作る（Actions 用）
//   node src/index.js publish [--date D] [--dry-run]  カルーセル + リールを投稿（Actions 用・二重投稿しない）
//   node src/index.js metrics                         24時間以上たった投稿のインサイトを取得
//   node src/index.js sample                          data/sample-post.json を描画＋無音リール（デザイン確認用）
//
// ■ オプション: API キーで完全自動（ANTHROPIC_API_KEY または GEMINI_API_KEY）
//   node src/index.js generate [--days 3]             空いている日を API の 生成⇄評価ループ で埋める
require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });
const fs = require("fs");
const path = require("path");
const { getDayConfig, DAY_NAMES } = require("../config/schedule");
const { runQualityLoop, codeCheck, EVAL_SYSTEM, PASS_SCORE } = require("./evaluator");
const { buildSystemPrompt, buildUserPrompt, normalizeDeep } = require("./generator");
const { renderPost, overflowFeedback } = require("./renderer");
const log = require("./learning-log");

const ROOT = path.join(__dirname, "..");
const POSTS = path.join(ROOT, "posts");
const OUT = path.join(ROOT, "output");

// ---------------------------------------------------------------- 日付
const todayJST = () => new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);
const addDays = (d, n) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 864e5).toISOString().slice(0, 10);
const dayOf = (d) => DAY_NAMES[new Date(`${d}T00:00:00Z`).getUTCDay()];
// 投稿枠は 20 時台。Actions の定時実行は遅れることがあるので「JST の現在時刻 − 19 時間」の日付を当日とみなす
const dueDate = () => new Date(Date.now() + (9 - 19) * 3600e3).toISOString().slice(0, 10);

// ---------------------------------------------------------------- 投稿ファイル
const postPath = (d) => path.join(POSTS, `${d}.json`);
const loadPost = (d) => (fs.existsSync(postPath(d)) ? JSON.parse(fs.readFileSync(postPath(d), "utf8")) : null);
const savePost = (d, p) => { fs.mkdirSync(POSTS, { recursive: true }); fs.writeFileSync(postPath(d), `${JSON.stringify(p, null, 2)}\n`); };
const outDir = (d) => path.join(OUT, d);

// ---------------------------------------------------------------- CLI
const argv = process.argv.slice(2);
const cmd = argv[0];
const flag = (n) => argv.includes(n);
const opt = (n, d) => (argv.includes(n) ? argv[argv.indexOf(n) + 1] : d);
const posArg = () => (argv[1] && !argv[1].startsWith("--") ? argv[1] : undefined);
const dry = flag("--dry-run") || process.env.DRY_RUN === "true";

function fail(msg, code = 1) {
  console.error(`✖ ${msg}`);
  process.exit(code);
}

// ---------------------------------------------------------------- status / brief / rubric
function status() {
  const from = opt("--from", addDays(todayJST(), 1));
  const days = Number(opt("--days", 3));
  const published = log.loadPublished();
  for (let i = -1; i < days; i++) {
    const d = addDays(from, i);
    const cfg = getDayConfig(dayOf(d));
    const p = loadPost(d);
    const pub = published.find((x) => x.date === d);
    const st = pub?.feed ? "published" : !p ? "missing" : p.status === "approved" ? "approved" : p.status || "draft";
    if (i === -1 && st !== "missing") { console.log(`${d} ${cfg.day.padEnd(9)} ${st.padEnd(9)} （今日）${p?.slides?.[0]?.title ?? ""}`); continue; }
    if (i === -1) { console.log(`${d} ${cfg.day.padEnd(9)} missing   （今日の分がありません。今夜の投稿に間に合わせるなら先に作る）`); continue; }
    console.log(`${d} ${cfg.day.padEnd(9)} ${st.padEnd(9)} ${cfg.title}${p ? ` — ${p.slides?.[0]?.title ?? ""}` : ""}`);
  }
}

function brief() {
  const d = posArg() || fail("日付を指定してください: brief YYYY-MM-DD");
  const cfg = getDayConfig(dayOf(d));
  console.log(`# 生成指示 ${d}（${cfg.day}）→ 保存先 vietnam-insta-bot/posts/${d}.json\n`);
  console.log("## システムプロンプト\n");
  console.log(buildSystemPrompt(cfg, log.promptContext()));
  console.log("\n## 今日の依頼\n");
  console.log(buildUserPrompt(cfg, { recentTopics: log.recentTopics() }));
  console.log(`\n## 保存形式\n上記 JSON に "status": "draft" を足して保存。評価ループ後に "status": "approved" と "evaluation" を足す（SKILL.md 参照）。`);
}

function rubric() {
  console.log(EVAL_SYSTEM);
  console.log(`\n合格点: ${PASS_SCORE} 点（4項目の合計）`);
}

// ---------------------------------------------------------------- check（生成直後の検査。Claude が修正ループで使う）
async function check() {
  const d = posArg() || fail("日付を指定してください: check YYYY-MM-DD");
  const raw = loadPost(d) || fail(`posts/${d}.json がありません`);
  const cfg = getDayConfig(dayOf(d));
  // NFC 正規化と固定値の強制（書き戻す）
  const { status: st, evaluation, ...body } = raw;
  const post = { ...normalizeDeep(body), day: cfg.day, theme: cfg.theme, themeColor: cfg.themeColor };
  savePost(d, { ...post, status: st || "draft", ...(evaluation ? { evaluation } : {}) });

  const { fatal, issues } = codeCheck(post, cfg);
  let overflow = [];
  if (!fatal.length) {
    const r = await renderPost(post, cfg, outDir(d));
    overflow = r.overflow;
    console.log(`描画: ${r.files.map((f) => path.relative(process.cwd(), f.png)).join(" ")}`);
  }
  const problems = [...fatal.map((m) => `[形式エラー] ${m}`), ...issues.map((m) => `[機械検査] ${m}`), ...overflowFeedback(post, overflow)];
  if (problems.length) {
    console.log(`\n問題 ${problems.length} 件（直して再度 check してください）:`);
    problems.forEach((m) => console.log(`- ${m}`));
    process.exit(2);
  }
  console.log("\n✔ 機械検査・レイアウトとも問題なし（画像を目で確認してから評価へ）");
}

// ---------------------------------------------------------------- record（評価履歴を学習ログへ）
function record() {
  const d = posArg() || fail("日付を指定してください: record YYYY-MM-DD");
  const p = loadPost(d) || fail(`posts/${d}.json がありません`);
  const ev = p.evaluation || fail("evaluation がありません（SKILL.md の形式で評価履歴を入れてください）");
  if (ev.logged) return console.log("記録済み");
  const cfg = getDayConfig(dayOf(d));
  log.appendRun({ date: d, dayCfg: cfg, result: { post: p, score: ev.score, passed: ev.passed, history: ev.history || [], lessons: ev.lessons || [] }, overflowRounds: ev.overflowRounds || 0 });
  log.addRules(ev.lessons);
  p.evaluation.logged = true;
  savePost(d, p);
  console.log(`✔ data/learning-log.md に ${d} を記録`);
}

// ---------------------------------------------------------------- prepare / publish（GitHub Actions）
function dueOrArg() {
  return opt("--date", posArg() || dueDate());
}

async function prepare() {
  const d = dueOrArg();
  const p = loadPost(d);
  if (!p) fail(`posts/${d}.json がありません（作り置きが切れています）`);
  if (p.status !== "approved") { console.log(`${d} は ${p.status}（approved 以外は投稿しない）`); return; }
  if (log.loadPublished().some((x) => x.date === d && x.feed && x.reel)) { console.log(`${d} は投稿済み`); return; }
  const cfg = getDayConfig(dayOf(d));
  const dir = outDir(d);
  console.log(`[prepare] ${d} ${cfg.day}: ${p.slides[0].title}`);
  const { overflow } = await renderPost(p, cfg, dir);
  if (overflow.length) fail(`レイアウトに収まらないスライドがあります: ${overflow.map((o) => o.index + 1).join(", ")} 枚目`);

  // 音声とリール（失敗してもカルーセルは出す）
  try {
    const { synthesizePost } = require("./tts");
    const { buildReel } = require("./reel");
    const audio = await synthesizePost(p, dir, { voice: process.env.TTS_VOICE });
    fs.copyFileSync(audio.full, path.join(OUT, "audio.mp3"));
    const reel = await buildReel(p, cfg, dir, audio.slides);
    console.log(`[prepare] 音声 ${audio.slides.filter(Boolean).length} 本、リール ${reel.seconds} 秒`);
  } catch (e) {
    console.warn(`::warning::音声・リールの作成に失敗（カルーセルのみ投稿します）: ${e.message}`);
  }
}

function mediaBase() {
  if (process.env.MEDIA_BASE_URL) return process.env.MEDIA_BASE_URL.replace(/\/$/, "");
  const { GITHUB_REPOSITORY: repo, GITHUB_SHA: sha } = process.env;
  return repo && sha ? `https://raw.githubusercontent.com/${repo}/${sha}/vietnam-insta-bot/output` : null;
}

async function publish() {
  const { publishCarousel, publishReel } = require("./uploader");
  const d = dueOrArg();
  const p = loadPost(d);
  if (!p || p.status !== "approved") { console.log(`${d}: approved の投稿がないので何もしません`); return; }
  const base = mediaBase() || fail("MEDIA_BASE_URL が未設定です（画像を公開 URL に置いてから投稿）");
  const dir = outDir(d);
  const published = log.loadPublished();
  let entry = published.find((x) => x.date === d);
  if (!entry) { entry = { date: d, day: p.day, topic: p.slides[0].title }; published.push(entry); }
  const save = () => { if (!dry) log.savePublished(published); };

  if (!entry.feed) {
    const jpgs = fs.readdirSync(dir).filter((f) => /^slide-\d+\.jpg$/.test(f)).sort();
    console.log(`[publish] カルーセル ${jpgs.length} 枚${dry ? "（dry-run）" : ""}`);
    const r = await publishCarousel(jpgs.map((f) => `${base}/${d}/${f}`), p.caption, { dry, source: p.source });
    entry.feed = { mediaId: r.mediaId, permalink: r.permalink, publishedAt: new Date().toISOString() };
    save();
  } else console.log("[publish] カルーセルは投稿済み");

  if (!entry.reel && fs.existsSync(path.join(dir, "reel.mp4"))) {
    console.log(`[publish] リール${dry ? "（dry-run）" : ""}`);
    try {
      const r = await publishReel(`${base}/${d}/reel.mp4`, p.caption, { dry, source: p.source });
      entry.reel = { mediaId: r.mediaId, permalink: r.permalink, publishedAt: new Date().toISOString() };
      save();
    } catch (e) {
      console.warn(`::warning::リール投稿に失敗: ${e.message}`);
    }
  }
  if (!dry) fs.appendFileSync(path.join(ROOT, "data", "learning-log.md"),
    `- 投稿(${d}): feed ${entry.feed?.mediaId ?? "-"}${entry.reel ? ` / reel ${entry.reel.mediaId}` : ""}${entry.feed?.permalink ? ` ${entry.feed.permalink}` : ""}\n`);
}

async function metrics() {
  if (!process.env.INSTAGRAM_ACCOUNT_ID || !process.env.PAGE_ACCESS_TOKEN) return console.log("Instagram の認証情報がないのでスキップ");
  const { getInsights } = require("./uploader");
  await log.collectMetrics(getInsights);
  console.log("✔ インサイトを更新");
}

async function sample() {
  const p = JSON.parse(fs.readFileSync(path.join(ROOT, "data", "sample-post.json"), "utf8"));
  const cfg = getDayConfig(p.day);
  const dir = path.join(OUT, "sample");
  const { files, overflow } = await renderPost(p, cfg, dir);
  if (overflow.length) console.warn("はみ出し:", overflow);
  const { buildReel } = require("./reel");
  const reel = await buildReel(p, cfg, dir, []);
  console.log(`✔ ${files.length} 枚 + リール ${reel.seconds} 秒（無音）→ ${path.relative(process.cwd(), dir)}`);
}

// ---------------------------------------------------------------- generate（API キーがある場合のオプション）
async function generate() {
  if (!process.env.ANTHROPIC_API_KEY && !process.env.GEMINI_API_KEY) {
    console.log("API キーがないので generate はスキップ（通常は Claude Code の定期実行が作ります）");
    return;
  }
  const days = Number(opt("--days", 3));
  const from = opt("--from", addDays(todayJST(), 1));
  for (let i = 0; i < days; i++) {
    const d = addDays(from, i);
    if (loadPost(d)) continue;
    const cfg = getDayConfig(dayOf(d));
    console.log(`[generate] ${d} ${cfg.day}: ${cfg.title}`);
    const learnings = log.promptContext();
    const recentTopics = log.recentTopics();
    let result = await runQualityLoop(cfg, { learnings, recentTopics });
    let overflowRounds = 0;
    for (;;) {
      if (!result.passed) break;
      const { overflow } = await renderPost(result.post, cfg, outDir(d));
      if (!overflow.length || overflowRounds >= 2) { if (overflow.length) result.passed = false; break; }
      overflowRounds++;
      const prev = result;
      result = await runQualityLoop(cfg, { learnings, recentTopics, maxRetries: 2, seed: { previous: prev.post, feedback: overflowFeedback(prev.post, overflow) } });
      result.history = [...prev.history, ...result.history];
      result.lessons = [...new Set([...prev.lessons, ...result.lessons])];
    }
    log.appendRun({ date: d, dayCfg: cfg, result, overflowRounds, error: result.passed ? undefined : "品質基準未達" });
    log.addRules(result.lessons);
    if (!result.passed) { console.error(`✖ ${d} は合格しませんでした（最高 ${result.score} 点）`); continue; }
    savePost(d, { ...result.post, status: "approved",
      evaluation: { score: result.score, passed: true, history: result.history, lessons: result.lessons, overflowRounds, logged: true } });
    console.log(`WROTE ${d}`);
  }
}

// ---------------------------------------------------------------- main
const COMMANDS = { status, brief, rubric, check, record, prepare, publish, metrics, sample, generate };
(async () => {
  const fn = COMMANDS[cmd];
  if (!fn) {
    console.log(fs.readFileSync(__filename, "utf8").split("\n").filter((l) => l.startsWith("//")).slice(1, 20).map((l) => l.slice(3)).join("\n"));
    process.exit(cmd ? 1 : 0);
  }
  await fn();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
