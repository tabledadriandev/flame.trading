import { fetchJson, ProxyError } from './http.js';
import type { Bar, Interval, Quote, Range } from './quotes.js';

// Alpaca's Market Data API (https://docs.alpaca.markets/docs/about-market-data-api).
// Only data.alpaca.markets is ever called: Flame reads prices and never touches
// the trading API. The key and secret live in Vercel environment variables.
//
// The free plan allows consolidated ("sip") data once it is 15 minutes old, so
// every request ends 16 minutes ago and the quote is the last bar of that
// window. Chart and quote therefore always agree, and "Delayed" is exactly true.

const DATA = 'https://data.alpaca.markets';
export const DELAY_MINUTES = 16;
const NY = 'America/New_York';

export function credentials(): { key: string; secret: string } | null {
  const key = process.env.ALPACA_KEY_ID;
  const secret = process.env.ALPACA_SECRET_KEY;
  return key && secret ? { key, secret } : null;
}

/** US-listed stocks and ETFs only: SPY, BRK.B. Indices, futures and currencies are not in this feed. */
export function alpacaSymbol(sym: string): string {
  const s = sym.replace('-', '.');
  if (!/^[A-Z]{1,5}(\.[A-Z]{1,2})?$/.test(s)) {
    throw new ProxyError(404, 'unsupported', 'Flame has stock and ETF prices only. Indices, futures and currencies are not in its data feed; chart the ETF that tracks them instead.');
  }
  return s;
}

const TIMEFRAME: Record<Interval, string> = { '1m': '1Min', '5m': '5Min', '15m': '15Min', '30m': '30Min', '60m': '1Hour', '1d': '1Day', '1wk': '1Week', '1mo': '1Month' };
const DAY = 86_400_000;
const RANGE_MS: Record<Range, number> = { '1d': 4 * DAY, '5d': 9 * DAY, '1mo': 32 * DAY, '3mo': 93 * DAY, '6mo': 185 * DAY, '1y': 366 * DAY, '2y': 731 * DAY, '5y': 1827 * DAY, '10y': 3653 * DAY, max: 7300 * DAY };

export const isIntraday = (i: Interval): boolean => i !== '1d' && i !== '1wk' && i !== '1mo';

/** The window to ask for. A "1d" range reaches back four days so a weekend or holiday still returns the last session. */
export function window(range: Range, now: number): { start: string; end: string } {
  return { start: new Date(now - RANGE_MS[range]).toISOString(), end: new Date(now - DELAY_MINUTES * 60_000).toISOString() };
}

const nyFormat = new Intl.DateTimeFormat('en-US', { timeZone: NY, weekday: 'short', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });

export interface NyTime {
  /** YYYY-MM-DD in New York. */
  date: string;
  /** Minutes after midnight in New York. */
  minutes: number;
  weekday: string;
}

export function nyTime(t: number): NyTime {
  const parts = nyFormat.formatToParts(t);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  return { date: `${get('year')}-${get('month')}-${get('day')}`, minutes: Number(get('hour')) * 60 + Number(get('minute')), weekday: get('weekday') };
}

const OPEN = 9 * 60 + 30;
const CLOSE = 16 * 60;

/** Keep the regular session only (09:30 to 16:00 New York). Hourly bars start on the hour, so the 09:00 bar holds the open. */
export function regularHours(bars: Bar[], interval: Interval): Bar[] {
  if (!isIntraday(interval)) return bars;
  const from = interval === '60m' ? 9 * 60 : OPEN;
  return bars.filter((b) => {
    const m = nyTime(b.t).minutes;
    return m >= from && m < CLOSE;
  });
}

/** Today's regular session in New York, in milliseconds; null at the weekend. */
export function sessionToday(now: number): { start: number; end: number } | null {
  const t = nyTime(now);
  if (t.weekday === 'Sat' || t.weekday === 'Sun') return null;
  const midnight = now - t.minutes * 60_000 - (now % 60_000);
  return { start: midnight + OPEN * 60_000, end: midnight + CLOSE * 60_000 };
}

interface RawBar {
  t?: string;
  o?: number;
  h?: number;
  l?: number;
  c?: number;
  v?: number;
}

interface BarsResponse {
  bars?: Record<string, RawBar[] | undefined>;
  next_page_token?: string | null;
}

export function readBars(raw: RawBar[] | undefined): Bar[] {
  const out: Bar[] = [];
  for (const b of raw ?? []) {
    const t = typeof b.t === 'string' ? Date.parse(b.t) : NaN;
    if (!Number.isFinite(t) || ![b.o, b.h, b.l, b.c].every((v) => typeof v === 'number' && Number.isFinite(v))) continue;
    out.push({ t, o: b.o!, h: b.h!, l: b.l!, c: b.c!, v: typeof b.v === 'number' ? b.v : 0 });
  }
  return out;
}

/** Bars for several symbols in one call (following up to three pages). */
export async function alpacaBars(symbols: string[], interval: Interval, range: Range, now: number): Promise<Map<string, Bar[]>> {
  const cred = credentials();
  if (!cred) throw new ProxyError(503, 'no_source', 'Stock prices are not switched on yet: Flame\'s server has no data key.');
  const { start, end } = window(range, now);
  const out = new Map<string, Bar[]>(symbols.map((s) => [s, []]));
  let page: string | null = null;
  for (let n = 0; n < 3; n++) {
    const q = new URLSearchParams({ symbols: symbols.join(','), timeframe: TIMEFRAME[interval], start, end, limit: '10000', adjustment: 'split', feed: 'sip', sort: 'asc' });
    if (page) q.set('page_token', page);
    const data: BarsResponse = await fetchJson<BarsResponse>({
      name: 'Alpaca',
      url: `${DATA}/v2/stocks/bars?${q}`,
      headers: { 'APCA-API-KEY-ID': cred.key, 'APCA-API-SECRET-KEY': cred.secret },
      timeoutMs: 9_000,
    });
    for (const [sym, bars] of Object.entries(data.bars ?? {})) out.get(sym)?.push(...readBars(bars));
    page = data.next_page_token ?? null;
    if (!page) break;
  }
  return out;
}

/**
 * The quote implied by a symbol's bars: the last close, the close of the
 * session before it, and whether the market is trading (inside regular hours
 * AND a bar arrived recently, so a holiday reads as closed).
 */
export function quoteFrom(symbol: string, intraday: Bar[], daily: Bar[], now: number): Quote {
  const last = intraday[intraday.length - 1] ?? daily[daily.length - 1];
  const lastDay = last ? nyTime(last.t).date : null;
  const before = lastDay ? [...daily].reverse().find((d) => nyTime(d.t).date < lastDay) : undefined;
  const session = sessionToday(now);
  const fresh = last !== undefined && now - last.t < (DELAY_MINUTES + 25) * 60_000;
  return {
    symbol,
    name: symbol,
    currency: 'USD',
    exchange: 'US consolidated tape',
    type: 'EQUITY',
    timezone: NY,
    last: last?.c ?? null,
    prevClose: before?.c ?? null,
    time: last?.t ?? null,
    open: session !== null && now >= session.start && now < session.end && fresh,
    session,
    delayMinutes: DELAY_MINUTES,
  };
}
