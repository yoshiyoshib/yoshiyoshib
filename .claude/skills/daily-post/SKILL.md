---
name: daily-post
description: Create one day's Instagram post for the English-learning account (phrasal verbs, idioms, C1–C2 words, Sunday review), including story and reel. Use when the user asks for today's post, a post for a given date, or to fix a post.
---

# One day's post

The account teaches intermediate-to-advanced (B2–C2) Japanese learners, in American English.
Each post is `insta/posts/<YYYY-MM-DD>.json`. `node insta/render.js <date>` writes `insta/out/<date>/`:
`01.jpg…` (carousel), `story.jpg` (answer to the previous day's quiz), `reel.mp4`, `caption.txt`, `alt.txt`.
Do not change `insta/template.html` unless the user asks for a design change.

## Before writing

1. Read `insta/learnings.md` and `insta/feedback.md` and follow them. They override the defaults below.
2. Run `node insta/schedule.js <date> 1` to get the kind (from the weekday rotation in `insta/lib.js`) and the post number.
3. Collect every `term` in `insta/posts/*.json`. Never repeat one.

## Content rules (kind = phrasal / idiom / word)

- 5 items, all of the day's kind. Pick a theme that ties them together (work, emotions, travel, money, relationships, news…) and has not been used in the last 3 weeks.
- Level: B2+ only. Skip beginner items such as give up, look for, piece of cake. `word` posts use the level from the rotation (C1 on Wednesday, C2 on Saturday).
- Per item: `term`, `ipa` (General American; may be omitted for long idioms), `pos`, `ja` (short Japanese meaning), `definition` (one plain English sentence, ≤ ~110 chars), `example` (original sentence, target wrapped in `**…**`, ≤ ~90 chars; separable phrasal verbs may mark both parts, e.g. `**move** the deadline **up**`), `example_ja`, `note` (one Japanese tip on usage, origin, register or a related form, ≤ ~45 chars).
- `quiz`: one fill-in-the-blank sentence (`____`) with 3 options taken from today's items. Put the answer at a random letter, set `answer`, and add `why` (one short Japanese line).
- `caption`: Japanese hook line, numbered `term｜meaning` list, ask for quiz answers in the comments, say the answer comes in tomorrow morning's story, a save reminder, three `.` lines, then 12–15 hashtags mixing Japanese and English.
- `status`: write new posts as `"draft"`. The `daily-loop` skill sets `"approved"` after the independent check. A post the user asked to stop stays `"draft"`.
- Write original examples. Do not copy dictionary sentences.

## Sunday review (kind = review)

- No `items`. The template pulls Monday–Saturday of the same week automatically.
- `theme` summarizes the week. `quizzes`: 3 questions, each from a different day's post, same shape as `quiz`.

## Check

1. Verify meanings, IPA, collocations and example grammar. Avoid absolute "× wrong" claims unless the usage is truly ungrammatical.
2. `node insta/render.js <date>`. It warns about anything that spills off a slide (exit code 2). Fix by shortening the text.
3. Look at every slide and the story. Fix anything cramped or cut off and render again.

## Fixing a post after feedback

Apply the change, re-render, push, and add a one-line general lesson to `insta/feedback.md` if the feedback applies to future posts (e.g. "examples should be under 12 words").
