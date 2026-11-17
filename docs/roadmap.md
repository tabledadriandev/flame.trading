# Roadmap

Build in this order. Each phase ends with something a person can use, deployed. Tick items as they land and keep the "Deployment status" section at the bottom true.

## Phase 0: baseline (done)

- [x] Vite + React + TypeScript project that builds and type-checks
- [x] PWA manifest, icons and service worker
- [x] Design tokens for the light and dark themes; app shell with rail, bar and theme switch
- [x] Desk laid out as empty panes; honest "Not built yet" pages for the other views
- [x] `api/health.ts`
- [x] The spec: teardown, product spec, design system, data sources, this roadmap

## Phase 1: a live chart and a real paper trade

The smallest thing worth using: watch BTC, place a trade, see the P&L.

- [ ] Verify Binance REST and WebSocket from a browser; update `docs/data-sources.md`
- [ ] `src/data`: adapter interface, shared WebSocket client (heartbeat, backoff, resubscribe), Binance adapter (candles, trades, book)
- [ ] `src/engine`: account, spot and perp positions, market / limit / stop orders, fees, liquidation, trades with R. Pure functions, unit tests for every rule in the spec
- [ ] `src/state`: zustand stores, IndexedDB persistence with a schema version
- [ ] Chart pane: candles, timeframes, crosshair readout, volume
- [ ] Watchlist pane with live prices
- [ ] Ticket: market and limit, size in units or dollars, preview sentence
- [ ] Positions drawer: positions, orders, fills
- [ ] Feed status in every pane (live, reconnecting, down)
- [ ] `?sim=1` simulated feed, labelled, for offline demos and screenshots
- [ ] Deploy; check acceptance items 1 and 4 on flame.trading

## Phase 2: the desk Flame is for

- [ ] Heat ladder from one venue; then the merged book (Coinbase, Kraken, Bitstamp, OKX, Bybit, Hyperliquid adapters) with walls and venue split
- [ ] Tape with a size filter
- [ ] Ticket: stops, take-profit and stop-loss, size-by-risk, leverage with liquidation preview
- [ ] Orders and positions as draggable lines on the chart
- [ ] Indicators: SMA, EMA, Bollinger, VWAP with bands, RSI, MACD, ATR, previous-day levels (unit-tested maths)
- [ ] Resizable, persistent pane layout; zen chart
- [ ] Command palette and the keyboard map
- [ ] Phone layout for the desk
- [ ] Acceptance items 2, 3 and 8

## Phase 3: stocks and the markets board

- [ ] `/api/quote/chart`, `/spark`, `/search` with validation and caching; verify from the deployed site
- [ ] Symbol search across crypto and stocks
- [ ] Stocks on the desk with the "Delayed" label, spot and margin
- [ ] Markets view: session clocks, boards, movers
- [ ] Acceptance item 5

## Phase 4: learning tools

- [ ] Journal: review form on close, tags, notes, chart snapshot
- [ ] Stats: expectancy, profit factor, drawdown, R distribution, slices by tag and time
- [ ] Export and import
- [ ] Outcome cone in the ticket
- [ ] Replay with the practice account
- [ ] Lab: four built-in strategies, costs, out-of-sample check
- [ ] Acceptance items 6, 7 and 9

## Phase 5: depth

- [ ] Flow view: footprint, volume profile, cumulative delta, large global book, funding and open interest
- [ ] Odds view: Polymarket catalogue, market page, paper positions, settlement
- [ ] News view
- [ ] Alerts (price crosses a level) as in-app and system notifications
- [ ] Anchored VWAP, visible-range volume profile, more indicators by demand
- [ ] Classic green/red colour option, validated

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
- Launchpad
- Options

## Deployment status

| Piece | State on 17 November 2026 |
|---|---|
| GitHub repo `tabledadriandev/flame.trading` | Created by Adrian, empty until the first push |
| First push of this baseline | **Not done.** The cloud session that wrote the baseline had read access only; push from the Desktop folder (see below) |
| Vercel project | **Not created.** The Vercel connector used from the chat is not allowed to create projects (403 on 17 November 2026). Create it once, as below |
| Domain `flame.trading` | Registered in the Vercel team with Vercel nameservers; not attached to any project yet |

### First push from the Desktop folder

```bash
cd ~/Desktop/flame
git init -b main
git remote add origin https://github.com/tabledadriandev/flame.trading.git
npm install
npm run build          # should pass
git add -A
git commit -m "Baseline: shell, design tokens, spec"
git push -u origin main
```

### Create the Vercel project (once, after the first push)

Vercel's GitHub integration is already installed for `tabledadriandev` with access to all repositories, so either route works.

In the dashboard:

1. vercel.com, team `stefan-code-js-projects`, Add New, Project, import `tabledadriandev/flame.trading`. Preset: Vite. Deploy.
2. Project, Settings, Domains: add `flame.trading`, then add `www.flame.trading` as a redirect to it.

Or from the terminal, in the project folder:

```bash
npx vercel@latest login
npx vercel@latest link --scope stefan-code-js-projects --project flame   # creates the project if it does not exist
npx vercel@latest git connect                                            # ties the project to the GitHub repo
npx vercel@latest --prod                                                 # first production deployment
npx vercel@latest domains add flame.trading flame --scope stefan-code-js-projects
```

Check the CLI's own `--help` if a flag has changed. After this, every push to `main` deploys to flame.trading. Confirm with `https://flame.trading/api/health`, then update the table above.
