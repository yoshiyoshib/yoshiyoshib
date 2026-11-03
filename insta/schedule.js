#!/usr/bin/env node
// Prints the plan for the next N days: which kind each day gets, its post number, and its status.
// Usage: node insta/schedule.js [startDate=tomorrow JST] [days=7]
const { allPosts, addDays, todayJST, slotFor, loadPost } = require("./lib");

const start = process.argv[2] || addDays(todayJST(), 1);
const days = Number(process.argv[3] || 7);
const posts = allPosts();
let nextNo = Math.max(0, ...posts.map(p => p.no || 0)) + 1;
const used = new Set(posts.flatMap(p => (p.items || []).map(i => i.term.toLowerCase())));
const WD = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

console.log(`Used terms so far: ${used.size}`);
for (let i = 0; i < days; i++) {
  const date = addDays(start, i);
  const slot = slotFor(date);
  const existing = loadPost(date);
  const no = existing ? existing.no : nextNo++;
  const label = slot.kind + (slot.level ? ` ${slot.level}` : "");
  console.log(`${date} ${WD[new Date(date + "T00:00:00Z").getUTCDay()]}  no=${no}  ${label.padEnd(10)}  ${existing ? existing.status || "draft" : "missing"}`);
}
