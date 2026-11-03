---
name: weekly-batch
description: Weekly loop for the English Instagram account — read last week's numbers, update learnings, create next Monday–Sunday's 7 posts as drafts, and send one review page. Use when the weekly scheduled run fires or the user asks for next week's posts.
---

# Weekly batch

Goal: next Monday–Sunday is drafted, rendered and waiting for the user's OK, with each week's choices informed by real results.

## 1. Sync

`git pull origin claude/claude-app-development-0yl5r5` (GitHub Actions commits `insta/published.json` and `insta/metrics/`).

## 2. Learn from results

Read `insta/metrics/latest.json`, `insta/learnings.md` and `insta/feedback.md`.

- Compare posts by **saves per reach** and **shares per reach** first, then follows and comments. Group by kind, theme, level, and reel vs no reel.
- Update `insta/learnings.md`: keep it short. Each finding states the evidence (numbers and how many posts) and what to do differently. Mark findings from fewer than 3 posts per group as tentative. Remove findings that newer data contradicts.
- If there is no data yet, say so and keep the current defaults.

## 3. Plan

`node insta/schedule.js <next Monday> 7` shows each day's kind and post number. Choose 6 themes that apply the learnings and do not repeat the last 3 weeks.

## 4. Write and render

For each day, follow the `daily-post` skill (status `"draft"`). Write Monday–Saturday before Sunday, because the review uses them.
Then `node insta/render.js <the 7 dates>` and check every slide and story image.

## 5. Ask for review

1. `python3 insta/review.py <scratchpad>/review.html <the 7 dates>`
2. Publish it with the Artifact tool to the existing review page `https://claude.ai/artifact/JLL63aHWKsTFM32L9Vr5QZ` (pass it as `url`; read it first if this session has not).
3. Commit and push the posts and `insta/out/`, then tell the user in Japanese: the link, the week's themes, what changed based on learnings, and that they should reply "OK" or list fixes by date and slide.

## 6. When the user replies

- "OK" (all or specific dates): set `"status": "approved"` on those posts, commit, push. Only approved posts are auto-published.
- Fixes: apply them via `daily-post`, re-render, republish the review page, and ask again.
