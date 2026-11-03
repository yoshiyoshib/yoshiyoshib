# Instagram 英語アカウント用 投稿テンプレート

毎日 1 投稿（カルーセル 7 枚）を作る仕組みです。

| 枚目 | 内容 |
| --- | --- |
| 1 | 表紙（テーマと今日の 5 つ） |
| 2〜6 | 1 枚に 1 表現（句動詞／イディオム／C1〜C2 単語） |
| 7 | おさらい＋クイズ |

## ファイル

- `config.json` … アカウント名（`handle`）やブランド名
- `template.html` … デザイン（全投稿共通）
- `posts/<日付>.json` … その日の中身
- `render.js` … JSON から画像を作る
- `out/<日付>/` … できた画像（`01.png`〜）とキャプション（`caption.txt`）

## 毎日の使い方

Claude に「今日の投稿を作って」と頼むだけです（`.claude/skills/daily-post` の手順で作ります）。
自分で画像を作り直すときは:

```
node insta/render.js insta/posts/2026-11-03.json
```
