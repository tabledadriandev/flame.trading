# HAJ teardown

A walk through the member area of haj.trading on 17 November 2026, logged in as a free member, at desktop and phone widths. This is a description of what the product does so Flame can match or beat it. It is not a design reference: do not reuse HAJ's artwork, wording or layout.

## What HAJ is

A paper-trading platform: "learn everything about trading any asset class" with a $100,000 play-money account. Stocks, ETFs, indices, rates, commodities, crypto and prediction markets. Free tier today; a $50 one-time Pro tier is announced (more chat messages, more file storage, an indicator editor, a P&L replay maker). It is a Next.js app that installs as a PWA. All data is fetched by HAJ's own server; the browser makes no direct exchange calls.

Navigation is a floating dock at the bottom (Profile, Charting, Order flow, Predictions, Launchpad, News, Portfolio, Research, Chat, Ranks, plus a "+" button) and a small rail on the left (avatar, plans, account, log out). Every item is a separate page. Black background, thin white type, pastel pink and green for down and up.

## Screen by screen

### Profile (home)
- Identity card: avatar, handle, plan, join month
- Three tiles: equity, P&L (value and percent), rank out of all members
- An equity line that starts the day you join
- "Your board": an editable grid of widgets. Defaults are holdings, a mini chart of SPY with VWAP bands, trades, win rate, cash, allocation, best trade
- Empty states are friendly one-liners ("All cash for now.")

### Charting (markets home)
- One search box for stocks, ETFs, indices and coins
- Market-hours clocks for New York, London, Frankfurt, Tokyo and Hong Kong, each with a countdown to open or close
- Trending symbols
- Boards with price, day change and a sparkline: indices (S&P 500, Nasdaq, Dow, Russell 2000, VIX), rates and commodities (10-year yield, gold, crude), crypto (Bitcoin, Ether, Solana)
- Symbols use Yahoo Finance notation (`^GSPC`, `GC=F`, `BTC-USD`), so the data is almost certainly Yahoo's

### Charting (one symbol)
- Header: name, last price, day change
- Chart: line by default, candles as a toggle; ranges 1D, 1W, 1M, 6M, 1Y, 5Y
- Chart controls: Candles, Indicators, Colours, Zen (hides everything but the chart)
- **Indicators: 32 of them**, in a searchable grid with a small preview drawing for each, filtered by category:
  - Order flow, Profile, Sessions, ICT, Quant, Abstract, Vault
  - VWAP, Bubbles, Cumulative delta, Bar stats, Exhaustion, Previous day, Session volume profile, Pixel profile, Blocks, TPO, TPO + VP, Visible-range VP, Delta ladder, Initial balance and overnight, Sessions, Sunrise, ICT model, Squeeze, Regression, Monte Carlo, Trend scan, Trend forecast, Regimes, Seasonality, Letter strata, Muse, Kalman trend, Volatility regime, RSI divergence, Flow toxicity, Anchored VWAP, Effort vs result
- Trade panel on the right:
  - Buying power
  - Mode: Spot, Margin, Options for stocks; Spot, Perp for crypto
  - Size in shares (or coins) or in dollars, with a Max button
  - Cost at the current price
  - **"If you hold for" 1D, 1W or 1M:** a small cone chart of the likely price range, the share of outcomes that make money, and a typical good and bad result in dollars
  - "Slide to buy": a slider instead of a button, so an order takes a deliberate gesture
- There is no limit order, stop order, take-profit or stop-loss in the ticket

### Order flow (crypto)
- Coin picker; 1m, 5m, 15m; two colour themes (Pastel, Ice)
- Three resizable panes:
  - **Footprint:** bid and ask volume inside each candle, with a one-line read ("Sellers in control") and a "how to read this" help button
  - **Profile:** volume by price with the point of control called out
  - **Global book:** one order book merged from several venues (the legend shows Coinbase, Hyperliquid, OKX, Bitget, Kraken and Binance), drawn as horizontal bars with a cumulative depth line; a summary ("Balanced book, $146M vs $146M"); the largest supply wall and demand wall with price, size and which venue holds most of it; finer and coarser row sizes
- The tape is Coinbase's last 1,000 trades

### Predictions
- A live ticker of events across the top (sports scores, earnings, central-bank decisions) with the favourite's probability
- Topic tabs: Trending, Earnings, Economy, Fed, Stocks, Crypto, Tech, Finance, World, Politics, Sports
- A card per market: question, leading outcomes with percentages, volume today, time left, change this week, and Yes/No prices in cents
- The markets match Polymarket's catalogue
- Positions are paper trades from the same $100K

### Launchpad
- New tokens from the last day across Solana, BSC, Base and Ethereum, refreshed every minute from DexScreener and GeckoTerminal
- Tabs: New, Movers, Volume, Drained
- Each row: name, chain, age, market cap, liquidity, and a risk ring from RugCheck (Solana only)
- A plain warning: most new coins go to zero

### News
- A single stream of posts from nine channels over the last 24 hours (they read like Telegram news channels, with view counts)
- Each post shows how much attention it is getting compared with that channel's usual ("1.6× usual"), its view count, how many channels carried it, and any ticker it names with that ticker's move

### Portfolio
- Account value with all-time change, an equity line, cash / invested / realised, allocation bar, holdings list

### Research and Chat
- An AI chat (30 messages a day on Free) that can quote uploaded files
- Research is a "map" of every question asked and file uploaded (PDF, HTML, text; 10 files, 25 MB), each linked to the tickers it mentions

### Ranks
- A leaderboard of all members (about 130) by return, with trade counts and account value
- Your own panel: rank, percentile, return, this week, win rate, average win and loss, active days out of 14, idle cash

## What HAJ does well

- **Breadth.** Stocks to prediction markets to brand-new tokens in one account.
- **The order-flow page.** The merged book with named walls is the best screen in the product.
- **The indicator shelf.** Thirty-two studies with previews is a real library, far beyond moving averages.
- **Teaching in place.** "If you hold for…", "Sellers in control", "How to read the footprint": the interface explains itself where the question arises.
- **Restraint.** Very little chrome; empty states read like a person wrote them.

## Where HAJ is weak, and Flame's opening

| HAJ | Flame |
|---|---|
| Chart, order flow, portfolio and news are separate pages; you cannot watch the book while you place a trade | One desk: chart, book, tape, ticket and positions together, resizable |
| The ticket only buys or sells at market | Market, limit and stop orders, take-profit and stop-loss, size-by-risk |
| No way to practise on the past | Replay any day bar by bar with a practice account |
| Stats stop at win rate and best trade | A journal on every trade (setup, emotion, notes) and stats that show what works: expectancy, profit factor, drawdown, R-multiples, by tag and time of day |
| No way to test a rule before trading it | The Lab: backtests with costs and an out-of-sample check |
| Mouse-first | Keyboard-first: a command palette and shortcuts for symbol, timeframe and orders |
| Dark only; pink and green that are hard to tell apart for colour-blind users | Light and dark; a warm/cool pair that survives colour blindness, with classic green/red as an option |
| Your account lives on their server | Your account lives in your browser; nothing to sign up for |

## What Flame v1 deliberately does not match

- **Leaderboard, chat, research files.** They need accounts, a database and an AI bill. Later phase.
- ~~Launchpad.~~ Adrian asked for it on 17 November 2026. Now in scope: see `docs/brief-02-every-market.md`.
- ~~Options.~~ Adrian asked for them on 17 November 2026. Now in scope: see `docs/brief-02-every-market.md`.
- **All 32 indicators.** v1 ships the core dozen done properly (see the spec); the exotic ones follow by demand.
