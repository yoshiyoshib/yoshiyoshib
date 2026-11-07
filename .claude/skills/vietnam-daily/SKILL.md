---
name: vietnam-daily
description: Daily autonomous loop for the Vietnamese-learning Instagram account (Tiếng Việt Lab) — keep the next 3 days of posts written, scored by an independent strict evaluator (85+ to pass, up to 3 revisions), layout-checked and approved, then log what was learned. Use when the Vietnamese daily scheduled run fires, or when the user asks to refill, fix or stop Vietnamese posts.
---

# Vietnamese daily loop

All files live in `vietnam-insta-bot/`. Run commands from that folder.
GitHub Actions (`.github/workflows/vietnam-insta.yml`) publishes whatever is `"approved"` every evening (≈20:07 JST):
carousel + reel with Vietnamese audio. This loop only writes and approves posts. No API key is used: you are the Generator, and a fresh subagent is the Evaluator.

The account posts every day with no manual approval, so the quality bar is the evaluator score (85/100).

## 1. Sync and set up

```bash
git pull origin claude/claude-app-development-0yl5r5
cd vietnam-insta-bot
[ -d node_modules ] || PUPPETEER_SKIP_DOWNLOAD=1 npm install --no-audit --no-fund
node src/index.js metrics   # skips itself if Instagram secrets are not in this environment
node src/index.js status
```

`status` lists today and the next 3 days. Work on every date shown as `missing` or `draft`, oldest first. Never touch `stopped`, `approved` or `published` dates unless the user asks.
Today counts only if it is before 19:30 JST (the evening run must still be able to post it).

## 2. Write (Generator)

1. `node src/index.js brief <date>` prints the full generation brief: weekday theme, slide plan, limits, the learning log's improvement rules and recent failure patterns, recent topics (do not repeat), and the JSON schema. Follow it exactly.
2. **Sunday (news summary):** use WebSearch to find a news story from the last 7 days in a Vietnamese outlet (VnExpress, Tuổi Trẻ, Thanh Niên, VietnamPlus…). Prefer economy, society, culture, travel, tech; avoid divisive politics and stories that identify victims. Open the article (WebFetch) and write **your own** Vietnamese summary in 3 paragraphs — never copy its sentences. Numbers, names and dates must match the article. Put `"source": { "name", "url", "date" }`.
3. Save as `posts/<date>.json` with `"status": "draft"`.

## 3. Mechanical and layout check

`node src/index.js check <date>` normalises the text (NFC), runs the code checks (broken characters, missing tone marks, character limits, schema, source) and renders the slides to `output/<date>/`, shrinking fonts 2px at a time. Exit code 2 means a problem: it prints exact fixes (for "文字数オーバー", shorten or split that slide). Fix and re-run until it passes.
Then look at every `output/<date>/slide-XX.png` yourself (Read the image). Fix anything cramped, cut off or ugly.

## 4. Independent evaluation loop (max 3 revisions)

1. Launch a **fresh subagent** that has not seen your reasoning. Give it only this:
   > Run `node vietnam-insta-bot/src/index.js rubric` and act as that evaluator. Score `vietnam-insta-bot/posts/<date>.json`.
   > (Sunday: open `source.url` and check every number, name and date against the article.) Do not edit any file.
   > Reply with only the JSON the rubric asks for.
2. Score = sum of the 4 sub-scores (compute it yourself; do not trust the subagent's total).
3. **85 or more → pass.** Below 85 → apply every feedback item (keep what was fine), run `check` again, and evaluate again with a **new** subagent. Up to 3 revisions after the first draft.
4. Record every round in the post:

```json
"status": "approved",
"evaluation": {
  "score": 91, "passed": true, "overflowRounds": 0,
  "history": [
    { "round": 0, "label": "初稿", "score": 78, "scores": { "tone_marks": 22, "depth": 18, "translation": 20, "density": 18 },
      "deductions": [ { "criterion": "depth", "points": 7, "location": "slides[2]", "reason": "…" } ], "feedback": ["…"], "codeIssues": [] },
    { "round": 1, "label": "修正1", "score": 91, "scores": { … }, "deductions": [], "feedback": [], "codeIssues": [] }
  ],
  "lessons": ["Evaluator の lessons（今後にも効く一般ルールだけ）"]
}
```

5. Run `node src/index.js record <date>` — appends the score history and failure reasons to `data/learning-log.md` and adds new lessons to the improvement rules (these are injected into the next brief).
6. If it still fails after 3 revisions: leave `"status": "draft"` (it will not be posted), record the attempt in `data/learning-log.md` by hand under 実行ログ, and tell the user. The next run starts that date from scratch.

## 5. Ship

Commit `vietnam-insta-bot/posts/` and `vietnam-insta-bot/data/` only (not `output/` — Actions renders and commits media itself). Push to `claude/claude-app-development-0yl5r5`; if the push is rejected, `git pull --rebase` and push again.

## 6. Learn (when there is data)

The performance table in `data/learning-log.md` is filled by Actions. Judge posts at least 48 hours old only. Rank by saves ÷ reach and reel views. When a pattern holds for 3+ posts, add or edit a rule under 改善ルール (and delete rules that the data contradicts or that are too vague to act on). Keep at most 30 rules.

## 7. Report (short, Japanese)

What was posted yesterday and early numbers if any, the scores of the posts written today (e.g. 「11/10 火 会話：初稿78→修正1 91点」), and the next 3 days' topics. End with: 止めたい日があれば「11/10止めて」のように送ってください.

## When the user replies

- 「止めて」 for a date: set its `status` to `"stopped"` (never `draft`, which the loop would rewrite) and push immediately. Confirm it will not post.
- A content fix: apply it, `check`, keep it approved, push, and add a general rule to 改善ルール if it applies to future posts.
- Design or schedule changes: only when asked.
