// Renderer: JSON → HTML テンプレート → Puppeteer で 1080x1350 (dpr 2) の PNG / JPEG を書き出す
//   各スライドの .fit 要素について scrollHeight > clientHeight を判定し、
//   はみ出したらフォントを 2px ずつ縮小（data-min まで）。それでも収まらなければ overflow として返す。
const fs = require("fs");
const path = require("path");
const { FONTS } = require("../config/schedule");

const TPL_DIR = path.join(__dirname, "..", "templates");
const WIDTH = 1080;
const HEIGHT = 1350;
const DAY_LABEL = { monday: "MON 漢越語", tuesday: "TUE 会話", wednesday: "WED 方言", thursday: "THU 文法",
  friday: "FRI 成語", saturday: "SAT 発音", sunday: "SUN 長文精読" };

// ---------------------------------------------------------------- テンプレート
const tplCache = {};
const tpl = (name) => (tplCache[name] ??= fs.readFileSync(path.join(TPL_DIR, name), "utf8"));

const esc = (s = "") =>
  String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** <mark> だけを許可した安全な HTML（それ以外のタグはエスケープ） */
const markHtml = (s = "") => esc(s).replace(/&lt;(\/?)mark&gt;/g, "<$1mark>");

/** {{x}} はエスケープして、{{{x}}} は生 HTML として差し込む */
function fill(template, vars) {
  return template
    .replace(/\{\{\{(\w+)\}\}\}/g, (_, k) => vars[k] ?? "")
    .replace(/\{\{(\w+)\}\}/g, (_, k) => esc(vars[k] ?? ""));
}

const headingHtml = (h) => (h ? `<h2 class="heading">${esc(h)}</h2>` : "");
const annotationHtml = (a) => (a ? `<div class="note">${markHtml(a)}</div>` : "");

function vocabHtml(slide) {
  const rows = slide.items
    .map((it) => `<tr><td class="w" lang="vi">${esc(it.word)}${it.pos ? `<span class="p">${esc(it.pos)}</span>` : ""}</td>` +
      `<td class="m">${esc(it.meaning)}${it.note ? `<span class="n">${esc(it.note)}</span>` : ""}</td></tr>`)
    .join("");
  return `<table class="vocab">${rows}</table>`;
}

function breakdownHtml(slide) {
  const items = slide.breakdown
    .map((b) => `<li><span class="part">${esc(b.part)}</span><span class="text" lang="vi">${markHtml(b.text)}</span>` +
      `<span class="exp">${esc(b.explanation)}</span></li>`)
    .join("");
  return `<div class="target" lang="vi">${markHtml(slide.targetSentence)}</div>` +
    (slide.translation ? `<div class="target-ja">${esc(slide.translation)}</div>` : "") +
    `<ul class="bd">${items}</ul>`;
}

/** 1スライド分の完全な HTML を返す */
function buildSlideHtml(post, slide, index, total, dayCfg) {
  const styles = tpl("styles.css");
  let paragraphNo = 0;
  for (let i = 0; i <= index; i++) if (post.slides[i].type === "text_with_translation") paragraphNo++;
  const common = {
    styles,
    fontsUrl: FONTS.googleFontsUrl,
    themeColor: post.themeColor || dayCfg.themeColor,
    accentColor: dayCfg.accentColor,
    brand: process.env.BRAND_NAME || "Tiếng Việt Lab",
    dayLabel: DAY_LABEL[post.day] || post.day,
    topicLabel: dayCfg.title,
    page: index + 1,
    total,
    headingHtml: headingHtml(slide.heading),
  };
  switch (slide.type) {
    case "cover":
      return fill(tpl("slide-cover.html"), { ...common, title: slide.title, subtitle: slide.subtitle, badge: slide.badge });
    case "text_with_translation":
      return fill(tpl(post.theme === "reading" ? "slide-reading.html" : "slide-content.html"), {
        ...common,
        paragraphNo,
        vietnameseHtml: markHtml(slide.vietnameseText),
        japaneseText: slide.japaneseText,
        annotationHtml: annotationHtml(slide.annotation),
      });
    case "vocabulary":
      return fill(tpl("slide-vocab.html"), { ...common, headingHtml: headingHtml(slide.heading || "単語リスト"), bodyHtml: vocabHtml(slide) });
    case "grammar_breakdown":
      return fill(tpl("slide-vocab.html"), { ...common, headingHtml: headingHtml(slide.heading || "構文分解"), bodyHtml: breakdownHtml(slide) });
    default:
      throw new Error(`未知のスライド type: ${slide.type}`);
  }
}

// ---------------------------------------------------------------- ブラウザ内で実行する自己縮小ロジック
/* istanbul ignore next — page.evaluate でブラウザ側で実行される */
function shrinkToFit(step) {
  const results = [];
  for (const el of document.querySelectorAll(".fit")) {
    const min = Number(el.dataset.min || 18);
    let size = parseFloat(getComputedStyle(el).fontSize);
    const start = size;
    const overflows = () => el.scrollHeight > el.clientHeight + 1 || el.scrollWidth > el.clientWidth + 1;
    while (overflows() && size - step >= min) {
      size -= step;
      el.style.fontSize = `${size}px`;
    }
    const still = overflows();
    results.push({
      start, final: size, min, overflow: still,
      // どれだけ削れば収まるかの目安（最小サイズでの縦方向のはみ出し率）
      excessRatio: still ? +(el.scrollHeight / el.clientHeight - 1).toFixed(2) : 0,
    });
  }
  // スライド全体（ヘッダー・見出し含む）のはみ出しも確認
  const slide = document.querySelector(".slide");
  const slideOverflow = slide.scrollHeight > slide.clientHeight + 1;
  return { results, slideOverflow };
}

// ---------------------------------------------------------------- Puppeteer
async function launchBrowser() {
  const puppeteer = require("puppeteer");
  const args = ["--no-sandbox", "--disable-setuid-sandbox", "--font-render-hinting=none"];
  // Chrome は HTTPS_PROXY 環境変数を自動では使わないので明示的に渡す（Google Fonts 取得用）
  const proxy = process.env.HTTPS_PROXY || process.env.https_proxy;
  if (proxy) args.push(`--proxy-server=${proxy}`);
  return puppeteer.launch({
    headless: true,
    executablePath: process.env.CHROME_PATH || process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
    args,
  });
}

/** フォントを確実に読み込む（全ウェイト × 声調記号付きの文字で明示ロード） */
async function waitFonts(page) {
  await page.evaluate(async () => {
    const sample = "Tiếng Việt ắằẳẵặ ếềểễệ ốồổỗộ ớờởỡợ ứừửữự đ 日本語";
    const loads = [];
    for (const fam of ["Be Vietnam Pro", "Noto Sans JP"])
      for (const w of [400, 600, 800]) loads.push(document.fonts.load(`${w} 40px "${fam}"`, sample));
    await Promise.allSettled(loads);
    await document.fonts.ready;
  });
  const ok = await page.evaluate(() => document.fonts.check('800 40px "Be Vietnam Pro"', "ệ") && document.fonts.check('400 40px "Noto Sans JP"', "日"));
  if (!ok) throw new Error("Google Fonts（Be Vietnam Pro / Noto Sans JP）を読み込めませんでした。ネットワークを確認してください");
}

/**
 * 全スライドを書き出す
 * @returns {{ files: {png:string, jpg:string}[], overflow: {index:number, type:string, excessRatio:number}[] }}
 *   overflow が空でなければ、呼び出し側が Evaluator に「文字数オーバー」として差し戻す
 */
async function renderPost(post, dayCfg, outDir, { step = 2 } = {}) {
  fs.mkdirSync(outDir, { recursive: true });
  const browser = await launchBrowser();
  const files = [];
  const overflow = [];
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: WIDTH, height: HEIGHT, deviceScaleFactor: 2 });
    const total = post.slides.length;
    for (let i = 0; i < total; i++) {
      const slide = post.slides[i];
      const html = buildSlideHtml(post, slide, i, total, dayCfg);
      const n = String(i + 1).padStart(2, "0");
      fs.writeFileSync(path.join(outDir, `slide-${n}.html`), html); // デバッグ用に HTML も残す
      // networkidle0 は Noto Sans JP の大量サブセット取得で終わらないことがあるので load + fonts 待機にする
      await page.setContent(html, { waitUntil: "load", timeout: 90000 });
      await waitFonts(page);
      const { results, slideOverflow } = await page.evaluate(shrinkToFit, step);
      const bad = results.find((r) => r.overflow);
      if (bad || slideOverflow) {
        overflow.push({ index: i, type: slide.type, excessRatio: bad?.excessRatio ?? 0.1 });
        console.warn(`  [render] slide ${n} (${slide.type}) は最小フォントでもはみ出し（+${Math.round((bad?.excessRatio ?? 0.1) * 100)}%）`);
      } else if (results.some((r) => r.final < r.start)) {
        console.log(`  [render] slide ${n}: フォント ${results.map((r) => `${r.start}→${r.final}px`).join(", ")} に縮小`);
      }
      const png = path.join(outDir, `slide-${n}.png`);
      const jpg = path.join(outDir, `slide-${n}.jpg`); // Instagram Graph API は JPEG のみ受け付ける
      await page.screenshot({ path: png, type: "png", clip: { x: 0, y: 0, width: WIDTH, height: HEIGHT } });
      await page.screenshot({ path: jpg, type: "jpeg", quality: 92, clip: { x: 0, y: 0, width: WIDTH, height: HEIGHT } });
      files.push({ png, jpg });
    }
  } finally {
    await browser.close();
  }
  return { files, overflow };
}

/** オーバーフロー結果を Generator 向けの修正指示に変換 */
function overflowFeedback(post, overflow) {
  return overflow.map(({ index, type, excessRatio }) => {
    const cut = Math.min(60, Math.max(15, Math.ceil(excessRatio * 100) + 10));
    return `[文字数オーバー] slides[${index}](${type}) は最小フォントでも画面に収まらない。` +
      `このスライドの文字量を約${cut}%削って要約するか、内容を2枚に分割する（全体で10枚以内）。`;
  });
}

module.exports = { renderPost, buildSlideHtml, overflowFeedback, markHtml, WIDTH, HEIGHT };
