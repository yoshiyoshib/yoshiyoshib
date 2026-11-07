// リール（1080x1920 / H.264 + AAC）を作る
//   各スライド画像を縦長フレームに配置し、スライドごとの音声を付けてつなぐ。
//   土曜（シャドーイング）は、音声のあとに同じ長さの無音を入れてリピートできるようにする。
const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");
const { FONTS } = require("../config/schedule");
const { launchBrowser, waitFonts, esc } = require("./renderer");

const FPS = 30;
const MAX_SECONDS = 180;

const ff = (args) => execFileSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", ...args], { stdio: ["ignore", "ignore", "pipe"] });
const duration = (file) =>
  Number(execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", file]).toString().trim());

const BADGE = { cover: "🔊 音声つき", text_with_translation: "🔊 聞いてみよう", vocabulary: "🔊 単語チェック", grammar_breakdown: "🔊 構文を確認" };

/** スライド画像（slide-XX.jpg）→ リール用フレーム（reel-XX.png） */
async function renderFrames(post, dayCfg, outDir) {
  const tpl = fs.readFileSync(path.join(__dirname, "..", "templates", "reel-frame.html"), "utf8");
  const browser = await launchBrowser();
  const frames = [];
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1080, height: 1920, deviceScaleFactor: 1 });
    for (let i = 0; i < post.slides.length; i++) {
      const n = String(i + 1).padStart(2, "0");
      const jpg = fs.readFileSync(path.join(outDir, `slide-${n}.jpg`)).toString("base64");
      const s = post.slides[i];
      const shadow = post.theme === "shadowing" && s.type === "text_with_translation";
      const vars = {
        fontsUrl: FONTS.googleFontsUrl,
        themeColor: post.themeColor || dayCfg.themeColor,
        accentColor: dayCfg.accentColor,
        badge: shadow ? "🔁 音声のあとに続けて言おう" : BADGE[s.type] || "🔊",
        title: post.slides[0].title,
        bottom: i === post.slides.length - 1 ? "全訳と解説はプロフィールの投稿で 🔖" : `${i + 1} / ${post.slides.length}`,
        imgSrc: `data:image/jpeg;base64,${jpg}`,
      };
      const html = tpl.replace(/\{\{\{(\w+)\}\}\}/g, (_, k) => vars[k]).replace(/\{\{(\w+)\}\}/g, (_, k) => esc(vars[k]));
      await page.setContent(html, { waitUntil: "load", timeout: 90000 });
      await waitFonts(page);
      const f = path.join(outDir, "reel", `frame-${n}.png`);
      fs.mkdirSync(path.dirname(f), { recursive: true });
      await page.screenshot({ path: f, type: "png" });
      frames.push(f);
    }
  } finally {
    await browser.close();
  }
  return frames;
}

/**
 * @param slideAudios  synthesizePost().slides（i 枚目の mp3 か null）
 * @returns {{ file: string, seconds: number }}
 */
async function buildReel(post, dayCfg, outDirArg, slideAudios = []) {
  const outDir = path.resolve(outDirArg); // concat のリストは絶対パスで書く
  const frames = await renderFrames(post, dayCfg, outDir);
  const work = path.join(outDir, "reel");
  const segs = [];
  let total = 0;
  for (const [i, frame] of frames.entries()) {
    const audio = slideAudios[i];
    const shadow = post.theme === "shadowing" && post.slides[i].type === "text_with_translation";
    let d = post.slides[i].type === "cover" ? 2.5 : 3.5;
    if (audio) {
      const a = duration(audio);
      d = 0.5 + a + (shadow ? a + 1.0 : 0.9);
    }
    const seg = path.join(work, `seg-${String(i + 1).padStart(2, "0")}.mp4`);
    const audioIn = audio ? ["-i", audio] : ["-f", "lavfi", "-i", "anullsrc=r=44100:cl=stereo"];
    ff([
      "-loop", "1", "-framerate", String(FPS), "-i", frame, ...audioIn,
      "-filter_complex", "[1:a]adelay=500:all=1,apad,aresample=44100,aformat=sample_fmts=fltp:channel_layouts=stereo[a]",
      "-map", "0:v", "-map", "[a]", "-t", d.toFixed(2),
      "-c:v", "libx264", "-preset", "veryfast", "-tune", "stillimage", "-pix_fmt", "yuv420p", "-r", String(FPS),
      "-c:a", "aac", "-b:a", "128k", seg,
    ]);
    segs.push(seg);
    total += d;
  }
  const list = path.join(work, "list.txt");
  fs.writeFileSync(list, segs.map((s) => `file '${s.replace(/'/g, "'\\''")}'`).join("\n"));
  const file = path.join(outDir, "reel.mp4");
  ff(["-f", "concat", "-safe", "0", "-i", list, "-c", "copy", "-movflags", "+faststart", file]);
  if (total > MAX_SECONDS) console.warn(`  [reel] ${total.toFixed(0)} 秒あります（${MAX_SECONDS} 秒を超えるとリール扱いされにくい）`);
  return { file, seconds: +total.toFixed(1) };
}

module.exports = { buildReel };
