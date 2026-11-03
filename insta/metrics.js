#!/usr/bin/env node
// Collects Instagram insights for published posts into insta/metrics/latest.json.
// Claude reads that file in the weekly run and updates insta/learnings.md.
// Env: IG_ACCESS_TOKEN
const fs = require("fs");
const path = require("path");
const { DIR, loadPost } = require("./lib");

const API = `https://graph.instagram.com/${process.env.IG_API_VERSION || "v23.0"}`;
const TOKEN = process.env.IG_ACCESS_TOKEN;
const LOG = path.join(DIR, "published.json");
const OUT = path.join(DIR, "metrics", "latest.json");
// Asked for in this order; any the API rejects are dropped and the rest retried.
const WANT = ["reach", "views", "saved", "shares", "likes", "comments", "total_interactions", "follows", "profile_visits"];

async function insights(id, metrics) {
  const res = await fetch(`${API}/${id}/insights?metric=${metrics.join(",")}&access_token=${TOKEN}`);
  const json = await res.json();
  if (json.error) {
    const bad = metrics.find(m => json.error.message && json.error.message.includes(m));
    if (bad) return insights(id, metrics.filter(m => m !== bad));
    throw new Error(`${id}: ${json.error.message}`);
  }
  return Object.fromEntries(json.data.map(d => [d.name, d.values ? d.values[0].value : d.total_value?.value]));
}

(async () => {
  if (!TOKEN) { console.log("::warning::IG_ACCESS_TOKEN is not set. Skipping."); return; }
  if (!fs.existsSync(LOG)) { console.log("Nothing published yet."); return; }
  const log = JSON.parse(fs.readFileSync(LOG, "utf8"));
  const out = fs.existsSync(OUT) ? JSON.parse(fs.readFileSync(OUT, "utf8")) : {};
  for (const [date, e] of Object.entries(log)) {
    const post = loadPost(date) || {};
    const row = { kind: e.kind, level: post.level, theme: post.theme?.ja, terms: (post.items || []).map(i => i.term) };
    for (const part of ["feed", "reel", "story"]) {
      if (!e[part]) continue;
      try { row[part] = await insights(e[part], WANT); } catch (err) { row[part] = { error: err.message }; }
    }
    row.collected = new Date().toISOString();
    out[date] = row;
  }
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(out, null, 2) + "\n");
  console.log(`metrics for ${Object.keys(out).length} days → ${path.relative(process.cwd(), OUT)}`);
})().catch(e => { console.error(e.message); process.exit(1); });
