#!/usr/bin/env node
// Publishes an approved post through the official Instagram Graph API (professional account linked to a Facebook Page).
// Usage: node insta/publish.js feed|story|check|find-id [--date YYYY-MM-DD] [--dry-run]
//   feed  : carousel (01.jpg…) and, on reel weekdays, reel.mp4 — run in the evening
//   story : story.jpg (yesterday's quiz answer) — run in the morning
//   find-id : list the Instagram account IDs the token can reach (needs IG_ACCESS_TOKEN only)
//   check : confirm IG_USER_ID + IG_ACCESS_TOKEN work and show the account name
// Env: IG_USER_ID, IG_ACCESS_TOKEN, MEDIA_BASE_URL (optional; defaults to raw GitHub URLs at the current commit)
// Only posts whose JSON has "status": "approved" are published. Results are logged to insta/published.json.
const fs = require("fs");
const path = require("path");
const { API, DIR, config, loadPost, todayJST, weekday, addDays } = require("./lib");

const args = process.argv.slice(2);
const mode = args[0];
// Which day's post is due. GitHub's scheduled runs can start hours late, so the date comes from
// "JST now minus the slot's hour": a feed run (slot 21:00) at 04:52 the next morning still means
// yesterday's post (posted late, never the next day's post early). Stories have an 08:00 slot.
const SLOT_HOUR = { feed: 20, story: 7 };
const dueDate = m => new Date(Date.now() + (9 - (SLOT_HOUR[m] ?? 0)) * 3600e3).toISOString().slice(0, 10);
const date = args.includes("--date") ? args[args.indexOf("--date") + 1] : dueDate(mode);
// check / find-id only read data, so they always call the real API.
const dry = !["check", "find-id"].includes(mode) && (args.includes("--dry-run") || process.env.DRY_RUN === "true");
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
  if (!["feed", "story", "check", "find-id"].includes(mode)) { console.error("Usage: node insta/publish.js feed|story|check|find-id [--date D] [--dry-run]"); process.exit(1); }
  if (mode === "find-id") {
    if (!IG_ACCESS_TOKEN) { console.error("IG_ACCESS_TOKEN is not set."); process.exit(1); }
    const { data } = await api("GET", "me/accounts", { fields: "name,instagram_business_account{id,username}" });
    if (!data.length) console.log("No Facebook Pages are assigned to this token. Assign the Page to the system user and regenerate the token.");
    for (const pg of data) {
      const ig = pg.instagram_business_account;
      console.log(`Page "${pg.name}": ${ig ? `Instagram @${ig.username} → IG_USER_ID = ${ig.id}` : "no Instagram account linked"}`);
    }
    return;
  }
  if (mode === "check") {
    if (!IG_USER_ID || !IG_ACCESS_TOKEN) { console.error("Set both IG_USER_ID and IG_ACCESS_TOKEN."); process.exit(1); }
    const me = await api("GET", IG_USER_ID, { fields: "username,followers_count,media_count" });
    console.log(`OK: @${me.username} · followers ${me.followers_count} · posts ${me.media_count}`);
    const lim = await api("GET", `${IG_USER_ID}/content_publishing_limit`, { fields: "quota_usage,config" });
    console.log("publishing quota:", JSON.stringify(lim.data?.[0] || lim));
    return;
  }
  if (!dry && (!IG_USER_ID || !IG_ACCESS_TOKEN)) { console.log("::warning::IG_USER_ID / IG_ACCESS_TOKEN are not set. Skipping."); return; }
  if (!base) { console.error("MEDIA_BASE_URL is not set and this is not running in GitHub Actions."); process.exit(1); }

  const log = fs.existsSync(LOG) ? JSON.parse(fs.readFileSync(LOG, "utf8")) : {};
  const post = loadPost(date);
  const outDir = path.join(DIR, "out", date);

  if (mode === "feed") {
    if (!post) { console.log(`::warning::No post for ${date}. Nothing to publish.`); return; }
    if (post.status !== "approved" && !dry) { console.log(`::warning::${date} is "${post.status || "draft"}", not approved. Skipping.`); return; }
  } else {
    // The morning story answers yesterday's quiz, so it goes out only if yesterday's post was published.
    const prevDate = addDays(date, -1);
    if (!log[prevDate]?.feed && !dry) { console.log(`::warning::${prevDate} was not published, so there is no quiz to answer. Skipping.`); return; }
  }
  const entry = log[date] || (post ? { kind: post.kind, no: post.no } : { story_only: true });

  if (mode === "feed") {
    const caption = fs.readFileSync(path.join(outDir, "caption.txt"), "utf8").trim();
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
