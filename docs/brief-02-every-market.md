# Brief 02: every market, and a new favicon

From Adrian, 17 November 2026, relayed through the Claude chat. His words:

> I also want options, memecoins, stocks, equities etc, everything. I want a better favicon, I don't like that one.

This brief is now part of the spec. Where it disagrees with an older document, this one wins, and the older document should be corrected in the same commit that implements the change.

## What changes

- **Options and memecoins are in scope.** Both were under "Later" in the roadmap and under "deliberately does not match" in the HAJ teardown. They are now v1.
- **Stocks stop being optional.** Phase 3 is built but has no live data. Adrian is getting a data key (see "What Adrian has to do"). Until it exists, keep building against the simulated feed; do not wait.
- **"Everything" means every asset class a learner would reach for:** stocks and ETFs, indices, currencies, commodities, rates, crypto spot and perps (done), crypto options, stock options, on-chain tokens, prediction markets (in progress).
- **The favicon is replaced.** Adrian does not like the current one.

The hard rules in `CLAUDE.md` do not change. Paper money only. A market-data key that Adrian owns, stored as a Vercel environment variable and used only inside `/api`, is fine; it is never sent to the browser, and Flame still never asks a visitor for a key, a wallet or a card.

## Order of work

1. **Favicon.** Small, visible, and he is waiting for it.
2. **Finish Phase 5** as already planned (Odds, News, Flow, classic colours).
3. **Crypto options** from Deribit. No key needed, so nothing blocks it.
4. **Memecoins.** No key needed.
5. **Stocks, ETFs, currencies, commodities, indices** go live the moment the key is in Vercel; then **stock options** on the same key.
6. **Phase 6 reviews** over everything, last.

Keep `docs/roadmap.md` current as before. The new work is listed there as Phase 5B.

## 1. Favicon and app icon

What is wrong with the current one (a small flame over a pale candle on a dark tile): at 16 px it is two blobs, the mark fills less than half the tile, and it reads as a lighter rather than as Flame.

What the new one has to do:

- Be recognisable at 16 px in a browser tab, on a light tab bar and a dark one
- Be one bold shape that fills the tile, not a small drawing sitting in the middle of it
- Belong to Flame's idea (fire, candles, heat) without being a generic flame emoji
- Stay flat: no gradients, glows or bevels

Directions worth drawing (make them clearly different from each other, and add your own):

- **The book is a flame.** Stacked horizontal bars, widest low and tapering to a tip, so the silhouette is a flame and the structure is Flame's heat ladder
- **Candles that burn.** Two or three candlestick bars of rising height whose tops are cut into one flame outline
- **A flame with a candle inside.** A solid flame whose negative space is a single candlestick or an upward tick
- **The letter.** An F whose top stroke is lit

Process:

1. Draw at least four candidates as SVG.
2. Render one preview sheet showing each at 16, 32, 64 and 180 px, on a light and on a dark background, next to the current icon. Look at it yourself first and drop anything that fails at 16 px.
3. **Show Adrian the sheet and let him choose.** Do not ship one without his pick.
4. Ship the pick everywhere at once: `public/icon.svg`, the 192, 512, maskable 512 and apple-touch PNGs, and `src/shell/Mark.tsx` so the mark in the rail matches the icon. Check the maskable version keeps the shape inside the safe zone.
5. Update the "mark" paragraph in `docs/design-system.md`.

The flame in the mark remains the only place `--hot` is used outside data.

## 2. Options

**What the learner should come away understanding:** calls and puts, moneyness, implied volatility, the greeks, time decay, the payoff at expiry, and what assignment means.

### Views

**Chain.** Reached from any optionable instrument on the desk ("Options" next to Spot and Perp). Expiries as tabs. One row per strike, calls on the left and puts on the right: bid, ask, mid, implied volatility, delta, open interest, volume. The at-the-money strike is marked; in-the-money cells carry a neutral tint (not hot or cold: moneyness is not buying or selling pressure). Every column header has a one-line explanation.

**Ticket.** Buy or sell one contract type at a time to begin with. Quantity in contracts. Limit at the mid by default. The preview sentence states premium, the most you can lose, the most you can make, the breakeven price, and the chance of finishing in profit (state the method in the tooltip).

**Payoff.** Profit and loss against the underlying price: one line for expiry, one for today (Black–Scholes at the current implied volatility), and a date slider between them so time decay can be seen happening. Breakevens labelled on the axis.

**Position.** Delta, gamma, theta and vega per position and summed for the account, each with its plain-language meaning ("theta −$12: this position loses about $12 a day if nothing else changes").

**Strategies (after single legs work).** Templates that build the legs and show the combined payoff: vertical spread, covered call, cash-secured put, straddle, strangle.

### Engine rules (each needs a test)

- A stock option contract covers 100 shares. A Deribit BTC or ETH option covers 1 coin and is quoted in the coin; convert to dollars at the index price for the paper account and say so in the ticket.
- Buying an option costs the premium; that premium is the most the position can lose.
- Selling is allowed only when the risk is covered: a call against 100 shares already held (covered call), a put against cash equal to strike × 100 set aside (cash-secured put), or as the short leg of a spread whose long leg caps the loss. No naked short options in v1. The ticket explains why when it refuses.
- Buys fill at the ask and sells at the bid. Mark positions at the mid.
- Fees: a per-contract fee for stock options and Deribit's own schedule for crypto options, both configurable in Settings. Take the default numbers from the venues' current fee pages, not from memory.
- At expiry every option is cash-settled at its intrinsic value: `max(0, underlying − strike)` for a call, `max(0, strike − underlying)` for a put, times the multiplier. Real stock options are settled in shares and can be assigned early; v1 does neither, and the help text says so plainly.
- Expiry is evaluated by the same catch-up path as stops, so an option that expires while Flame is closed is settled at the right price when it reopens.
- In Replay, options are not offered (there is no historical chain). Say so in the pane.

### Data

| What | Source | Notes |
|---|---|---|
| BTC and ETH options | Deribit public API v2, `https://www.deribit.com/api/v2/public/…` | Public methods need no key. `get_instruments` (currency, kind=option) for strikes and expiries; `get_book_summary_by_currency` for bid, ask, mark, mark IV and open interest across the chain in one call; `ticker` for one contract's greeks and IV. Deribit's docs ask clients to subscribe (`ticker.{instrument}.{interval}` over `wss://www.deribit.com/ws/api/v2`) rather than poll the summary. Check CORS from the browser first |
| Stock and ETF options | Alpaca Market Data, options endpoints, with Adrian's key through `/api` | The free plan carries the indicative options feed, not the consolidated one. Label quotes "Indicative". Confirm which endpoint returns the chain with greeks before designing around it |
| Greeks and IV when a source omits them | `src/options/bs.ts` | Black–Scholes price, greeks and an implied-volatility solver, pure and unit-tested against published values |

All of the above is unverified from the sandbox that wrote this. Make one real call to each and record the result in `docs/data-sources.md`, as before.

## 3. Memecoins

**What the learner should come away understanding:** most new tokens go to zero; liquidity decides whether you can get out; price impact is a cost; a contract can stop you selling.

### Views

**Launchpad** (replaces nothing; add it to the rail). Tabs: New, Trending, Movers, Volume, Drained (liquidity pulled). Chain filter: Solana, Base, BSC, Ethereum. Each row: token, chain, age, price, market cap, liquidity, change over 5 minutes, 1 hour and 24 hours, trade count, and a risk read. A standing line at the top says what the Drained tab is there to prove.

**Token on the desk.** The chart is the pool's own candles. The Book pane becomes a Pool pane: liquidity, both reserves, the pool fee, the largest recent trades. The ticket is dollars only.

### Engine rules (each needs a test)

- Spot only. No leverage, no shorting.
- Fills come from the pool, not a book. With reserves `x` (token) and `y` (quote), spending `Δy` buys `x·Δy / (y + Δy)` tokens, less the pool fee; selling is the mirror. This is the constant-product curve. The ticket shows the price impact before the order, in percent and in dollars.
- One order may not exceed 2% of the pool's liquidity. The refusal explains that a bigger position could not be sold.
- Positions are marked at what the pool would pay for the whole position now, not at the last trade price. A drained pool therefore marks the position near zero, and the closed trade is tagged "rugged" in the journal.
- If the risk source says the contract blocks or taxes sells, show it before the buy; a paper sell of such a token fails with the reason, because that is what would happen on-chain.

### Data

| What | Source | Notes |
|---|---|---|
| New and boosted tokens, search, pair stats | DexScreener, `https://api.dexscreener.com` | No key. Documented limits: 60 requests a minute on profile and boost endpoints, 300 a minute on pair and search endpoints |
| New pools, trending pools, pool candles | GeckoTerminal, `https://api.geckoterminal.com/api/v2` | No key, 30 calls a minute, and they ask for a link back. `/networks/{network}/new_pools`, `/networks/{network}/trending_pools`, `/networks/{network}/pools/{pool}/ohlcv/{timeframe}`. Shared server addresses are reported to be throttled hard, so prefer calling from the browser if CORS allows, and cache if it has to go through `/api` |
| Risk read (Solana) | RugCheck | Endpoint and terms unverified; find the current public summary endpoint before relying on it |

Instrument id: `dex:<chain>:<pool address>`, class `meme`. Show the GeckoTerminal and DexScreener attribution where their data appears.

## 4. Stocks, ETFs, currencies, commodities, indices

Phase 3 already built this path against Flame's own `/api/quote` shape. Keep that shape; change only what sits behind it.

- **Provider: Alpaca Market Data, free plan.** Real-time quotes from the IEX exchange, the consolidated feed delayed 15 minutes, 200 requests a minute, 30 symbols on the WebSocket. One key also unlocks the indicative options feed (section 2).
- Environment variables in Vercel: `ALPACA_KEY_ID`, `ALPACA_SECRET_KEY`. Read them only in `api/_lib`. Never log them, never return them, never put them in a `VITE_` variable.
- Label every stock price with what it is: "IEX" for the real-time single-exchange quote, "Delayed 15 min" for the consolidated one.
- Protect the allowance: cache at the edge (`s-maxage`), coalesce identical in-flight requests, and keep one budget for all upstream calls so a busy hour cannot exceed 200 a minute. When the budget is spent, serve the cached value marked stale rather than failing.
- **Indices, currencies and commodities.** Alpaca does not carry them. Two options, in this order:
  1. ETF proxies on the same key, labelled as proxies: SPY, QQQ, DIA, IWM for the index board; GLD, SLV, USO for commodities; TLT and SHY for rates; UUP and FXE for the dollar and the euro. This fills every board that now says "These quotes are not available".
  2. If Adrian adds a Twelve Data key (`TWELVEDATA_KEY`; free plan: 8 requests a minute, 800 a day, covering US stocks, currencies and crypto), use it for real currency pairs behind a long cache. Its free plan does not include indices.
- Stocks in Replay and the Lab need daily history going back years; confirm how far the free plan reaches and say so in the Lab's date picker.

## What Adrian has to do

1. Create a free Alpaca account, generate a market-data API key, and add `ALPACA_KEY_ID` and `ALPACA_SECRET_KEY` to the `flame` project in Vercel (Settings, Environment Variables, Production). He types the secret himself; it must not appear in the chat, a commit or a log.
2. Pick the favicon from the preview sheet.
3. Optional: a Twelve Data key for real currency pairs.

Everything else in this brief can be built without him.

## New acceptance checks

10. The new icon is recognisable in a browser tab at 16 px in both themes, and Adrian chose it.
11. Load AAPL: a price labelled "IEX" or "Delayed 15 min"; buy 10 shares; the position is marked.
12. Open the BTC option chain, buy one call, and see its greeks and payoff. At expiry the cash settles at intrinsic value.
13. Open the SPY chain and sell a cash-secured put: the cash is set aside, and expiry settles it.
14. Try to sell a call with no shares held: refused, with the reason.
15. Launchpad lists new tokens with liquidity and a risk read. Buying $100 of a thin pool shows the price impact first, and the fill matches it.
16. A token whose pool is drained marks the position near zero and the journal tags the trade "rugged".
17. Every board on Markets shows numbers; none says "not available".

## Housekeeping

The Claude chat wrote this file, added Phase 5B to `docs/roadmap.md`, and adjusted two lines in `docs/haj-teardown.md`. None of it is committed. Commit it with your first change.
