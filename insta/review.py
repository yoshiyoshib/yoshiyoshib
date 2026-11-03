#!/usr/bin/env python3
"""Builds a single review page (HTML, images embedded at half size) for a set of post dates.

Usage: python3 insta/review.py OUT.html 2026-11-04 2026-11-05 ...
The page is published as an Artifact so the user can check every slide on a phone and reply OK / fixes in chat.
"""
import base64, html, io, json, sys
from datetime import date as Date
from pathlib import Path
from PIL import Image

DIR = Path(__file__).parent
WD = "月火水木金土日"
KIND_JA = {"phrasal": "句動詞", "idiom": "イディオム", "word": "単語", "review": "週のおさらい"}
STATUS_JA = {"draft": "確認待ち", "approved": "OK済み", "published": "投稿済み"}


def thumb(path, width=540):
    im = Image.open(path).convert("RGB")
    im = im.resize((width, round(im.height * width / im.width)), Image.LANCZOS)
    buf = io.BytesIO()
    im.save(buf, "JPEG", quality=80, optimize=True)
    return "data:image/jpeg;base64," + base64.b64encode(buf.getvalue()).decode()


def day_section(d):
    post = json.loads((DIR / "posts" / f"{d}.json").read_text())
    out = DIR / "out" / d
    wd = WD[Date.fromisoformat(d).weekday()]
    kind = KIND_JA[post["kind"]] + (f"（{post['level']}）" if post.get("level") else "")
    status = post.get("status", "draft")
    slides = sorted(out.glob("[0-9][0-9].jpg"))
    imgs = "".join(
        f'<figure><img src="{thumb(p)}" alt="{d} slide {i + 1}" loading="lazy"><figcaption>{i + 1}枚目</figcaption></figure>'
        for i, p in enumerate(slides))
    story = out / "story.jpg"
    if story.exists():
        imgs += f'<figure class="tall"><img src="{thumb(story, 380)}" alt="{d} story" loading="lazy"><figcaption>ストーリー（朝）</figcaption></figure>'
    quizzes = post.get("quizzes") or ([post["quiz"]] if post.get("quiz") else [])
    answers = "・".join(f"{q['answer']}（{html.escape(q['options']['ABCD'.index(q['answer'])])}）" for q in quizzes)
    return f"""
<section class="day" id="d{d.replace('-', '')}">
  <header>
    <div><h2>{int(d[5:7])}/{int(d[8:])}（{wd}）<span>{kind}</span></h2>
    <p>No.{post['no']:03d} · {html.escape(post['theme']['ja'])}</p></div>
    <span class="pill {status}">{STATUS_JA.get(status, status)}</span>
  </header>
  <div class="strip">{imgs}</div>
  <details><summary>キャプション{'・クイズの答え' if answers else ''}</summary>
    {f'<p class="ans">クイズの答え：{answers}</p>' if answers else ''}
    <pre>{html.escape(post.get('caption', ''))}</pre>
  </details>
</section>"""


def main():
    out_file, dates = sys.argv[1], sys.argv[2:]
    span = f"{int(dates[0][5:7])}/{int(dates[0][8:])}–{int(dates[-1][5:7])}/{int(dates[-1][8:])}"
    body = "".join(day_section(d) for d in dates)
    page = f"""<title>英語アカウント 投稿チェック</title>
<meta name="claude:viewport-fit-sides" content="cover">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Young+Serif&family=Zen+Kaku+Gothic+New:wght@400;700&display=swap">
<style>
  /* Layout: one column of days; each day is a header, a horizontally scrolling strip of slides, and a folded caption */
  :root {{
    --bg: #f1f3f8; --fg: #141a33; --muted: #5d6480; --card: #ffffff; --rule: #d8dce8;
    --accent: #2b4be0; --ok: #0b7a5c; --wait: #b25e09;
    --display: "Young Serif", Georgia, serif;
    --body: "Zen Kaku Gothic New", "Hiragino Sans", system-ui, sans-serif;
  }}
  @media (prefers-color-scheme: dark) {{
    :root:not([data-theme="light"]) {{ --bg: #10142a; --fg: #eef0fa; --muted: #a3abcc; --card: #1b2140; --rule: #2c3456;
      --accent: #8fa2ff; --ok: #5fd3ae; --wait: #f0a85a; color-scheme: dark; }}
  }}
  :root[data-theme="dark"] {{ --bg: #10142a; --fg: #eef0fa; --muted: #a3abcc; --card: #1b2140; --rule: #2c3456;
    --accent: #8fa2ff; --ok: #5fd3ae; --wait: #f0a85a; color-scheme: dark; }}
  body {{ background: var(--bg); color: var(--fg); font-family: var(--body); font-size: 15px; line-height: 1.6; }}
  main {{ max-width: 980px; margin: 0 auto; padding-block: 28px 56px;
    padding-left: max(16px, env(safe-area-inset-left, 0px)); padding-right: max(16px, env(safe-area-inset-right, 0px));
    display: flex; flex-direction: column; gap: 28px; }}
  h1 {{ font-family: var(--display); font-weight: 400; font-size: 2rem; margin: 0; line-height: 1.1; text-wrap: balance; }}
  .intro p {{ margin: 8px 0 0; color: var(--muted); max-width: 62ch; }}
  .howto {{ background: var(--card); border: 1px solid var(--rule); border-radius: 12px; padding: 14px 16px; }}
  .howto b {{ color: var(--accent); }}
  .day {{ display: flex; flex-direction: column; gap: 12px; border-top: 1px solid var(--rule); padding-top: 20px; min-width: 0; }}
  .day header {{ display: flex; justify-content: space-between; align-items: flex-start; gap: 12px; }}
  h2 {{ font-size: 1.25rem; margin: 0; }}
  h2 span {{ font-size: .85rem; font-weight: 400; color: var(--muted); margin-left: 10px; }}
  .day header p {{ margin: 2px 0 0; color: var(--muted); font-size: .9rem; }}
  .pill {{ flex: none; font-size: .78rem; font-weight: 700; padding: 3px 12px; border-radius: 999px; border: 1.5px solid currentColor; }}
  .pill.draft {{ color: var(--wait); }} .pill.approved, .pill.published {{ color: var(--ok); }}
  .strip {{ display: flex; gap: 10px; overflow-x: auto; padding-bottom: 8px; scroll-snap-type: x mandatory; }}
  figure {{ margin: 0; flex: none; width: min(72vw, 270px); scroll-snap-align: start; }}
  figure.tall {{ width: min(48vw, 180px); }}
  figure img {{ width: 100%; display: block; border-radius: 6px; border: 1px solid var(--rule); }}
  figcaption {{ font-size: .75rem; color: var(--muted); margin-top: 4px; }}
  details {{ background: var(--card); border: 1px solid var(--rule); border-radius: 10px; padding: 10px 14px; }}
  summary {{ cursor: pointer; font-weight: 700; }}
  summary:focus-visible {{ outline: 2px solid var(--accent); outline-offset: 3px; }}
  pre {{ white-space: pre-wrap; font-family: var(--body); font-size: .88rem; margin: 10px 0 0; overflow-wrap: anywhere; }}
  .ans {{ margin: 10px 0 0; color: var(--ok); font-weight: 700; }}
</style>
<main>
  <div class="intro">
    <h1>投稿チェック {span}</h1>
    <p>スライドは横にスクロールできます。キャプションとクイズの答えは各日の下にあります。</p>
  </div>
  <div class="howto">確認したらチャットで返信してください。問題なければ <b>「OK」</b>、直したいところがあれば <b>「11/5の3枚目の例文を短く」</b> のように日付と枚数で伝えてください。OKになった日だけが自動で投稿されます。</div>
  {body}
</main>
"""
    Path(out_file).write_text(page)
    print(f"wrote {out_file} ({len(page) / 1e6:.1f} MB)")


if __name__ == "__main__":
    main()
