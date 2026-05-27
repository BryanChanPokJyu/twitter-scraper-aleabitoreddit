const SIGNALS_URL = '../output/scored_signals.json';
const LEADERBOARD_URL = '../output/ticker_leaderboard.json';
const TICKERS_URL = '../output/tickers.json';
const YAHOO_PROXY = '/api/yahoo/';

let signalsData = null;
let leaderboardData = null;
let tickersData = null;
let chart = null;
let candleSeries = null;
let currentSymbol = null;

// Color scale: 1-5 conviction level
function scoreToColor(score) {
  if (score >= 5) return '#e8220b';     // 5 — vivid red (S)
  if (score >= 4) return '#ff6b35';     // 4 — ember orange (A)
  if (score >= 3) return '#e8a825';     // 3 — warm yellow (B)
  if (score >= 2) return '#a8b030';     // 2 — olive (C)
  return '#8c9196';                      // 1 — muted gray (C)
}

async function init() {
  try {
    const [sigRes, lbRes, tkRes] = await Promise.all([
      fetch(SIGNALS_URL),
      fetch(LEADERBOARD_URL),
      fetch(TICKERS_URL),
    ]);
    signalsData = await sigRes.json();
    leaderboardData = await lbRes.json();
    tickersData = await tkRes.json();
    renderKPIs();
    renderSymbolsList();
  } catch (e) {
    document.getElementById('kpis').innerHTML = `<div class="error-msg">Failed to load data: ${e.message}</div>`;
  }
}

function renderKPIs() {
  const meta = signalsData.metadata;
  const gd = meta.grade_distribution;
  const kpis = [
    { label: 'Scored Pairs', value: meta.total_scored_pairs.toLocaleString() },
    { label: 'S Grade', value: gd.S || 0 },
    { label: 'A Grade', value: gd.A || 0 },
    { label: 'B Grade', value: gd.B || 0 },
    { label: 'Tickers Tracked', value: leaderboardData.length },
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

  const lb = leaderboardData.find(t => t.ticker === ticker);
  document.getElementById('chartTitle').textContent = `$${ticker}`;
  document.getElementById('chartMeta').textContent = 'Loading price data...';
  document.getElementById('mentionsList').innerHTML = '<div class="loading">Loading...</div>';

  const mentions = getMentions(ticker);
  renderMentions(mentions);

  try {
    const prices = await fetchPrices(ticker);
    renderChart(prices, mentions, ticker);
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
  return signalsData.scored_pairs
    .filter(p => p.ticker === ticker)
    .map(p => ({
      date: p.date,
      score: p.score,
      grade: p.grade,
      url: p.url,
      likes: p.likes,
    }));
}

function renderMentions(mentions) {
  const container = document.getElementById('mentionsList');
  const items = mentions.slice(0, 40);
  container.innerHTML = items.map(m => {
    const color = scoreToColor(m.score);
    return `<div class="mention-item">
      <span class="mention-date">${m.date}</span>
      <span class="mention-score" style="background:${color}">${m.score}</span>
      <span class="mention-text"><a href="${m.url}" target="_blank" rel="noopener">View tweet →</a> · ${m.likes} likes</span>
    </div>`;
  }).join('');
}

async function fetchPrices(ticker) {
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

function renderChart(prices, mentions, ticker) {
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

  // Create markers: aggregate scores per day, show cumulative score
  const priceDates = prices.map(p => p.time);
  const dayScores = new Map();

  for (const m of mentions) {
    if (!m.date) continue;
    let nearest = priceDates.find(pd => pd >= m.date);
    if (!nearest) nearest = priceDates[priceDates.length - 1];
    if (!nearest) continue;

    if (!dayScores.has(nearest)) {
      dayScores.set(nearest, { totalScore: 0, count: 0, maxScore: 0 });
    }
    const ds = dayScores.get(nearest);
    ds.totalScore += m.score;
    ds.count++;
    ds.maxScore = Math.max(ds.maxScore, m.score);
  }

  const markerList = Array.from(dayScores.entries())
    .map(([time, info]) => {
      const total = info.totalScore;
      const displayScore = String(total);
      // Color and shape based on daily total
      let color, shape;
      if (total >= 10) { color = '#e8220b'; shape = 'arrowUp'; }
      else if (total >= 6) { color = '#ff6b35'; shape = 'arrowUp'; }
      else if (total >= 4) { color = '#e8a825'; shape = 'arrowUp'; }
      else if (total >= 2) { color = '#a8b030'; shape = 'circle'; }
      else { color = '#8c9196'; shape = 'circle'; }
      return { time, position: 'belowBar', color, shape, text: displayScore };
    })
    .sort((a, b) => a.time.localeCompare(b.time));

  candleSeries.setMarkers(markerList);

  // Summary
  const totalScore = mentions.reduce((s, m) => s + m.score, 0);
  const lb = leaderboardData.find(t => t.ticker === ticker);
  const grade = lb ? lb.best_grade : '—';
  const dateRange = prices.length > 0
    ? `${prices[0].time} → ${prices[prices.length-1].time}`
    : '';
  document.getElementById('chartMeta').textContent =
    `${grade} • Total: ${totalScore} pts • ${mentions.length} signals • ${dateRange}`;

  chart.timeScale().fitContent();

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
