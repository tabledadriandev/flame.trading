# Flame design system

The tokens live in `src/styles/tokens.css`. This file is the reasoning behind them. If a new screen needs something the tokens cannot express, change the system here first, then the tokens, then the screen.

## The idea

Flame's world is fire and candles. A candlestick is a candle; its wick can be lit. A market is hot where people are buying and cold where they are selling. Everything visual comes from that:

- **The mark** is a candlestick with a flame for its upper wick (`src/shell/Mark.tsx`, `public/icon.svg`).
- **Polarity is thermal.** Up, bids, buys and longs are hot (amber). Down, asks, sells and shorts are cold (blue).
- **Liquidity is heat.** The order book is a heat ladder: the more size resting at a price, the more saturated the row.
- **Everything else is ash.** Surfaces, text, borders and buttons are neutral, so that the only colour on screen is the market.

The one bold thing is the heat ladder and the thermal language around it. The rest stays quiet so that it can be.

## Two rules that hold everywhere

1. **Chrome is ash.** No accent colour. A primary button is ink on surface, inverted. Selection is an inverted pill. Focus is a 2px ink outline.
2. **Hue is data.** `--hot` and `--cold` appear only where they mean buying or selling pressure. Never on a logo lockup, a link, a badge, a decoration or a chart series that is not polarity. The flame in the mark is amber too, but through its own token (`--flame`), so it is not an exception to the rule and does not turn green in the Classic convention.

If you find yourself reaching for a third colour, the answer is a label, a weight, a position or a pattern.

## Colour

| Token | Ash (light) | Char (dark) | Use |
|---|---|---|---|
| `--bg` | `#e9e9e7` | `#131210` | App background, wells, inputs |
| `--surface` | `#f8f8f6` | `#1c1a18` | Panes, bars |
| `--raised` | `#ffffff` | `#262320` | Popovers, hovered rows, menus |
| `--line` | `#d6d6d2` | `#312d29` | Pane dividers, input borders |
| `--line-strong` | `#bdbdb8` | `#47423c` | Hovered borders, axis ticks |
| `--ink` | `#1b1a19` | `#ece7e0` | Primary text, prices |
| `--ink-2` | `#55534f` | `#aaa298` | Secondary text, labels |
| `--ink-3` | `#85827c` | `#736c63` | Hints and disabled text only (about 3.5:1; never for anything a user must read) |
| `--hot` | `#c2570a` | `#dd7418` | Up, bid, buy, long |
| `--cold` | `#1f6fd1` | `#3d8ce3` | Down, ask, sell, short |
| `--hot-wash` / `--cold-wash` | 12% | 16% | Tick flashes, row tints, the lightest step of a heat ramp |
| `--hot-text` | `#a04606` | `#dd7418` | Hot as small text (P&L, change): 5.1:1 or better on every surface |
| `--cold-text` | `#1a5fb6` | `#3d8ce3` | Cold as small text: 5.1:1 or better on every light surface, 4.5:1 or better on dark |

Marks (candles, bars, ladder rows) use `--hot` and `--cold`. Numbers set in the hue use `--hot-text` and `--cold-text` (the `.hot` and `.cold` classes), because the light-theme mark colours are 3.7–4.6:1 against the light surfaces: enough for a mark, not for 12 px text.

Light is a neutral wood-ash grey, not cream. Dark is a warm charcoal, not blue-black. The theme follows the system and can be overridden with `data-theme="light"` or `"dark"` on `<html>` (`src/lib/theme.ts`).

### Why amber and blue, not green and red

- Red and green are the hardest pair for the most common kinds of colour blindness. Amber and blue stay distinct under protanopia, deuteranopia and tritanopia.
- It is what "hot" and "cold" already mean, so the order book reads without a legend.
- It is Flame's own. Every other terminal is green and red.

Traders trained on green and red can switch to **Classic** in settings. Thermal is the default.

The pair first pencilled in for Classic (`#1f9d55`/`#d64545` light, `#2fb872`/`#e5604f` dark) failed the validator: to a deuteranope the two are ΔE 2.9 and 5.0 apart, effectively one colour. The shipped pair separates green and red in lightness as well as hue:

| | Light | Dark |
|---|---|---|
| `--hot` (up) | `#2f9e6e` | `#3aaa78` |
| `--cold` (down) | `#a8201a` | `#c94a38` |
| `--hot-text` / `--cold-text` | `#1b6e4a` / `#a8201a` | `#3aaa78` / `#e3705c` |
| Worst colour-blind separation | ΔE 14.8 | ΔE 9.3 |

Both pass every validator check (17 November 2026). The flame in the mark has its own token, `--flame`, and stays amber under either convention.

### Validated, not eyeballed

Both pairs pass the `dataviz` skill's validator against their own surfaces (lightness band, chroma floor, colour-blind separation, normal-vision separation, 3:1 contrast). Re-run it whenever a value changes:

```bash
node <dataviz-skill>/scripts/validate_palette.js "#dd7418,#3d8ce3" --mode dark  --surface "#1c1a18" --pairs all
node <dataviz-skill>/scripts/validate_palette.js "#c2570a,#1f6fd1" --mode light --surface "#f8f8f6" --pairs all
```

Results on 17 November 2026: all checks pass in both modes; worst colour-blind separation ΔE 26.5 (target ≥ 8).

### Heat ramps

The ladder shades each side with one hue from wash to full: five steps, mixed from the surface towards `--hot` or `--cold` (`color-mix(in oklab, var(--hot) N%, var(--surface))` at 12, 28, 46, 68 and 100%). Size is also always shown as a bar length and a number, so the shading is a third reading, never the only one.

### Never colour alone

Side is shown by colour **and** by something else: position (bids below, asks above), a sign (+/−), an arrow glyph on the tape, a word in the ticket (Buy/Sell). Venues are told apart by a short label, not by colour. Status (connected, delayed, reconnecting, offline) is an icon and a word in ink, not a coloured dot.

## Type

One family: **Archivo Variable**, self-hosted. It has a width axis (62–125%), and Flame uses width to say how dense something is.

| Role | Width | Weight | Where |
|---|---|---|---|
| Dense | 80% (`--w-dense`) | 400–600 | Ladder, tape, tables, rail labels: anything numeric and repeated |
| UI | 100% (`--w-ui`) | 400–600 | Labels, buttons, body copy |
| Display | 118% (`--w-display`) | 700 | The wordmark, the big price, view titles |

- Numbers are always tabular: add the `.num` class (it sets `tabular-nums` and the dense width).
- Scale: 11, 12, 13 (base), 15, 18, 24, 32, 44 px. Nothing smaller than 11.
- Sentence case everywhere. No all-caps labels, no letter-spaced eyebrows, no monospace for data.
- Negative tracking only on display sizes (−0.01 to −0.02em).
- Lines of prose stay under 62 characters.

## Layout

- **Full-bleed desk.** Panes fill the window and are divided by 1px lines (`gap: 1px` over a `--line` background). No cards, no shadows, no gaps between panes.
- **Square panes, soft controls.** Panes have no radius. Buttons, inputs and menus use 6px. Pills are fully round and reserved for status and selection.
- **Rail** (64px) on the left for views; **bar** (48px) on top for identity, search and the account. Below 860px the rail becomes a bottom bar and the desk becomes a stack.
- **Pane header** is 34px: title on the left in 600 weight, one quiet note or control group on the right.
- Spacing steps: 4, 8, 12, 16, 24, 32, 48.
- Left-align text and labels; right-align numbers in columns.
- Density is a feature. Default row height in data tables is 22px.

## Motion

- A price cell flashes its wash for 300 ms on a tick. That is the only unprompted motion.
- Things the user causes (a drawer opening, an order landing in the list) may animate for 120–160 ms.
- Nothing loops. `prefers-reduced-motion` turns all of it off.

## Charts

Follow the `dataviz` skill. In short:

- Candles: body and wick in `--hot` or `--cold`; volume bars in the same hue at 40% so they recede.
- Indicators are drawn in ink at different weights and dash patterns, not in new colours: a 20-period average is a solid 1.5px `--ink-2` line, a 50 is dashed, a 200 is dotted. Bands are a 6% ink fill. Each is labelled at the right edge.
- One price axis per pane. Oscillators (RSI, MACD, delta) get their own pane under the price, never a second axis on it.
- Grid and axes recede (`--line`); the crosshair and its readout are ink.
- Orders and positions on the axis are ink lines with a small tag ("Stop −1R", "Limit buy 0.1"); only the fill of the tag carries hot or cold.
- Every chart has a crosshair readout; every table-like chart can be read as a table.
- Keep the lightweight-charts attribution visible; its licence asks for it.

## Words

- Name things the way a trader says them: Desk, Book, Tape, Ticket, Journal. Not "Dashboard", "Module", "Widget".
- A button says what happens: "Buy 0.156 BTC", "Cancel order", "End replay". The toast repeats the verb: "Bought 0.156 BTC at $64,210".
- Explain numbers in one line, in place: "Profit factor: dollars won for every dollar lost. Above 1.5 is healthy."
- Empty: say what will be here and how to fill it. "No open positions. Place an order from the ticket."
- Failure: say what broke and what to do. "Kraken's feed dropped. Reconnecting; the book excludes Kraken until it is back."
- No exclamation marks, no "Oops", no emoji in the interface.
- Money: `$64,210.50`; negative as `−$120.40` with a true minus; percentages to two decimals; R to one (`+2.4R`).

## Things to stay away from

These are the marks of a generated interface. If one shows up, it is a default, not a decision:

- A dark screen with one bright accent colour
- Identical rounded cards with soft shadows
- All-caps, letter-spaced labels above headings
- Strings of facts joined with middle dots
- A monospace face used to make numbers look technical
- Arrows appended to button and link text
- Gradients, glows, glass
- Fade-and-slide-up entrances
