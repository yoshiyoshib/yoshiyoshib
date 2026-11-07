// Evaluator-Optimizer ループ
//   Generator が作った JSON を「コード検査 + LLM 採点（100点満点）」で評価し、
//   PASS_SCORE 未満なら feedback を付けて Generator に修正させる（最大 MAX_LOOPS 回リトライ）。
const { generate, callLLM } = require("./generator");
const { LIMITS } = require("../config/schedule");

const PASS_SCORE = Number(process.env.PASS_SCORE || 85);
const MAX_LOOPS = Number(process.env.MAX_LOOPS || 3);
const SLIDE_TYPES = ["cover", "text_with_translation", "vocabulary", "grammar_breakdown"];

const strip = (s = "") => String(s).replace(/<[^>]+>/g, "");
const len = (s) => [...strip(s)].length;

// ---------------------------------------------------------------- コード側の検査（確実に判定できるもの）
const VI_SPECIFIC = /[àáạảãâầấậẩẫăằắặẳẵèéẹẻẽêềếệểễìíịỉĩòóọỏõôồốộổỗơờớợởỡùúụủũưừứựửữỳýỵỷỹđ]/i;

function vietnameseIssues(text, where) {
  const issues = [];
  const plain = strip(text);
  if (/\p{L}[?？]\p{L}/u.test(plain)) issues.push(`${where}: 単語の途中に「?」があり文字化けの疑い`);
  if (/[□■�]/.test(plain)) issues.push(`${where}: 文字化け記号（□/�）が含まれる`);
  if (/\p{M}/u.test(plain)) issues.push(`${where}: 結合文字（NFD）が残っており声調記号の描画が崩れる`);
  // 日本語（○✕の注記など）が混ざっても誤判定しないよう、ラテン文字の音節だけで割合を出す
  const syllables = plain.toLowerCase().match(/\p{Script=Latin}+/gu) || [];
  if (syllables.length >= 8) {
    const marked = syllables.filter((s) => VI_SPECIFIC.test(s)).length;
    if (marked / syllables.length < 0.3)
      issues.push(`${where}: 声調記号付きの音節が ${Math.round((100 * marked) / syllables.length)}% しかなく、記号が欠落している疑い`);
  }
  const opens = (text.match(/<mark>/g) || []).length;
  const closes = (text.match(/<\/mark>/g) || []).length;
  if (opens !== closes) issues.push(`${where}: <mark> の開始と終了の数が合わない`);
  if (/<(?!\/?mark>)[^>]+>/.test(text)) issues.push(`${where}: <mark> 以外の HTML タグは使用禁止`);
  return issues;
}

function over(where, value, limit) {
  const n = len(value);
  return n > limit ? [`${where}: ${n}字（上限 ${limit}字）→ ${n - limit}字以上削る`] : [];
}

/**
 * スキーマ・文字化け・文字数を機械的に検査
 * @returns {{ fatal: string[], issues: string[] }} fatal はLLM採点に進めない致命的エラー
 */
function codeCheck(post, dayCfg) {
  const fatal = [];
  const issues = [];
  if (!post || typeof post !== "object") return { fatal: ["JSON がオブジェクトではない"], issues };
  const slides = post.slides;
  if (!Array.isArray(slides) || !slides.length) return { fatal: ["slides 配列がない"], issues };
  if (slides.length < LIMITS.minSlides || slides.length > LIMITS.maxSlides)
    fatal.push(`スライド枚数 ${slides.length} 枚（${LIMITS.minSlides}〜${LIMITS.maxSlides} 枚にする）`);
  if (slides[0]?.type !== "cover") fatal.push("1枚目は type=cover にする");

  slides.forEach((s, i) => {
    const w = `slides[${i}](${s?.type})`;
    if (!SLIDE_TYPES.includes(s?.type)) return fatal.push(`${w}: 未知の type`);
    if (s.type === "cover") {
      if (!s.title) fatal.push(`${w}: title がない`);
      issues.push(...over(`${w}.title`, s.title, LIMITS.coverTitle));
    }
    if (s.type === "text_with_translation") {
      if (!s.vietnameseText || !s.japaneseText) fatal.push(`${w}: vietnameseText / japaneseText がない`);
      issues.push(...vietnameseIssues(s.vietnameseText || "", `${w}.vietnameseText`));
      issues.push(...over(`${w}.vietnameseText`, s.vietnameseText, LIMITS.vietnameseText));
      issues.push(...over(`${w}.japaneseText`, s.japaneseText, LIMITS.japaneseText));
      issues.push(...over(`${w}.annotation`, s.annotation, LIMITS.annotation));
    }
    if (s.type === "vocabulary") {
      if (!Array.isArray(s.items) || !s.items.length) return fatal.push(`${w}: items がない`);
      if (s.items.length > LIMITS.vocabItems) issues.push(`${w}: 語彙 ${s.items.length} 項目（上限 ${LIMITS.vocabItems}）→ スライドを分ける`);
      s.items.forEach((it, j) => {
        if (!it.word || !it.meaning) fatal.push(`${w}.items[${j}]: word / meaning がない`);
        issues.push(...vietnameseIssues(it.word || "", `${w}.items[${j}].word`));
        issues.push(...over(`${w}.items[${j}].meaning`, it.meaning, LIMITS.vocabMeaning));
        issues.push(...over(`${w}.items[${j}].note`, it.note, LIMITS.vocabNote));
      });
    }
    if (s.type === "grammar_breakdown") {
      if (!s.targetSentence || !Array.isArray(s.breakdown) || !s.breakdown.length)
        return fatal.push(`${w}: targetSentence / breakdown がない`);
      issues.push(...vietnameseIssues(s.targetSentence, `${w}.targetSentence`));
      if (s.breakdown.length > LIMITS.breakdownItems) issues.push(`${w}: 分解要素 ${s.breakdown.length}（上限 ${LIMITS.breakdownItems}）`);
      s.breakdown.forEach((b, j) => issues.push(...over(`${w}.breakdown[${j}].explanation`, b.explanation, LIMITS.breakdownExplanation)));
    }
  });

  const c = post.caption || {};
  if (!c.hook || !c.summary || !Array.isArray(c.hashtags)) fatal.push("caption.hook / summary / hashtags がない");
  else {
    const missing = dayCfg.hashtags.filter((h) => !c.hashtags.includes(h));
    if (missing.length) issues.push(`caption.hashtags に必須タグがない: ${missing.join(" ")}`);
    if (c.hashtags.length > 30) issues.push(`hashtags が ${c.hashtags.length} 個（Instagram 上限 30）`);
    const total = len(`${c.hook}\n\n${c.summary}\n\n${c.hashtags.join(" ")}`);
    if (total > 2200) issues.push(`キャプション全体が ${total} 字（Instagram 上限 2200）`);
  }
  if (dayCfg.requiresSource) {
    const src = post.source || {};
    if (!src.name || !/^https?:\/\//.test(src.url || "")) fatal.push("source（name と url）がない。ニュース要約には出典が必須");
  }
  if (!post.audioScript) fatal.push("audioScript がない");
  else {
    if (/[぀-ヿ一-鿿]/.test(post.audioScript)) issues.push("audioScript に日本語が混ざっている（ベトナム語のみにする）");
    if (/<[^>]+>/.test(post.audioScript)) issues.push("audioScript に HTML タグが含まれている");
    issues.push(...vietnameseIssues(post.audioScript.replace(/<[^>]+>/g, ""), "audioScript"));
  }
  return { fatal, issues };
}

// ---------------------------------------------------------------- LLM 採点
const EVAL_SYSTEM = `あなたはハノイ国家大学で20年教えてきた、極めて厳格なベトナム語教育者です（日本語も母語水準）。
日本人のガチ学習者向け Instagram 教材 JSON を審査し、甘い点は絶対に付けません。

# ルーブリック（各25点、合計100点）
1. tone_marks（声調記号の完全性）: 全ベトナム語の声調・字母（ă â ê ô ơ ư đ）が正しいか。綴り誤り・記号欠落・文字化け（? □）・不自然な表記は1箇所ごとに大きく減点。
2. depth（情報深度）: 表面的・初歩的すぎないか。文法的な理由・語源・ニュアンス・使用場面・地域差が具体的に書かれているか。「〜という意味です」だけの説明は減点。
3. translation（日本語訳の正確性）: 誤訳、直訳による不自然な日本語、ニュアンスの取り違え、ベトナム語として不自然な例文。
   ニュース要約（source あり）は、数値・固有名詞・日付が元記事と食い違っていたら1箇所ごとに大きく減点。記事の文をほぼそのまま写している場合も減点（自分の言葉で要約すること）。
4. density（文字数・密度）: スマホで読める量か。1枚に詰め込みすぎ・逆に内容が薄すぎるスライド、構成の偏り。

# 出力（JSON のみ）
{
  "scores": { "tone_marks": 0-25, "depth": 0-25, "translation": 0-25, "density": 0-25 },
  "deductions": [ { "criterion": "tone_marks|depth|translation|density", "points": 減点数, "location": "slides[2].japaneseText など", "reason": "減点理由" } ],
  "feedback": [ "Generator への具体的な修正指示。どこを・どう直すかを1件ずつ（例: slides[3].items[1] の pos を「類別」に変更）" ],
  "lessons": [ "今回に限らず今後の全生成に効く汎用的な改善ルール（0〜3件、具体的に）" ]
}
減点がない項目は満点にし、feedback は空配列でよい。`;

async function llmEvaluate(post, dayCfg) {
  const r = await callLLM({
    role: "evaluator",
    temperature: 0.1,
    system: EVAL_SYSTEM,
    user: `テーマ: ${dayCfg.title}\n方針: ${dayCfg.focus}\n\n# 審査対象\n${JSON.stringify(post, null, 2)}`,
  });
  const clamp = (n) => Math.max(0, Math.min(25, Number(n) || 0));
  const scores = {
    tone_marks: clamp(r.scores?.tone_marks),
    depth: clamp(r.scores?.depth),
    translation: clamp(r.scores?.translation),
    density: clamp(r.scores?.density),
  };
  return {
    scores,
    score: Object.values(scores).reduce((a, b) => a + b, 0), // 合計はコードで計算（LLM の足し算を信用しない）
    deductions: Array.isArray(r.deductions) ? r.deductions : [],
    feedback: Array.isArray(r.feedback) ? r.feedback.map(String) : [],
    lessons: Array.isArray(r.lessons) ? r.lessons.map(String) : [],
  };
}

/** 1稿を評価して { score, passed, feedback, ... } を返す */
async function evaluate(post, dayCfg) {
  const { fatal, issues } = codeCheck(post, dayCfg);
  if (fatal.length) {
    return { score: 0, passed: false, scores: null, codeIssues: [...fatal, ...issues], deductions: [], lessons: [],
      feedback: [...fatal, ...issues].map((m) => `[形式エラー] ${m}`) };
  }
  const llm = await llmEvaluate(post, dayCfg);
  // コード検査で見つかった問題は確実な欠陥なので 1件 4点（最大 30点）減点
  const penalty = Math.min(30, issues.length * 4);
  const score = Math.max(0, llm.score - penalty);
  return {
    ...llm,
    llmScore: llm.score,
    score,
    passed: score >= PASS_SCORE,
    codeIssues: issues,
    feedback: [...issues.map((m) => `[機械検査] ${m}`), ...llm.feedback],
  };
}

/**
 * Generator ↔ Evaluator ループ
 * @param seed  { previous, feedback } を渡すと、その稿の修正から開始（レンダラーの文字数オーバー差し戻し用）
 * @returns { post, score, passed, history, lessons }
 */
async function runQualityLoop(dayCfg, { learnings, recentTopics, seed, maxRetries = MAX_LOOPS, log = console.log } = {}) {
  const history = [];
  const lessons = new Set();
  let best = null;
  let previous = seed?.previous;
  let feedback = seed?.feedback;

  for (let round = 0; round <= maxRetries; round++) {
    const label = round === 0 && !seed ? "初稿" : `修正${round + (seed ? 1 : 0)}`;
    log(`  [loop] ${label} を生成中…`);
    const post = await generate(dayCfg, { learnings, recentTopics, previous, feedback });
    const ev = await evaluate(post, dayCfg);
    ev.lessons.forEach((l) => lessons.add(l));
    history.push({
      round, label, score: ev.score, llmScore: ev.llmScore ?? null, scores: ev.scores,
      codeIssues: ev.codeIssues, deductions: ev.deductions, feedback: ev.feedback,
    });
    log(`  [loop] ${label}: ${ev.score} 点${ev.scores ? ` (${Object.entries(ev.scores).map(([k, v]) => `${k}=${v}`).join(", ")})` : ""}` +
        `${ev.codeIssues.length ? ` / 機械検査 ${ev.codeIssues.length}件` : ""}`);
    if (!best || ev.score > best.score) best = { post, score: ev.score, passed: ev.passed };
    if (ev.passed) break;
    previous = post;
    feedback = ev.feedback.length ? ev.feedback : ["合格点に届いていない。情報の深さと訳の自然さを全体的に引き上げる"];
  }
  return { ...best, history, lessons: [...lessons] };
}

module.exports = { runQualityLoop, evaluate, codeCheck, EVAL_SYSTEM, PASS_SCORE, MAX_LOOPS };
