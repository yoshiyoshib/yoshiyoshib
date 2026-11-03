# ebay-scout

This tool finds Japanese products that sell well on eBay. It compares each item's eBay sold price against the cheapest domestic sourcing price (Mercari / Surugaya) and calculates the profit. It then sends rankings of profitable items to Slack.
If no API keys are set, it runs end to end on mock data.

## Setup
```bash
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env   # Fill in API keys etc. as needed
python main.py
pytest                 # Tests
```

## Layout
```
main.py          Fetch -> analyze -> report, in one run
src/config.py    Settings loaded from environment variables
src/scout.py     eBay sold data and competitor listing counts (mock fallback), STR calculation
src/analyzer.py  Matching against domestic lowest prices, profit calculation, filtering, TOP5 rankings
src/notifier.py  Sends to Slack Incoming Webhook; prints tables to stdout when not configured
tests/           Calculation formula and pipeline tests
```

## Formulas
- Net profit = eBay sale price (in JPY) - domestic purchase price - eBay fee (15%) - international shipping (¥2,500) - warehouse/forwarding fee (¥800)
- Net profit margin = net profit / eBay sale price × 100
- STR = sold in the last 30 days / active listings × 100
- Items are kept only if margin ≥ 20% **and** net profit ≥ ¥3,000
- High-turnover ranking: sorted by STR, descending / High-margin ranking: sorted by margin, descending

## Using the real APIs
- The old eBay Finding API (`findCompletedItems`) has been shut down. Sold data is fetched through the **Marketplace Insights API**, which requires an access application to eBay. Competitor listing counts come from the **Browse API**.
- If an API call fails, the tool logs a warning and falls back to mock data.
- Mercari and Surugaya have no public API, so `MOCK_DOMESTIC_PRICES` / `lookup_domestic_lowest()` in `src/analyzer.py` still uses mock data. Replace it with real price fetching.
