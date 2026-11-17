import type { Candle } from '../data/types';

// Indicator maths: pure functions over plain arrays, tested against known
// values in math.test.ts. Every series is aligned with its input; positions
// before an indicator has enough history are null.

export type Series = (number | null)[];

export function sma(values: number[], n: number): Series {
  const out: Series = new Array(values.length).fill(null);
  let sum = 0;
  for (let i = 0; i < values.length; i++) {
    sum += values[i]!;
    if (i >= n) sum -= values[i - n]!;
    if (i >= n - 1) out[i] = sum / n;
  }
  return out;
}

/** Exponential average, seeded with the simple average of the first n values. */
export function ema(values: number[], n: number): Series {
  const out: Series = new Array(values.length).fill(null);
  if (values.length < n) return out;
  const k = 2 / (n + 1);
  let prev = 0;
  for (let i = 0; i < n; i++) prev += values[i]!;
  prev /= n;
  out[n - 1] = prev;
  for (let i = n; i < values.length; i++) {
    prev = values[i]! * k + prev * (1 - k);
    out[i] = prev;
  }
  return out;
}

export interface Bands {
  mid: Series;
  upper: Series;
  lower: Series;
}

/** Bollinger bands: a simple average with bands k population standard deviations either side. */
export function bollinger(values: number[], n = 20, k = 2): Bands {
  const mid = sma(values, n);
  const upper: Series = new Array(values.length).fill(null);
  const lower: Series = new Array(values.length).fill(null);
  for (let i = n - 1; i < values.length; i++) {
    const m = mid[i]!;
    let sq = 0;
    for (let j = i - n + 1; j <= i; j++) sq += (values[j]! - m) ** 2;
    const sd = Math.sqrt(sq / n);
    upper[i] = m + k * sd;
    lower[i] = m - k * sd;
  }
  return { mid, upper, lower };
}

/** Wilder's RSI. */
export function rsi(values: number[], n = 14): Series {
  const out: Series = new Array(values.length).fill(null);
  if (values.length <= n) return out;
  let gain = 0;
  let loss = 0;
  for (let i = 1; i <= n; i++) {
    const d = values[i]! - values[i - 1]!;
    if (d >= 0) gain += d;
    else loss -= d;
  }
  gain /= n;
  loss /= n;
  out[n] = loss === 0 ? 100 : 100 - 100 / (1 + gain / loss);
  for (let i = n + 1; i < values.length; i++) {
    const d = values[i]! - values[i - 1]!;
    gain = (gain * (n - 1) + Math.max(0, d)) / n;
    loss = (loss * (n - 1) + Math.max(0, -d)) / n;
    out[i] = loss === 0 ? 100 : 100 - 100 / (1 + gain / loss);
  }
  return out;
}

export interface Macd {
  macd: Series;
  signal: Series;
  hist: Series;
}

export function macd(values: number[], fast = 12, slow = 26, signalN = 9): Macd {
  const f = ema(values, fast);
  const s = ema(values, slow);
  const line: Series = values.map((_, i) => (f[i] !== null && s[i] !== null ? f[i]! - s[i]! : null));
  const start = line.findIndex((v) => v !== null);
  const signal: Series = new Array(values.length).fill(null);
  if (start >= 0) {
    const sig = ema(line.slice(start) as number[], signalN);
    for (let i = 0; i < sig.length; i++) signal[start + i] = sig[i]!;
  }
  const hist: Series = values.map((_, i) => (line[i] !== null && signal[i] !== null ? line[i]! - signal[i]! : null));
  return { macd: line, signal, hist };
}

/** Wilder's average true range. */
export function atr(candles: Candle[], n = 14): Series {
  const out: Series = new Array(candles.length).fill(null);
  if (candles.length <= n) return out;
  const tr = (i: number): number => {
    const c = candles[i]!;
    const pc = candles[i - 1]!.c;
    return Math.max(c.h - c.l, Math.abs(c.h - pc), Math.abs(c.l - pc));
  };
  let avg = 0;
  for (let i = 1; i <= n; i++) avg += tr(i);
  avg /= n;
  out[n] = avg;
  for (let i = n + 1; i < candles.length; i++) {
    avg = (avg * (n - 1) + tr(i)) / n;
    out[i] = avg;
  }
  return out;
}

const DAY = 86_400_000;
export const dayOf = (t: number, offsetMs = 0): number => Math.floor((t + offsetMs) / DAY);

export interface Vwap {
  vwap: Series;
  upper1: Series;
  lower1: Series;
  upper2: Series;
  lower2: Series;
}

/**
 * Volume-weighted average price with volume-weighted standard-deviation bands.
 * `resets(i)` is true on the first bar of a new session; pass `() => false`
 * with a slice starting at the anchor for an anchored VWAP.
 */
export function vwapBands(candles: Candle[], resets: (i: number) => boolean): Vwap {
  const n = candles.length;
  const out: Vwap = {
    vwap: new Array(n).fill(null),
    upper1: new Array(n).fill(null),
    lower1: new Array(n).fill(null),
    upper2: new Array(n).fill(null),
    lower2: new Array(n).fill(null),
  };
  let pv = 0;
  let vol = 0;
  let pv2 = 0;
  for (let i = 0; i < n; i++) {
    if (i === 0 || resets(i)) {
      pv = 0;
      vol = 0;
      pv2 = 0;
    }
    const c = candles[i]!;
    const typical = (c.h + c.l + c.c) / 3;
    pv += typical * c.v;
    pv2 += typical * typical * c.v;
    vol += c.v;
    if (vol <= 0) continue;
    const v = pv / vol;
    const sd = Math.sqrt(Math.max(0, pv2 / vol - v * v));
    out.vwap[i] = v;
    out.upper1[i] = v + sd;
    out.lower1[i] = v - sd;
    out.upper2[i] = v + 2 * sd;
    out.lower2[i] = v - 2 * sd;
  }
  return out;
}

/** Session VWAP: resets when the (UTC, or offset) day changes. */
export function sessionVwap(candles: Candle[], offsetMs = 0): Vwap {
  return vwapBands(candles, (i) => dayOf(candles[i]!.t, offsetMs) !== dayOf(candles[i - 1]!.t, offsetMs));
}

/** True when the bars reach back to the anchor, so a VWAP anchored there can be computed honestly. */
export function anchorInRange(candles: Candle[], anchorT: number): boolean {
  const first = candles[0];
  const second = candles[1];
  if (!first) return false;
  const step = second ? second.t - first.t : 0;
  return anchorT >= first.t - step && anchorT <= candles[candles.length - 1]!.t;
}

/**
 * VWAP from one bar onward; null before the anchor. If the anchor is older
 * than the first bar there is not enough history to compute it, and the
 * result is blank rather than a VWAP anchored somewhere else.
 */
export function anchoredVwap(candles: Candle[], anchorT: number): Vwap {
  const n = candles.length;
  const blank = (): Series => new Array(n).fill(null);
  const out: Vwap = { vwap: blank(), upper1: blank(), lower1: blank(), upper2: blank(), lower2: blank() };
  if (!anchorInRange(candles, anchorT)) return out;
  const start = candles.findIndex((c) => c.t >= anchorT);
  if (start < 0) return out;
  const part = vwapBands(candles.slice(start), () => false);
  for (const key of Object.keys(out) as (keyof Vwap)[]) {
    for (let i = 0; i < part[key].length; i++) out[key][start + i] = part[key][i]!;
  }
  return out;
}

export interface DayLevels {
  high: number;
  low: number;
  close: number;
}

/** High, low and close of the day before the last bar's day. Null without a full previous day in the data. */
export function previousDay(candles: Candle[], offsetMs = 0): DayLevels | null {
  const last = candles[candles.length - 1];
  if (!last) return null;
  const today = dayOf(last.t, offsetMs);
  let prev: number | null = null;
  for (let i = candles.length - 1; i >= 0; i--) {
    const d = dayOf(candles[i]!.t, offsetMs);
    if (d < today) {
      prev = d;
      break;
    }
  }
  if (prev === null) return null;
  let high = -Infinity;
  let low = Infinity;
  let close = 0;
  let seen = false;
  for (const c of candles) {
    if (dayOf(c.t, offsetMs) !== prev) continue;
    seen = true;
    high = Math.max(high, c.h);
    low = Math.min(low, c.l);
    close = c.c;
  }
  return seen ? { high, low, close } : null;
}

/** Per-bar delta (taker buys minus taker sells), where the venue reports taker-buy volume. */
export function barDelta(c: Candle): number | null {
  return c.bv === undefined ? null : 2 * c.bv - c.v;
}

/** Running sum of delta. Null where the venue does not report it. */
export function cumulativeDelta(candles: Candle[]): Series {
  let sum = 0;
  return candles.map((c) => {
    const d = barDelta(c);
    if (d === null) return null;
    sum += d;
    return sum;
  });
}

export interface ProfileRow {
  /** Lower edge of the price bucket. */
  price: number;
  volume: number;
  buy: number;
  sell: number;
}

export interface Profile {
  rows: ProfileRow[];
  step: number;
  /** Point of control: the bucket with the most volume. */
  poc: number;
  /** Value area: the band around the point of control holding 70% of volume. */
  valueLow: number;
  valueHigh: number;
  total: number;
}

/**
 * Volume by price. Each bar's volume is spread evenly across the buckets its
 * range touches: an approximation, since bars do not say where inside them the
 * volume traded.
 */
export function volumeProfile(candles: Candle[], buckets = 40): Profile | null {
  if (candles.length === 0) return null;
  let lo = Infinity;
  let hi = -Infinity;
  for (const c of candles) {
    lo = Math.min(lo, c.l);
    hi = Math.max(hi, c.h);
  }
  if (!(hi > lo)) return null;
  const step = (hi - lo) / buckets;
  const rows: ProfileRow[] = Array.from({ length: buckets }, (_, i) => ({ price: lo + i * step, volume: 0, buy: 0, sell: 0 }));
  for (const c of candles) {
    const a = Math.min(buckets - 1, Math.floor((c.l - lo) / step));
    // A high that sits exactly on a bucket edge does not reach into the bucket above.
    const b = Math.max(a, Math.min(buckets - 1, Math.ceil((c.h - lo) / step) - 1));
    const share = c.v / (b - a + 1);
    const buyShare = (c.bv ?? c.v / 2) / (b - a + 1);
    for (let i = a; i <= b; i++) {
      const r = rows[i]!;
      r.volume += share;
      r.buy += buyShare;
      r.sell += share - buyShare;
    }
  }
  const total = rows.reduce((s, r) => s + r.volume, 0);
  let pocIndex = 0;
  for (let i = 1; i < rows.length; i++) if (rows[i]!.volume > rows[pocIndex]!.volume) pocIndex = i;
  // Grow outward from the point of control, taking the larger neighbour, until 70% is inside.
  let a = pocIndex;
  let b = pocIndex;
  let inside = rows[pocIndex]!.volume;
  while (inside < total * 0.7 && (a > 0 || b < rows.length - 1)) {
    const below = a > 0 ? rows[a - 1]!.volume : -1;
    const above = b < rows.length - 1 ? rows[b + 1]!.volume : -1;
    if (above >= below) inside += rows[++b]!.volume;
    else inside += rows[--a]!.volume;
  }
  return { rows, step, poc: rows[pocIndex]!.price + step / 2, valueLow: rows[a]!.price, valueHigh: rows[b]!.price + step, total };
}

/** Highest high and lowest low of the previous n bars (not including the current one). */
export function donchian(candles: Candle[], n: number): { upper: Series; lower: Series } {
  const upper: Series = new Array(candles.length).fill(null);
  const lower: Series = new Array(candles.length).fill(null);
  for (let i = n; i < candles.length; i++) {
    let hi = -Infinity;
    let lo = Infinity;
    for (let j = i - n; j < i; j++) {
      hi = Math.max(hi, candles[j]!.h);
      lo = Math.min(lo, candles[j]!.l);
    }
    upper[i] = hi;
    lower[i] = lo;
  }
  return { upper, lower };
}
