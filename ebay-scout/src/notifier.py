"""ランキングを Slack Incoming Webhook へ送信。未設定時は標準出力にテーブル表示。"""
from __future__ import annotations

import logging
from datetime import datetime

import requests
from tabulate import tabulate

from .analyzer import ProfitResult
from .config import Settings, settings as default_settings

logger = logging.getLogger(__name__)

HEADERS = ["#", "商品", "eBay価格", "仕入値(店)", "利益", "利益率", "STR", "成約/出品"]


def _short(text: str, width: int = 38) -> str:
    return text if len(text) <= width else text[: width - 1] + "…"


def _rows(results: list[ProfitResult]) -> list[list[str]]:
    return [
        [
            i,
            _short(r.title),
            f"¥{r.sell_price_jpy:,} (${r.item.sold_price_usd:,.0f})",
            f"¥{r.source_price_jpy:,} ({r.source_shop})",
            f"¥{r.profit_jpy:,}",
            f"{r.margin_pct:.1f}%",
            f"{r.str_rate:.0f}%",
            f"{r.item.sold_count_30d}/{r.item.active_listings}",
        ]
        for i, r in enumerate(results, 1)
    ]


def format_console(turnover: list[ProfitResult], margin: list[ProfitResult],
                   total_candidates: int, data_source: str, cfg: Settings) -> str:
    lines = [
        "=" * 100,
        f" eBay 輸出リサーチレポート  {datetime.now():%Y-%m-%d %H:%M}  (データ: {data_source})",
        f" 条件: 利益率 {cfg.min_profit_margin:.0f}%以上 / 純利益 ¥{cfg.min_profit_jpy:,.0f}以上"
        f"  | 為替 1USD=¥{cfg.usd_jpy_rate:.1f}  | 該当 {total_candidates} 件",
        "=" * 100,
        "",
        "■ 高回転ランキング TOP5 (STR = 30日成約数 / 出品数)",
        tabulate(_rows(turnover), headers=HEADERS, tablefmt="github") if turnover else "  該当なし",
        "",
        "■ 高利益率ランキング TOP5",
        tabulate(_rows(margin), headers=HEADERS, tablefmt="github") if margin else "  該当なし",
        "",
    ]
    return "\n".join(lines)


def _slack_section(title: str, results: list[ProfitResult]) -> list[dict]:
    blocks: list[dict] = [{"type": "header", "text": {"type": "plain_text", "text": title}}]
    if not results:
        blocks.append({"type": "section", "text": {"type": "mrkdwn", "text": "該当なし"}})
        return blocks
    lines = [
        f"*{i}. {r.title}*\n"
        f"　利益 *¥{r.profit_jpy:,}* ({r.margin_pct:.1f}%) | STR {r.str_rate:.0f}% "
        f"({r.item.sold_count_30d}/{r.item.active_listings})\n"
        f"　eBay ¥{r.sell_price_jpy:,} (${r.item.sold_price_usd:,.0f}) ← "
        f"仕入 ¥{r.source_price_jpy:,} ({r.source_shop})"
        for i, r in enumerate(results, 1)
    ]
    blocks.append({"type": "section", "text": {"type": "mrkdwn", "text": "\n".join(lines)}})
    return blocks


def build_slack_payload(turnover: list[ProfitResult], margin: list[ProfitResult],
                        total_candidates: int, data_source: str, cfg: Settings) -> dict:
    summary = (f"{datetime.now():%Y-%m-%d} | データ: {data_source} | 該当 {total_candidates} 件 | "
               f"条件: 利益率{cfg.min_profit_margin:.0f}%↑ & ¥{cfg.min_profit_jpy:,.0f}↑ | "
               f"1USD=¥{cfg.usd_jpy_rate:.1f}")
    blocks = [{"type": "context", "elements": [{"type": "mrkdwn", "text": summary}]}]
    blocks += _slack_section("🔥 高回転ランキング TOP5", turnover)
    blocks.append({"type": "divider"})
    blocks += _slack_section("💰 高利益率ランキング TOP5", margin)
    return {"text": "eBay 輸出リサーチレポート", "blocks": blocks}


def notify(turnover: list[ProfitResult], margin: list[ProfitResult], total_candidates: int,
           data_source: str, cfg: Settings = default_settings) -> bool:
    """Slack 送信。Webhook 未設定または送信失敗時はコンソール出力。送信成功で True。"""
    if cfg.slack_webhook_url:
        payload = build_slack_payload(turnover, margin, total_candidates, data_source, cfg)
        try:
            resp = requests.post(cfg.slack_webhook_url, json=payload, timeout=15)
            resp.raise_for_status()
            logger.info("Slackへ通知しました。")
            return True
        except requests.RequestException as exc:
            logger.warning("Slack送信に失敗したためコンソールに出力します: %s", exc)
    else:
        logger.info("SLACK_WEBHOOK_URL 未設定のためコンソールに出力します。")
    print(format_console(turnover, margin, total_candidates, data_source, cfg))
    return False
