# Instagram 英語アカウント 自動運用

中級〜上級（B2〜C2）向け、アメリカ英語。

## 1 週間の流れ

| 曜日 | フィード（21時） | ストーリー（朝8時） |
| --- | --- | --- |
| 月 | 句動詞 | 前日（日曜）のクイズの答え |
| 火 | イディオム ＋ リール | 前日のクイズの答え |
| 水 | C1 単語 | 〃 |
| 木 | 句動詞 ＋ リール | 〃 |
| 金 | イディオム | 〃 |
| 土 | C2 単語 ＋ リール | 〃 |
| 日 | 週のおさらい（3問クイズ） | 〃 |

## 仕組み（毎日の自動ループ・すべて GitHub 上で動く）

1. **毎日 3:37ごろ**：投稿ごとの数字（保存・シェア・リーチなど）を集める（`instagram.yml`）
2. **毎日 14:41ごろ**：`generate.mjs` が Claude API で、
   - 数字から `learnings.md` を更新する
   - 3日先まで空いている日の投稿を書く
   - 別の呼び出しで正確さをチェック・修正 → プログラムでも形式チェック → 自動で `approved`
   - 画像・ストーリー・リールを作って保存する（`generate.yml`）
3. **毎朝 8:17ごろ** ストーリー、**毎晩 21:07ごろ** フィードを自動投稿する（`instagram.yml`）
4. 止めたい日は、その日の `posts/<日付>.json` の `status` を `draft` にする（Claude に頼んでもOK）

必要な GitHub Secrets：`IG_USER_ID`、`IG_ACCESS_TOKEN`、`ANTHROPIC_API_KEY`

## ファイル

- `config.json` … アカウント名、ブランド名、リールを出す曜日など
- `template.html` … デザイン
- `posts/<日付>.json` … 各日の中身（`status` が `approved` のものだけ投稿される）
- `out/<日付>/` … 画像・ストーリー・リール・キャプション
- `learnings.md` … 数字から分かったこと（Claude が更新）
- `feedback.md` … 確認時の指摘のうち、今後にも使うもの
- `published.json`、`metrics/` … 投稿の記録と数字（GitHub Actions が更新）

## 自動投稿の設定（最初に 1 回だけ）

詳しいチェック式の手順書：https://claude.ai/artifact/1Va4Tk7fY8DFs4AwfTseTr

アクセスキーは **期限のないシステムユーザーのトークン** を使います（Facebook ログイン経由の Instagram Graph API）。

1. Instagram をプロアカウントにし、Facebook ページと連携する
2. Meta のビジネスポートフォリオにページと Instagram を追加する
3. 開発者アプリ（種類：ビジネス）を作り、Instagram（Facebook ログインを使った API 設定）を追加する
4. システムユーザーを作り、アプリ・ページ・Instagram を割り当て、有効期限「なし」でトークンを生成する
   - 権限：`instagram_basic` `instagram_content_publish` `instagram_manage_insights` `pages_show_list` `pages_read_engagement` `business_management`
5. GitHub の Secrets に `IG_ACCESS_TOKEN` を登録 → Actions で mode `find-id` を実行 → 表示された ID を `IG_USER_ID` として登録
6. mode `check` で接続確認、mode `feed` を `dry_run` のまま実行して予行演習

設定するまでは、自動投稿は何もせずに終わります（エラーにはなりません）。

## 手で動かすとき

```
node insta/schedule.js 2026-11-09 7     # 曜日ごとの予定を表示
node insta/render.js 2026-11-09         # 画像・ストーリー・リールを作る
node insta/publish.js feed --date 2026-11-09 --dry-run
```
