# Flame

Flame is a paper-trading terminal that lives at **flame.trading**. Real markets, play money. It is Adrian's answer to haj.trading: the same idea (learn to trade any asset class with a $100K paper account) built as one fast workspace instead of a set of separate pages, with better tools for practising and for reviewing your own trading.

This file is the working agreement for whoever builds it next. Read it, then read the four docs it points to before writing code.

| Doc | What it holds |
|---|---|
| `docs/haj-teardown.md` | What HAJ has, screen by screen, and where Flame should match it or beat it |
| `docs/product-spec.md` | What Flame v1 does: every view, the paper-trading rules, acceptance checks |
| `docs/design-system.md` | Colour, type, layout and copy rules, with the reasoning |
| `docs/data-sources.md` | Every market-data source, how to reach it, and what still needs verifying |
| `docs/roadmap.md` | The build order, as checklists. Tick items off as they land |

## State of the repo

What exists today is a **baseline**, not the product:

- Vite + React + TypeScript app that builds, type-checks and installs as a PWA
- The design tokens (`src/styles/tokens.css`) and the app shell: rail, top bar, light and dark themes that follow the system
- The desk laid out as five empty panes, and an honest "Not built yet" page for each other view
- One serverless function, `api/health.ts`, to prove `/api` works on Vercel

Nothing talks to a market yet. No engine, no charts, no data adapters. `docs/roadmap.md` is the order to build them in.

## Hard rules

1. **Paper money only.** Flame never places a real order, never asks for an exchange API key, a wallet or a card, and never holds money. Do not add any of these, even behind a flag.
2. **No accounts in v1.** One paper account per browser, stored locally. Leaderboards, sign-in and AI chat need a backend and are a later phase; do not half-build them.
3. **Hue is data.** `--hot` and `--cold` mean buying and selling pressure (up/down, bid/ask, long/short) and nothing else. Chrome is neutral. Read `docs/design-system.md` before adding any colour.
4. **Do not copy HAJ.** Its features are fair inspiration; its logo, shark artwork, copy and layout are not. Flame has its own identity.
5. **Never fake data.** If a feed is down, say so in the pane. A simulated feed is allowed only when it is switched on deliberately (`?sim=1`) and labelled "Simulated" wherever its numbers appear.
6. **No stock images and no AI-generated video.** Both themes (light and dark) must work and follow the system setting.

## Commands

```bash
npm install        # once
npm run dev        # local dev server
npm run build      # type-check, then production build into dist/
npm run typecheck  # tsc only
npm run test       # vitest (add tests next to the code: foo.ts -> foo.test.ts)
npm run preview    # serve the production build
```

Node 20 or newer. The serverless functions in `api/` run on Vercel; use `npx vercel dev` when you need them locally.

## Stack

React 19, Vite 8, TypeScript 7 (strict, `noUncheckedIndexedAccess` on), zustand 5 for state, lightweight-charts 5.3 for candles, lucide-react for icons, Archivo Variable (self-hosted through fontsource) for all type, vite-plugin-pwa for the manifest and service worker, vitest for tests.

These are newer major versions than most examples online. Check the installed package's own typings in `node_modules` before assuming an API (lightweight-charts 5 in particular changed how series, panes and markers are created).

Keep dependencies few. Before adding one, check that the platform or an existing dependency cannot do the job.

## Layout

```
api/            Vercel functions: data proxies for sources the browser cannot call directly
docs/           The spec. Keep it true: when behaviour changes, change the doc in the same commit
public/         Icons for the PWA
src/
  main.tsx      Entry: fonts, styles, theme, render
  App.tsx       Picks the view from the URL hash
  lib/          Framework-free logic. route.ts, theme.ts today; the engine and indicators go here
  shell/        Rail, top bar, the Flame mark
  styles/       tokens.css (the design tokens) and app.css
  views/        One file or folder per view
```

Planned homes for what is not built yet (create them as you go):

```
src/engine/     Paper-trading engine: pure functions over plain data, no React, fully unit-tested
src/data/       Market-data adapters, one per venue, behind one interface
src/indicators/ Pure indicator maths, unit-tested against known values
src/state/      zustand stores (account, market, layout, settings) and persistence
```

## How to work here

- **Engine first, pixels second.** Money maths lives in `src/engine` as pure functions with tests. A fill, a P&L or a liquidation price that is not covered by a test is not done.
- **One interface for data.** Every venue adapter implements the same small interface (candles, trades, book, ticker) so panes never know which exchange they are looking at.
- **Verify against the live thing.** The endpoints in `docs/data-sources.md` were written from knowledge, not tested: the sandbox that produced this baseline could not reach any exchange. Make one real call to each source and record what you find in that doc before building on it.
- **Look at what you build.** After any visual change, open it in a browser in both themes and at phone width. Screens are part of the test suite.
- **Performance budget.** Market data arrives faster than React should render. Batch feed updates on `requestAnimationFrame`, draw the ladder and tape on canvas or in a virtualised list, and keep the main bundle under 400 kB gzipped.
- **Write like the interface.** Sentence case, plain verbs, no all-caps labels, numbers in tabular figures. An empty or failed pane says what happened and what to do next.
- **Small commits, each one deployable.** `main` deploys to production.

## Skills to use

Adrian wants the installed skills used where they earn their keep. In practice:

| When | Skill |
|---|---|
| Before designing or restyling any view | `frontend-design`, `consistent-ui` |
| Before any chart, ladder, heat map or stat tile | `dataviz` (run its palette validator; the current tokens already pass) |
| At a design fork, or when a view feels generic | `design-council`, `design-critique` |
| Before calling a view finished | `design:accessibility-review` |
| After each sizeable chunk of code | `code-review`, `pr-review-toolkit:silent-failure-hunter` on the data adapters |
| Before the first public announcement | `ateam-security-audit:security-audit`, then `security-fix` and `security-verify` |
| Bigger features | `feature-dev:feature-dev` |

The social-media, ASO, video and marketing skills do not make a terminal better. Leave them for the launch.

## Deployment

- **GitHub:** `tabledadriandev/flame.trading`, branch `main`
- **Vercel:** team `stefan-code-js-projects` (`team_eZ6itSslAdSJ6akyk17HmjfO`), framework preset Vite, functions from `api/`
- **Domain:** `flame.trading`, registered through Vercel on 17 November 2026, Vercel nameservers

See "Deployment status" at the end of `docs/roadmap.md` for what is wired and what is not.
