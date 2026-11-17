import { ProxyError } from './http.js';

// What every stock-quote function accepts and returns, whichever source is
// behind it. The source itself lives in alpaca.ts.

/** Tickers: SPY, BRK.B, BRK-B, and the index and futures notations (^GSPC, GC=F) that the source may not cover. Nothing else gets through. */
const SYMBOL = /^[A-Z0-9^][A-Z0-9.\-=^]{0,14}$/;

export function symbol(raw: string | undefined): string {
  const s = (raw ?? '').trim().toUpperCase();
  if (!SYMBOL.test(s)) throw new ProxyError(400, 'bad_symbol', 'That is not a symbol Flame can look up.');
  return s;
}

export const RANGES = ['1d', '5d', '1mo', '3mo', '6mo', '1y', '2y', '5y', '10y', 'max'] as const;
export const INTERVALS = ['1m', '5m', '15m', '30m', '60m', '1d', '1wk', '1mo'] as const;
export type Range = (typeof RANGES)[number];
export type Interval = (typeof INTERVALS)[number];

/** The longest range worth serving for each intraday interval (it bounds the number of bars). */
const MAX_RANGE: Partial<Record<Interval, Range[]>> = {
  '1m': ['1d', '5d'],
  '5m': ['1d', '5d', '1mo'],
  '15m': ['1d', '5d', '1mo'],
  '30m': ['1d', '5d', '1mo'],
  '60m': ['1d', '5d', '1mo', '3mo', '6mo', '1y', '2y'],
};

export function rangeAndInterval(rawRange: string | undefined, rawInterval: string | undefined): { range: Range; interval: Interval } {
  const range = (rawRange ?? '1d') as Range;
  const interval = (rawInterval ?? '5m') as Interval;
  if (!RANGES.includes(range)) throw new ProxyError(400, 'bad_range', `range must be one of ${RANGES.join(', ')}.`);
  if (!INTERVALS.includes(interval)) throw new ProxyError(400, 'bad_interval', `interval must be one of ${INTERVALS.join(', ')}.`);
  const allowed = MAX_RANGE[interval];
  if (allowed && !allowed.includes(range)) throw new ProxyError(400, 'bad_range', `${interval} bars are only available for ${allowed.join(', ')}.`);
  return { range, interval };
}

export interface Bar {
  t: number;
  o: number;
  h: number;
  l: number;
  c: number;
  v: number;
}

export interface Quote {
  symbol: string;
  name: string;
  currency: string;
  exchange: string;
  type: string;
  timezone: string;
  last: number | null;
  prevClose: number | null;
  /** When the last price is from, in milliseconds. */
  time: number | null;
  /** True during the regular session, when a recent bar shows the market really is trading. */
  open: boolean;
  /** The regular session today, in milliseconds. */
  session: { start: number; end: number } | null;
  /** How old the prices are by design, in minutes. */
  delayMinutes: number;
}
