// Shared helpers: weekday rotation, post loading, Japan dates.
const fs = require("fs");
const path = require("path");

const DIR = __dirname;
const POSTS = path.join(DIR, "posts");

// 0 = Sunday. Mon/Thu phrasal verbs, Tue/Fri idioms, Wed C1 words, Sat C2 words, Sun weekly review.
const ROTATION = {
  1: { kind: "phrasal" },
  2: { kind: "idiom" },
  3: { kind: "word", level: "C1" },
  4: { kind: "phrasal" },
  5: { kind: "idiom" },
  6: { kind: "word", level: "C2" },
  0: { kind: "review" },
};

const config = () => JSON.parse(fs.readFileSync(path.join(DIR, "config.json"), "utf8"));
const postPath = date => path.join(POSTS, `${date}.json`);
const loadPost = date => fs.existsSync(postPath(date)) ? JSON.parse(fs.readFileSync(postPath(date), "utf8")) : null;
const allPosts = () => fs.readdirSync(POSTS).filter(f => /^\d{4}-\d{2}-\d{2}\.json$/.test(f)).sort()
  .map(f => JSON.parse(fs.readFileSync(path.join(POSTS, f), "utf8")));

const addDays = (date, n) => {
  const t = new Date(date + "T00:00:00Z"); t.setUTCDate(t.getUTCDate() + n);
  return t.toISOString().slice(0, 10);
};
const weekday = date => new Date(date + "T00:00:00Z").getUTCDay();
const todayJST = () => new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);
const slotFor = date => ROTATION[weekday(date)];

// The Monday–Saturday posts that a Sunday review covers (only ones that are approved to go out).
const weekFor = sunday => [6, 5, 4, 3, 2, 1].map(n => loadPost(addDays(sunday, -n))).filter(p => p && p.status === "approved");

// Facebook-login route: works with a non-expiring system user token from Meta Business settings.
const API = `${process.env.IG_GRAPH_HOST || "https://graph.facebook.com"}/${process.env.IG_API_VERSION || "v23.0"}`;

module.exports = { API, DIR, POSTS, ROTATION, config, postPath, loadPost, allPosts, addDays, weekday, todayJST, slotFor, weekFor };
