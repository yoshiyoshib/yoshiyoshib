---
name: daily-loop
description: Daily autonomous loop for the English Instagram account (@articulate.eng.jp) — learn from yesterday's numbers, keep the next 3 days of posts written, fact-checked and approved, and report briefly. Use when the daily scheduled run fires, or when the user asks to refill or stop upcoming posts.
---

# Daily loop

> Normally the GitHub Actions workflow `Instagram daily content` (`insta/generate.mjs`, 14:41 JST) does steps 2–4 by itself.
> This chat run comes later as a backup: if `node insta/schedule.js <tomorrow> 3` shows nothing `missing`, skip to step 5 and only report.
> If days are missing, check that workflow's latest run for the error, tell the user, then fill the gap with the steps below.

The account posts every day with no manual approval. GitHub Actions publishes whatever is `"approved"`
(feed 21:07 JST, story 08:17 JST) and collects insights daily at 03:37 JST. This loop keeps that pipeline fed
and gets a little better each day.

## 1. Sync

`git pull origin claude/claude-app-development-0yl5r5` (Actions commits `insta/published.json` and `insta/metrics/`).

## 2. Learn

Read `insta/metrics/latest.json`, `insta/learnings.md`, `insta/feedback.md`.

- Judge posts at least 48 hours old only (younger numbers are still moving).
- Rank by **saves ÷ reach**, then **shares ÷ reach**, then follows and comments. Compare by kind, level, theme type, reel vs none.
- Update `insta/learnings.md` only when the data says something new. Each finding: the numbers, how many posts, what to do differently. Under 3 posts per group = "tentative". Remove findings newer data contradicts.
- Turn findings into choices for the posts you write today (themes, kinds of examples, caption hooks). Do not change the weekday rotation or posting times on your own; propose that to the user instead.

## 3. Fill the buffer

`node insta/schedule.js <tomorrow JST> 3`. For every day shown as `missing`, in date order (a Sunday review must come after its Saturday):

1. Write it with the `daily-post` skill.
2. **Independent check**: launch a fresh subagent that has not seen your reasoning. Give it the file paths only and ask it to verify meaning, IPA, naturalness, translations, notes, that each quiz has exactly one correct option with the right letter, and caption consistency, and to report problems with exact replacements without editing.
3. Apply real fixes. If something is doubtful, replace the item rather than keep it.
4. Set `"status": "approved"`.

Then render all new dates **plus tomorrow** (tomorrow's story depends on today's post): `node insta/render.js <dates>`. Look at every new slide and story image; fix overflow or cramped text and re-render.

## 4. Ship

Commit and push posts and `insta/out/`. Posts must be pushed before 21:00 JST on their day.

## 5. Report (short, Japanese)

Tell the user: what was posted yesterday and its early numbers if any, what you learned (or "まだデータ不足"), and the themes of the next 3 days. One line at the end: 止めたい日があれば「11/10止めて」のように送ってください.

## When the user replies

- "止めて" / "stop" for a date: set its `status` to `"draft"`, push immediately. Confirm it will not post.
- A content fix: apply it (keep approved), re-render, push, and add a general lesson to `insta/feedback.md` if it applies to future posts.
- A design or schedule change: do it only when asked.
