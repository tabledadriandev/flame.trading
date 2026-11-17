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

## Phase 3: stocks and the markets board (built; waiting on Adrian's data key)

- [x] `/api/quote/chart`, `/spark`, `/search` with validation and caching; verified from the deployed site
- [x] Symbol search across crypto and stocks (crypto is live; the stock half says its source is not switched on)
- [ ] Stocks on the desk with the "Delayed" label, spot and margin. **Built against Alpaca's market data API from its documentation and working with the simulated feed, but never called for real:** the proxy answers `503 no_source` until `ALPACA_KEY_ID` and `ALPACA_SECRET_KEY` exist in Vercel. Yahoo, Stooq and Cboe turned out to be unusable; see `docs/data-sources.md`
- [x] Markets view: session clocks, boards, movers, and the strip of today's moves (the index and commodity boards are ETF proxies on the same key, and say "These quotes are not available" until it exists)
- [ ] Acceptance item 5. Waiting on the same key

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

## Phase 5: depth (done 17 November 2026)

- [x] Flow view: footprint, volume profile, cumulative delta, large global book, funding and open interest
- [x] Odds view: Polymarket catalogue, market page, paper positions, settlement
- [x] News view
- [x] Alerts (price crosses a level) as in-app and system notifications
- [x] Anchored VWAP, visible-range volume profile, more indicators by demand
- [x] Classic green/red colour option, validated
- [x] Perp funding: Hyperliquid's hourly rate, applied to open crypto perp positions once an hour while Flame is open

## Phase 5B: every market, and a new favicon (added 17 November 2026)

Adrian asked for options, memecoins, stocks and "everything", and for a better favicon. The full brief, with engine rules, data sources and acceptance checks 10 to 17, is `docs/brief-02-every-market.md`. Read it before starting any item here. Work in the order the brief gives: favicon, crypto options, memecoins, stocks and the rest once the key exists, stock options, then Phase 6 over everything.

- [x] Favicon and app icon: five candidates on one preview sheet (`design/favicon-sheet.html`); Adrian picked C, the flame with a candlestick cut out of it, on 17 November 2026. Shipped to `public/icon.svg`, the 192, 512, maskable 512 and apple-touch PNGs, and `src/shell/Mark.tsx`. `node scripts/make-icons.mjs` redraws every size
- [x] `src/options/bs.ts`: Black-Scholes price, greeks and implied-volatility solver, tested against Hull's textbook values and against Deribit's own greeks for a live contract
- [x] Engine: option positions (long, covered call, cash-secured put, defined-risk spreads), cash settlement at expiry, fees. A test for every rule in the brief (`src/engine/options.test.ts`). The stock-option fee default waits for stock options
- [x] Crypto options from Deribit: public API and CORS verified, adapter, chain view, ticket, payoff chart, position greeks (`#options`)
- [x] Engine: pool fills on the constant-product curve, the 2% of liquidity cap, marking at what the pool would pay, the "rugged" tag, blocked and taxed sales. A test for every rule (`src/engine/pool.test.ts`, `meme.test.ts`)
- [x] Memecoins: GeckoTerminal, DexScreener and RugCheck verified from a browser; Launchpad view in the rail; a token on the desk with the Pool pane and a dollars-only ticket
- [ ] Stocks and ETFs live through Alpaca behind the existing `/api/quote` shape. **Needs `ALPACA_KEY_ID` and `ALPACA_SECRET_KEY` in Vercel, which Adrian adds himself.** The upstream is written (`api/_lib/alpaca.ts`) but unverified; still to do once the key exists: one real call, the "IEX" and "Delayed 15 min" labels, in-flight request coalescing, and serving the cached value marked stale when the budget is spent
- [ ] Markets boards filled with labelled ETF proxies for indices, commodities, rates and currencies (the index and commodity boards exist and wait on the key; rates and currency proxies are not added yet); real currency pairs if a Twelve Data key is added
- [ ] Stock and ETF options on Alpaca's indicative feed
- [ ] Option strategy templates: vertical spread, covered call, cash-secured put, straddle, strangle
- [ ] Acceptance items 10 to 17

## Phase 6: reviews before telling anyone

Brief 02 moved these to the end, over everything including Phase 5B. Work already done is recorded here so it is not repeated blind; views added in 5B still need every review.

- [ ] Design critique of every view in both themes and at phone width. Done for the desk (Phase 2). A first pass over Markets, Flow, Odds, Replay, Lab, Journal and News on 17 November found and fixed the desk's chart being crushed on windows around 1024 px wide; the views have not had the full written critique
- [ ] Accessibility review (keyboard, focus, contrast, screen-reader names, reduced motion). Done for the desk. An automated pass over the other views in both themes found no contrast failures, unnamed controls or unlabelled fields; fixed: help marks now have a 24 px target, one page heading per view. Keyboard-only and screen-reader passes on those views are still to do. Known and accepted: ladder rows are 20 px tall on a fine pointer (24 px on touch)
- [x] Security audit: the `/api` proxies, headers, dependencies. Audit R1 found six issues (one Medium); five are fixed and verified in run R2 (quick verify), one Low remains open (build-time-only advisories through vite-plugin-pwa). The register is in `.security-audit/` and stays out of the public repo. Still for Adrian: a full verify and his sign-off, a Vercel Firewall rate-limit rule on `/api/*`, and whether to install scanners (coverage is "Reduced" without them). Re-audit after Phase 5B adds proxies
- [ ] Performance pass against the budget in `CLAUDE.md` (main bundle is about 219 kB gzipped against the 400 kB limit; the 60 fps check is not done)
- [x] A short "what is Flame" section for first-time visitors, and a plain disclaimer: paper trading, not financial advice, data may be delayed

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

- **Where work stands (17 November 2026):** Phases 1, 2, 4 and 5 are done and deployed. Phase 5B: the new icon is shipped. Next, in the brief's order: crypto options (Deribit), memecoins, then stocks and stock options once the Alpaca key is in Vercel, then Phase 6.
- Last verified on flame.trading: acceptance items 1, 4, 6 and 7, and the live desk under the Content-Security-Policy (prices moving, seven venues in the book). Items 2 and 3 pass locally against live Binance data but were not re-run on the deployed site. Item 5 waits on the Alpaca key. Item 8 needs a real iPhone. Item 9 (offline) is unverified.
- The installed app updates through a prompt ("A new version of Flame is ready"); a tab opened before a deploy keeps the old build until reloaded, and tabs from before the prompt was added need closing once.
- A new `/api` function must go through `proxy()` in `api/_lib/http.ts` (known parameters only, GET only, cross-site refusal, rate limit), import its neighbours with a `.js` suffix, and any new upstream host the browser calls directly must be added to `connect-src` in `vercel.json`.

- The Vercel CLI on this Mac is logged in as `tabledadriandev`; `.vercel/` and `.env.local` are local only (ignored by git).
- The Vercel connector in the chat cannot see this project (404). Use the CLI (`npx vercel@latest api …`) for project settings.
- `vercel link` appends `.env*` to `.gitignore`, which would also ignore `.env.example`. That line was removed; `.env` and `.env.*` already cover it.
