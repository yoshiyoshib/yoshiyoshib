#!/usr/bin/env node
// Usage: node insta/render.js insta/posts/2026-11-03.json
// Writes insta/out/<date>/01.png ... and caption.txt
const fs = require("fs");
const path = require("path");

function loadPlaywright() {
  try { return require("playwright"); } catch {
    const root = require("child_process").execSync("npm root -g").toString().trim();
    return require(path.join(root, "playwright"));
  }
}

(async () => {
  const file = process.argv[2];
  if (!file) { console.error("Usage: node insta/render.js <post.json>"); process.exit(1); }
  const post = JSON.parse(fs.readFileSync(file, "utf8"));
  const cfg = JSON.parse(fs.readFileSync(path.join(__dirname, "config.json"), "utf8"));
  const outDir = path.join(__dirname, "out", post.date);
  fs.mkdirSync(outDir, { recursive: true });

  const { chromium } = loadPlaywright();
  const proxy = process.env.HTTPS_PROXY || process.env.https_proxy;
  const browser = await chromium.launch(proxy ? { proxy: { server: proxy } } : {});
  const page = await browser.newPage({ viewport: { width: 1200, height: 1400 }, deviceScaleFactor: 1 });
  await page.goto("file://" + path.join(__dirname, "template.html"));
  await page.waitForLoadState("networkidle");
  await page.evaluate(([p, c]) => window.renderPost(p, c), [post, cfg]);
  await page.waitForLoadState("networkidle");
  await page.evaluate(() => document.fonts.ready);

  const slides = await page.$$(".slide");
  for (let i = 0; i < slides.length; i++) {
    const out = path.join(outDir, String(i + 1).padStart(2, "0") + ".png");
    await slides[i].screenshot({ path: out });
    console.log("wrote", out);
  }
  if (post.caption) {
    fs.writeFileSync(path.join(outDir, "caption.txt"), post.caption.trim() + "\n");
    console.log("wrote", path.join(outDir, "caption.txt"));
  }
  await browser.close();
})().catch(e => { console.error(e); process.exit(1); });
