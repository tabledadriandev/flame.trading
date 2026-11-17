import { ProxyError } from './http.js';

// Yahoo Finance's unofficial chart endpoints. Not a licensed feed: they can
// change or refuse without notice, and prices are delayed for many exchanges.
// docs/data-sources.md records what was verified and when.

export const YAHOO = 'https://query1.finance.yahoo.com';
/** Yahoo turns away clients that do not look like a browser (and, as of November 2026, most that do). */
export const YAHOO_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

/** Tickers as Yahoo writes them: SPY, BRK-B, ^GSPC, GC=F, EURUSD=X. Nothing else gets through. */
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

/** The longest range Yahoo serves for each intraday interval. */
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

export interface YahooMeta {
  symbol?: string;
  currency?: string;
  exchangeName?: string;
  fullExchangeName?: string;
  instrumentType?: string;
  longName?: string;
  shortName?: string;
  regularMarketPrice?: number;
  regularMarketTime?: number;
  chartPreviousClose?: number;
  previousClose?: number;
  exchangeTimezoneName?: string;
  gmtoffset?: number;
  currentTradingPeriod?: { regular?: { start?: number; end?: number } };
}

export interface YahooResult {
  meta?: YahooMeta;
  timestamp?: number[];
  indicators?: { quote?: { open?: (number | null)[]; high?: (number | null)[]; low?: (number | null)[]; close?: (number | null)[]; volume?: (number | null)[] }[] };
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
  /** True between the regular session's open and close, by the exchange's own clock. */
  open: boolean;
  /** The regular session today, in milliseconds. */
  session: { start: number; end: number } | null;
}

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

export function quoteOf(sym: string, meta: YahooMeta | undefined, now: number): Quote {
  const start = num(meta?.currentTradingPeriod?.regular?.start);
  const end = num(meta?.currentTradingPeriod?.regular?.end);
  const session = start !== null && end !== null ? { start: start * 1000, end: end * 1000 } : null;
  const time = num(meta?.regularMarketTime);
  return {
    symbol: sym,
    name: meta?.longName ?? meta?.shortName ?? sym,
    currency: meta?.currency ?? 'USD',
    exchange: meta?.fullExchangeName ?? meta?.exchangeName ?? '',
    type: meta?.instrumentType ?? '',
    timezone: meta?.exchangeTimezoneName ?? '',
    last: num(meta?.regularMarketPrice),
    prevClose: num(meta?.chartPreviousClose) ?? num(meta?.previousClose),
    time: time !== null ? time * 1000 : null,
    open: session !== null && now >= session.start && now < session.end,
    session,
  };
}

/** Yahoo sends parallel arrays with nulls where a bar has no trades; keep only complete bars. */
export function barsOf(r: YahooResult | undefined): Bar[] {
  const ts = r?.timestamp ?? [];
  const q = r?.indicators?.quote?.[0];
  if (!q) return [];
  const out: Bar[] = [];
  for (let i = 0; i < ts.length; i++) {
    const o = num(q.open?.[i]);
    const h = num(q.high?.[i]);
    const l = num(q.low?.[i]);
    const c = num(q.close?.[i]);
    const t = num(ts[i]);
    if (t === null || o === null || h === null || l === null || c === null) continue;
    out.push({ t: t * 1000, o, h, l, c, v: num(q.volume?.[i]) ?? 0 });
  }
  return out;
}
