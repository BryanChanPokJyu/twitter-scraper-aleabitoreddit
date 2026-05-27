#!/usr/bin/env python3
"""
Score tweet-ticker pairs by signal strength.
4 dimensions: exclusivity, depth, burst, behavioral signals.
"""

import json
import re
from collections import defaultdict
from datetime import datetime, timedelta

TWEETS_FILE = "tweets.json"
TICKERS_FILE = "output/tickers.json"
OUTPUT_DIR = "output"

TICKER_PAT = re.compile(r'\$([A-Z]{2,5})')
PRICE_PAT = re.compile(r'\d+\.?\d*%|\$\d+\.?\d*\s*(MC|market cap|price|target|PT|entry)', re.I)
RETURN_PAT = re.compile(r'\d+x\s*(return|bag)|up\s*\d+%|return\s*\d+%|went up|moon', re.I)
HOLDING_PAT = re.compile(r"i.m\s*(long|short|holding|in)|my\s*(position|portfolio|holdings)|added\s*(to|more)", re.I)
THESIS_PAT = re.compile(r'thesis|bull case|bear case|catalyst|undervalued|overvalued|valuation|supply chain', re.I)

FALSE_POSITIVE_US = {
    "AI", "CEO", "GPU", "CPU", "IPO", "ETF", "SEC", "FDA", "USA", "USD",
    "API", "LLC", "INC", "THE", "FOR", "AND", "NOT", "BUT", "ALL", "ARE",
    "CAN", "HAS", "HAD", "WAS", "HIS", "HER", "WHO", "HOW", "NEW", "OLD",
    "TOP", "LOW", "HIGH", "BIG", "ANY", "FYI", "IMO", "LOL", "OMG", "WTF",
    "EPS", "PE", "PB", "ROE", "ROI", "YOY", "QOQ", "ATH", "ATL", "OTC",
    "CW", "DC", "AC", "IC", "PC", "TV", "UK", "EU", "JP", "KR", "TW",
    "PT", "IV", "MC", "SK", "B", "K", "M", "Q", "X",
}


def parse_date(s):
    try:
        return datetime.strptime(s, '%a %b %d %H:%M:%S %z %Y')
    except Exception:
        try:
            return datetime.fromisoformat(s.replace('Z', '+00:00'))
        except Exception:
            return None


def compute_burst_map(tweets):
    """For each ticker, compute max mentions in any 7-day window."""
    ticker_dates = defaultdict(list)
    for t in tweets:
        dt = parse_date(t['createdAt'])
        if not dt:
            continue
        tickers = set(TICKER_PAT.findall(t['text'])) - FALSE_POSITIVE_US
        for tk in tickers:
            ticker_dates[tk].append(dt)

    burst_scores = {}
    for tk, dates in ticker_dates.items():
        dates.sort()
        max_burst = 1
        for i, d in enumerate(dates):
            count = sum(1 for dd in dates[i:] if (dd - d).days <= 7)
            max_burst = max(max_burst, count)
        burst_scores[tk] = max_burst

    global_max_burst = max(burst_scores.values()) if burst_scores else 1
    return burst_scores, global_max_burst


def score_tweet_ticker(tweet, ticker, burst_scores, global_max_burst):
    """
    5-point scoring:
      5 = exclusive + long(>800) + position/thesis declaration
      4 = exclusive + long(>500) OR has position/target price
      3 = exclusive OR (2-3 tickers + has argument)
      2 = 4-5 tickers with directional view
      1 = 6+ tickers listed OR short casual mention
    """
    text = tweet['text']
    all_tickers = set(TICKER_PAT.findall(text)) - FALSE_POSITIVE_US
    num_tickers = max(len(all_tickers), 1)
    length = len(text)

    is_exclusive = (num_tickers == 1)
    is_long = (length > 800)
    is_medium = (length > 500)
    has_position = bool(HOLDING_PAT.search(text))
    has_thesis = bool(THESIS_PAT.search(text))
    has_target = bool(PRICE_PAT.search(text))
    has_argument = has_thesis or has_target or bool(RETURN_PAT.search(text))

    if is_exclusive and is_long and (has_position or has_thesis):
        score = 5
    elif (is_exclusive and is_medium) or has_position or (is_exclusive and has_target):
        score = 4
    elif is_exclusive or (num_tickers <= 3 and has_argument):
        score = 3
    elif num_tickers <= 5 and (has_argument or is_medium):
        score = 2
    else:
        score = 1

    return {
        'score': score,
        'num_tickers': num_tickers,
        'length': length,
        'has_position': has_position,
        'has_thesis': has_thesis,
        'has_target': has_target,
    }


def assign_grade(score):
    if score >= 5:
        return 'S'
    elif score >= 4:
        return 'A'
    elif score >= 3:
        return 'B'
    else:
        return 'C'


def main():
    import os
    os.makedirs(OUTPUT_DIR, exist_ok=True)

    with open(TWEETS_FILE) as f:
        data = json.load(f)
    tweets = data['tweets']

    with open(TICKERS_FILE) as f:
        tickers_data = json.load(f)

    print("Computing burst map...")
    burst_scores, global_max_burst = compute_burst_map(tweets)
    print(f"  Global max burst: {global_max_burst} (7-day window)")

    # Score every tweet-ticker pair
    scored_pairs = []
    for tweet in tweets:
        tickers = set(TICKER_PAT.findall(tweet['text'])) - FALSE_POSITIVE_US
        if not tickers:
            continue
        dt = parse_date(tweet['createdAt'])
        date_str = dt.strftime('%Y-%m-%d') if dt else ''

        for ticker in tickers:
            scores = score_tweet_ticker(tweet, ticker, burst_scores, global_max_burst)
            grade = assign_grade(scores['score'])
            scored_pairs.append({
                'ticker': ticker,
                'grade': grade,
                'score': scores['score'],
                'date': date_str,
                'likes': tweet.get('likes', 0),
                'views': tweet.get('views', 0),
                'url': tweet.get('url', ''),
                'text_preview': tweet['text'][:150],
                'tweet_id': tweet['id'],
            })

    # Sort by score descending
    scored_pairs.sort(key=lambda x: -x['score'])

    # Grade distribution
    grade_dist = defaultdict(int)
    for p in scored_pairs:
        grade_dist[p['grade']] += 1

    print(f"\nTotal scored pairs: {len(scored_pairs)}")
    print("Grade distribution:")
    for g in ['S', 'A', 'B', 'C']:
        print(f"  {g}: {grade_dist[g]:5d} ({grade_dist[g]*100//len(scored_pairs)}%)")

    # Aggregate: best score per ticker
    ticker_best = {}
    ticker_all_scores = defaultdict(list)
    for p in scored_pairs:
        tk = p['ticker']
        ticker_all_scores[tk].append(p['score'])
        if tk not in ticker_best or p['score'] > ticker_best[tk]['score']:
            ticker_best[tk] = p

    ticker_summary = []
    for tk, best in ticker_best.items():
        all_scores = ticker_all_scores[tk]
        ticker_summary.append({
            'ticker': tk,
            'best_grade': best['grade'],
            'best_score': best['score'],
            'avg_score': round(sum(all_scores) / len(all_scores), 1),
            'total_score': sum(all_scores),
            'mention_count': len(all_scores),
            'burst_7d': burst_scores.get(tk, 0),
            'best_tweet_url': best['url'],
            'best_tweet_preview': best['text_preview'],
        })

    ticker_summary.sort(key=lambda x: -x['best_score'])

    # Write outputs
    # 1. Full scored pairs
    full_output = {
        'metadata': {
            'total_tweets': len(tweets),
            'total_scored_pairs': len(scored_pairs),
            'grade_distribution': dict(grade_dist),
            'scoring_rules': {
                '5 (S)': 'exclusive + long(>800) + position/thesis',
                '4 (A)': 'exclusive + medium(>500) OR has position/target',
                '3 (B)': 'exclusive OR (2-3 tickers + argument)',
                '2 (C)': '4-5 tickers with view',
                '1 (C)': '6+ tickers listed or short mention',
            },
            'grade_thresholds': {'S': '=5', 'A': '=4', 'B': '=3', 'C': '<=2'},
        },
        'scored_pairs': scored_pairs,
    }
    with open(f'{OUTPUT_DIR}/scored_signals.json', 'w') as f:
        json.dump(full_output, f, indent=2, ensure_ascii=False)

    # 2. Ticker summary (leaderboard)
    with open(f'{OUTPUT_DIR}/ticker_leaderboard.json', 'w') as f:
        json.dump(ticker_summary, f, indent=2, ensure_ascii=False)

    # 3. Top picks (S + A grade, deduplicated by ticker)
    top_picks = [t for t in ticker_summary if t['best_grade'] in ('S', 'A')]
    with open(f'{OUTPUT_DIR}/top_picks.json', 'w') as f:
        json.dump(top_picks, f, indent=2, ensure_ascii=False)

    print(f"\nTop picks (S+A grade): {len(top_picks)} tickers")
    print("\nTop 20 by total score:")
    print(f"{'Ticker':8s} {'Grade':6s} {'Best':5s} {'Avg':4s} {'Total':6s} {'Mentions':9s}")
    for t in ticker_summary[:20]:
        print(f"${t['ticker']:7s} {t['best_grade']:6s} {t['best_score']:4d}   {t['avg_score']:3.1f}  {t['total_score']:5d}  {t['mention_count']:7d}")

    print(f"\nOutput saved to {OUTPUT_DIR}/")
    print(f"  - scored_signals.json  (all {len(scored_pairs)} tweet-ticker pairs)")
    print(f"  - ticker_leaderboard.json  ({len(ticker_summary)} tickers ranked)")
    print(f"  - top_picks.json  ({len(top_picks)} S+A grade tickers)")


if __name__ == '__main__':
    main()
