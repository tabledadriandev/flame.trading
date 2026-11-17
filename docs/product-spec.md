# Flame v1 product spec

Who it is for: someone learning to trade (chart reading, order flow, risk, their own psychology) who wants a serious terminal without risking money. First user: Adrian.

What it must feel like: one desk you can live in. Fast, quiet, keyboard-friendly, and honest about what a number means.

## Principles

1. **One workspace.** Seeing the book while you place the trade is the point. Views exist for depth, not because the desk is missing something.
2. **Teach where the question arises.** Every unfamiliar number has a plain one-line explanation one hover or tap away. No separate "academy".
3. **Rules like a real venue.** Orders fill the way they would fill: against the book, with fees and slippage. Flattering fills teach bad habits.
4. **The review is the product.** A trade is not finished when it closes; it is finished when it is journaled. Make that take ten seconds.
5. **Local first.** The account, journal and layouts live in the browser. Export and import as a file. No sign-up.

## Instruments

| Class | Examples | Live source | Trading modes |
|---|---|---|---|
| Crypto | BTC, ETH, SOL and the top ~40 USD pairs by volume | Exchange WebSockets, direct from the browser | Spot; Perp (long/short, 1–20× leverage) |
| Stocks and ETFs | AAPL, NVDA, SPY, QQQ | Server proxy (delayed) | Spot; Margin (long/short, 1–2×) |
| Indices, rates, commodities | S&P 500, VIX, 10-year yield, gold, crude | Server proxy (delayed) | Chart only. Offer the matching ETF or future to trade |
| Prediction markets | Polymarket events | Server proxy | Buy and sell Yes/No shares priced 0–100¢ |

An instrument has one id (`crypto:BTC`, `yahoo:SPY`, `poly:<market-id>`), a display symbol, a name, a class, a price precision and a tradable flag. Panes take an instrument id and never care where the data comes from.

Delayed data is labelled "Delayed" next to the price, always.

## Views

### Desk (default)

```
┌────┬───────────────────────────────────────────────────────────────┐
│rail│ Flame   [search ⌘K]            clocks        Paper $100,000   │
│    ├───────────┬─────────────────────────┬───────────┬─────────────┤
│    │ Watchlist │ Chart                   │ Book      │ Ticket      │
│    │           │                         │ (ladder)  │             │
│    │           │                         ├───────────┤             │
│    │           │                         │ Tape      │             │
│    ├───────────┴─────────────────────────┴───────────┴─────────────┤
│    │ Positions | Orders | Fills | Journal                          │
└────┴───────────────────────────────────────────────────────────────┘
```

Every divider drags; sizes persist. Any pane can be maximised (and the chart has a zen mode). On a phone the panes become a swipeable stack: chart, ticket, book, positions.

**Watchlist.** Symbol, last price, day change, 24-hour sparkline. Add from search; drag to reorder; several named lists. Clicking a row loads it on the desk. Price cells flash hot or cold for 300 ms on a tick.

**Chart.**
- Candles (default), line, Heikin-Ashi
- Timeframes 1m, 5m, 15m, 1h, 4h, 1D, 1W; keyboard `1`–`7`
- Crosshair with an OHLCV readout; scroll to zoom, drag to pan, double-click the price axis to reset
- Your world on the price axis: position entry, stop, target, liquidation price, working orders. **Drag a line to move the order.**
- Levels: click the axis to drop a horizontal level; `Alt`-click to set an alert at it
- Indicators (v1 dozen): SMA, EMA, Bollinger bands, session VWAP with ±1σ and ±2σ bands, anchored VWAP, volume, RSI, MACD, ATR, previous-day high/low/close, visible-range volume profile, cumulative delta (crypto)
- Each indicator has a one-line "what this tells you" and sensible defaults; settings are a small popover, not a modal
- "Replay from here" on right-click (see Replay)

**Book (heat ladder).** The signature pane. Price rows down the middle, bids below the mid and asks above. Each row shows total resting size as a bar and as a number, shaded by how large it is relative to the visible book (a one-hue ramp per side: hot for bids, cold for asks). For crypto the book is merged across venues; a row expands to show which venue holds what. The largest wall on each side is labelled with its size and distance. Row size (tick grouping) steps finer or coarser. Click a price to load it into the ticket as a limit.

Above the ladder: spread, mid, and the bid/ask imbalance within ±0.5% as a single split bar with a plain read ("Buyers heavier").

**Tape.** Last 200 trades: time, price, size, side by colour and by an arrow glyph. A size filter hides the small ones. Large trades get a heavier weight, not a new colour.

**Ticket.**
- Buy / Sell (Long / Short in Perp and Margin)
- Mode: Spot | Perp (crypto), Spot | Margin (stocks)
- Order type: Market, Limit, Stop
- Size in units or in dollars, and a third way: **Risk**. Enter a stop price and a risk (1% of equity by default); Flame sizes the position so that stop loses exactly that
- Optional take-profit and stop-loss, shown as R-multiples as you type ("target is 2.4R")
- Leverage slider in Perp and Margin, with the liquidation price shown before you commit
- A preview line in words: "Buy 0.156 BTC at about $64,210. Fee $5.01. Uses $10,018 of cash."
- **If you hold:** the outcome cone (below)
- Confirm with `Enter`, or a press-and-hold button on touch. Keyboard: `B` buy, `S` sell, `L` limit at the hovered chart price

**Outcome cone ("If you hold").** For 1 day, 1 week or 1 month: the 10th–90th percentile price range drawn as a cone from now, the median path, the share of outcomes that end in profit after fees, and a typical good and bad result in dollars for the size entered. Computed by block-bootstrapping the instrument's own daily returns over the last two years (state the method in the tooltip). If a stop or target is set, show the share of paths that hit each first.

**Positions drawer.** Tabs:
- Positions: instrument, side, size, entry, mark, unrealised P&L in dollars, percent and R, liquidation price, buttons to close, reverse, or move the stop to breakeven
- Orders: working orders with cancel and edit
- Fills: every execution
- Journal: the most recent closed trades waiting for a note (a count badge on the tab)

### Markets
Search; session clocks with countdowns (New York, London, Frankfurt, Tokyo, Hong Kong); boards for indices, rates and commodities, crypto and a user-pinned board; top gainers and losers; a correlation strip (how today's moves line up across assets). Every row opens on the desk.

### Flow (crypto)
A full-screen version of the order-flow tools:
- Footprint chart (bid × ask volume per price per bar) with imbalance highlighting and a one-line read
- Volume profile with point of control and value area
- Cumulative volume delta under price
- The merged global book, large, with the venue split and the walls
- Funding rate and open interest from Hyperliquid for perps
- "How to read this" on every panel

### Odds
Prediction markets by topic, each as a card: question, leading outcomes with probabilities, change this week, volume, time left. A market page shows the probability history and a simple ticket (buy Yes or No in dollars; shares = dollars ÷ price). Positions settle at $1 or $0 when the market resolves, or can be sold at the current bid.

### Replay
Pick an instrument, a timeframe and a start date. The chart hides everything after that moment. Step one bar (`→`), play at 1×–20×, pause (`space`). Orders work as on the desk, against a separate **practice account** so replay results never mix with the live paper account. Inside a bar, price is assumed to travel open → low → high → close for an up bar and open → high → low → close for a down bar, so stops and targets trigger in a defensible order. Ending the session shows what you did against what happened next. The book and tape panes say "Not available in replay".

### Lab
Backtest a rule on history.
- Built-in strategies: moving-average cross, RSI mean reversion, Donchian breakout, Bollinger reversion, each with parameters
- Settings: instrument, timeframe, date range, fees, slippage, position sizing (fixed dollars, percent of equity, or fixed risk)
- Results: equity curve with drawdown shaded, trades marked on the chart, total return, CAGR, max drawdown, win rate, profit factor, expectancy, exposure, and a buy-and-hold comparison
- **Out-of-sample check:** tune on the first 70% of the range, report the last 30% separately, and say plainly when the two disagree
- A warning when a result rests on fewer than 30 trades

### Journal
- Account: equity curve, cash, invested, realised and unrealised P&L, allocation
- Every closed trade as a row: instrument, side, entry and exit, duration, P&L, R-multiple, fees, worst and best point during the trade (MAE/MFE), setup tag, emotion tag, note, a snapshot of the chart at entry
- A ten-second review form on close: setup (your own tag list), how you felt (calm, rushed, fearful, greedy, bored…), did you follow the plan (yes/no), one line of notes
- Stats: win rate, average win and loss, expectancy per trade and per R, profit factor, max drawdown, longest losing streak; each sliceable by setup, emotion, instrument, day of week and hour
- A weekly review card: the three numbers that changed most and one sentence on each
- Export everything as CSV and as one JSON backup; import the backup

### News
Headlines from public RSS feeds through a server proxy, newest first, each tagged with the tickers it names (click to load on the desk). Mark anything not from a primary source as such. No engagement metrics in v1.

## Paper-trading rules

These are the engine's contract. Each line needs a test.

**Account**
- Starts with $100,000 cash. Reset is available in settings and asks for confirmation, because it deletes history.
- Equity = cash + market value of spot holdings + margin held + unrealised P&L on leveraged positions.
- All accounting in USD. USDT pairs are treated as USD.

**Spot**
- Buying spends cash; selling returns it. No shorting. You cannot spend more cash than you have.
- One position per instrument, averaged on adds. Realised P&L on sells is against the average entry.

**Perp and Margin**
- Long or short. Isolated margin per position: margin = notional ÷ leverage, moved out of cash while the position is open.
- Unrealised P&L = (mark − entry) × size for longs, reversed for shorts.
- Leverage: 1–20× for crypto perps, 1–2× for stocks (with a 25% maintenance rate, anything above 2× would liquidate almost at entry).
- Maintenance margin rate: 0.5% of notional for crypto, 25% for stocks.
- Liquidation price, long: entry × (1 − 1/leverage + maintenance rate). Short: entry × (1 + 1/leverage − maintenance rate). When the mark crosses it the position closes at the liquidation price; what is left of the margin (the maintenance amount) is taken as a liquidation fee, so the whole margin is lost.
- Funding (perps): apply the venue's funding rate at its interval if the feed is available; otherwise none, and say so.

**Orders**
- Market: fills immediately by walking the live book for the venue (crypto), giving a volume-weighted price. With no book (stocks, replay), fills at the last price plus a slippage of 1 basis point against you.
- Limit: rests until the opposite best quote reaches the limit price. A buy limit above the ask fills at once as a taker.
- Stop: triggers when the last trade reaches the stop price, then behaves as a market order.
- Take-profit and stop-loss attached to a position are reduce-only and cancel each other.
- Stock orders outside market hours rest until the open, unless the user chooses "fill at last close" in settings.

**Fees**
- Crypto: 0.05% taker, 0.02% maker. Stocks: none. Prediction markets: none. Configurable in settings.

**Trades and R**
- A trade is the life of a position from first fill to flat. It records every fill, total fees, duration, MAE and MFE.
- If a stop existed at entry, initial risk = |entry − stop| × size, and the result is also stored in R (P&L ÷ initial risk).

**Persistence**
- Account, orders, positions, fills, trades, journal, watchlists, layout and settings persist in the browser (IndexedDB, with a versioned schema and migrations). Candles are cached in memory only.
- Working orders and stops are evaluated only while Flame is open. On reopening, the engine replays the candles it missed and fills or liquidates what would have triggered, at the triggering bar's price, marked "filled while away".

## Command palette and keys

`⌘K` / `Ctrl K` opens the palette: jump to a symbol, change timeframe, switch view, add an indicator, place an order ("buy 0.1 btc limit 63000"), reset layout. Every action in the palette shows its shortcut.

| Key | Action |
|---|---|
| `/` | Focus search |
| `1`–`7` | Timeframe |
| `B` / `S` | Buy / sell ticket |
| `L` | Limit at the hovered price |
| `X` | Close the selected position |
| `Esc` | Cancel the current ticket or dialog |
| `Z` | Zen chart |
| `G` then `D`, `M`, `F`, `O`, `R`, `L`, `J`, `N` | Go to a view |

## Settings
Theme (system, light, dark); colour convention (thermal, or classic green/red); fees; default risk per trade; confirm-before-order; sounds off by default; data: export, import, reset.

## Quality bar

- Works on the current Chrome, Safari, Firefox and Edge, and installs to the Mac Dock and the iPhone home screen
- First load under 2 s on a laptop; the desk stays at 60 fps with BTC streaming from every venue
- Fully usable by keyboard; visible focus; respects reduced motion; no information carried by colour alone
- Every pane has a loading state, an empty state and a failure state that says what to do next
- A feed that drops reconnects with backoff and shows "Reconnecting" in its pane; stale prices are marked stale after 5 s

## Acceptance checks for v1

1. Open flame.trading, see BTC streaming on the desk within 3 seconds, no sign-up.
2. Size a long by risk with a stop and a target, place it, and see entry, stop and target on the chart. Drag the stop; the order updates.
3. Let the stop hit. The position closes, the journal asks for a note, the trade shows −1.0R (less fees).
4. Reload the page: account, history and layout are exactly as they were.
5. Load SPY, see "Delayed", buy 10 shares, see it in positions.
6. Replay BTC from a date last month, take a trade, end the session, see the review. The live account is untouched.
7. Run the moving-average cross on BTC daily for three years and get an equity curve, a trade list and an out-of-sample result.
8. Install on an iPhone from Safari and place a trade one-handed.
9. Turn the network off: the app opens, says the feeds are offline, and the journal still works.
