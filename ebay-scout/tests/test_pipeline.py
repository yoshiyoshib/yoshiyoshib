from dataclasses import replace

from src.analyzer import analyze, calc_profit, rank_by_margin, rank_by_turnover
from src.config import Settings
from src.notifier import build_slack_payload
from src.scout import SoldItem, calc_str, fetch_sold_listings

CFG = Settings(ebay_client_id="", ebay_client_secret="", usd_jpy_rate=150.0,
               ebay_fee_rate=0.15, shipping_cost_jpy=2500, warehouse_fee_jpy=800,
               min_profit_margin=20, min_profit_jpy=3000, slack_webhook_url="")


def test_calc_str():
    assert calc_str(50, 100) == 50.0
    assert calc_str(0, 0) == 0.0


def test_profit_formula():
    item = SoldItem("k", "t", "c", 100.0, 10, 20)
    r = calc_profit(item, 5000, "mercari", CFG)
    # 15000 - 5000 - 2250 - 2500 - 800 = 4450
    assert r.sell_price_jpy == 15000
    assert r.profit_jpy == 4450
    assert r.margin_pct == 29.7


def test_mock_fallback_and_filters():
    items = fetch_sold_listings(cfg=CFG)
    assert items and all(i.source == "mock" for i in items)
    results = analyze(items, CFG)
    assert results
    assert all(r.margin_pct >= 20 and r.profit_jpy >= 3000 for r in results)
    assert len(results) < len(items)  # 一部は条件で除外される
    t, m = rank_by_turnover(results), rank_by_margin(results)
    assert len(t) <= 5 and len(m) <= 5
    assert [r.str_rate for r in t] == sorted([r.str_rate for r in t], reverse=True)
    assert [r.margin_pct for r in m] == sorted([r.margin_pct for r in m], reverse=True)
    payload = build_slack_payload(t, m, len(results), "モック", CFG)
    assert payload["blocks"]


def test_rate_change_affects_result():
    items = fetch_sold_listings(cfg=CFG)
    assert len(analyze(items, replace(CFG, usd_jpy_rate=100.0))) < len(analyze(items, CFG))
