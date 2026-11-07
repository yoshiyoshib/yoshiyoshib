// edge-tts（無料・Microsoft Edge の読み上げ音声）で MP3 を生成する
//   インストール: pip install edge-tts   （コマンド edge-tts、または python3 -m edge_tts）
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawn } = require("child_process");

const VOICES = { female: "vi-VN-HoaiMyNeural", male: "vi-VN-NamMinhNeural" };

function run(cmd, args) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { stdio: ["ignore", "pipe", "pipe"] });
    let err = "";
    p.stderr.on("data", (d) => (err += d));
    p.on("error", reject);
    p.on("close", (code) => (code === 0 ? resolve() : reject(new Error(`${cmd} exited ${code}: ${err.slice(-400)}`))));
  });
}

/** edge-tts コマンドの候補を順に試す */
async function edgeTts(args) {
  const candidates = [
    [process.env.EDGE_TTS_BIN || "edge-tts", []],
    ["python3", ["-m", "edge_tts"]],
    ["python", ["-m", "edge_tts"]],
  ];
  let last;
  for (const [cmd, pre] of candidates) {
    try {
      return await run(cmd, [...pre, ...args]);
    } catch (e) {
      last = e;
      if (e.code !== "ENOENT" && !/No module named/.test(e.message)) throw e;
    }
  }
  throw new Error(`edge-tts が見つかりません（pip install edge-tts）: ${last?.message}`);
}

const resolveVoice = (v) => VOICES[v] || v || process.env.TTS_VOICE || VOICES.female;

/** 音声用にテキストを掃除（タグ・日本語・記号の除去） */
function cleanForSpeech(text = "") {
  return text
    .replace(/<[^>]+>/g, "")
    .replace(/[぀-ヿ一-鿿（）「」【】]+/g, " ")
    .replace(/^\s*[AB][:：]\s*/gm, "") // 会話の話者ラベル
    .replace(/[✕×○◯→⟶]/g, " ")
    .replace(/[ \t]+/g, " ")
    .split("\n").map((l) => l.trim()).filter(Boolean)
    .join("\n");
}

/** テキスト → MP3 */
async function synthesize(text, outFile, { voice, rate = process.env.TTS_RATE || "-10%" } = {}) {
  const clean = cleanForSpeech(text);
  if (!clean) throw new Error("読み上げるテキストが空です");
  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  // 長文や記号をシェル引数で渡さないよう一時ファイル経由
  const tmp = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "tts-")), "in.txt");
  fs.writeFileSync(tmp, clean);
  try {
    const args = ["--voice", resolveVoice(voice), `--rate=${rate}`, "--file", tmp, "--write-media", outFile];
    const proxy = process.env.HTTPS_PROXY || process.env.https_proxy; // edge-tts は環境変数のプロキシを自動では使わない
    if (proxy) args.push("--proxy", proxy);
    await edgeTts(args);
  } finally {
    fs.rmSync(path.dirname(tmp), { recursive: true, force: true });
  }
  return outFile;
}

/**
 * 投稿全体の音声（audioScript）と、本文スライドごとの音声を生成
 * @returns {{ full: string, slides: string[] }}
 */
async function synthesizePost(post, outDir, opts = {}) {
  const full = await synthesize(post.audioScript, path.join(outDir, "audio.mp3"), opts);
  const slides = [];
  if (opts.perSlide !== false) {
    for (const [i, s] of post.slides.entries()) {
      const text = s.vietnameseText || s.targetSentence;
      if (!text) continue;
      const f = path.join(outDir, "audio", `slide-${String(i + 1).padStart(2, "0")}.mp3`);
      slides.push(await synthesize(text, f, opts));
    }
  }
  return { full, slides };
}

module.exports = { synthesize, synthesizePost, cleanForSpeech, VOICES };

// CLI: node src/tts.js "Xin chào các bạn" out.mp3 [female|male]
if (require.main === module) {
  const [text, out = "output/test.mp3", voice] = process.argv.slice(2);
  synthesize(text || "Xin chào, hôm nay chúng ta học tiếng Việt nhé.", out, { voice })
    .then((f) => console.log(`wrote ${f}`))
    .catch((e) => { console.error(e.message); process.exit(1); });
}
