# vietnam-insta-bot — ベトナム語学習 Instagram 自動運用（Tiếng Việt Lab）

毎日、曜日ごとのテーマで **カルーセル（全訳・語彙・構文）＋リール（ネイティブ音声つき）** を自動投稿します。
人の確認なしで動きます。品質は「別の評価役が 100 点満点で採点し、85 点未満なら最大 3 回まで作り直す」ループで担保します。

## 費用

| 部分 | 何で動くか | 費用 |
| --- | --- | --- |
| 教材の生成・評価 | Claude Code の定期実行（Claude のサブスク内） | 追加 0 円（プランの利用枠を使う） |
| 画像・音声・リール作成、投稿 | GitHub Actions（公開リポジトリ） | 0 円 |
| 音声 | edge-tts | 0 円 |
| Instagram 投稿 | Graph API | 0 円 |

Claude の API キーは使いません（API は従量課金のため）。API キーで動かしたくなった場合の経路も `generate` コマンドとして残してあります。

## 毎日の流れ

```
[Claude Code 定期実行・毎日 13:47 JST ごろ]  .claude/skills/vietnam-daily/SKILL.md
  status で 3 日先までの空きを確認
  └ 空いている日ごとに:
     brief（曜日テーマ + 学習ログの改善ルール・失敗傾向 + スキーマ）→ Claude が JSON を書く
     日曜は直近 1 週間の実在ニュースを検索 → 自分の言葉で要約（出典つき）
     check（機械検査 + 描画 + はみ出しを 2px ずつ縮小、収まらなければ「文字数オーバー」で書き直し）
     評価: 新しいサブエージェントが厳格なベトナム語教師として採点（各 25 点 × 4）
       85 点未満 → 修正指示を反映して再評価（最大 3 回）
     合格 → approved、record で学習ログに推移・減点理由・新ルールを追記
  posts/ と data/ を commit・push

[GitHub Actions・毎日 20:07 JST（予備 20:37 / 21:07）]  .github/workflows/vietnam-insta.yml
  prepare: 画像（1080x1350, 2x）→ edge-tts 音声 → リール（1080x1920）
  commit → raw URL で カルーセル投稿 → リール投稿 → 投稿記録を commit
[GitHub Actions・毎日 04:17 JST]  インサイト収集 → 学習ログのパフォーマンス表
```

| 曜日 | テーマ |
| --- | --- |
| 月 | 語源・漢越語（Hán Việt） |
| 火 | 実用会話ダイアログ（文末詞） |
| 水 | 北部弁 vs 南部弁 |
| 木 | 間違えやすい文法・助詞 |
| 金 | 慣用句・成語（Thành ngữ） |
| 土 | シャドーイング・発音（リールは音声のあとにリピート用の無音が入る） |
| 日 | 現地ニュースの要約で長文精読（出典をキャプションに明記） |

## コマンド（`vietnam-insta-bot/` で実行）

| コマンド | 内容 |
| --- | --- |
| `node src/index.js status` | 今日〜3 日先の状態（missing / draft / approved / stopped / published） |
| `node src/index.js brief <日付>` | その日の生成指示 |
| `node src/index.js rubric` | 評価役の採点基準 |
| `node src/index.js check <日付>` | 機械検査＋描画＋はみ出し検知（問題があれば終了コード 2） |
| `node src/index.js record <日付>` | 評価履歴を学習ログへ |
| `node src/index.js prepare --date <日付>` | 画像・音声・リールを作る（Actions 用） |
| `node src/index.js publish --date <日付> [--dry-run]` | カルーセル＋リール投稿（二重投稿しない） |
| `node src/index.js metrics` | インサイト収集 |
| `node src/index.js sample` | サンプルを描画＋無音リール（デザイン確認） |
| `node src/index.js generate` | （任意）API キーで生成⇄評価ループ |
| `node src/uploader.js check` | Instagram の認証確認 |

投稿を止めたい日は `posts/<日付>.json` の `status` を `stopped` にします（Claude に「11/10止めて」と頼んでも OK）。

## ファイル

| パス | 役割 |
| --- | --- |
| `config/schedule.js` | 曜日別テーマ・配色・フォント・スライド構成・文字数上限 |
| `src/generator.js` | 生成プロンプト（共通）と、任意の API 呼び出し |
| `src/evaluator.js` | 機械検査・採点基準・（API 用）修正ループ |
| `src/renderer.js` | テンプレート差し込み、フォント待ち、はみ出し自動縮小、PNG/JPEG |
| `src/tts.js` | edge-tts（女性 `vi-VN-HoaiMyNeural` / 男性 `vi-VN-NamMinhNeural`） |
| `src/reel.js` | リール動画（ffmpeg） |
| `src/uploader.js` | Graph API：カルーセル・リール投稿、インサイト |
| `src/learning-log.js` | 学習ログの読み書き |
| `src/index.js` | 上記コマンド |
| `posts/<日付>.json` | 各日の教材（評価履歴 `evaluation` つき） |
| `data/learning-log.md` | 改善ルール・パフォーマンス・実行ログ |
| `data/published.json` | 投稿記録（初回投稿時に作成） |

## 導入手順

1. **Instagram アカウントを作る**：プロアカウント（クリエイター or ビジネス）にして Facebook ページと連携。
2. **トークン**：Meta for Developers でアプリを作り、ビジネスマネージャのシステムユーザーで
   `instagram_basic`, `instagram_content_publish`, `instagram_manage_insights`, `pages_show_list`, `pages_read_engagement` を付けた**期限なし**トークンを発行
   （通常のユーザートークンは 60 日で切れます）。英語アカウントと同じ手順です。
3. **GitHub Secrets**（Settings → Secrets and variables → Actions）：`INSTAGRAM_ACCOUNT_ID`, `PAGE_ACCESS_TOKEN`。
   任意で Variable `VI_TTS_VOICE=vi-VN-NamMinhNeural`（男性音声）。
4. Actions の「Vietnamese Instagram autopost」を `mode=check-ig` で手動実行して認証を確認 → `publish` を dry-run で 1 回。
5. Claude Code の定期実行（毎日 1 回、上記スキルを実行）を作る。

ローカルで試す場合：

```bash
cd vietnam-insta-bot
npm install && pip install edge-tts   # ffmpeg も必要
cp .env.example .env
npm run sample
```

## 注意

- 画像と動画は raw.githubusercontent.com の URL で Instagram に渡すため、リポジトリが公開されている必要があります。
- 日曜のニュースは記事の文を写さず要約し、キャプションに出典（媒体名・日付・URL）を入れます。
- 公開上限は 24 時間で 50 件（カルーセル＋リールで 1 日 2 件）。
