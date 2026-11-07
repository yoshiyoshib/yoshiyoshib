// Generator: LLM を呼び出して1日分の教材 JSON を作る
// LLM_PROVIDER=gemini（無料枠, 既定）| anthropic
const { LIMITS } = require("../config/schedule");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------- LLM 呼び出し
async function callGemini({ system, user, model, temperature }) {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error("GEMINI_API_KEY が未設定です（.env を確認）");
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json", "x-goog-api-key": key },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: system }] },
      contents: [{ role: "user", parts: [{ text: user }] }],
      generationConfig: { responseMimeType: "application/json", temperature, maxOutputTokens: 16384 },
    }),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const hint = res.status === 404 ? `（モデル「${model}」が使えません。GEMINI_MODEL を現行のモデル名に変更してください）` : "";
    const err = new Error(`Gemini ${res.status}${hint}: ${JSON.stringify(json.error || json).slice(0, 400)}`);
    err.status = res.status;
    throw err;
  }
  const cand = json.candidates?.[0];
  const text = (cand?.content?.parts || []).map((p) => p.text || "").join("");
  if (!text) throw new Error(`Gemini から本文が返りませんでした（finishReason=${cand?.finishReason}）`);
  return text;
}

async function callAnthropic({ system, user, model }) {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) throw new Error("ANTHROPIC_API_KEY が未設定です");
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01" },
    body: JSON.stringify({
      model,
      max_tokens: 16000,
      system: `${system}\n\n出力は JSON オブジェクト1つだけ。前後に説明文やコードフェンスを付けない。`,
      messages: [{ role: "user", content: user }],
    }),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(`Anthropic ${res.status}: ${JSON.stringify(json.error || json).slice(0, 400)}`);
    err.status = res.status;
    throw err;
  }
  if (json.stop_reason === "max_tokens") throw new Error("Anthropic: max_tokens に達しました");
  return (json.content || []).filter((b) => b.type === "text").map((b) => b.text).join("");
}

/** LLM を呼んで JSON を返す。429/5xx と JSON 破損は指数バックオフで再試行。 */
async function callLLM({ system, user, role = "generator", temperature = 0.7 }) {
  const provider = (process.env.LLM_PROVIDER || "gemini").toLowerCase();
  const model =
    provider === "anthropic"
      ? process.env.ANTHROPIC_MODEL || "claude-opus-5-5"
      : (role === "evaluator" && process.env.GEMINI_EVAL_MODEL) || process.env.GEMINI_MODEL || "gemini-flash-latest";
  const fn = provider === "anthropic" ? callAnthropic : callGemini;

  let lastErr;
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      const text = await fn({ system, user, model, temperature });
      return parseJson(text);
    } catch (e) {
      lastErr = e;
      const retryable = !e.status || e.status === 429 || e.status >= 500;
      if (!retryable) throw e;
      const wait = 2000 * 2 ** attempt;
      console.warn(`  [llm:${role}] ${e.message.slice(0, 160)} → ${wait / 1000}s 後に再試行`);
      await sleep(wait);
    }
  }
  throw lastErr;
}

function parseJson(text) {
  const t = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "");
  try {
    return JSON.parse(t);
  } catch {
    const s = t.indexOf("{");
    const e = t.lastIndexOf("}");
    if (s >= 0 && e > s) return JSON.parse(t.slice(s, e + 1));
    throw new Error(`JSON を解析できません: ${t.slice(0, 200)}`);
  }
}

// ---------------------------------------------------------------- 正規化
/** ベトナム語の結合文字（NFD）は描画で声調記号がずれるので、全文字列を NFC にそろえる */
function normalizeDeep(v) {
  if (typeof v === "string") return v.normalize("NFC").trim();
  if (Array.isArray(v)) return v.map(normalizeDeep);
  if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, normalizeDeep(x)]));
  return v;
}

// ---------------------------------------------------------------- プロンプト
const SCHEMA_DOC = `{
  "day": "<曜日 英小文字>",
  "theme": "<テーマID>",
  "themeColor": "#RRGGBB",
  "slides": [
    { "type": "cover", "title": "スライドタイトル(${LIMITS.coverTitle}字以内)", "subtitle": "サブ見出し / カテゴリ", "badge": "第X回 ○○" },
    { "type": "text_with_translation", "heading": "小見出し(任意)", "vietnameseText": "ベトナム語本文。重要語を <mark>…</mark> で囲んでよい。改行は \\n",
      "japaneseText": "対応する日本語訳", "annotation": "注記・文法的理由・ニュアンス" },
    { "type": "vocabulary", "heading": "小見出し(任意)", "items": [ { "word": "từ vựng", "pos": "名", "meaning": "意味", "note": "用法・漢字・北/南" } ] },
    { "type": "grammar_breakdown", "heading": "小見出し(任意)", "targetSentence": "分解対象の文",
      "breakdown": [ { "part": "主語", "text": "…", "explanation": "…" } ], "translation": "文全体の訳(任意)" }
  ],
  "caption": { "hook": "冒頭1行のフック", "summary": "要約・解説(300〜600字)", "hashtags": ["#ベトナム語", "..."] },
  "audioScript": "音声合成用。ベトナム語の文だけを、読み上げ順に改行区切りで（<mark> などのタグや日本語は含めない）"
}`;

function buildSystemPrompt(dayCfg, learnings) {
  return `あなたは日本人向けベトナム語教材の専門編集者であり、ハノイ・ホーチミン両方の言語事情に通じたネイティブ水準の言語学者です。
Instagram カルーセル（1080x1350px, 最大${LIMITS.maxSlides}枚）用の「ガチ学習者向け」教材を JSON で作ります。

# 読者
- 日本語母語話者。ベトナム語 初中級〜上級（入門の挨拶レベルは扱わない）。
- 「なぜそうなるのか」（文法的理由・語源・語感・地域差）を知りたい層。

# 厳守ルール
1. ベトナム語は必ず正しい声調記号付きの Unicode（NFC）で書く。記号の省略・ASCII 化・「?」での代用は禁止。
2. 日本語訳は自然な日本語にする（直訳調を避け、必要なら注記で直訳を補足）。
3. 1枚あたりの文字量上限: ベトナム語本文 ${LIMITS.vietnameseText} 字 / 日本語訳 ${LIMITS.japaneseText} 字 / 注記 ${LIMITS.annotation} 字 /
   語彙 ${LIMITS.vocabItems} 項目（意味 ${LIMITS.vocabMeaning} 字・用法 ${LIMITS.vocabNote} 字）/ 構文分解 ${LIMITS.breakdownItems} 要素（説明 ${LIMITS.breakdownExplanation} 字）。
   多い場合はスライドを分けるか要約する。
4. 品詞 pos は「名・動・形・副・前・接・助・類別・代・文末」など短い略号。
5. 実在しない統計・日付・固有名詞の捏造は禁止。ニュース風文章は一般的事実に基づくオリジナル文。
6. hashtags は 8〜15 個、必ず次を含める: ${dayCfg.hashtags.join(" ")}

# 出力 JSON スキーマ（このキー構成を厳守、余計なキーを足さない）
${SCHEMA_DOC}

# 過去の評価から得た改善ルール（必ず守る）
${learnings?.trim() || "（まだなし）"}`;
}

function buildUserPrompt(dayCfg, { previous, feedback, recentTopics } = {}) {
  const base = `今日は ${dayCfg.day}（${dayCfg.title}）。
テーマID: ${dayCfg.theme} / themeColor: ${dayCfg.themeColor}
内容の方針: ${dayCfg.focus}
スライド構成（この順・この type で）: ${dayCfg.slidePlan.join(" → ")}
${recentTopics?.length ? `最近扱ったトピック（重複禁止）: ${recentTopics.join(" / ")}` : ""}`;

  if (!previous) return `${base}\n\n上記で新しい教材 JSON を作成してください。`;

  return `${base}

# 前回の出力
${JSON.stringify(previous, null, 2)}

# 評価者からの修正指示（すべて反映すること）
${feedback.map((f, i) => `${i + 1}. ${f}`).join("\n")}

指摘された箇所を修正した完全版 JSON を出力してください。問題のない部分は不用意に変えないこと。`;
}

/** 教材 JSON を生成（previous + feedback を渡すと修正版を生成） */
async function generate(dayCfg, { learnings, previous, feedback, recentTopics } = {}) {
  const raw = await callLLM({
    role: "generator",
    system: buildSystemPrompt(dayCfg, learnings),
    user: buildUserPrompt(dayCfg, { previous, feedback, recentTopics }),
    temperature: previous ? 0.4 : 0.8,
  });
  const post = normalizeDeep(raw);
  // 固定値はコード側で強制（LLM の揺れを防ぐ）
  post.day = dayCfg.day;
  post.theme = dayCfg.theme;
  post.themeColor = dayCfg.themeColor;
  return post;
}

module.exports = { generate, callLLM, parseJson, normalizeDeep, buildSystemPrompt };
