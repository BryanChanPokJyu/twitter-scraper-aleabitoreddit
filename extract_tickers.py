#!/usr/bin/env python3
"""
Extract stock tickers from tweets.json
- US stocks: $TICKER format
- Taiwan stocks: (XXXX) format (4-5 digit codes)
- Company name aliases: common names mapped to tickers
"""

import json
import re
from collections import Counter

TWEETS_FILE = "tweets.json"
OUTPUT_FILE = "output/tickers.json"

# Known company name -> ticker mappings for this account
ALIASES = {
    "win semi": "3105.TW",
    "win semiconductor": "3105.TW",
    "shunsin": "6451.TW",
    "sivers": "SIVE",
    "nebius": "NBIS",
    "celestial ai": "PRIVATE:CelestialAI",
    "lightmatter": "PRIVATE:Lightmatter",
    "lightelligence": "PRIVATE:Lightelligence",
    "sk hynix": "000660.KS",
    "samsung": "005930.KS",
    "lumentum": "LITE",
    "coherent": "COHR",
    "ii-vi": "COHR",
    "marvell": "MRVL",
    "broadcom": "AVGO",
}

# Taiwan stock codes that are actually years or other false positives
FALSE_POSITIVE_TW = {"2024", "2025", "2026", "2027", "1000", "1500", "2000", "3000", "5000", "10000"}

# Common words that look like tickers but aren't
FALSE_POSITIVE_US = {
    "AI", "CEO", "GPU", "CPU", "IPO", "ETF", "SEC", "FDA", "USA", "USD",
    "API", "LLC", "INC", "THE", "FOR", "AND", "NOT", "BUT", "ALL", "ARE",
    "CAN", "HAS", "HAD", "WAS", "HIS", "HER", "WHO", "HOW", "NEW", "OLD",
    "TOP", "LOW", "HIGH", "BIG", "ANY", "FYI", "IMO", "LOL", "OMG", "WTF",
    "EPS", "PE", "PB", "ROE", "ROI", "YOY", "QOQ", "ATH", "ATL", "OTC",
    "CW", "DC", "AC", "IC", "PC", "TV", "UK", "EU", "JP", "KR", "TW",
    "PT", "IV", "MC", "SK", "B", "K", "M", "Q", "X",
}


def extract_us_tickers(text):
    """Extract $TICKER patterns"""
    matches = re.findall(r'\$([A-Z]{2,5})', text)
    return [t for t in matches if t not in FALSE_POSITIVE_US]


def extract_tw_codes(text):
    """Extract (XXXX) Taiwan stock codes"""
    matches = re.findall(r'\((\d{4,5})\)', text)
    return [f"{m}.TW" for m in matches if m not in FALSE_POSITIVE_TW]


def extract_aliases(text):
    """Extract tickers from known company name mentions"""
    text_lower = text.lower()
    found = []
    for name, ticker in ALIASES.items():
        if name in text_lower:
            found.append(ticker)
    return found


def extract_all(text):
    """Combine all extraction methods, deduplicate"""
    tickers = set()
    tickers.update(extract_us_tickers(text))
    tickers.update(extract_tw_codes(text))
    tickers.update(extract_aliases(text))
    return sorted(tickers)


def main():
    with open(TWEETS_FILE, "r") as f:
        data = json.load(f)

    tweets = data["tweets"]
    results = []
    all_tickers = Counter()

    for tweet in tweets:
        tickers = extract_all(tweet["text"])
        all_tickers.update(tickers)
        results.append({
            "id": tweet["id"],
            "date": tweet["createdAt"],
            "url": tweet["url"],
            "tickers": tickers,
            "text_preview": tweet["text"][:120],
        })

    tagged = [r for r in results if r["tickers"]]
    untagged = [r for r in results if not r["tickers"]]

    output = {
        "summary": {
            "total_tweets": len(tweets),
            "tweets_with_tickers": len(tagged),
            "tweets_without_tickers": len(untagged),
            "coverage": f"{len(tagged) * 100 // len(tweets)}%",
            "unique_tickers": len(all_tickers),
        },
        "ticker_frequency": dict(all_tickers.most_common(50)),
        "tweets": results,
        "untagged_tweets": untagged,
    }

    with open(OUTPUT_FILE, "w") as f:
        json.dump(output, f, indent=2, ensure_ascii=False)

    print(f"Total tweets: {len(tweets)}")
    print(f"With tickers: {len(tagged)} ({len(tagged) * 100 // len(tweets)}%)")
    print(f"Without tickers: {len(untagged)} ({len(untagged) * 100 // len(tweets)}%)")
    print(f"Unique tickers found: {len(all_tickers)}")
    print(f"\nTop 30 tickers:")
    for ticker, count in all_tickers.most_common(30):
        print(f"  {ticker:12s} {count:4d} mentions")
    print(f"\nOutput saved to {OUTPUT_FILE}")


if __name__ == "__main__":
    main()
