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
| Stocks and ETFs | AAPL, NVDA, SPY, QQQ | Server proxy to Alpaca, 15 minutes delayed | Spot; Margin (long/short, 1–2×) |
| Indices, rates, commodities | S&P 500, VIX, long Treasuries, gold, crude | Not in the stock feed. Shown and traded through the ETF that tracks each (SPY, VIXY, TLT, GLD, USO) | As stocks |
| Prediction markets | Polymarket events | Server proxy | Buy and sell Yes/No shares priced 0–100¢ |
| Crypto options | BTC and ETH calls and puts | Deribit, direct from the browser | Buy; sell only when covered (see the rules) |
| On-chain tokens | New and trending pools on Solana, Base, BSC and Ethereum | GeckoTerminal, DexScreener and RugCheck, direct from the browser, read every 30 seconds | Spot only, in dollars, against the pool |

An instrument has one id (`crypto:BTC`, `stock:SPY`, `poly:<token-id>`, `opt:deribit:BTC-25JUN27-88000-C`, `dex:solana:<pool address>`), a display symbol, a name, a class, a price precision and a tradable flag. Panes take an instrument id and never care where the data comes from.

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

**Book (heat ladder).** The signature pane. Price rows down the middle, bids below the mid and asks above. Each row shows total resting size as a bar and as a number, shaded by how large it is relative to the visible book (a one-hue ramp per side: hot for bids, cold for asks). For crypto the book is merged across venues, each lined up on its own mid price; a row expands to show which venue holds what. The largest wall on each side is labelled with its size and distance. Row size (tick grouping) steps finer or coarser. Click a price to load it into the ticket as a limit.

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

### Launchpad
In the rail. New and moving on-chain tokens, to teach four things: most new tokens go to zero; liquidity decides whether you can get out; price impact is a cost; a contract can stop you selling.

- **Lists.** New, Trending, Movers (the biggest moves over the last hour among busy pools), Volume, and Drained (recent pools whose liquidity has gone or whose price has fallen 90% in a day). A chain filter: Solana, Base, BSC, Ethereum. A standing line at the top says what the Drained tab is there to prove.
- **Rows.** Token, chain, age, price, market cap, liquidity, change over 5 minutes, 1 hour and 24 hours, trades in 24 hours, and a risk read. The risk read is Flame's own, from the pool's age, size and trading, said in words; it is labelled as not being a contract check. Narrow windows drop columns; none scrolls sideways.
- **A token on the desk.** The chart is the pool's own candles. The Book and Tape give way to a **Pool** pane: liquidity, both reserves, the pool fee, the locked share, the largest recent trades, and how orders are priced. The ticket is in dollars only: it shows the tokens and price the pool would give, the price impact in percent and in dollars, the pool fee, and what selling straight back would return; then Flame's read of the pool and, on Solana, the RugCheck report. If the report says holders can be stopped from selling, or that sales are taxed, that is shown before the buy.
- With the simulated feed the view says it is not shown.

### Options
Reached from the desk ticket ("Options" beside Spot and Perp, on BTC and ETH), from the palette, or with `G` then `P`. Not in the rail.

- **Chain.** Expiries as tabs. One row per strike, calls on the left and puts on the right, prices next to the strike: bid, ask, mid, implied volatility, delta, open interest, volume. The strike nearest the forward is marked "At the money"; in-the-money cells carry a neutral tint. Strikes near the money are shown first, with a button for the rest. Narrow windows drop volume, then open interest, then mid; a phone shows calls or puts, one at a time. "What the columns mean" explains each column in one line. Clicking an ask loads a buy, a bid a sale.
- **Ticket.** One contract at a time. Size in contracts, a limit at the mid by default, or a market order. The preview states the premium and fees, the most you can lose, the most you can make, the breakeven and the chance of finishing in profit (the method is in its help). A sale that the account cannot cover is refused there, with the reason. Deribit options say that they are quoted in the coin and converted at the index price.
- **Payoff.** Profit and loss against the underlying's price: a line for expiry, a dashed line for a date chosen with a slider between today and expiry, breakevens marked on the axis. Readable by pointer and by arrow keys, with the same numbers as a table.
- **Strategies.** "What to trade" above the ticket switches from one contract to a template: call spread, put spread, straddle, strangle, covered call, cash-secured put. A template starts from strikes around the money, lists its legs and what each fills at, and shows the combined payoff. Its preview runs the engine on a copy of the account, so the cost, the cash set aside, the cover and any refusal are exactly what placing it would do. Legs are market orders placed one after the other, the bought leg first; if only the first fills, a notice says what is left.
- **Positions.** Every option position with its delta, gamma, theta and vega, a total for the account, and what each total means in a sentence.
- With the simulated feed (`?sim=1`) the view says options are not shown: there is no simulated chain.

### Replay
Options are not offered in Replay, because nobody publishes the old chains to fill against; the Replay ticket says so. Pick an instrument, a timeframe and a start date. The chart hides everything after that moment. Step one bar (`→`), play at 1×–20×, pause (`space`). Orders work as on the desk, against a separate **practice account** so replay results never mix with the live paper account. Inside a bar, price is assumed to travel open → low → high → close for an up bar and open → high → low → close for a down bar, so stops and targets trigger in a defensible order. Ending the session shows what you did against what happened next. The book and tape panes say "Not available in replay".

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
- Equity = cash + market value of spot holdings + margin held + unrealised P&L on leveraged positions. An option that was sold counts as what it would cost to buy back, against the premium already in cash.
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

**Options** (`src/engine/options.test.ts` has a test for each line)
- A stock option contract covers 100 shares. A Deribit option covers 1 coin, trades in steps of 0.1 contracts for BTC and whole contracts for ETH, and is quoted in the coin; Flame converts to dollars at the index price.
- Buying costs the premium, and the premium (with the fee) is the most the position can lose.
- Selling opens a position only when it is covered: a call against shares or coins already held (a covered call), a put against cash equal to the strike for every unit, set aside (a cash-secured put), or either against a bought option of the same kind on the same underlying with the same expiry (a spread; what the pair can lose at expiry is set aside). Of the covers available, the one that sets aside the least cash is used. There are no uncovered short options, and the refusal says why.
- What covers a sold option cannot be sold while it does. A stop or target on shares that partly cover a call sells only the part that is free.
- Buys fill at the ask and sells at the bid. A limit rests until the other side reaches it. No stops, take-profits or stop-losses on options. Positions are marked at the mid.
- Nothing liquidates a sold option: it is fully covered.
- At expiry every option settles in cash at what it is worth: `max(0, underlying − strike)` for a call, `max(0, strike − underlying)` for a put, times the size. A covered call that finishes in the money is paid in cash; if the cash is short, enough of the shares behind that call are sold at the settlement price to pay what it owes, and the notice says how many. Real stock options settle in shares and can be assigned early; Flame does neither, and says so.
- Expiry is checked at start and once a minute, and settles at the venue's own settlement price for that expiry (Deribit's delivery price), so an option that expired while Flame was closed settles at the price of that moment.
- Not offered in Replay.

**On-chain tokens** (`src/engine/meme.test.ts` and `pool.test.ts` have a test for each line)
- Spot only: no leverage and no shorting. Market orders only: a pool has no book to rest an order in. No stops or targets.
- Fills come from the pool, not a book. With x tokens and y dollars in the pool, putting in Δy takes out x·Δy ÷ (y + Δy) tokens; selling is the mirror. The pool's fee is charged on top of a buy and out of a sale.
- Paper orders do not move the real pool, so the account's own position counts as tokens it has already taken out. A buy continues up the curve from what is held and a sale comes back down it: splitting an order into pieces costs, or returns, exactly what the whole would.
- A position may not be more than 2% of the pool's liquidity, at cost. The refusal says a bigger one could not be sold back.
- A position is marked at what the pool would pay for the whole of it, less the fee and any tax, going by the last reading of the pool whatever its age; never at the price on the screen. With no reading at all it stays at cost and shows no P&L.
- A pool reported with nothing in it is an empty pool: nothing can be bought, the position is marked at zero, and a sale returns nothing but closes the trade. A pool whose size the source does not report is unknown, not empty: no order is priced against it.
- Any sale, whole or part, into a pool with a tenth or less of the liquidity it had when the position was bought (averaged over the buys, by size) tags the trade "rugged" in the journal, and it stays tagged.
- What the risk source says about a token when it is bought is kept with the position. If it says holders can be stopped from selling, a paper sale fails with the reason and the position is valued at nothing. If it reports a tax on transfers, the tax comes out of every sale and out of the mark. On Solana a buy waits for the report, or for word that it could not be read.
- An order needs a reading of the pool less than 75 seconds old.

**Fees**
- Crypto: 0.05% taker, 0.02% maker. Stocks: none. Prediction markets: none. Configurable in settings.
- Crypto options (Deribit's standard tier): 0.03% of the underlying per contract, never more than 12.5% of the premium; 0.015% at expiry with the same cap, and nothing on daily expiries. Stock options: a fee per contract, set when stock options are built.

**Trades and R**
- A trade is the life of a position from first fill to flat. It records every fill, total fees, duration, MAE and MFE.
- If a stop existed at entry, initial risk = |entry − stop| × size, and the result is also stored in R (P&L ÷ initial risk). P&L is net of fees, so R is too; where fees move it by 0.1R or more the interface also shows R before fees.
- Moving a working order (by dragging its line or editing its price) to a price where it would trigger on the next tick is refused.

**Persistence**
- Account, orders, positions, fills, trades, journal, watchlists, layout and settings persist in the browser (IndexedDB, with a versioned schema and migrations). Candles are cached in memory only.
- Working orders and stops are evaluated only while Flame is open. On reopening, the engine replays the candles it missed and fills or liquidates what would have triggered, at the triggering bar's price, marked "filled while away".

## Command palette and keys

`⌘K` / `Ctrl K` opens the palette: jump to a symbol, change timeframe, switch view, add an indicator, type an order ("buy 0.1 btc limit 63000"), reset layout. A typed order loads into the ticket with its preview; `Enter` there places it. Every action in the palette that has a shortcut shows it.

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
