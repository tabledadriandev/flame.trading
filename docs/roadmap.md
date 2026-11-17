# Roadmap

Build in this order. Each phase ends with something a person can use, deployed. Tick items as they land and keep the "Deployment status" section at the bottom true.

## Phase 0: baseline (done)

- [x] Vite + React + TypeScript project that builds and type-checks
- [x] PWA manifest, icons and service worker
- [x] Design tokens for the light and dark themes; app shell with rail, bar and theme switch
- [x] Desk laid out as empty panes; honest "Not built yet" pages for the other views
- [x] `api/health.ts`
- [x] The spec: teardown, product spec, design system, data sources, this roadmap

## Phase 1: a live chart and a real paper trade (done 17 November 2026)

The smallest thing worth using: watch BTC, place a trade, see the P&L.

- [x] Verify Binance REST and WebSocket from a browser; update `docs/data-sources.md`
- [x] `src/data`: adapter interface, shared WebSocket client (heartbeat, backoff, resubscribe), Binance adapter (candles, trades, book)
- [x] `src/engine`: account, spot and perp positions, market / limit / stop orders, fees, liquidation, trades with R. Pure functions, unit tests for every rule in the spec
- [x] `src/state`: zustand stores, IndexedDB persistence with a schema version
- [x] Chart pane: candles, timeframes, crosshair readout, volume
- [x] Watchlist pane with live prices
- [x] Ticket: market and limit, size in units or dollars, preview sentence (stop orders, take-profit, stop-loss, size-by-risk and leverage landed here too)
- [x] Positions drawer: positions, orders, fills
- [x] Feed status in every pane (live, reconnecting, down)
- [x] `?sim=1` simulated feed, labelled, for offline demos and screenshots (it keeps its own database, so it never touches the real paper account)
- [x] Deploy; check acceptance items 1 and 4 on flame.trading

Also in this phase, from the review of the data and state layers:

- One tab at a time owns the account (Web Locks); a second tab offers to take over instead of saving over the first
- Any gap in prices (Flame closed, laptop asleep, feed dropped) is replayed from candles before live prices resume
- Binance requests time out, honour `Retry-After`, and the book snapshot backs off instead of retrying on every update
- A stored document that cannot be read is never overwritten with defaults

## Phase 2: the desk Flame is for (done 17 November 2026)

- [x] Heat ladder from one venue; then the merged book (Coinbase, Kraken, Bitstamp, OKX, Bybit, Hyperliquid adapters) with walls and venue split
- [x] Tape with a size filter
- [x] Ticket: stops, take-profit and stop-loss, size-by-risk, leverage with liquidation preview
- [x] Orders and positions as draggable lines on the chart (a move that would trigger the order at once is refused)
- [x] Indicators: SMA, EMA, Bollinger, VWAP with bands, RSI, MACD, ATR, previous-day levels (unit-tested maths); cumulative delta, anchored VWAP and the volume profile landed here too
- [x] Resizable, persistent pane layout; zen chart
- [x] Command palette and the keyboard map
- [x] Phone layout for the desk
- [x] The ten-second review form on close (pulled forward from Phase 4: acceptance item 3 needs it)
- [x] Chart levels and price alerts (pulled forward from Phase 5)
- [x] Acceptance items 2 and 3 on flame.trading. Item 8: the phone layout and the hold-to-confirm button are checked at phone width in a desktop browser; installing from Safari on a real iPhone still needs Adrian's phone

## Phase 3: stocks and the markets board (built; blocked on a data source)

- [x] `/api/quote/chart`, `/spark`, `/search` with validation and caching; verified from the deployed site
- [x] Symbol search across crypto and stocks (crypto is live; the stock half reports that its source is not answering)
- [ ] Stocks on the desk with the "Delayed" label, spot and margin. **Built and working with the simulated feed, but no live data:** Yahoo refuses Flame's server (and Adrian's Mac) with 429, and the documented fallbacks are behind browser challenges. See "Status on 17 November 2026" in `docs/data-sources.md`. Needs a data key from Adrian
- [x] Markets view: session clocks, boards, movers, and the strip of today's moves (the index and commodity boards show "These quotes are not available" until the source is fixed)
- [ ] Acceptance item 5. Blocked on the same thing

## Phase 4: learning tools (done 17 November 2026)

- [x] Journal: review form on close, tags, notes, chart snapshot
- [x] Stats: expectancy, profit factor, drawdown, R distribution, slices by tag and time; the weekly review card
- [x] Export and import (JSON backup, CSV of trades), and the account reset, in Settings
- [x] Outcome cone in the ticket ("If you hold")
- [x] Replay with the practice account
- [x] Lab: four built-in strategies, costs, out-of-sample check
- [x] Settings: theme, fees, default risk, confirm-before-order, sounds, fill-at-last-close
- [x] Acceptance items 6 and 7, checked on flame.trading on 17 November 2026
- [ ] Acceptance item 9 (offline). The service worker precaches the app shell and the top bar says "Offline: feeds paused", but nobody has yet opened the deployed site with the network off. Check it before calling Phase 4 closed

## Phase 5: depth (in progress; resume here)

Done so far:

- [x] Alerts (price crosses a level) as in-app notices, and as system notifications when the browser has already granted permission. Still to do: a button that asks for that permission
- [x] Anchored VWAP and the volume profile (shipped with Phase 2)
- [x] Server side of Odds: `/api/odds/events?topic=` and `/api/odds/market?token=&history=1`, verified on flame.trading (`api/_lib/poly.ts`)
- [x] Server side of News: `/api/news` (Federal Reserve, ECB, SEC, Bank of England press feeds), verified on flame.trading (`api/_lib/rss.ts`)

Not started:

- [ ] Odds view (`src/views/Odds.tsx`): topic tabs, cards, market page with probability history and a dollar ticket, paper positions, settlement. Plan: a `poly` venue adapter in `src/data/poly.ts` registered with `registerVenue('poly', …)` so positions are marked; instrument ids `poly:<token id>`; the engine already has `cls: 'odds'` and `settle()`, both tested. Add `'odds'` to `KEYS` in `src/state/persist.ts` to keep each token's question and outcome name
- [ ] News view (`src/views/News.tsx`) over `/api/news`: headline, source, time, subject tags that open on the desk
- [ ] Flow view: footprint (from the live trade stream plus Binance `aggTrades` for backfill), volume profile, cumulative delta, the large merged book (`<Book rangePct={0.02} />`), funding and open interest from Hyperliquid (`POST /info {"type":"metaAndAssetCtxs"}`: not yet verified; check CORS first). `applyFunding()` exists in the engine and is tested but nothing calls it yet
- [ ] Classic green/red colour option. The setting and the `data-convention="classic"` attribute exist, but `tokens.css` has no classic values yet, so choosing it changes nothing. Validator results on 17 November 2026: the pair in `docs/design-system.md` fails colour-blind separation (ΔE 2.9 and 5.0). Light theme: `#2f9e6e` with `#a8201a` passes every check (ΔE 14.8), green as text needs `#1f7a52`. Dark theme: no pair tried yet passes the lightness band; greens must be at or below L 0.67 (try around `#3fae7c`) with a red near `#d2553f`

## Phase 5B: every market, and a new favicon (added 17 November 2026)

Adrian asked for options, memecoins, stocks and "everything", and for a better favicon. The full brief, with engine rules, data sources and acceptance checks 10 to 17, is `docs/brief-02-every-market.md`. Read it before starting any item here.

- [ ] Favicon and app icon: at least four candidates on one preview sheet, Adrian picks, ship to every size and to `src/shell/Mark.tsx`
- [ ] `src/options/bs.ts`: Black-Scholes price, greeks and implied-volatility solver, unit-tested
- [ ] Engine: option positions (long, covered call, cash-secured put, defined-risk spreads), cash settlement at expiry through the catch-up path, fees. A test for every rule in the brief
- [ ] Crypto options from Deribit: verify the public API and CORS, adapter, chain view, ticket, payoff chart, position greeks
- [ ] Engine: pool fills on the constant-product curve, the 2% of liquidity cap, marking at what the pool would pay, the "rugged" tag
- [ ] Memecoins: verify DexScreener, GeckoTerminal and a risk source; Launchpad view; token on the desk with the Pool pane
- [ ] Stocks and ETFs live through Alpaca behind the existing `/api/quote` shape. **Needs `ALPACA_KEY_ID` and `ALPACA_SECRET_KEY` in Vercel, which Adrian adds himself.** Build and test against the simulated feed until then
- [ ] Markets boards filled with labelled ETF proxies for indices, commodities, rates and currencies; real currency pairs if a Twelve Data key is added
- [ ] Stock and ETF options on Alpaca's indicative feed
- [ ] Option strategy templates: vertical spread, covered call, cash-secured put, straddle, strangle
- [ ] Acceptance items 10 to 17

## Phase 6: reviews before telling anyone

- [ ] Design critique of every view in both themes and at phone width
- [ ] Accessibility review (keyboard, focus, contrast, screen-reader names, reduced motion)
- [ ] Security audit: the `/api` proxies (input validation, no open proxy, no SSRF), headers, dependencies
- [ ] Performance pass against the budget in `CLAUDE.md`
- [ ] A short "what is Flame" section for first-time visitors, and a plain disclaimer: paper trading, not financial advice, data may be delayed

## Later (needs a backend; decide with Adrian first)

- Accounts and sync across devices
- Leaderboard
- AI chat and research files

Launchpad and Options were on this list until 17 November 2026; they are now Phase 5B.

## Deployment status

| Piece | State on 17 November 2026 |
|---|---|
| GitHub repo `tabledadriandev/flame.trading` | Live, public, branch `main` |
| First push of the baseline | Done on 17 November 2026 |
| Vercel project | `flame` (`prj_PLW0bZJP5IKrcilRFBvAzvwiDkBN`) in team `stefan-code-js-projects`, preset Vite, connected to the GitHub repo. Every push to `main` deploys to production |
| Domain `flame.trading` | Attached to the project as the production domain; `www.flame.trading` redirects to it (308) |
| `https://flame.trading/api/health` | Returns `{"ok":true}` (checked 17 November 2026) |

### How it was set up

```bash
npx vercel@latest link --yes --scope stefan-code-js-projects --project flame   # created the project and connected the repo
npx vercel@latest --prod --yes --scope stefan-code-js-projects                 # first production deployment
npx vercel@latest domains add flame.trading flame --scope stefan-code-js-projects
# www redirect: POST /v10/projects/<id>/domains {"name":"www.flame.trading","redirect":"flame.trading","redirectStatusCode":308}
```

Notes for the next session:

- Last verified on flame.trading: acceptance items 1, 4, 6 and 7. Items 2 and 3 pass locally against live Binance data but were not re-run on the deployed site. Item 5 is blocked on a stock data source. Item 8 needs a real iPhone. Item 9 is unverified.
- Commit `8fbed71` (feed batches fall back to a timer when animation frames stall) is deployed but the desk has not been looked at on flame.trading since. Open it and confirm the watchlist prices move.
- The installed app updates through a prompt ("A new version of Flame is ready"); a tab opened before a deploy keeps the old build until reloaded.
- Phase 6 has not been started: the cross-view design critique, accessibility review, `consistent-ui` sweep, security audit of `/api`, the performance pass and the first-visit introduction with the disclaimer are all still to do.

- The Vercel CLI on this Mac is logged in as `tabledadriandev`; `.vercel/` and `.env.local` are local only (ignored by git).
- The Vercel connector in the chat cannot see this project (404). Use the CLI (`npx vercel@latest api …`) for project settings.
- `vercel link` appends `.env*` to `.gitignore`, which would also ignore `.env.example`. That line was removed; `.env` and `.env.*` already cover it.
