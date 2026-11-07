#!/usr/bin/env node
// 日次パイプライン: 設定ロード → 学習ログ注入 → 生成⇄評価ループ → 描画（はみ出し差し戻し）→ 音声 → 投稿 → ログ追記
//
// 使い方:
//   node src/index.js                         今日（JST）の曜日で全工程
//   node src/index.js --day sunday            曜日を指定
//   node src/index.js --date 2026-11-08       出力フォルダ名（=投稿日）を指定
//   node src/index.js --dry-run               投稿 API を叩かない
//   node src/index.js --skip-upload           生成・描画・音声まで（GitHub Actions ではこの後 commit → --upload-only）
//   node src/index.js --upload-only --date D  output/D の画像を投稿だけする
//   node src/index.js --sample --skip-tts --skip-upload   LLM なしで data/sample-post.json を描画（デザイン確認）
//   node src/index.js --voice male            男性音声（vi-VN-NamMinhNeural）
require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });
const fs = require("fs");
const path = require("path");
const { getDayConfig, DAY_NAMES } = require("../config/schedule");
const { runQualityLoop, codeCheck } = require("./evaluator");
const { renderPost, overflowFeedback } = require("./renderer");
const { synthesizePost } = require("./tts");
const { publishCarousel, getInsights } = require("./uploader");
const log = require("./learning-log");

const ROOT = path.join(__dirname, "..");
const MAX_OVERFLOW_ROUNDS = 2;

// ---------------------------------------------------------------- CLI
const argv = process.argv.slice(2);
const flag = (n) => argv.includes(n);
const opt = (n, d) => (argv.includes(n) ? argv[argv.indexOf(n) + 1] : d);
const todayJST = () => new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);

const date = opt("--date", todayJST());
const dayArg = opt("--day", flag("--date") ? DAY_NAMES[new Date(`${date}T00:00:00Z`).getUTCDay()] : undefined);
const dry = flag("--dry-run") || process.env.DRY_RUN === "true";
const outDir = path.join(ROOT, "output", date);

function mediaBase() {
  if (process.env.MEDIA_BASE_URL) return process.env.MEDIA_BASE_URL.replace(/\/$/, "");
  const { GITHUB_REPOSITORY: repo, GITHUB_SHA: sha } = process.env;
  const sub = path.relative(process.env.GITHUB_WORKSPACE || path.join(ROOT, ".."), ROOT).split(path.sep).join("/");
  return repo && sha ? `https://raw.githubusercontent.com/${repo}/${sha}/${sub}/output` : null;
}

// ---------------------------------------------------------------- 工程
async function produce(dayCfg) {
  // 2. 学習ログから改善ルール・失敗傾向を読み込む
  const learnings = log.promptContext();
  const recentTopics = log.recentTopics();
  console.log(`[2/7] 学習ログ: ルール ${log.rules().length} 件 / 最近のトピック ${recentTopics.length} 件`);

  // 3. Generator ⇄ Evaluator
  console.log("[3/7] 生成⇄評価ループ");
  let result;
  if (flag("--sample")) {
    const post = JSON.parse(fs.readFileSync(path.join(ROOT, "data", "sample-post.json"), "utf8"));
    const { fatal, issues } = codeCheck(post, dayCfg);
    if (fatal.length || issues.length) console.warn("  sample の機械検査:", [...fatal, ...issues]);
    result = { post, score: null, passed: true, history: [], lessons: [] };
  } else {
    result = await runQualityLoop(dayCfg, { learnings, recentTopics });
    if (!result.passed) {
      const err = new Error(`品質基準（${process.env.PASS_SCORE || 85}点）に届きませんでした（最高 ${result.score}点）`);
      err.result = result;
      throw err;
    }
  }

  // 4. 描画。はみ出しがあれば Evaluator ループに「文字数オーバー」で差し戻して再要約
  let overflowRounds = 0;
  for (;;) {
    console.log("[4/7] 画像を描画");
    const { files, overflow } = await renderPost(result.post, dayCfg, outDir);
    if (!overflow.length) { result.files = files; break; }
    if (flag("--sample") || overflowRounds >= MAX_OVERFLOW_ROUNDS) {
      const err = new Error(`レイアウトに収まらないスライドがあります: ${overflow.map((o) => o.index + 1).join(", ")} 枚目`);
      err.result = result;
      throw err;
    }
    overflowRounds++;
    console.log(`  → 文字数オーバーを Evaluator ループへ差し戻し（${overflowRounds}/${MAX_OVERFLOW_ROUNDS}）`);
    const prev = result;
    result = await runQualityLoop(dayCfg, {
      learnings, recentTopics, maxRetries: 2,
      seed: { previous: prev.post, feedback: overflowFeedback(prev.post, overflow) },
    });
    result.history = [...prev.history, ...result.history];
    result.lessons = [...new Set([...prev.lessons, ...result.lessons])];
    if (!result.passed) { const err = new Error("再要約版が品質基準に届きませんでした"); err.result = result; throw err; }
    for (const f of fs.readdirSync(outDir)) if (/^slide-\d+\./.test(f)) fs.rmSync(path.join(outDir, f)); // 枚数が変わる場合の残骸を削除
  }
  result.overflowRounds = overflowRounds;
  fs.writeFileSync(path.join(outDir, "post.json"), `${JSON.stringify(result.post, null, 2)}\n`);
  fs.writeFileSync(path.join(outDir, "history.json"), `${JSON.stringify(result.history, null, 2)}\n`);

  // 5. 音声（失敗しても投稿は止めない）
  if (!flag("--skip-tts")) {
    console.log("[5/7] 音声を生成（edge-tts）");
    try {
      const voice = opt("--voice", process.env.TTS_VOICE);
      const { full, slides } = await synthesizePost(result.post, outDir, { voice });
      fs.copyFileSync(full, path.join(ROOT, "output", "audio.mp3"));
      console.log(`  ${path.relative(ROOT, full)}（+ スライド別 ${slides.length} 本）, output/audio.mp3`);
    } catch (e) {
      console.warn(`  音声生成に失敗（投稿は続行）: ${e.message}`);
    }
  }
  return result;
}

async function upload(dayCfg, post) {
  const published = log.loadPublished();
  if (published.some((p) => p.date === date && !String(p.mediaId).startsWith("dry_"))) {
    console.log(`[6/7] ${date} は投稿済みのためスキップ`);
    return null;
  }
  const base = mediaBase();
  const jpgs = fs.readdirSync(outDir).filter((f) => /^slide-\d+\.jpg$/.test(f)).sort();
  if (!base) {
    console.warn("[6/7] MEDIA_BASE_URL が未設定のため投稿をスキップ（画像を公開URLに置いてから --upload-only で投稿）");
    return null;
  }
  console.log(`[6/7] Instagram にカルーセル投稿（${jpgs.length} 枚${dry ? ", dry-run" : ""}）`);
  const res = await publishCarousel(jpgs.map((f) => `${base}/${date}/${f}`), post.caption, { dry });
  if (!dry) {
    published.push({ date, day: dayCfg.day, topic: post.slides[0].title, mediaId: res.mediaId, permalink: res.permalink, publishedAt: new Date().toISOString() });
    log.savePublished(published);
  }
  return res;
}

// ---------------------------------------------------------------- main
(async () => {
  // 1. 曜日と設定
  const dayCfg = getDayConfig(dayArg);
  console.log(`[1/7] ${date} ${dayCfg.day}: ${dayCfg.title}`);

  if (!dry && process.env.INSTAGRAM_ACCOUNT_ID && process.env.PAGE_ACCESS_TOKEN) {
    await log.collectMetrics(getInsights).catch((e) => console.warn(`  インサイト取得失敗: ${e.message}`));
  }

  if (flag("--upload-only")) {
    const post = JSON.parse(fs.readFileSync(path.join(outDir, "post.json"), "utf8"));
    const res = await upload(dayCfg, post);
    if (res && !dry) fs.appendFileSync(path.join(ROOT, "data", "learning-log.md"), `- 投稿(${date}): ${res.mediaId}${res.permalink ? ` ${res.permalink}` : ""}\n`);
    return;
  }

  let result;
  try {
    result = await produce(dayCfg);
  } catch (e) {
    console.error(`✖ ${e.message}`);
    if (!flag("--sample")) {
      log.appendRun({ date, dayCfg, result: e.result, error: e.message.slice(0, 80) });
      log.addRules(e.result?.lessons);
    }
    process.exit(1);
  }

  const publish = flag("--skip-upload") ? null : await upload(dayCfg, result.post);

  // 7. 学習ログに追記
  if (!flag("--sample")) {
    log.appendRun({ date, dayCfg, result, overflowRounds: result.overflowRounds, publish });
    log.addRules(result.lessons);
    console.log("[7/7] data/learning-log.md を更新");
  }
  console.log(`✔ 完了: ${path.relative(ROOT, outDir)}`);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
