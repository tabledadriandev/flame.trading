import type { Candle } from '../data/types';
import { atr, bollinger, donchian, rsi, sma } from '../indicators/math';

// The Lab's backtester. A strategy says, at each bar's close, whether it wants
// to be long or flat; orders fill at the NEXT bar's open, so a rule can never
// trade on a price it could not have seen. Costs are charged on every fill.

export type StrategyId = 'ma-cross' | 'rsi-reversion' | 'donchian' | 'bb-reversion';

export interface ParamDef {
  key: string;
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  /** Values tried when tuning on the in-sample part. */
  grid: number[];
}

export interface StrategyDef {
  id: StrategyId;
  name: string;
  /** The rule in one sentence. */
  rule: string;
  params: ParamDef[];
  /** For each bar: true to be long after this bar closes, false to be flat. */
  wants(candles: Candle[], p: Record<string, number>): boolean[];
}

const closes = (c: Candle[]): number[] => c.map((x) => x.c);

export const STRATEGIES: StrategyDef[] = [
  {
    id: 'ma-cross',
    name: 'Moving-average cross',
    rule: 'Long while the fast average is above the slow one; flat otherwise.',
    params: [
      { key: 'fast', label: 'Fast average', value: 20, min: 2, max: 200, grid: [10, 20, 50] },
      { key: 'slow', label: 'Slow average', value: 100, min: 5, max: 400, grid: [50, 100, 200] },
    ],
    wants(c, p) {
      const f = sma(closes(c), p.fast ?? 20);
      const s = sma(closes(c), p.slow ?? 100);
      return c.map((_, i) => f[i] !== null && s[i] !== null && f[i]! > s[i]!);
    },
  },
  {
    id: 'rsi-reversion',
    name: 'RSI mean reversion',
    rule: 'Buy when RSI falls below the entry level; sell when it recovers above the exit level.',
    params: [
      { key: 'n', label: 'RSI bars', value: 14, min: 2, max: 50, grid: [7, 14, 21] },
      { key: 'enter', label: 'Buy below', value: 30, min: 5, max: 50, grid: [20, 30, 40] },
      { key: 'exit', label: 'Sell above', value: 55, min: 40, max: 90, grid: [50, 60, 70] },
    ],
    wants(c, p) {
      const r = rsi(closes(c), p.n ?? 14);
      let long = false;
      return c.map((_, i) => {
        const v = r[i];
        if (v === null || v === undefined) return false;
        if (!long && v < (p.enter ?? 30)) long = true;
        else if (long && v > (p.exit ?? 55)) long = false;
        return long;
      });
    },
  },
  {
    id: 'donchian',
    name: 'Donchian breakout',
    rule: 'Buy a close above the highest high of the last N bars; sell a close below the lowest low of the last M bars.',
    params: [
      { key: 'entry', label: 'Breakout bars', value: 20, min: 5, max: 200, grid: [20, 40, 55] },
      { key: 'exit', label: 'Exit bars', value: 10, min: 2, max: 100, grid: [10, 20] },
    ],
    wants(c, p) {
      const up = donchian(c, p.entry ?? 20).upper;
      const down = donchian(c, p.exit ?? 10).lower;
      let long = false;
      return c.map((bar, i) => {
        if (!long && up[i] !== null && bar.c > up[i]!) long = true;
        else if (long && down[i] !== null && bar.c < down[i]!) long = false;
        return long;
      });
    },
  },
  {
    id: 'bb-reversion',
    name: 'Bollinger reversion',
    rule: 'Buy a close below the lower band; sell when price closes back above the middle of the bands.',
    params: [
      { key: 'n', label: 'Band bars', value: 20, min: 5, max: 100, grid: [10, 20, 40] },
      { key: 'k', label: 'Deviations', value: 2, min: 1, max: 4, step: 0.5, grid: [1.5, 2, 2.5] },
    ],
    wants(c, p) {
      const b = bollinger(closes(c), p.n ?? 20, p.k ?? 2);
      let long = false;
      return c.map((bar, i) => {
        if (b.lower[i] === null) return false;
        if (!long && bar.c < b.lower[i]!) long = true;
        else if (long && bar.c > b.mid[i]!) long = false;
        return long;
      });
    },
  },
];

export const strategy = (id: StrategyId): StrategyDef => STRATEGIES.find((s) => s.id === id)!;

export type Sizing =
  | { kind: 'fixed'; dollars: number }
  | { kind: 'percent'; percent: number }
  /** Risk a percent of equity per trade, with a stop `atrMultiple` average-true-ranges below the entry. */
  | { kind: 'risk'; percent: number; atrMultiple: number };

export interface Settings {
  startCash: number;
  /** Fee per side, as a fraction of notional (0.0005 = 0.05%). */
  fee: number;
  /** Slippage per side, as a fraction of price. */
  slippage: number;
  sizing: Sizing;
}

export const DEFAULT_LAB: Settings = { startCash: 100_000, fee: 0.0005, slippage: 0.0002, sizing: { kind: 'percent', percent: 100 } };

export interface BtTrade {
  entryT: number;
  entryPrice: number;
  exitT: number;
  exitPrice: number;
  qty: number;
  pnl: number;
  fees: number;
  bars: number;
  /** 'signal', 'stop', or 'end' when the test ran out of bars with the position open. */
  reason: 'signal' | 'stop' | 'end';
}

export interface BtPoint {
  t: number;
  equity: number;
  /** Fraction below the highest equity so far (0–1). */
  drawdown: number;
}

export interface BtResult {
  trades: BtTrade[];
  curve: BtPoint[];
  /** Fractions, not percents: 0.25 = +25%. */
  totalReturn: number;
  cagr: number;
  maxDrawdown: number;
  winRate: number;
  profitFactor: number | null;
  /** Average P&L per trade in dollars. */
  expectancy: number;
  /** Share of bars spent in the market. */
  exposure: number;
  /** Buying at the first open and holding to the last close, with the same costs. */
  buyHold: number;
  bars: number;
  from: number;
  to: number;
}

const YEAR = 365.25 * 86_400_000;

/**
 * Run a rule over the bars. With `startAt`, the bars before it only warm the
 * indicators up: no position is opened there, and the result (trades, curve,
 * exposure, buy-and-hold) covers the bars from `startAt` on.
 */
export function runBacktest(candles: Candle[], def: StrategyDef, params: Record<string, number>, s: Settings, startAt = 0): BtResult {
  const n = candles.length;
  const wants = def.wants(candles, params);
  const ranges = s.sizing.kind === 'risk' ? atr(candles, 14) : null;
  let cash = s.startCash;
  let qty = 0;
  let entryPrice = 0;
  let entryT = 0;
  let entryFee = 0;
  let entryBar = 0;
  let stop: number | null = null;
  let peak = s.startCash;
  let maxDrawdown = 0;
  let inMarket = 0;
  const trades: BtTrade[] = [];
  const curve: BtPoint[] = [];

  const close = (price: number, t: number, bar: number, reason: BtTrade['reason']) => {
    const fill = price * (1 - s.slippage);
    const fee = qty * fill * s.fee;
    cash += qty * fill - fee;
    trades.push({ entryT, entryPrice, exitT: t, exitPrice: fill, qty, pnl: (fill - entryPrice) * qty - fee - entryFee, fees: fee + entryFee, bars: bar - entryBar, reason });
    qty = 0;
    stop = null;
  };

  for (let i = 0; i < n; i++) {
    const bar = candles[i]!;
    // Act on what the previous bar's close asked for, at this bar's open.
    const want = i > 0 ? wants[i - 1]! : false;
    if (i < startAt) continue;
    if (qty === 0 && want) {
      const fill = bar.o * (1 + s.slippage);
      const equity = cash;
      let size = 0;
      if (s.sizing.kind === 'fixed') size = Math.min(s.sizing.dollars, equity) / fill;
      else if (s.sizing.kind === 'percent') size = (equity * Math.min(100, s.sizing.percent)) / 100 / fill;
      else {
        const range = ranges?.[i - 1];
        if (range && range > 0) {
          const distance = range * s.sizing.atrMultiple;
          size = Math.min((equity * s.sizing.percent) / 100 / distance, equity / fill);
          stop = fill - distance;
        }
      }
      // Leave room for the fee so cash never goes negative.
      size = Math.min(size, equity / (fill * (1 + s.fee)));
      if (size > 0) {
        entryFee = size * fill * s.fee;
        cash -= size * fill + entryFee;
        qty = size;
        entryPrice = fill;
        entryT = bar.t;
        entryBar = i;
      }
    } else if (qty > 0 && !want) {
      close(bar.o, bar.t, i, 'signal');
    }
    // A stop is hit inside the bar: at the stop, or at the open if the bar gapped through it.
    if (qty > 0 && stop !== null && bar.l <= stop) close(Math.min(bar.o, stop), bar.t, i, 'stop');
    if (qty > 0 && i === n - 1) close(bar.c, bar.t, i, 'end');

    if (qty > 0) inMarket += 1;
    const equity = cash + qty * bar.c;
    peak = Math.max(peak, equity);
    const dd = peak > 0 ? (peak - equity) / peak : 0;
    maxDrawdown = Math.max(maxDrawdown, dd);
    curve.push({ t: bar.t, equity, drawdown: dd });
  }

  const first = candles[startAt];
  const last = candles[n - 1];
  const end = curve[curve.length - 1]?.equity ?? s.startCash;
  const totalReturn = end / s.startCash - 1;
  const years = first && last ? Math.max((last.t - first.t) / YEAR, 1 / 365.25) : 1;
  const wins = trades.filter((t) => t.pnl > 0);
  const won = wins.reduce((a, t) => a + t.pnl, 0);
  const lost = trades.filter((t) => t.pnl < 0).reduce((a, t) => a - t.pnl, 0);
  const buyHold = first && last ? (last.c * (1 - s.slippage) * (1 - s.fee)) / (first.o * (1 + s.slippage) * (1 + s.fee)) - 1 : 0;
  return {
    trades,
    curve,
    totalReturn,
    cagr: end > 0 ? (end / s.startCash) ** (1 / years) - 1 : -1,
    maxDrawdown,
    winRate: trades.length ? wins.length / trades.length : 0,
    profitFactor: trades.length === 0 ? null : lost > 0 ? won / lost : won > 0 ? Infinity : null,
    expectancy: trades.length ? trades.reduce((a, t) => a + t.pnl, 0) / trades.length : 0,
    exposure: n > startAt ? inMarket / (n - startAt) : 0,
    buyHold,
    bars: Math.max(0, n - startAt),
    from: first?.t ?? 0,
    to: last?.t ?? 0,
  };
}

export interface OutOfSample {
  /** The parameters that did best on the first 70%. */
  best: Record<string, number>;
  tried: number;
  inSample: BtResult;
  outOfSample: BtResult;
  /** True when the tuned rule held up on data it was not tuned on. */
  agrees: boolean;
  verdict: string;
}

function grid(def: StrategyDef): Record<string, number>[] {
  let combos: Record<string, number>[] = [{}];
  for (const p of def.params) combos = combos.flatMap((c) => p.grid.map((v) => ({ ...c, [p.key]: v })));
  // A fast average must be shorter than the slow one, and so on: drop combinations that make no sense.
  return combos.filter((c) => (c.fast === undefined || c.slow === undefined || c.fast < c.slow) && (c.enter === undefined || c.exit === undefined || c.enter < c.exit));
}

/**
 * Tune on the first 70% of the bars, then run the winning parameters on the
 * last 30%, which the tuning never saw. A rule that only works on the data it
 * was fitted to is a description of the past, not an edge.
 */
export function outOfSample(candles: Candle[], def: StrategyDef, s: Settings): OutOfSample | null {
  const cut = Math.floor(candles.length * 0.7);
  if (cut < 60 || candles.length - cut < 30) return null;
  const train = candles.slice(0, cut);
  // The test part needs the indicator warm-up from before the cut, but only trades after it count.
  const combos = grid(def);
  let best: Record<string, number> | null = null;
  let bestResult: BtResult | null = null;
  for (const params of combos) {
    const r = runBacktest(train, def, params, s);
    if (!bestResult || r.totalReturn > bestResult.totalReturn) {
      best = params;
      bestResult = r;
    }
  }
  if (!best || !bestResult) return null;
  // The unseen part: the bars before the cut only warm the indicators up. Nothing is held across the cut,
  // so return, trades, exposure and buy-and-hold all describe the same stretch.
  const warm = Math.min(cut, 400);
  const test = runBacktest(candles.slice(cut - warm), def, best, s, warm);

  const inYear = bestResult.cagr;
  const outYear = test.cagr;
  let agrees = true;
  let verdict: string;
  if (inYear <= 0) {
    agrees = false;
    verdict = 'Even the best parameters lost money on the data they were tuned on. There is nothing here to carry forward.';
  } else if (outYear <= 0) {
    agrees = false;
    verdict = 'The two disagree. The rule made money on the data it was tuned on and lost on the data it had not seen: the tuning fitted the past.';
  } else if (outYear < inYear * 0.4) {
    agrees = false;
    verdict = 'The two disagree. The rule kept working on unseen data, but at well under half the rate: expect less than the tuned result suggests.';
  } else {
    verdict = 'The two agree. The rule held up on data it was not tuned on, which is the least a rule should do before you trust it.';
  }
  return { best, tried: combos.length, inSample: bestResult, outOfSample: test, agrees, verdict };
}

/** Fewer than this many trades and a result is mostly luck. */
export const MIN_TRADES = 30;
