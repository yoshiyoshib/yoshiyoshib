---
name: daily-post
description: Create the day's Instagram carousel for the English-learning account (phrasal verbs, idioms, C1–C2 words). Use when the user asks for today's post, the next post, or a post on a given theme or date.
---

# Daily Instagram post

Each post is one JSON file in `insta/posts/<YYYY-MM-DD>.json`. `insta/render.js` turns it into 1080x1350 PNG slides plus `caption.txt` in `insta/out/<date>/`. Do not change `insta/template.html` unless the user asks for a design change.

## Steps

1. Pick the date (today unless the user names one) and the next `no` (highest `no` in `insta/posts/` + 1).
2. Collect every `term` already used in `insta/posts/*.json`. Never repeat one.
3. Choose a theme (the user's, or a fresh everyday/work/emotion/travel topic not used recently).
4. Write 5 items. Default mix: 2 `phrasal`, 2 `idiom`, 1 `word` (rotate to 1/2/2 or 2/1/2 on some days). `word` items need `level` of `C1` or `C2`.
5. Write the JSON in the same shape as the existing posts:
   - `term`, `ipa` (General American, optional for long idioms), `pos`, `ja` (short Japanese meaning), `definition` (one plain English sentence, under ~110 characters), `example` (wrap the target words in `**...**`, under ~90 characters), `example_ja`, `note` (one short Japanese tip: usage, origin, related forms; under ~45 characters).
   - `quiz`: one fill-in-the-blank sentence with 3 options from today's items. Put the correct answer at a random position and set `answer` to its letter.
   - `caption`: Japanese hook line, numbered list `term｜meaning`, a line asking for quiz answers in comments, a save reminder, the quiz answer after a few `.` lines, then 10–15 hashtags (mix Japanese and English).
6. Check accuracy: meanings, IPA, register and the example's grammar must be correct and natural. Avoid absolute "× wrong" claims unless the usage is truly ungrammatical.
7. Run `node insta/render.js insta/posts/<date>.json`.
8. Look at every slide image. If a headword, example or tip is cut off or crowds the footer, shorten the text and render again.
9. Commit the JSON and the `insta/out/<date>/` folder, push, then send the PNGs and `caption.txt` to the user with SendUserFile.
