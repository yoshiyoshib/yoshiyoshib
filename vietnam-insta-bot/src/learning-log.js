// data/learning-log.md の読み書き（改善ルール・失敗傾向・パフォーマンスの蓄積）
const fs = require("fs");
const path = require("path");

const LOG = path.join(__dirname, "..", "data", "learning-log.md");
const PUBLISHED = path.join(__dirname, "..", "data", "published.json");
const MAX_RULES = 30;

const read = () => fs.readFileSync(LOG, "utf8");
const section = (md, name) => md.match(new RegExp(`<!-- ${name}:START -->\\n([\\s\\S]*?)<!-- ${name}:END -->`))?.[1] ?? "";
const replaceSection = (md, name, body) =>
  md.replace(new RegExp(`(<!-- ${name}:START -->\\n)[\\s\\S]*?(<!-- ${name}:END -->)`), `$1${body}$2`);

function rules(md = read()) {
  return section(md, "RULES").split("\n").filter((l) => l.startsWith("- ")).map((l) => l.slice(2).trim());
}

/** 実行ログのエントリを新しい順に返す */
function entries(md = read()) {
  const body = md.split("## 実行ログ")[1] || "";
  return body.split(/\n(?=### )/).filter((e) => e.startsWith("### ")).reverse();
}

/** 最近扱ったトピック（重複防止用） */
function recentTopics(n = 21) {
  return entries().slice(0, n).map((e) => e.match(/^- トピック: (.+)$/m)?.[1]).filter(Boolean);
}

/** Generator のプロンプトに注入するテキスト（改善ルール + 直近の失敗傾向 + 伸びた投稿） */
function promptContext() {
  const md = read();
  const out = [];
  const r = rules(md);
  if (r.length) out.push("## 改善ルール", ...r.map((x) => `- ${x}`));

  // 直近 7 回の初稿で減点された観点を集計 → 失敗傾向
  const counts = {};
  const reasons = [];
  for (const e of entries(md).slice(0, 7)) {
    for (const m of e.matchAll(/^- 減点\[(\w+)\] (.+)$/gm)) {
      counts[m[1]] = (counts[m[1]] || 0) + 1;
      if (reasons.length < 8) reasons.push(`${m[1]}: ${m[2]}`);
    }
  }
  if (reasons.length) {
    out.push("", "## 直近の失敗傾向（同じミスを繰り返さない）",
      `観点別の減点回数: ${Object.entries(counts).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}=${v}`).join(", ")}`,
      ...reasons.map((x) => `- ${x}`));
  }

  // 保存数が多かった投稿 → 伸びる傾向
  const top = loadPublished().filter((p) => p.metrics?.saved != null)
    .sort((a, b) => b.metrics.saved - a.metrics.saved).slice(0, 3);
  if (top.length) {
    out.push("", "## 保存が多かった投稿（この方向性を参考に）",
      ...top.map((p) => `- ${p.day} 「${p.topic}」 保存${p.metrics.saved} / リーチ${p.metrics.reach ?? "-"} / リール再生${p.reelMetrics?.views ?? "-"}`));
  }
  return out.join("\n");
}

/** Evaluator が出した汎用ルールを追加（重複は除外、古いものから押し出し） */
function addRules(newRules) {
  if (!newRules?.length) return;
  let md = read();
  const cur = rules(md);
  const norm = (s) => s.replace(/\s+/g, "").toLowerCase();
  const seen = new Set(cur.map(norm));
  for (const r of newRules) if (r && !seen.has(norm(r))) { cur.push(r.replace(/\n/g, " ")); seen.add(norm(r)); }
  md = replaceSection(md, "RULES", cur.slice(-MAX_RULES).map((x) => `- ${x}\n`).join(""));
  fs.writeFileSync(LOG, md);
}

/** 1回分の実行ログを追記 */
function appendRun({ date, dayCfg, result, overflowRounds = 0, publish, error }) {
  const first = result?.history?.[0];
  const status = error ? `失敗（${error}）` : result?.passed ? "合格" : "不合格";
  const lines = [
    `### ${date} (${dayCfg.day} / ${dayCfg.theme}) — ${status} ${result?.score ?? "-"}点 / ${result?.history?.length ?? 0}ループ`,
    `- トピック: ${result?.post?.slides?.[0]?.title ?? "-"}`,
    `- 推移: ${(result?.history || []).map((h) => `${h.label} ${h.score}`).join(" → ") || "-"}`,
  ];
  if (overflowRounds) lines.push(`- レイアウト差し戻し: ${overflowRounds}回（文字数オーバー）`);
  // 初稿の減点理由（失敗傾向として次回に注入される）
  for (const d of (first?.deductions || []).slice(0, 6))
    lines.push(`- 減点[${d.criterion}] ${String(d.reason).replace(/\n/g, " ").slice(0, 120)}（-${d.points}）`);
  for (const c of (first?.codeIssues || []).slice(0, 4)) lines.push(`- 減点[code] ${c.slice(0, 120)}`);
  if (result?.lessons?.length) lines.push(`- 新ルール: ${result.lessons.join(" / ")}`);
  if (publish) lines.push(`- 投稿: ${publish.mediaId}${publish.permalink ? ` ${publish.permalink}` : ""}`);
  fs.appendFileSync(LOG, `\n${lines.join("\n")}\n`);
}

// ---------------------------------------------------------------- 投稿記録とインサイト
function loadPublished() {
  try { return JSON.parse(fs.readFileSync(PUBLISHED, "utf8")); } catch { return []; }
}
function savePublished(list) {
  fs.writeFileSync(PUBLISHED, `${JSON.stringify(list, null, 2)}\n`);
}

/** 24時間以上たってインサイト未取得の投稿について数字を取り、パフォーマンス表に書く */
async function collectMetrics(getInsights) {
  const list = loadPublished();
  const old = (x) => x?.mediaId && Date.now() - Date.parse(x.publishedAt) > 24 * 3600e3;
  const due = list.filter((p) => (old(p.feed) && !p.metrics) || (old(p.reel) && !p.reelMetrics));
  if (!due.length) return;
  let md = read();
  let rows = section(md, "PERF");
  for (const p of due) {
    if (old(p.feed) && !p.metrics) p.metrics = await getInsights(p.feed.mediaId);
    if (old(p.reel) && !p.reelMetrics) p.reelMetrics = await getInsights(p.reel.mediaId, "reach,saved,shares,likes,comments,views");
    if (!p.metrics) continue;
    const m = p.metrics;
    rows += `| ${p.date} | ${p.day} | ${p.topic} | ${m.reach ?? "-"} | ${m.saved ?? "-"} | ${m.shares ?? "-"} | ${m.likes ?? "-"} | ${m.comments ?? "-"} | ${p.reelMetrics?.views ?? "-"} |\n`;
  }
  md = replaceSection(md, "PERF", rows);
  fs.writeFileSync(LOG, md);
  savePublished(list);
}

module.exports = { promptContext, recentTopics, addRules, appendRun, loadPublished, savePublished, collectMetrics, rules };
