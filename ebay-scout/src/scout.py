"""eBay から成約データ (Sold Listings) とライバル出品数を取得する。

- 成約データ: Marketplace Insights API (`/buy/marketplace_insights/v1_beta/item_sales/search`)
  ※旧 Finding API の findCompletedItems は 2025年に廃止。Insights API は利用申請が必要。
- ライバル出品数: Browse API (`/buy/browse/v1/item_summary/search`) の `total`

API キー未設定 / 取得失敗時は、日本のホビー・ゲーム系のダミーデータにフォールバックする。
"""
from __future__ import annotations

import base64
import logging
import statistics
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone

import requests

from .config import Settings, settings as default_settings

logger = logging.getLogger(__name__)

TIMEOUT = 20


@dataclass
class SoldItem:
    keyword: str            # 検索キーワード（国内仕入れ照合キー）
    title: str
    category: str
    sold_price_usd: float   # 直近30日の成約価格（中央値）
    sold_count_30d: int     # 直近30日の成約数
    active_listings: int    # ライバル出品数（現在の出品数）
    source: str = "mock"    # "ebay" or "mock"
    str_rate: float = field(init=False)

    def __post_init__(self) -> None:
        self.str_rate = calc_str(self.sold_count_30d, self.active_listings)


def calc_str(sold_count: int, active_listings: int) -> float:
    """成約率 STR (%) = 成約数 / 出品数 * 100。出品数0なら成約数があれば上限扱い。"""
    if active_listings <= 0:
        return 100.0 * sold_count if sold_count > 0 else 0.0
    return round(sold_count / active_listings * 100, 1)


# --------------------------------------------------------------------------
# モックデータ（2026年時点の相場感をイメージした架空の数値）
# keyword, title, category, 成約価格USD, 30日成約数, ライバル出品数
# --------------------------------------------------------------------------
MOCK_SOLD_DATA: list[tuple[str, str, str, float, int, int]] = [
    ("pokemon card 151 booster box", "Pokemon Card 151 Booster Box Japanese Sealed", "Trading Cards", 168.0, 142, 95),
    ("pokemon card terastal festival box", "Pokemon Terastal Festival ex Booster Box Japanese", "Trading Cards", 112.0, 210, 160),
    ("one piece card romance dawn box", "One Piece Card Game Romance Dawn OP-01 Box Japanese", "Trading Cards", 245.0, 64, 58),
    ("yugioh 25th quarter century", "Yu-Gi-Oh! Quarter Century Chronicle Side Pride Box JP", "Trading Cards", 74.0, 88, 140),
    ("nintendo switch oled splatoon", "Nintendo Switch OLED Splatoon 3 Edition Japan", "Video Games", 395.0, 22, 47),
    ("famicom mini", "Nintendo Classic Mini Famicom Japan Boxed", "Video Games", 92.0, 55, 80),
    ("pc engine mini", "PC Engine mini Konami Japan Console New", "Video Games", 158.0, 31, 26),
    ("gameboy pocket famitsu", "Game Boy Pocket Famitsu Limited Edition Japan", "Video Games", 210.0, 9, 21),
    ("gundam pg unleashed rx-78-2", "Bandai PG Unleashed 1/60 RX-78-2 Gundam", "Model Kits", 265.0, 38, 44),
    ("gundam mg aerial", "Bandai MG 1/100 Gundam Aerial Witch from Mercury", "Model Kits", 62.0, 120, 210),
    ("figma link tears of the kingdom", "figma Link Tears of the Kingdom ver. DX Edition", "Figures", 155.0, 47, 39),
    ("ichiban kuji dragon ball last one", "Ichiban Kuji Dragon Ball Last One Prize Figure", "Figures", 128.0, 36, 52),
    ("nendoroid frieren", "Nendoroid Frieren Beyond Journey's End Good Smile", "Figures", 58.0, 75, 66),
    ("sanrio kuromi plush limited", "Sanrio Kuromi Big Plush Japan Limited", "Toys", 48.0, 160, 300),
    ("tamagotchi uni", "Bandai Tamagotchi Uni Japan Version", "Toys", 69.0, 92, 120),
    ("seiko 5 sports gmt", "Seiko 5 Sports GMT SSK001 Made in Japan", "Watches", 320.0, 18, 70),
    ("grand seiko sbga", "Grand Seiko SBGA211 Snowflake", "Watches", 4900.0, 4, 30),
]


def get_mock_sold_listings() -> list[SoldItem]:
    return [
        SoldItem(keyword=k, title=t, category=c, sold_price_usd=p,
                 sold_count_30d=s, active_listings=a, source="mock")
        for k, t, c, p, s, a in MOCK_SOLD_DATA
    ]


# --------------------------------------------------------------------------
# eBay 実API
# --------------------------------------------------------------------------
class EbayClient:
    SCOPE = "https://api.ebay.com/oauth/api_scope"
    INSIGHTS_SCOPE = "https://api.ebay.com/oauth/api_scope/buy.marketplace.insights"

    def __init__(self, cfg: Settings) -> None:
        self.cfg = cfg
        self.session = requests.Session()
        self._token: str | None = None

    def _get_token(self) -> str:
        if self._token:
            return self._token
        basic = base64.b64encode(
            f"{self.cfg.ebay_client_id}:{self.cfg.ebay_client_secret}".encode()
        ).decode()
        resp = self.session.post(
            f"{self.cfg.ebay_api_base}/identity/v1/oauth2/token",
            headers={"Authorization": f"Basic {basic}",
                     "Content-Type": "application/x-www-form-urlencoded"},
            data={"grant_type": "client_credentials",
                  "scope": f"{self.SCOPE} {self.INSIGHTS_SCOPE}"},
            timeout=TIMEOUT,
        )
        resp.raise_for_status()
        self._token = resp.json()["access_token"]
        return self._token

    def _headers(self) -> dict[str, str]:
        return {
            "Authorization": f"Bearer {self._get_token()}",
            "X-EBAY-C-MARKETPLACE-ID": self.cfg.ebay_marketplace_id,
        }

    def count_active_listings(self, keyword: str) -> int:
        """Browse API: 現在の出品数（ライバル数）。"""
        resp = self.session.get(
            f"{self.cfg.ebay_api_base}/buy/browse/v1/item_summary/search",
            headers=self._headers(),
            params={"q": keyword, "limit": 1,
                    "filter": "itemLocationCountry:JP,buyingOptions:{FIXED_PRICE}"},
            timeout=TIMEOUT,
        )
        resp.raise_for_status()
        return int(resp.json().get("total", 0))

    def fetch_sold(self, keyword: str, days: int = 30) -> tuple[str, str, float, int]:
        """Marketplace Insights API: 直近 days 日の成約。 (title, category, 中央値USD, 成約数)"""
        since = (datetime.now(timezone.utc) - timedelta(days=days)).strftime("%Y-%m-%dT%H:%M:%S.000Z")
        resp = self.session.get(
            f"{self.cfg.ebay_api_base}/buy/marketplace_insights/v1_beta/item_sales/search",
            headers=self._headers(),
            params={"q": keyword, "limit": 200,
                    "filter": f"lastSoldDate:[{since}],itemLocationCountry:JP"},
            timeout=TIMEOUT,
        )
        resp.raise_for_status()
        data = resp.json()
        sales = data.get("itemSales", [])
        prices = [float(s["lastSoldPrice"]["value"]) for s in sales if s.get("lastSoldPrice")]
        sold_count = sum(int(s.get("totalSoldQuantity", 1)) for s in sales)
        title = sales[0]["title"] if sales else keyword
        category = (sales[0].get("categories") or [{}])[0].get("categoryName", "-") if sales else "-"
        median = statistics.median(prices) if prices else 0.0
        return title, category, median, sold_count


def fetch_sold_listings(keywords: list[str] | None = None,
                        cfg: Settings = default_settings) -> list[SoldItem]:
    """成約データを取得する。認証情報が無い/失敗時はモックを返す。"""
    if not cfg.has_ebay_credentials:
        logger.info("eBay APIキー未設定（またはUSE_MOCK=1）のためモックデータを使用します。")
        return get_mock_sold_listings()

    keywords = keywords or [row[0] for row in MOCK_SOLD_DATA]
    client = EbayClient(cfg)
    items: list[SoldItem] = []
    try:
        for kw in keywords:
            title, category, price, sold = client.fetch_sold(kw)
            active = client.count_active_listings(kw)
            if price <= 0:
                continue
            items.append(SoldItem(kw, title, category, price, sold, active, source="ebay"))
    except (requests.RequestException, KeyError, ValueError) as exc:
        logger.warning("eBay API取得に失敗したためモックデータにフォールバックします: %s", exc)
        return get_mock_sold_listings()
    return items or get_mock_sold_listings()
