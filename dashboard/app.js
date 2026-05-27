const TICKERS_URL = '../output/tickers.json';
const YAHOO_PROXY = '/api/yahoo/';

let tickersData = null;
let chart = null;
let candleSeries = null;
let markers = [];
let currentSymbol = null;

async function init() {
  try {
    const res = await fetch(TICKERS_URL);
    tickersData = await res.json();
    renderKPIs();
    renderSymbolsList();
  } catch (e) {
    document.getElementById('kpis').innerHTML = `<div class="error-msg">Failed to load tickers.json: ${e.message}</div>`;
  }
}

function renderKPIs() {
  const s = tickersData.summary;
  const freq = tickersData.ticker_frequency;
  const topTicker = Object.keys(freq)[0];
  const kpis = [
    { label: 'Total Tweets', value: s.total_tweets.toLocaleString() },
    { label: 'With Tickers', value: `${s.tweets_with_tickers} (${s.coverage})` },
    { label: 'Unique Tickers', value: s.unique_tickers },
    { label: 'Top Ticker', value: `$${topTicker}` },
    { label: 'Top Mentions', value: freq[topTicker] },
  ];
  document.getElementById('kpis').innerHTML = kpis.map(k =>
    `<div class="kpi"><div class="kpi-label">${k.label}</div><div class="kpi-value">${k.value}</div></div>`
  ).join('');
}

function renderSymbolsList(filter = '') {
  const freq = tickersData.ticker_frequency;
  const entries = Object.entries(freq)
    .filter(([ticker]) => ticker.toLowerCase().includes(filter.toLowerCase()))
    .slice(0, 100);

  const container = document.getElementById('symbolsList');
  container.innerHTML = entries.map(([ticker, count]) =>
    `<div class="symbol-item${ticker === currentSymbol ? ' active' : ''}" data-ticker="${ticker}">
      <span class="symbol-ticker">$${ticker}</span>
      <span class="symbol-count">${count}</span>
    </div>`
  ).join('');

  container.querySelectorAll('.symbol-item').forEach(el => {
    el.addEventListener('click', () => selectSymbol(el.dataset.ticker));
  });
}

document.getElementById('search').addEventListener('input', (e) => {
  renderSymbolsList(e.target.value);
});

async function selectSymbol(ticker) {
  currentSymbol = ticker;
  renderSymbolsList(document.getElementById('search').value);

  document.getElementById('chartTitle').textContent = `$${ticker}`;
  document.getElementById('chartMeta').textContent = 'Loading price data...';
  document.getElementById('mentionsList').innerHTML = '<div class="loading">Loading...</div>';

  const mentions = getMentions(ticker);
  renderMentions(mentions);

  try {
    const prices = await fetchPrices(ticker);
    renderChart(prices, mentions);
  } catch (e) {
    document.getElementById('chartMeta').textContent = `Error: ${e.message}`;
    if (chart) {
      chart.remove();
      chart = null;
    }
    document.getElementById('chartContainer').innerHTML = `<div class="error-msg">Could not load price data for $${ticker}.<br>${e.message}</div>`;
  }
}

function getMentions(ticker) {
  return tickersData.tweets
    .filter(t => t.tickers.includes(ticker))
    .map(t => ({
      date: t.date,
      text: t.text_preview,
      url: t.url,
    }));
}

function renderMentions(mentions) {
  const container = document.getElementById('mentionsList');
  const items = mentions.slice(0, 30);
  container.innerHTML = items.map(m => {
    const d = new Date(m.date);
    const dateStr = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
    return `<div class="mention-item">
      <span class="mention-date">${dateStr}</span>
      <span class="mention-text"><a href="${m.url}" target="_blank" rel="noopener">${escapeHtml(m.text)}</a></span>
    </div>`;
  }).join('');
}

async function fetchPrices(ticker) {
  // Skip non-US tickers that Yahoo can't handle well via CORS
  if (ticker.includes('.TW') || ticker.includes('.KS') || ticker.startsWith('PRIVATE:')) {
    throw new Error('Non-US ticker — Yahoo Finance proxy not available for this market');
  }

  const period2 = Math.floor(Date.now() / 1000);
  const period1 = period2 - 86400 * 500;
  const url = `${YAHOO_PROXY}${ticker}?period1=${period1}&period2=${period2}&interval=1d&events=history`;

  const res = await fetch(url);
  if (!res.ok) throw new Error(`Yahoo API returned ${res.status}`);

  const json = await res.json();
  const result = json.chart?.result?.[0];
  if (!result) throw new Error('No data returned');

  const timestamps = result.timestamp || [];
  const quotes = result.indicators?.quote?.[0] || {};

  return timestamps.map((ts, i) => ({
    time: formatDateStr(ts),
    open: quotes.open?.[i],
    high: quotes.high?.[i],
    low: quotes.low?.[i],
    close: quotes.close?.[i],
    volume: quotes.volume?.[i],
  })).filter(d => d.open != null && d.close != null);
}

function renderChart(prices, mentions) {
  const container = document.getElementById('chartContainer');

  if (chart) {
    chart.remove();
    chart = null;
  }
  container.innerHTML = '';

  chart = LightweightCharts.createChart(container, {
    width: container.clientWidth,
    height: container.clientHeight || 400,
    layout: {
      background: { type: 'solid', color: 'transparent' },
      textColor: '#6b6e62',
      fontFamily: "'IBM Plex Mono', monospace",
    },
    grid: {
      vertLines: { color: 'rgba(24,32,25,.06)' },
      horzLines: { color: 'rgba(24,32,25,.06)' },
    },
    crosshair: { mode: LightweightCharts.CrosshairMode.Normal },
    rightPriceScale: { borderColor: 'rgba(24,32,25,.16)' },
    timeScale: {
      borderColor: 'rgba(24,32,25,.16)',
      timeVisible: false,
    },
  });

  candleSeries = chart.addCandlestickSeries({
    upColor: '#1f7a4f',
    downColor: '#d94040',
    borderUpColor: '#1f7a4f',
    borderDownColor: '#d94040',
    wickUpColor: '#1f7a4f',
    wickDownColor: '#d94040',
  });

  candleSeries.setData(prices);

  // Create markers for tweet mentions
  const mentionDates = new Map();
  const priceDates = prices.map(p => p.time);
  for (const m of mentions) {
    const d = new Date(m.date);
    const mStr = formatDateStr(Math.floor(d.getTime() / 1000));
    // Find nearest trading day at or after mention date
    let nearest = priceDates.find(pd => pd >= mStr);
    if (!nearest) nearest = priceDates[priceDates.length - 1];
    if (nearest) {
      if (!mentionDates.has(nearest)) {
        mentionDates.set(nearest, { count: 0, text: m.text });
      }
      mentionDates.get(nearest).count++;
    }
  }

  markers = Array.from(mentionDates.entries())
    .map(([time, info]) => ({
      time,
      position: 'belowBar',
      color: '#ff6b35',
      shape: 'arrowUp',
      text: info.count > 1 ? `${info.count}x` : '',
    }))
    .sort((a, b) => a.time.localeCompare(b.time));

  candleSeries.setMarkers(markers);

  const totalMentions = mentions.length;
  const dateRange = prices.length > 0
    ? `${prices[0].time} → ${prices[prices.length-1].time}`
    : '';
  document.getElementById('chartMeta').textContent = `${totalMentions} mentions • ${dateRange}`;

  chart.timeScale().fitContent();

  // Resize observer
  const ro = new ResizeObserver(() => {
    chart.applyOptions({ width: container.clientWidth, height: container.clientHeight });
  });
  ro.observe(container);
}

function formatDateStr(ts) {
  const d = new Date(ts * 1000);
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

function escapeHtml(str) {
  return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

init();
