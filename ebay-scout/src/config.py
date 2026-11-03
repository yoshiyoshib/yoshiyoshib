"""環境変数から設定を読み込む。"""
from __future__ import annotations

import os
from dataclasses import dataclass

from dotenv import load_dotenv

load_dotenv()


def _float(name: str, default: float) -> float:
    raw = os.getenv(name, "").strip()
    try:
        return float(raw) if raw else default
    except ValueError:
        return default


@dataclass(frozen=True)
class Settings:
    ebay_client_id: str = os.getenv("EBAY_CLIENT_ID", "").strip()
    ebay_client_secret: str = os.getenv("EBAY_CLIENT_SECRET", "").strip()
    ebay_env: str = os.getenv("EBAY_ENV", "production").strip() or "production"
    ebay_marketplace_id: str = os.getenv("EBAY_MARKETPLACE_ID", "EBAY_US").strip() or "EBAY_US"
    use_mock: bool = os.getenv("USE_MOCK", "0").strip() in ("1", "true", "True")

    usd_jpy_rate: float = _float("USD_JPY_RATE", 150.0)
    ebay_fee_rate: float = _float("EBAY_FEE_RATE", 0.15)
    shipping_cost_jpy: float = _float("SHIPPING_COST_JPY", 2500)
    warehouse_fee_jpy: float = _float("WAREHOUSE_FEE_JPY", 800)

    min_profit_margin: float = _float("MIN_PROFIT_MARGIN", 20)
    min_profit_jpy: float = _float("MIN_PROFIT_JPY", 3000)

    slack_webhook_url: str = os.getenv("SLACK_WEBHOOK_URL", "").strip()

    @property
    def has_ebay_credentials(self) -> bool:
        return bool(self.ebay_client_id and self.ebay_client_secret) and not self.use_mock

    @property
    def ebay_api_base(self) -> str:
        if self.ebay_env == "sandbox":
            return "https://api.sandbox.ebay.com"
        return "https://api.ebay.com"


settings = Settings()
