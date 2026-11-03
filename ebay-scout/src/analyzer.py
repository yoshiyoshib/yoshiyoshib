"""国内仕入れ値との照合・利益計算・ランキング生成。

実質利益   = eBay販売価格(円) - 国内仕入れ値 - eBay手数料(15%) - 海外送料 - 倉庫代行費
実質利益率 = 実質利益 / eBay販売価格(円) * 100
"""
from __future__ import annotations

import logging
from dataclasses import dataclass

from .config import Settings, settings as default_settings
from .scout import SoldItem

logger = logging.getLogger(__name__)


# --------------------------------------------------------------------------
# 国内仕入れ先（メルカリ / 駿河屋想定）のモック最安値（円）
# メルカリは公式APIが無く、駿河屋もAPI非公開のため、実運用ではスクレイピング
# または価格比較サービス経由の取得に差し替える想定。
# --------------------------------------------------------------------------
MOCK_DOMESTIC_PRICES: dict[str, dict[str, int]] = {
    "pokemon card 151 booster box":       {"mercari": 11800, "surugaya": 13480},
    "pokemon card terastal festival box": {"mercari": 6980,  "surugaya": 7480},
    "one piece card romance dawn box":    {"mercari": 19800, "surugaya": 18900},
    "yugioh 25th quarter century":        {"mercari": 7200,  "surugaya": 7980},
    "nintendo switch oled splatoon":      {"mercari": 33500, "surugaya": 35800},
    "famicom mini":                       {"mercari": 6500,  "surugaya": 7480},
    "pc engine mini":                     {"mercari": 9800, "surugaya": 10980},
    "gameboy pocket famitsu":             {"mercari": 13500, "surugaya": 16800},
    "gundam pg unleashed rx-78-2":        {"mercari": 22800, "surugaya": 21980},
    "gundam mg aerial":                   {"mercari": 4900,  "surugaya": 5280},
    "figma link tears of the kingdom":    {"mercari": 11500, "surugaya": 12800},
    "ichiban kuji dragon ball last one":  {"mercari": 7800,  "surugaya": 8980},
    "nendoroid frieren":                  {"mercari": 4800,  "surugaya": 5380},
    "sanrio kuromi plush limited":        {"mercari": 1200,  "surugaya": 1680},
    "tamagotchi uni":                     {"mercari": 3200,  "surugaya": 3680},
    "seiko 5 sports gmt":                 {"mercari": 42000, "surugaya": 45800},
    "grand seiko sbga":                   {"mercari": 520000, "surugaya": 548000},
}


def lookup_domestic_lowest(keyword: str) -> tuple[int, str] | None:
    """国内仕入れ最安値 (価格, 仕入れ先) を返す。見つからなければ None。"""
    prices = MOCK_DOMESTIC_PRICES.get(keyword)
    if not prices:
        return None
    shop, price = min(prices.items(), key=lambda kv: kv[1])
    return price, shop


@dataclass
class ProfitResult:
    item: SoldItem
    sell_price_jpy: int
    source_price_jpy: int
    source_shop: str
    ebay_fee_jpy: int
    shipping_jpy: int
    warehouse_jpy: int
    profit_jpy: int
    margin_pct: float

    @property
    def title(self) -> str:
        return self.item.title

    @property
    def str_rate(self) -> float:
        return self.item.str_rate


def calc_profit(item: SoldItem, source_price: int, source_shop: str,
                cfg: Settings = default_settings) -> ProfitResult:
    sell_jpy = round(item.sold_price_usd * cfg.usd_jpy_rate)
    fee = round(sell_jpy * cfg.ebay_fee_rate)
    ship = round(cfg.shipping_cost_jpy)
    wh = round(cfg.warehouse_fee_jpy)
    profit = sell_jpy - source_price - fee - ship - wh
    margin = round(profit / sell_jpy * 100, 1) if sell_jpy else 0.0
    return ProfitResult(item, sell_jpy, source_price, source_shop, fee, ship, wh, profit, margin)


def analyze(items: list[SoldItem], cfg: Settings = default_settings) -> list[ProfitResult]:
    """全商品の利益を計算し、条件（利益率・純利益の下限）を満たすものだけ返す。"""
    results: list[ProfitResult] = []
    for item in items:
        found = lookup_domestic_lowest(item.keyword)
        if not found:
            logger.info("国内仕入れ価格が見つかりません: %s", item.keyword)
            continue
        price, shop = found
        r = calc_profit(item, price, shop, cfg)
        if r.margin_pct >= cfg.min_profit_margin and r.profit_jpy >= cfg.min_profit_jpy:
            results.append(r)
    return results


def rank_by_turnover(results: list[ProfitResult], top: int = 5) -> list[ProfitResult]:
    """高回転ランキング: STR降順 → 成約数降順。"""
    return sorted(results, key=lambda r: (r.str_rate, r.item.sold_count_30d), reverse=True)[:top]


def rank_by_margin(results: list[ProfitResult], top: int = 5) -> list[ProfitResult]:
    """高利益率ランキング: 利益率降順 → 利益額降順。"""
    return sorted(results, key=lambda r: (r.margin_pct, r.profit_jpy), reverse=True)[:top]
