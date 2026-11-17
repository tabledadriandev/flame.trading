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
