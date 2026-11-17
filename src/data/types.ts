import type { Side } from '../engine/types';

// The shapes every venue adapter speaks, so panes never know which exchange
// they are looking at. See docs/data-sources.md.

export type Timeframe = '1m' | '5m' | '15m' | '1h' | '4h' | '1d' | '1w';

export const TIMEFRAMES: { id: Timeframe; label: string; ms: number }[] = [
  { id: '1m', label: '1m', ms: 60_000 },
  { id: '5m', label: '5m', ms: 300_000 },
  { id: '15m', label: '15m', ms: 900_000 },
  { id: '1h', label: '1h', ms: 3_600_000 },
  { id: '4h', label: '4h', ms: 14_400_000 },
  { id: '1d', label: '1D', ms: 86_400_000 },
  { id: '1w', label: '1W', ms: 604_800_000 },
];

export const tfMs = (tf: Timeframe): number => TIMEFRAMES.find((t) => t.id === tf)!.ms;

export interface Candle {
  /** Open time, milliseconds. */
  t: number;
  o: number;
  h: number;
  l: number;
  c: number;
  v: number;
  /** Volume bought at the ask (taker buys), where the venue reports it. Delta = 2 × bv − v. */
  bv?: number;
}

export interface Tick {
  t: number;
  p: number;
  q: number;
  /** The side that crossed the spread. */
  side: Side;
}

export type Level = [price: number, size: number];

export interface BookSnapshot {
  /** Highest bid first. */
  bids: Level[];
  /** Lowest ask first. */
  asks: Level[];
  t: number;
}

export interface Ticker {
  last: number;
  /** Change against the reference the venue uses (24 hours ago for crypto, previous close for stocks). NaN while unknown. */
  changePct: number;
  t: number;
  /** Exchange session state, for venues that close. */
  open?: boolean;
}

export type FeedStatus = 'connecting' | 'live' | 'reconnecting' | 'down';
export type Unsubscribe = () => void;

export interface CandleQuery {
  /** Only bars that open before this time (for paging back). */
  before?: number;
  /** Only bars that open at or after this time. */
  from?: number;
  limit?: number;
}

export interface VenueAdapter {
  id: string;
  /** Shown next to prices: 'Live', 'Delayed' or 'Simulated'. */
  kind: 'live' | 'delayed' | 'simulated';
  hasBook: boolean;
  candles(symbol: string, tf: Timeframe, query?: CandleQuery): Promise<Candle[]>;
  subscribeCandles(symbol: string, tf: Timeframe, on: (c: Candle) => void): Unsubscribe;
  subscribeTrades(symbol: string, on: (t: Tick[]) => void): Unsubscribe;
  /** `onProblem` hears why the book is not syncing (null once it is), so the pane can say so. */
  subscribeBook(symbol: string, on: (b: BookSnapshot) => void, onProblem?: (message: string | null) => void): Unsubscribe;
  subscribeTicker(symbol: string, on: (t: Ticker) => void): Unsubscribe;
  /** The most recent trades, for views that need history before the stream (the footprint). */
  recentTrades?(symbol: string): Promise<Tick[]>;
  /** For venues with their own two-sided price (a prediction market's book): what an order fills against. */
  quote?(symbol: string): import('../engine/types').Quote | undefined;
  status(): FeedStatus;
  onStatus(cb: (s: FeedStatus) => void): Unsubscribe;
}

/** A failed request, with a sentence fit to show in a pane. */
export class FeedError extends Error {
  constructor(
    message: string,
    readonly source: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = 'FeedError';
  }
}
