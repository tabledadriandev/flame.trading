import { registerRemoteSearch } from './search';
import type { Instrument, InstrumentKind } from './instruments';
import {
  FeedError,
  type BookSnapshot,
  type Candle,
  type CandleQuery,
  type FeedStatus,
  type Ticker,
  type Timeframe,
  type Unsubscribe,
  type VenueAdapter,
} from './types';

// Stocks, ETFs, indices, rates and commodities, through Flame's own /api/quote
// proxy. The browser never talks to the upstream source; whatever that source
// is, this adapter sees the same shape. Prices are delayed and labelled so.

interface ApiQuote {
  symbol: string;
  name: string;
  currency: string;
  exchange: string;
  type: string;
  timezone: string;
  last: number | null;
  prevClose: number | null;
  time: number | null;
  open: boolean;
  session: { start: number; end: number } | null;
  delayMinutes?: number;
}

interface ChartPayload {
  quote: ApiQuote;
  candles: Candle[];
}

interface SparkPayload {
  quotes: ((ApiQuote & { spark: number[] }) | { symbol: string; missing: true })[];
}

async function api<T>(path: string): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, { signal: AbortSignal.timeout(15_000) });
  } catch (err) {
    console.warn(`[flame] ${path} did not answer`, err);
    throw new FeedError('Could not reach Flame\'s quote service. Check the connection.', 'stocks');
  }
  let body: unknown;
  try {
    body = await res.json();
  } catch {
    throw new FeedError('The quote service sent an answer Flame could not read.', 'stocks', res.status);
  }
  if (!res.ok) {
    const message = (body as { message?: string } | null)?.message;
    throw new FeedError(message ?? `The quote service answered ${res.status}.`, 'stocks', res.status);
  }
  return body as T;
}

/** How each chart timeframe is asked for upstream. Four-hour bars are built from hourly ones. */
const PLAN: Record<Timeframe, { interval: string; range: string; group?: number }> = {
  '1m': { interval: '1m', range: '5d' },
  '5m': { interval: '5m', range: '1mo' },
  '15m': { interval: '15m', range: '1mo' },
  '1h': { interval: '60m', range: '6mo' },
  '4h': { interval: '60m', range: '1y', group: 4 },
  '1d': { interval: '1d', range: '5y' },
  '1w': { interval: '1wk', range: '10y' },
};

/** Join every `n` bars of the same exchange day into one. */
export function groupBars(bars: Candle[], n: number): Candle[] {
  const out: Candle[] = [];
  let day = '';
  let count = 0;
  for (const b of bars) {
    const d = new Date(b.t).toDateString();
    const cur = out[out.length - 1];
    if (!cur || d !== day || count >= n) {
      out.push({ ...b });
      day = d;
      count = 1;
    } else {
      cur.h = Math.max(cur.h, b.h);
      cur.l = Math.min(cur.l, b.l);
      cur.c = b.c;
      cur.v += b.v;
      count += 1;
    }
  }
  return out;
}

const POLL = 15_000;
const BATCH = 20;

const meta = new Map<string, ApiQuote>();
/** What the proxy last said about a symbol: name, exchange, whether its session is open. */
export const stockMeta = (symbol: string): ApiQuote | undefined => meta.get(symbol);
const sparks = new Map<string, number[]>();
export const stockSpark = (symbol: string): number[] | undefined => sparks.get(symbol);

class StocksAdapter implements VenueAdapter {
  readonly id = 'stocks';
  readonly kind = 'delayed' as const;
  readonly hasBook = false;

  private state: FeedStatus = 'connecting';
  private problem: string | null = null;
  private statusListeners = new Set<(s: FeedStatus) => void>();
  private tickers = new Map<string, Set<(t: Ticker) => void>>();
  private timer: ReturnType<typeof setInterval> | null = null;
  private failures = 0;
  private nextTry = 0;

  status(): FeedStatus {
    return this.state;
  }

  /** Why quotes are not arriving, in the upstream's own words. */
  lastProblem(): string | null {
    return this.problem;
  }

  onStatus(cb: (s: FeedStatus) => void): Unsubscribe {
    this.statusListeners.add(cb);
    return () => this.statusListeners.delete(cb);
  }

  private setState(s: FeedStatus): void {
    if (s === this.state) return;
    this.state = s;
    for (const cb of this.statusListeners) cb(s);
  }

  async candles(symbol: string, tf: Timeframe, query: CandleQuery = {}): Promise<Candle[]> {
    // The source serves one window per timeframe; there is nothing older to page back to.
    if (query.before !== undefined) return [];
    const plan = PLAN[tf];
    const data = await api<ChartPayload>(`/api/quote/chart?symbol=${encodeURIComponent(symbol)}&range=${plan.range}&interval=${plan.interval}`);
    meta.set(symbol, data.quote);
    let bars = plan.group ? groupBars(data.candles, plan.group) : data.candles;
    if (query.from !== undefined) bars = bars.filter((b) => b.t >= query.from!);
    if (query.limit !== undefined) bars = bars.slice(-query.limit);
    return bars;
  }

  subscribeCandles(symbol: string, tf: Timeframe, on: (c: Candle) => void): Unsubscribe {
    // Delayed data has no stream: ask again every half minute and pass on the bar in progress.
    const timer = setInterval(() => {
      this.candles(symbol, tf, { limit: 2 })
        .then((bars) => {
          for (const b of bars) on(b);
        })
        .catch((err: unknown) => console.warn(`[flame] refreshing ${symbol} bars failed`, err));
    }, 30_000);
    return () => clearInterval(timer);
  }

  subscribeTrades(): Unsubscribe {
    return () => {};
  }

  subscribeBook(_symbol: string, _on: (b: BookSnapshot) => void, onProblem?: (m: string | null) => void): Unsubscribe {
    onProblem?.('Delayed stock quotes come without an order book.');
    return () => {};
  }

  subscribeTicker(symbol: string, on: (t: Ticker) => void): Unsubscribe {
    let set = this.tickers.get(symbol);
    if (!set) {
      set = new Set();
      this.tickers.set(symbol, set);
    }
    set.add(on);
    if (!this.timer) this.timer = setInterval(() => void this.poll(), POLL);
    // Ask soon, so a symbol added to a list shows a price without waiting a full interval.
    setTimeout(() => void this.poll([symbol]), 50);
    return () => {
      const cur = this.tickers.get(symbol);
      if (!cur) return;
      cur.delete(on);
      if (cur.size === 0) this.tickers.delete(symbol);
      if (this.tickers.size === 0 && this.timer) {
        clearInterval(this.timer);
        this.timer = null;
      }
    };
  }

  private async poll(only?: string[]): Promise<void> {
    // While the source is refusing, ask once a minute instead of every poll.
    if (Date.now() < this.nextTry) return;
    const symbols = (only && this.state === 'live' ? only : [...this.tickers.keys()]).filter((s) => this.tickers.has(s));
    if (symbols.length === 0) return;
    for (let i = 0; i < symbols.length; i += BATCH) {
      const batch = symbols.slice(i, i + BATCH);
      try {
        const data = await api<SparkPayload>(`/api/quote/spark?symbols=${batch.map(encodeURIComponent).join(',')}`);
        this.failures = 0;
        this.problem = null;
        this.setState('live');
        const now = Date.now();
        for (const q of data.quotes) {
          if ('missing' in q || q.last === null) continue;
          meta.set(q.symbol, q);
          if (q.spark.length > 1) sparks.set(q.symbol, q.spark);
          const t: Ticker = {
            last: q.last,
            changePct: q.prevClose && q.prevClose > 0 ? ((q.last - q.prevClose) / q.prevClose) * 100 : NaN,
            t: now,
            open: q.open,
          };
          for (const cb of this.tickers.get(q.symbol) ?? []) cb(t);
        }
      } catch (err) {
        this.failures += 1;
        this.nextTry = Date.now() + Math.min(60_000, 5_000 * 2 ** this.failures);
        this.problem = err instanceof FeedError ? err.message : 'Stock quotes could not be loaded.';
        console.warn('[flame] stock quotes failed', err);
        this.setState(this.failures >= 2 ? 'down' : this.state === 'live' ? 'reconnecting' : 'connecting');
        return;
      }
    }
  }
}

export const stocks = new StocksAdapter();

const KINDS: Record<string, InstrumentKind> = { EQUITY: 'stock', ETF: 'etf' };

registerRemoteSearch(async (q) => {
  const data = await api<{ results: { symbol: string; name: string; type: string; exchange: string }[] }>(`/api/quote/search?q=${encodeURIComponent(q)}`);
  return data.results.map((r): Instrument => {
    const kind = KINDS[r.type] ?? 'stock';
    return {
      id: `stock:${r.symbol}`,
      symbol: r.symbol,
      name: r.name === r.symbol ? `${r.symbol} (US-listed)` : r.name,
      kind,
      cls: 'stock',
      tradable: kind === 'stock' || kind === 'etf',
    };
  });
});
