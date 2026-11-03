#!/usr/bin/env node
// Publishes an approved post through the official Instagram API (Instagram Login, business/creator account).
// Usage: node insta/publish.js feed|story [--date YYYY-MM-DD] [--dry-run]
//   feed  : carousel (01.jpg…) and, on reel weekdays, reel.mp4 — run in the evening
//   story : story.jpg (yesterday's quiz answer) — run in the morning
// Env: IG_USER_ID, IG_ACCESS_TOKEN, MEDIA_BASE_URL (optional; defaults to raw GitHub URLs at the current commit)
// Only posts whose JSON has "status": "approved" are published. Results are logged to insta/published.json.
const fs = require("fs");
const path = require("path");
const { DIR, config, loadPost, todayJST, weekday } = require("./lib");

const args = process.argv.slice(2);
const mode = args[0];
const date = args.includes("--date") ? args[args.indexOf("--date") + 1] : todayJST();
const dry = args.includes("--dry-run") || process.env.DRY_RUN === "true";
const API = `https://graph.instagram.com/${process.env.IG_API_VERSION || "v23.0"}`;
const { IG_USER_ID, IG_ACCESS_TOKEN } = process.env;
const LOG = path.join(DIR, "published.json");

const base = process.env.MEDIA_BASE_URL ||
  (process.env.GITHUB_REPOSITORY && process.env.GITHUB_SHA
    ? `https://raw.githubusercontent.com/${process.env.GITHUB_REPOSITORY}/${process.env.GITHUB_SHA}/insta/out`
    : null);
const url = f => `${base}/${date}/${f}`;
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function api(method, p, params = {}) {
  if (dry) { console.log(`[dry-run] ${method} ${p}`, JSON.stringify(params).slice(0, 200)); return { id: `dry_${Math.random().toString(36).slice(2, 8)}` }; }
  const body = new URLSearchParams({ ...params, access_token: IG_ACCESS_TOKEN });
  const res = method === "GET"
    ? await fetch(`${API}/${p}?${body}`)
    : await fetch(`${API}/${p}`, { method, body });
  const json = await res.json();
  if (!res.ok || json.error) throw new Error(`${method} ${p}: ${JSON.stringify(json.error || json)}`);
  return json;
}

async function waitReady(id, label) {
  if (dry) return;
  for (let i = 0; i < 60; i++) {
    const { status_code } = await api("GET", id, { fields: "status_code" });
    if (status_code === "FINISHED") return;
    if (status_code === "ERROR" || status_code === "EXPIRED") throw new Error(`${label} container ${status_code}`);
    await sleep(5000);
  }
  throw new Error(`${label} container not ready after 5 minutes`);
}

async function publish(creationId, label) {
  await waitReady(creationId, label);
  const { id } = await api("POST", `${IG_USER_ID}/media_publish`, { creation_id: creationId });
  console.log(`published ${label}: ${id}`);
  return id;
}

(async () => {
  if (!["feed", "story"].includes(mode)) { console.error("Usage: node insta/publish.js feed|story [--date D] [--dry-run]"); process.exit(1); }
  if (!dry && (!IG_USER_ID || !IG_ACCESS_TOKEN)) { console.log("::warning::IG_USER_ID / IG_ACCESS_TOKEN are not set. Skipping."); return; }
  if (!base) { console.error("MEDIA_BASE_URL is not set and this is not running in GitHub Actions."); process.exit(1); }

  const post = loadPost(date);
  if (!post) { console.log(`::warning::No post for ${date}. Nothing to publish.`); return; }
  if (post.status !== "approved" && !dry) { console.log(`::warning::${date} is "${post.status || "draft"}", not approved. Skipping.`); return; }

  const log = fs.existsSync(LOG) ? JSON.parse(fs.readFileSync(LOG, "utf8")) : {};
  const entry = log[date] || { kind: post.kind, no: post.no };
  const outDir = path.join(DIR, "out", date);
  const caption = fs.readFileSync(path.join(outDir, "caption.txt"), "utf8").trim();

  if (mode === "feed") {
    if (!entry.feed) {
      const slides = fs.readdirSync(outDir).filter(f => /^\d\d\.jpg$/.test(f)).sort();
      const children = [];
      for (const f of slides) children.push((await api("POST", `${IG_USER_ID}/media`, { image_url: url(f), is_carousel_item: "true" })).id);
      for (const c of children) await waitReady(c, "slide");
      const carousel = await api("POST", `${IG_USER_ID}/media`, { media_type: "CAROUSEL", children: children.join(","), caption });
      entry.feed = await publish(carousel.id, "carousel");
    } else console.log(`carousel for ${date} already published (${entry.feed})`);

    const reelDays = config().reel_weekdays || [];
    if (reelDays.includes(weekday(date)) && !entry.reel && fs.existsSync(path.join(outDir, "reel.mp4"))) {
      const reel = await api("POST", `${IG_USER_ID}/media`, { media_type: "REELS", video_url: url("reel.mp4"), caption, share_to_feed: "true" });
      entry.reel = await publish(reel.id, "reel");
    }
  }

  if (mode === "story") {
    if (entry.story) console.log(`story for ${date} already published (${entry.story})`);
    else if (!fs.existsSync(path.join(outDir, "story.jpg"))) console.log(`No story image for ${date}.`);
    else {
      const story = await api("POST", `${IG_USER_ID}/media`, { media_type: "STORIES", image_url: url("story.jpg") });
      entry.story = await publish(story.id, "story");
    }
  }

  if (!dry) {
    entry.updated = new Date().toISOString();
    log[date] = entry;
    fs.writeFileSync(LOG, JSON.stringify(log, null, 2) + "\n");
  }
})().catch(e => { console.error(e.message); process.exit(1); });
