"""取得 → 分析 → レポート出力 を一括実行する。"""
from __future__ import annotations

import logging
import sys

from src.analyzer import analyze, rank_by_margin, rank_by_turnover
from src.config import settings
from src.notifier import notify
from src.scout import fetch_sold_listings


def main() -> int:
    logging.basicConfig(level=logging.INFO, format="[%(levelname)s] %(message)s")

    items = fetch_sold_listings(cfg=settings)
    data_source = "eBay API" if items and items[0].source == "ebay" else "モック"
    logging.info("成約データ %d 件を取得 (%s)", len(items), data_source)

    candidates = analyze(items, cfg=settings)
    logging.info("利益条件を満たす商品: %d 件", len(candidates))

    notify(rank_by_turnover(candidates), rank_by_margin(candidates),
           len(candidates), data_source, cfg=settings)
    return 0


if __name__ == "__main__":
    sys.exit(main())
