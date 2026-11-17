# Decisions

Notable choices made while building Flame, newest last. Each has the reason, so a later session can disagree with the reason rather than guess at it.

## 17 November 2026

**Vercel project is named `flame`, created from the CLI.** The roadmap offered the dashboard or the CLI. The CLI was already logged in on Adrian's Mac, so no browser step was needed. `vercel link` connected the GitHub repo in the same step.

**`www.flame.trading` redirects with a 308.** A permanent redirect that keeps the method; Vercel's default for a redirect domain.

**The engine fills instruments that are off the desk at the last price plus one basis point.** Only the instrument on the desk has a live book in memory, so only its market orders walk real depth. Anything else (a stop on ETH while BTC is on screen) uses the spec's no-book rule. Subscribing to a full book for every instrument with an order would cost a 250-weight snapshot each and a lot of bandwidth.

**A market order larger than the visible book fills the remainder at the last level reached.** The spec says market orders walk the book but not what happens past its end. The local book holds about 5,000 levels a side, so this only matters for sizes far beyond the paper account.

**A limit that crosses the spread takes what is offered at the limit or better and rests the remainder.** The alternative (filling the whole size at the limit) would be a flattering fill, which the spec's third principle forbids.

**Resting orders do not reserve cash.** Cash is checked when the order fills; if it is no longer there the order is rejected with a message. Reserving would need an "available" versus "total" cash split throughout the interface for little teaching value.

**Initial risk grows when an add carries the same stop.** The spec defines initial risk at entry. A limit order that fills in two parts is still one entry, so the second fill adds to the risk; without this a partial fill would overstate R.

**Isolated margin caps a leveraged loss at the margin.** If a stop fills past the liquidation price in a gap, the loss recorded is the margin, never more.

**`--hot-text` and `--cold-text` tokens for small text.** `--hot` (#c2570a) is 4.2:1 on the light surface and 3.7:1 on the light background: fine for marks (3:1), short of 4.5:1 for 12 px numbers. The text tokens deepen the same hues to pass on every light surface (#a04606, #1a5fb6); in the dark theme the mark colours already pass and are reused. See `docs/design-system.md`.

**The order button is ink, with only its left edge in hot or cold.** The design system says a primary button is ink on surface, inverted; white text on `--hot` would also miss 4.5:1. The side is carried by the word, the glyph on the Buy/Sell switch and the edge.

**The simulated feed has its own database (`flame-sim`).** Otherwise opening `?sim=1` would mark the real paper account against made-up prices and could fill its working orders with them.

**Chart time axis is local time.** lightweight-charts draws UTC; timestamps are shifted by the local offset, which is the approach its own documentation recommends.

**`frontend-design` is not among the installed skills.** `CLAUDE.md` names it; the skills present are `consistent-ui`, `dataviz`, `design-council`, `design:design-critique` and `design:accessibility-review`. Those are used at the stages the table gives; the design system document stands in for the missing one.

**One tab owns the account.** Found in review: two tabs each kept the account in memory and saved the whole document, so the second tab's heartbeat could erase the first tab's fill. Flame now takes a Web Lock at start. A second tab shows "Flame is open in another tab" with a button that asks the first to save, stand down and hand over. Browsers without Web Locks run unguarded, as before.

**`lastSeen` is the last moment a price arrived, not the wall clock.** A laptop that sleeps overnight wakes with a gap the engine never saw. Every price now checks how long it has been since the previous one; past 90 seconds, the missed candles are replayed (orders and positions that existed before the gap only) and live prices wait until the replay is done. The same path handles reopening Flame.

**A hidden tab still evaluates orders, but less promptly.** Browsers throttle timers in background tabs, so a stop on the desk instrument can fill up to a minute late there, at the book as it is then. The batch still carries the high and low it missed, so the stop is not skipped.

**The merged book lines each venue up on its own mid.** The spec said to convert USDT prices to USD at parity. Tried literally, Coinbase's USD book sits a few dollars from Binance's USDT book, so merged bids landed above asks. Each secondary venue is now shifted by the difference between its mid and the primary's before bucketing; depth is compared at the same distance from the mid. `docs/data-sources.md` and the pane's help say so.

**Hyperliquid contributes only 20 levels near the touch.** Its book can be coarsened to reach deeper, but coarse rows from one venue would pile onto round prices in a fine ladder and look like walls.

**A typed order loads into the ticket; a second Enter places it.** The spec lists "place an order" among palette actions. Loading it into the ticket first shows the preview sentence (fee, cash used, any problem) before the order exists, and costs one keystroke.

**Dragging an order line to where it would trigger at once is refused.** Found in review: dragging a stop above the market turned it into a market sell on the next tick. The engine now rejects such a move with the reason, and the order stays where it was.

**The review form arrived in Phase 2, alerts too.** Acceptance item 3 ("the journal asks for a note") is listed under Phase 2 but depended on Phase 4's journal. Alt-click alerts were offered by the chart as soon as levels existed, so they had to actually fire.

**R is shown net of fees, with the before-fees figure beside it when they differ.** A stop $20 from entry on BTC risks $50 on a position whose round-trip fee is $160. The stop itself cost about −1.3R; fees took the trade to −4.5R. Showing both teaches why very tight stops on taker orders do not work.

**Stocks: no live source, by choice not to circumvent.** Yahoo answers 429 to Flame's server and to a plain request from Adrian's Mac. The cookie-and-crumb workaround was not used: it defeats an access control. See `docs/data-sources.md`. The whole stock path is built against Flame's own `/api/quote` shape and verified with the simulated feed.

**Exchange hours: two of five confirmed from the exchange's own page.** NYSE and HKEX were read from their sites. London, Frankfurt and Tokyo could not be fetched (a spreadsheet, a 404, a 403) and are marked unconfirmed in `docs/data-sources.md`.

**Clocks do not use hot or cold.** An open exchange is said with the word "Open", a bolder weight and a rule along the top of its tile. Open or closed is not buying or selling pressure.

**`consistent-ui` runs once, in Phase 6.** It compares every surface against every other; with one finished view there is nothing to compare. The desk was checked against the design system by the design critique instead.

**Lab strategies are long only and fill at the next bar's open.** A rule decides on a bar's close and trades on the next open, so it cannot use a price it had not seen. Shorting would double the surface of every strategy for a first version whose job is to teach the out-of-sample habit.

**The out-of-sample check tunes by total return over a small grid** (three values per parameter, 8 to 27 combinations). A larger search would overfit harder and take longer; the point is to show whether tuning carries forward, not to find the best parameters.

**"Fixed risk" sizing in the Lab puts the stop two ATRs below the entry.** The built-in rules have no stop of their own, and risk sizing needs one to be defined.

**The outcome cone checks stops and targets at each day's close.** It is built from daily returns, so it cannot see inside a day. The help text says so. A stop that would have been touched intraday and recovered by the close is counted as not hit, which flatters stops slightly.

**Replay fills at the close of the bar on screen.** With no book or tape in history, a market order placed while paused fills at that bar's close, one basis point against you; working orders are walked along the next bar's assumed path like any other bar evaluation.

**Ending a replay closes open positions at the last price.** Otherwise the review would have to describe unrealised results, and "what you did" would not have a number.

**Chart snapshots are the closes of the last 60 bars on the chart at the first fill.** A small sparkline is enough to remember the setup by, and it costs a few hundred bytes per trade instead of an image.

**Settings is a dialog behind a gear in the top bar,** not a ninth view: it is visited rarely and should not take a place in the rail.

**Sounds default to off and are one short tick on a fill.** Nothing else makes a sound.

**Stocks come from Alpaca, 15 minutes delayed, by Adrian's choice (17 November 2026).** Alpaca's free plan allows consolidated-tape data once it is 15 minutes old. The proxy asks for bars ending 16 minutes ago and takes the quote from the last bar, so chart and quote always agree and the "Delayed" label is exactly true. Only `data.alpaca.markets` is called; the trading API is never touched.

**Indices, bonds, gold and oil appear as their ETFs.** Alpaca carries US-listed stocks and ETFs, not indices, futures or currencies. The Markets boards show SPY, QQQ, DIA, IWM, VIXY, TLT, GLD and USO, each named for the market it tracks. That is also the thing a learner would actually trade.

**Stock search confirms exact tickers only.** Alpaca's data API has no search by company name, and its asset list lives on the trading API, which Flame does not call. Names are searched over the built-in list; any other ticker typed exactly is checked against the feed and added.

**Stock instrument ids are `stock:SPY`,** not `yahoo:SPY`: the id should not name a source Flame no longer uses.

**Prediction-market fills walk the outcome's own book.** The spec said best ask to buy and best bid to sell. Walking the book is the same for small orders and more honest for large ones in thin markets.

**Placeholder outcomes are hidden.** Polymarket creates events with unnamed slots ("Candidate T") priced at exactly 50% with no trades. A card that led with four of those read as nonsense.

**News is four institutions' press feeds, all primary sources:** the Federal Reserve, the ECB, the SEC and the Bank of England. Links are kept only when they are https and on the institution's own domain. No news publisher's feed is used, because none was checked for terms that allow it.

**Flame's perps borrow Hyperliquid's funding rate.** Its perps are priced on Binance spot and have no funding of their own. Once an hour, an open crypto perp pays or receives Hyperliquid's hourly rate for that coin. Hours that pass while Flame is closed are not charged, and a coin Hyperliquid does not list pays none; the Flow view says which applies.

**The footprint starts from the last 1,000 trades.** Exchanges do not publish trade-by-trade history in bulk for free, so the footprint is built from Binance's most recent aggregate trades plus the live stream from the moment the view opens.

**Classic colours were re-chosen with the validator.** The pair in the design document failed: a deuteranope sees them 2.9 apart on a scale where 8 is the target. The shipped pair differs in lightness as well as hue (see `docs/design-system.md`).

**The flame in the mark has its own token.** Otherwise the logo turned green in Classic.
