// 曜日別カリキュラム・配色・フォント・スライド構成の定義
// key は Date#getDay() の値（0 = 日曜）

const FONTS = {
  vi: "'Be Vietnam Pro', 'Noto Sans JP', sans-serif",
  ja: "'Noto Sans JP', 'Be Vietnam Pro', sans-serif",
  googleFontsUrl:
    "https://fonts.googleapis.com/css2?family=Be+Vietnam+Pro:wght@400;600;800&family=Noto+Sans+JP:wght@400;600;800&display=block",
};

// スライド1枚あたりの文字数上限（Evaluator のルーブリック「文字数・密度」と、コード側検証の両方で使う）
const LIMITS = {
  coverTitle: 28,
  vietnameseText: 260,
  japaneseText: 200,
  annotation: 140,
  vocabItems: 6,
  vocabMeaning: 30,
  vocabNote: 60,
  breakdownItems: 6,
  breakdownExplanation: 70,
  minSlides: 4,
  maxSlides: 10, // Instagram カルーセルの上限
};

const COMMON_HASHTAGS = ["#ベトナム語", "#ベトナム語学習", "#ベトナム語勉強", "#tiengviet", "#語学学習"];

const SCHEDULE = {
  1: {
    day: "monday",
    theme: "etymology",
    title: "語源・漢字語（Hán Việt）徹底解説",
    themeColor: "#B91C1C",
    accentColor: "#FDE68A",
    focus:
      "漢越語（Hán Việt）を1つの漢字要素（例: học 学, quốc 国）を軸に掘り下げる。元の漢字・日本語の音読みとの対応、声調と漢字音の対応規則（例: 日本語の入声 -ku/-tsu ↔ ベトナム語 -c/-t）、派生語3〜5個、純越語との使い分けを扱う。",
    slidePlan: ["cover", "text_with_translation", "vocabulary", "grammar_breakdown", "text_with_translation"],
    hashtags: ["#漢越語", "#HánViệt", "#語源"],
  },
  2: {
    day: "tuesday",
    theme: "dialogue",
    title: "実用会話ダイアログ（文末詞のニュアンス）",
    themeColor: "#0F766E",
    accentColor: "#99F6E4",
    focus:
      "具体的な場面（カフェ・タクシー・職場など）の往復4〜6ターンの会話。A:/B: 形式で vietnameseText に改行区切りで書く。文末詞（nhé, nhỉ, ạ, mà, đấy, cơ, chứ）や人称代名詞（anh/chị/em）の選択理由を annotation と grammar_breakdown で解説する。",
    slidePlan: ["cover", "text_with_translation", "text_with_translation", "grammar_breakdown", "vocabulary"],
    hashtags: ["#ベトナム語会話", "#文末詞"],
  },
  3: {
    day: "wednesday",
    theme: "dialect",
    title: "北部弁（ハノイ）vs 南部弁（ホーチミン）",
    themeColor: "#7C3AED",
    accentColor: "#DDD6FE",
    focus:
      "同じ意味の北部語彙・南部語彙のペア（例: bát/chén, ốm/bệnh, vâng/dạ）と発音差（d/gi/r の発音、hỏi/ngã 声調の合流、語末 -n/-ng など）を比較。vocabulary の note に『北:』『南:』を明記する。同じ文の北部版・南部版を text_with_translation で並べる。",
    slidePlan: ["cover", "vocabulary", "text_with_translation", "grammar_breakdown", "text_with_translation"],
    hashtags: ["#北部弁", "#南部弁", "#ハノイ", "#ホーチミン"],
  },
  4: {
    day: "thursday",
    theme: "grammar",
    title: "間違えやすい文法・助詞の比較講義",
    themeColor: "#1D4ED8",
    accentColor: "#BFDBFE",
    focus:
      "紛らわしいペア（đã/rồi, đang/vẫn, cũng/đều, mà/nhưng, bị/được, cho/để など）を1組選び、意味・語順・使える文脈の違いを正誤例つきで解説。誤用例には ✕、正用例には ○ を付ける。",
    slidePlan: ["cover", "text_with_translation", "grammar_breakdown", "grammar_breakdown", "text_with_translation"],
    hashtags: ["#ベトナム語文法"],
  },
  5: {
    day: "friday",
    theme: "idiom",
    title: "ネイティブの慣用句・成語（Thành ngữ）",
    themeColor: "#C2410C",
    accentColor: "#FED7AA",
    focus:
      "成語・ことわざ（thành ngữ / tục ngữ）を3つ程度。逐語訳・本当の意味・近い日本語のことわざ・使用場面・語感（硬い/口語/皮肉）を示し、実際の会話例を付ける。",
    slidePlan: ["cover", "text_with_translation", "text_with_translation", "text_with_translation", "vocabulary"],
    hashtags: ["#ThànhNgữ", "#ことわざ", "#慣用句"],
  },
  6: {
    day: "saturday",
    theme: "shadowing",
    title: "シャドーイング短文・発音ルール",
    themeColor: "#047857",
    accentColor: "#A7F3D0",
    focus:
      "シャドーイング用の短文5〜6文（自然な速さで言える長さ）。6声調（ngang, huyền, sắc, hỏi, ngã, nặng）や語末子音の発音ルールを1つ取り上げ、どの音節で注意するかを annotation に書く。audioScript はシャドーイング文をそのまま並べる。",
    slidePlan: ["cover", "text_with_translation", "text_with_translation", "grammar_breakdown", "vocabulary"],
    hashtags: ["#シャドーイング", "#ベトナム語発音", "#声調"],
  },
  0: {
    day: "sunday",
    theme: "reading",
    title: "現地ニュース要約で長文精読",
    themeColor: "#1E3A8A",
    accentColor: "#FCD34D",
    focus:
      "直近1週間のベトナム国内の実在ニュース（VnExpress, Tuổi Trẻ, Thanh Niên, VietnamPlus など）を1本選び、その内容を自分の言葉で書き直したベトナム語の要約文（記事の文をそのまま写さない）。3パラグラフに分けて text_with_translation に1つずつ入れ、重要語を <mark> で囲む。語彙表と、最も難しい1文の構文分解を付ける。数値・固有名詞・日付は元記事どおりにし、推測で足さない。出典を source に必ず入れる。政治的に対立の激しい話題・事件事故の被害者が特定される話題は避け、経済・社会・文化・観光・テクノロジーを優先する。",
    requiresSource: true,
    slidePlan: [
      "cover",
      "text_with_translation",
      "text_with_translation",
      "text_with_translation",
      "vocabulary",
      "grammar_breakdown",
    ],
    hashtags: ["#ベトナム語長文", "#ベトナムニュース", "#精読"],
  },
};

const DAY_NAMES = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];

/** 曜日指定（"sunday" / "0" / Date）から設定を返す。未指定なら日本時間の今日。 */
function getDayConfig(input) {
  let idx;
  if (input === undefined || input === null || input === "") {
    // 日本時間の曜日（サーバーが UTC でも JST 基準で判定）
    idx = new Date(Date.now() + 9 * 3600e3).getUTCDay();
  } else if (input instanceof Date) {
    idx = input.getDay();
  } else if (/^[0-6]$/.test(String(input))) {
    idx = Number(input);
  } else {
    idx = DAY_NAMES.indexOf(String(input).toLowerCase());
    if (idx < 0) throw new Error(`Unknown day: ${input}`);
  }
  const cfg = SCHEDULE[idx];
  return { ...cfg, dayIndex: idx, hashtags: [...COMMON_HASHTAGS, ...cfg.hashtags] };
}

module.exports = { SCHEDULE, FONTS, LIMITS, DAY_NAMES, COMMON_HASHTAGS, getDayConfig };
