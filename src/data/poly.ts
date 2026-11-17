import type { Quote } from '../engine/types';
import {
  FeedError,
  type BookSnapshot,
  type Candle,
  type FeedStatus,
  type Ticker,
  type Unsubscribe,
  type VenueAdapter,
} from './types';

// Prediction markets (Polymarket), through Flame's /api/odds proxy. An
// instrument is one outcome of one market: `poly:<token id>`. A share pays $1
// if the outcome happens and $0 if not, so its price is the probability.

export interface OddsOutcome {
  name: string;
  price: number;
  token: string;
}

export interface OddsMarket {
  id: string;
  question: string;
  label: string | null;
  outcomes: OddsOutcome[];
  bestBid: number | null;
  bestAsk: number | null;
  weekChange: number | null;
  dayChange: number | null;
  volume24h: number;
  endDate: string | null;
  closed: boolean;
  resolved: boolean;
}

export interface OddsEvent {
  id: string;
  slug: string;
  title: string;
  endDate: string | null;
  volume24h: number;
  volume: number;
  topics: string[];
  markets: OddsMarket[];
  marketCount: number;
}

export interface OddsDetail {
  market: OddsMarket;
  outcome: string;
  book: { bids: { price: number; size: number }[]; asks: { price: number; size: number }[] };
  history: { t: number; p: number }[];
}

async function api<T>(path: string): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, { signal: AbortSignal.timeout(15_000) });
  } catch (err) {
    console.warn(`[flame] ${path} did not answer`, err);
    throw new FeedError('Could not reach Flame\'s prediction-market service. Check the connection.', 'poly');
  }
  let body: unknown;
  try {
    body = await res.json();
  } catch {
    throw new FeedError('The prediction-market service sent an answer Flame could not read.', 'poly', res.status);
  }
  if (!res.ok) throw new FeedError((body as { message?: string } | null)?.message ?? `The prediction-market service answered ${res.status}.`, 'poly', res.status);
  return body as T;
}

export const TOPICS: { id: string; label: string }[] = [
  { id: 'trending', label: 'Trending' },
  { id: 'economy', label: 'Economy' },
  { id: 'fed', label: 'Fed' },
  { id: 'stocks', label: 'Stocks' },
  { id: 'earnings', label: 'Earnings' },
  { id: 'crypto', label: 'Crypto' },
  { id: 'tech', label: 'Tech' },
  { id: 'finance', label: 'Finance' },
  { id: 'politics', label: 'Politics' },
  { id: 'world', label: 'World' },
  { id: 'sports', label: 'Sports' },
];

export const fetchEvents = (topic: string): Promise<OddsEvent[]> => api<{ events: OddsEvent[] }>(`/api/odds/events?topic=${encodeURIComponent(topic)}`).then((d) => d.events);

const details = new Map<string, { at: number; detail: OddsDetail }>();

export async function fetchMarket(token: string, history = false): Promise<OddsDetail> {
  const detail = await api<OddsDetail>(`/api/odds/market?token=${encodeURIComponent(token)}${history ? '&history=1' : ''}`);
  details.set(token, { at: Date.now(), detail });
  for (const cb of watchers) cb(token, detail);
  return detail;
}

type Watcher = (token: string, d: OddsDetail) => void;
const watchers = new Set<Watcher>();
/** Hear every market answer as it arrives: the account uses this to settle resolved markets. */
export function onMarket(cb: Watcher): Unsubscribe {
  watchers.add(cb);
  return () => watchers.delete(cb);
}

/** The price a paper order fills against: the outcome's own book, bought at the ask and sold at the bid. */
export function polyQuote(token: string): Quote | undefined {
  const hit = details.get(token);
  if (!hit || Date.now() - hit.at > 90_000) return undefined;
  const { book, market } = hit.detail;
  if (market.closed) return undefined;
  const bid = book.bids[0]?.price;
  const ask = book.asks[0]?.price;
  if (bid === undefined || ask === undefined) return undefined;
  return {
    bid,
    ask,
    last: (bid + ask) / 2,
    t: Date.now(),
    book: { bids: book.bids.map((l) => [l.price, l.size] as const), asks: book.asks.map((l) => [l.price, l.size] as const) },
  };
}

const POLL = 30_000;

class PolyAdapter implements VenueAdapter {
  readonly id = 'poly';
  readonly kind = 'delayed' as const;
  readonly hasBook = false;
  private state: FeedStatus = 'connecting';
  private listeners = new Set<(s: FeedStatus) => void>();

  status(): FeedStatus {
    return this.state;
  }

  onStatus(cb: (s: FeedStatus) => void): Unsubscribe {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  private setState(s: FeedStatus): void {
    if (s === this.state) return;
    this.state = s;
    for (const cb of this.listeners) cb(s);
  }

  quote(symbol: string): Quote | undefined {
    return polyQuote(symbol);
  }

  /** The week of hourly probabilities, as flat bars, so an outcome can be charted like anything else. */
  async candles(symbol: string): Promise<Candle[]> {
    const d = await fetchMarket(symbol, true);
    return d.history.map((p) => ({ t: p.t, o: p.p, h: p.p, l: p.p, c: p.p, v: 0 }));
  }

  subscribeCandles(): Unsubscribe {
    return () => {};
  }

  subscribeTrades(): Unsubscribe {
    return () => {};
  }

  subscribeBook(_s: string, _on: (b: BookSnapshot) => void, onProblem?: (m: string | null) => void): Unsubscribe {
    onProblem?.('Open the market in Odds to see its order book.');
    return () => {};
  }

  subscribeTicker(symbol: string, on: (t: Ticker) => void): Unsubscribe {
    let failures = 0;
    const poll = () =>
      fetchMarket(symbol)
        .then((d) => {
          failures = 0;
          this.setState('live');
          const bid = d.book.bids[0]?.price;
          const ask = d.book.asks[0]?.price;
          const own = d.market.outcomes.find((o) => o.token === symbol);
          const last = bid !== undefined && ask !== undefined ? (bid + ask) / 2 : own?.price;
          if (last !== undefined) on({ last, changePct: NaN, t: Date.now() });
        })
        .catch((err: unknown) => {
          failures += 1;
          console.warn(`[flame] prediction market ${symbol.slice(0, 8)}… could not be refreshed`, err);
          this.setState(failures >= 2 ? 'down' : 'reconnecting');
        });
    void poll();
    const timer = setInterval(() => void poll(), POLL);
    return () => clearInterval(timer);
  }
}

export const poly = new PolyAdapter();
