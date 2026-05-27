# @aleabitoreddit Signal Tracker

Twitter KOL 股票信号追踪系统 — 自动爬取推文、提取 ticker、评估信号强度、K 线叠加展示。

## 快速开始

```bash
# 1. 安装依赖
npm install

# 2. 配置 API Key
cp .env.example .env
# 编辑 .env，填入 TWITTER_API_KEY 和 TWITTER_API_BASE

# 3. 爬取推文
node scrape.js

# 4. 提取 ticker
python3 extract_tickers.py

# 5. 信号评分
python3 score_signals.py

# 6. 启动前端
python3 server.py
# 浏览器打开 http://localhost:8899
```

## 项目结构

```
├── scrape.js              # 推文爬取（Twitter API，增量更新）
├── extract_tickers.py     # Ticker 提取（$TAG + 台股代码 + 别名映射）
├── score_signals.py       # 5 分制信号评分
├── server.py              # 本地服务器（含 Yahoo Finance CORS 代理）
├── dashboard/             # K 线信号展示前端
│   ├── index.html
│   ├── styles.css
│   └── app.js
├── output/                # 评分产出
│   ├── tickers.json           # ticker 提取结果（607 个）
│   ├── scored_signals.json    # 5576 条 tweet-ticker 评分记录
│   ├── ticker_leaderboard.json # ticker 排行榜
│   └── top_picks.json         # S+A 级标的（156 个）
├── tweets.json            # 原始推文数据（1284 条）
├── PRD.md                 # 产品需求文档
└── .github/workflows/     # CI：每周自动爬取+评分+提交
```

## 评分规则

5 分制，每分有明确语义：

| 分数 | 条件 | 含义 |
|------|------|------|
| 5 (S) | 独占 + 长文(>800字) + 持仓声明/thesis | 完整投资论文 |
| 4 (A) | 独占 + 中文(>500字) 或 有持仓/目标价 | 深度分析 |
| 3 (B) | 独占 或 (2-3 ticker + 有论据) | 有观点有论据 |
| 2 (C) | 4-5 个 ticker 并列，有方向性判断 | 提到了有态度 |
| 1 (C) | 6+ ticker 列举 或 短文随口提 | 背景噪音 |

## Dashboard 展示

- 左侧：ticker 列表（按提及频率排序，可搜索）
- 右侧：K 线图 + 信号标注
  - 标注数字 = 当天所有推文分数加总
  - 颜色：红(≥10) > 橙(≥6) > 黄(≥4) > 橄榄(≥2) > 灰(1)
  - 形状：≥4 箭头，<4 圆点
- 底部：该 ticker 相关推文列表（含单条评分）

## 数据源

| 组件 | 来源 | 费用 |
|------|------|------|
| 推文 | Twitter API | — |
| K 线 | Yahoo Finance v8（非官方） | 免费 |
| 图表 | TradingView Lightweight Charts | 免费（MIT） |

## 自动化

GitHub Actions 每周一 08:00 UTC 自动执行：

1. `node scrape.js` — 增量爬取新推文
2. `python extract_tickers.py` — 提取 ticker
3. `python score_signals.py` — 重新评分
4. 自动 commit 更新结果

也可在 GitHub Actions 页面手动触发（workflow_dispatch）。

## 环境要求

- Node.js 20+
- Python 3.9+
- Twitter API Key（设为 `TWITTER_API_KEY` + `TWITTER_API_BASE` 环境变量或 GitHub Secret）

## 已知限制

- Twitter 平台限制：最多可获取 ~3200 条历史推文
- Yahoo Finance 仅支持美股 K 线，台股/韩股标注暂无价格图
- 评分基于关键词和结构特征，无法识别反讽/转述
- 该博主为纯多头风格，系统暂无做空信号维度
