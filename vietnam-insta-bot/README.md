# vietnam-insta-bot — ベトナム語学習 Instagram 完全自動運用

毎日、曜日ごとのテーマで「教材生成 → 厳格な採点と自己修正ループ → 4:5 画像描画（はみ出し自動調整）→ 読み上げ音声 → Instagram カルーセル投稿 → 学習ログ更新」を一気通貫で実行します。
LLM は **Gemini API の無料枠**、音声は **edge-tts（無料）**、実行環境は **GitHub Actions（公開リポジトリなら無料）** で、運用コストは 0 円です。

## パイプライン

```
[1] 曜日 → config/schedule.js
[2] data/learning-log.md の「改善ルール」「直近の失敗傾向」「保存が多かった投稿」をプロンプトに注入
[3] Generator ──JSON──▶ Evaluator（機械検査 + 厳格な教師役 LLM が 100点満点で採点）
        ▲                         │ 85点未満 → 減点理由と修正指示
        └──────── feedback ───────┘ （最大 3 回リトライ）
[4] Renderer（Puppeteer 1080x1350, dpr 2）
      .fit 要素で scrollHeight > clientHeight → フォントを 2px ずつ縮小
      最小サイズでも溢れる → 「文字数オーバー」として [3] に差し戻し、再要約（最大 2 回）
[5] edge-tts → output/<日付>/audio.mp3（+ スライド別）, output/audio.mp3
[6] Graph API: 子コンテナ ×N → CAROUSEL コンテナ → media_publish
[7] スコア推移・減点理由・新ルールを data/learning-log.md に追記
```

| 曜日 | テーマ | スライド構成 |
| --- | --- | --- |
| 月 | 語源・漢越語（Hán Việt） | 表紙 / 本文 / 語彙 / 構文 / 本文 |
| 火 | 実用会話ダイアログ（文末詞） | 表紙 / 会話 / 会話 / 構文 / 語彙 |
| 水 | 北部弁 vs 南部弁 | 表紙 / 語彙 / 本文 / 構文 / 本文 |
| 木 | 間違えやすい文法・助詞 | 表紙 / 本文 / 構文 / 構文 / 本文 |
| 金 | 慣用句・成語（Thành ngữ） | 表紙 / 本文 ×3 / 語彙 |
| 土 | シャドーイング・発音ルール | 表紙 / 本文 ×2 / 構文 / 語彙 |
| 日 | 現地ニュース長文精読 | 表紙 / 段落 ×3 / 語彙 / 構文 |

## ファイル

| パス | 役割 |
| --- | --- |
| `config/schedule.js` | 曜日別テーマ・配色・フォント・スライド構成・文字数上限 |
| `src/generator.js` | LLM 呼び出し（Gemini / Anthropic 切替、429 再試行、NFC 正規化） |
| `src/evaluator.js` | 機械検査（文字化け・声調欠落・文字数・スキーマ）+ LLM 採点 + 修正ループ |
| `src/renderer.js` | テンプレート差し込み、フォント読み込み待ち、はみ出し検知と自動縮小、PNG/JPEG 出力 |
| `src/tts.js` | edge-tts ラッパー（女性 `vi-VN-HoaiMyNeural` / 男性 `vi-VN-NamMinhNeural`） |
| `src/uploader.js` | Instagram Graph API カルーセル投稿、インサイト取得、認証チェック |
| `src/learning-log.js` | 学習ログの読み書き（ルール注入・失敗傾向集計・パフォーマンス表） |
| `src/index.js` | 日次オーケストレーター |
| `templates/` | `styles.css` と 4 種のスライドテンプレート |
| `data/learning-log.md` | 改善ルール・パフォーマンス・実行ログ（自動更新、手編集も可） |
| `data/sample-post.json` | LLM なしでデザイン確認するためのサンプル |
| `data/published.json` | 投稿記録（二重投稿防止・インサイト取得用。初回投稿時に作成） |

## 導入手順（ローカル）

```bash
cd vietnam-insta-bot
npm install                 # puppeteer, dotenv（Puppeteer が Chrome を自動ダウンロード）
pip install edge-tts        # 音声合成（Python 3.8+）
cp .env.example .env        # キーを記入
```

1. **Gemini API キー（無料）**: <https://aistudio.google.com/apikey> で発行し `GEMINI_API_KEY` に設定。
2. **Instagram**: プロアカウント（ビジネス/クリエイター）を Facebook ページに連携し、Meta for Developers のアプリで
   `instagram_basic`, `instagram_content_publish`, `pages_show_list`, `pages_read_engagement`（インサイトを使うなら `instagram_manage_insights`）を付与した
   長期ページアクセストークンを `PAGE_ACCESS_TOKEN` に、IG ユーザー ID を `INSTAGRAM_ACCOUNT_ID` に設定。
   `npm run check:ig` で接続確認できます。
3. **画像の公開 URL**: Graph API は「インターネット上の URL にある JPEG」しか受け付けません。
   `MEDIA_BASE_URL` に `output/` を配信している URL を設定してください（GitHub Actions では自動設定。公開リポジトリが前提）。

```bash
npm run render:sample                         # LLM なしでサンプルを描画 → output/<今日>/slide-XX.png
node src/index.js --day sunday --dry-run      # 生成〜評価〜描画〜音声、投稿は dry-run
node src/index.js --skip-upload               # 投稿以外すべて
node src/index.js --upload-only --date 2026-11-08   # 公開済み画像を投稿だけ
node src/tts.js "Xin chào các bạn" out.mp3 male     # 音声だけ試す
```

## 自動運用（GitHub Actions）

`.github/workflows/vietnam-insta.yml` が毎日 19:23 JST に実行します。リポジトリの **Settings → Secrets and variables → Actions** に以下を登録してください。

| 種類 | 名前 | 内容 |
| --- | --- | --- |
| Secret | `GEMINI_API_KEY` | Gemini API キー（未設定ならワークフローは何もせず終了） |
| Secret | `INSTAGRAM_ACCOUNT_ID` | IG ユーザー ID（未設定なら投稿だけスキップ） |
| Secret | `PAGE_ACCESS_TOKEN` | 長期ページアクセストークン |
| Variable（任意） | `VI_TTS_VOICE` | `vi-VN-NamMinhNeural` にすると男性音声 |
| Variable（任意） | `VI_LLM_PROVIDER` | `anthropic` にすると Claude（有料・`ANTHROPIC_API_KEY` が必要） |

流れ: 生成・描画 → JPEG と JSON を commit/push → その commit の raw URL を `MEDIA_BASE_URL` にして投稿 → 投稿記録を commit。
手動実行（Run workflow）は既定で dry-run です。

## 品質ループの詳細

- **機械検査**（確実に判定できるもの）: 単語途中の `?`・`□`・`�`、NFD 結合文字の残存、声調記号付き音節の割合（30% 未満で欠落とみなす）、
  `<mark>` 以外のタグ、文字数上限（`LIMITS`）、スライド枚数、必須ハッシュタグ、キャプション 2200 字。1 件につき 4 点減点（最大 30 点）、スキーマ破損は 0 点。
- **LLM 採点**: 声調記号 / 情報深度 / 日本語訳 / 文字数・密度 を各 25 点。合計はコードで計算（LLM の足し算を信用しない）。
- 合格点 `PASS_SCORE`（既定 85）・リトライ回数 `MAX_LOOPS`（既定 3）は `.env` で変更可。モデルは既定で `gemini-flash-latest`（最新 Flash のエイリアス）。合格しなければ投稿せず、失敗をログに残して終了します。
- Evaluator が出した「今後にも効く教訓」は `改善ルール` に自動追加され（最大 30 件、重複除外）、次回以降の Generator に注入されます。

## 注意

- 音声 MP3 はカルーセル（画像）には添付できないため、`output/` に保存されます（リールや音声配布に流用してください）。
- Graph API の公開上限は 24 時間で 50 件です。
- 日曜の長文は「実在記事のコピー禁止・数値の捏造禁止」をプロンプトで指示していますが、事実関係は定期的に目視確認してください。
