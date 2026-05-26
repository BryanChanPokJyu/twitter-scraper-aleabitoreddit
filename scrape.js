#!/usr/bin/env node

import 'dotenv/config';
import { writeFile, readFile } from 'fs/promises';
import { existsSync } from 'fs';

const API_BASE = 'https://api.twitterapi.io/twitter/user/last_tweets';
const TARGET_HANDLE = 'aleabitoreddit';
const LOOKBACK_DAYS = 9999;
const OUTPUT_FILE = 'tweets.json';
const STATE_FILE = 'state.json';

const API_KEY = process.env.TWITTER_API_KEY;
if (!API_KEY) {
  console.error('TWITTER_API_KEY not set');
  process.exit(1);
}

const cutoffDate = new Date(Date.now() - LOOKBACK_DAYS * 24 * 60 * 60 * 1000);

async function fetchPage(cursor) {
  const params = new URLSearchParams({ userName: TARGET_HANDLE });
  if (cursor) params.set('cursor', cursor);

  const res = await fetch(`${API_BASE}?${params}`, {
    headers: { 'x-api-key': API_KEY }
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`HTTP ${res.status}: ${text}`);
  }

  const json = await res.json();
  return {
    tweets: json.data?.tweets || json.tweets || [],
    cursor: json.data?.next_cursor || json.next_cursor || null
  };
}

async function loadState() {
  if (!existsSync(STATE_FILE)) return { cursor: null, tweets: [] };
  try {
    return JSON.parse(await readFile(STATE_FILE, 'utf-8'));
  } catch {
    return { cursor: null, tweets: [] };
  }
}

async function saveState(state) {
  await writeFile(STATE_FILE, JSON.stringify(state, null, 2));
}

async function main() {
  console.log(`Scraping @${TARGET_HANDLE} — tweets from past ${LOOKBACK_DAYS} days`);
  console.log(`Cutoff date: ${cutoffDate.toISOString()}`);
  console.log('');

  let state = await loadState();
  let cursor = state.cursor;
  let allTweets = state.tweets || [];
  let pageNum = Math.floor(allTweets.length / 20) + 1;
  let reachedCutoff = false;
  let noNewPages = 0;

  while (!reachedCutoff) {
    console.log(`  Page ${pageNum}${cursor ? ' (cursor: ...' + cursor.slice(-20) + ')' : ''}...`);

    const data = await fetchPage(cursor);
    const tweets = data.tweets;

    if (tweets.length === 0) {
      console.log('  No more tweets returned. Done.');
      break;
    }

    const prevCount = allTweets.length;

    for (const tweet of tweets) {
      const createdAt = new Date(tweet.createdAt);
      if (createdAt < cutoffDate) {
        reachedCutoff = true;
        console.log(`  Reached cutoff at: ${tweet.createdAt}`);
        break;
      }

      const exists = allTweets.some(t => t.id === tweet.id);
      if (!exists) {
        allTweets.push({
          id: tweet.id,
          text: tweet.text,
          createdAt: tweet.createdAt,
          url: tweet.url || `https://x.com/${TARGET_HANDLE}/status/${tweet.id}`,
          likes: tweet.likeCount || tweet.likes || 0,
          retweets: tweet.retweetCount || tweet.retweets || 0,
          replies: tweet.replyCount || tweet.replies || 0,
          views: tweet.viewCount || tweet.views || 0,
          isRetweet: tweet.isRetweet || false,
          isQuote: tweet.isQuote || false,
          quotedText: tweet.quotedTweet?.text || null,
          media: tweet.media || null
        });
      }
    }

    const added = allTweets.length - prevCount;
    console.log(`    +${added} new tweets (total: ${allTweets.length})`);

    if (added === 0) {
      noNewPages++;
      if (noNewPages >= 3) {
        console.log('  API returning only duplicates for 3 pages. Stopping.');
        break;
      }
    } else {
      noNewPages = 0;
    }

    cursor = data.cursor;
    pageNum++;

    // Save progress after each page
    state = { cursor, tweets: allTweets };
    await saveState(state);

    if (!cursor) {
      console.log('  No more pages (no cursor). Done.');
      break;
    }

    // Rate limit: small delay between requests
    await new Promise(r => setTimeout(r, 500));
  }

  // Sort by date descending
  allTweets.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

  const output = {
    handle: TARGET_HANDLE,
    scrapedAt: new Date().toISOString(),
    lookbackDays: LOOKBACK_DAYS,
    cutoffDate: cutoffDate.toISOString(),
    totalTweets: allTweets.length,
    tweets: allTweets
  };

  await writeFile(OUTPUT_FILE, JSON.stringify(output, null, 2));
  console.log(`\nDone! ${allTweets.length} tweets saved to ${OUTPUT_FILE}`);
}

main().catch(err => {
  console.error('Fatal error:', err.message);
  process.exit(1);
});
