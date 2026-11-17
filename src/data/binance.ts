import { ManagedSocket } from './socket';
import { onFrame, throttle } from './schedule';
import {
  FeedError,
  type BookSnapshot,
  type Candle,
  type CandleQuery,
  type FeedStatus,
  type Level,
  type Tick,
  type Ticker,
  type Timeframe,
  type Unsubscribe,
  type VenueAdapter,
} from './types';

// Binance spot: the primary venue for crypto charts, tape and fills.
// Verified 17 November 2026 (docs/data-sources.md): REST sends
// Access-Control-Allow-Origin: *, and both hosts answer from a browser.

const REST = ['https://api.binance.com', 'https://data-api.binance.vision'];
const WS = ['wss://stream.binance.com:9443/stream', 'wss://data-stream.binance.vision/stream'];
const BOOK_LEVELS = 1500;

type Handler = (data: any) => void;

let restIndex = 0;

async function rest<T>(path: string): Promise<T> {
  let lastError: unknown;
  for (let i = 0; i < REST.length; i++) {
    const host = REST[(restIndex + i) % REST.length]!;
    try {
      const res = await fetch(host + path);
      if (res.ok) {
        restIndex = (restIndex + i) % REST.length;
        return (await res.json()) as T;
      }
      // 4xx is our request, not the host: the fallback would say the same.
      if (res.status >= 400 && res.status < 500 && res.status !== 451 && res.status !== 403 && res.status !== 429) {
        throw new FeedError(`Binance rejected the request (${res.status}).`, 'binance', res.status);
      }
      lastError = new FeedError(`Binance answered ${res.status}.`, 'binance', res.status);
    } catch (err) {
      if (err instanceof FeedError && err.status && err.status < 500 && ![403, 429, 451].includes(err.status)) throw err;
      lastError = err;
    }
  }
  if (lastError instanceof FeedError) throw lastError;
  throw new FeedError('Could not reach Binance. Check the connection.', 'binance');
}

type Kline = [number, string, string, string, string, string, number, string, number, string, string, string];

function fromKline(k: Kline): Candle {
  return { t: k[0], o: +k[1], h: +k[2], l: +k[3], c: +k[4], v: +k[5], bv: +k[9] };
}

interface DepthEvent {
  U: number;
  u: number;
  b: [string, string][];
  a: [string, string][];
}

/** A local order book kept in step with Binance's diff stream. */
class BookSync {
  private bids = new Map<number, number>();
  private asks = new Map<number, number>();
  private lastId = 0;
  private synced = false;
  private loading = false;
  private buffer: DepthEvent[] = [];
  private dead = false;
  readonly listeners = new Set<(b: BookSnapshot) => void>();
  private emit = throttle(() => this.publish(), 120);

  constructor(private readonly symbol: string) {}

  reset(): void {
    this.synced = false;
    this.buffer = [];
    this.bids.clear();
    this.asks.clear();
  }

  close(): void {
    this.dead = true;
  }

  onDiff(ev: DepthEvent): void {
    if (!this.synced) {
      this.buffer.push(ev);
      if (this.buffer.length > 2_000) this.buffer.shift();
      if (!this.loading) void this.load();
      return;
    }
    if (ev.u <= this.lastId) return;
    if (ev.U > this.lastId + 1) {
      // A gap: the book can no longer be trusted. Start again from a snapshot.
      this.reset();
      this.buffer.push(ev);
      void this.load();
      return;
    }
    this.apply(ev);
    this.emit();
  }

  private apply(ev: DepthEvent): void {
    for (const [p, q] of ev.b) {
      const size = +q;
      if (size === 0) this.bids.delete(+p);
      else this.bids.set(+p, size);
    }
    for (const [p, q] of ev.a) {
      const size = +q;
      if (size === 0) this.asks.delete(+p);
      else this.asks.set(+p, size);
    }
    this.lastId = ev.u;
  }

  private async load(): Promise<void> {
    this.loading = true;
    try {
      for (let tries = 0; tries < 4 && !this.dead; tries++) {
        const snap = await rest<{ lastUpdateId: number; bids: [string, string][]; asks: [string, string][] }>(
          `/api/v3/depth?symbol=${this.symbol}&limit=5000`,
        );
        const first = this.buffer[0];
        // The snapshot must not be older than the first buffered diff, or events are missing between them.
        if (first && first.U > snap.lastUpdateId + 1) {
          await new Promise((r) => setTimeout(r, 400));
          continue;
        }
        this.bids = new Map(snap.bids.map(([p, q]) => [+p, +q]));
        this.asks = new Map(snap.asks.map(([p, q]) => [+p, +q]));
        this.lastId = snap.lastUpdateId;
        for (const ev of this.buffer) if (ev.u > this.lastId) this.apply(ev);
        this.buffer = [];
        this.synced = true;
        this.emit();
        return;
      }
    } catch (err) {
      console.warn(`[flame] Binance book snapshot for ${this.symbol} failed; retrying on the next update`, err);
    } finally {
      this.loading = false;
    }
  }

  private publish(): void {
    if (!this.synced || this.dead) return;
    const bids: Level[] = [...this.bids].sort((a, b) => b[0] - a[0]).slice(0, BOOK_LEVELS);
    const asks: Level[] = [...this.asks].sort((a, b) => a[0] - b[0]).slice(0, BOOK_LEVELS);
    // Diffs for levels the snapshot did not reach can leave a crossed fringe; trim it.
    const bestAsk = asks[0]?.[0];
    const bestBid = bids[0]?.[0];
    if (bestAsk !== undefined && bestBid !== undefined && bestBid >= bestAsk) {
      this.reset();
      void this.load();
      return;
    }
    const snap: BookSnapshot = { bids, asks, t: Date.now() };
    for (const cb of this.listeners) cb(snap);
  }
}

export class BinanceAdapter implements VenueAdapter {
  readonly id = 'binance';
  readonly kind = 'live' as const;
  readonly hasBook = true;

  private streams = new Map<string, Set<Handler>>();
  private books = new Map<string, BookSync>();
  private toSubscribe = new Set<string>();
  private toUnsubscribe = new Set<string>();
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  private idleTimer: ReturnType<typeof setTimeout> | null = null;
  private reqId = 1;

  private socket = new ManagedSocket({
    urls: WS,
    silenceMs: 15_000,
    onOpen: (send) => {
      // A fresh connection knows nothing: resubscribe everything and resync the books.
      this.toSubscribe.clear();
      this.toUnsubscribe.clear();
      for (const book of this.books.values()) book.reset();
      const all = [...this.streams.keys()];
      for (let i = 0; i < all.length; i += 150) {
        send({ method: 'SUBSCRIBE', params: all.slice(i, i + 150), id: this.reqId++ });
      }
    },
    onMessage: (raw) => {
      let msg: { stream?: string; data?: unknown };
      try {
        msg = JSON.parse(raw);
      } catch {
        console.warn('[flame] Binance sent something that is not JSON', raw.slice(0, 120));
        return;
      }
      if (!msg.stream) return; // a reply to SUBSCRIBE
      const handlers = this.streams.get(msg.stream);
      if (handlers) for (const h of handlers) h(msg.data);
    },
  });

  status(): FeedStatus {
    return this.socket.status();
  }

  onStatus(cb: (s: FeedStatus) => void): Unsubscribe {
    return this.socket.onStatus(cb);
  }

  private listen(stream: string, handler: Handler): Unsubscribe {
    let set = this.streams.get(stream);
    if (!set) {
      set = new Set();
      this.streams.set(stream, set);
      this.toUnsubscribe.delete(stream);
      this.toSubscribe.add(stream);
      this.scheduleFlush();
    }
    set.add(handler);
    if (this.idleTimer) {
      clearTimeout(this.idleTimer);
      this.idleTimer = null;
    }
    this.socket.start();
    return () => {
      const cur = this.streams.get(stream);
      if (!cur) return;
      cur.delete(handler);
      if (cur.size === 0) {
        this.streams.delete(stream);
        this.toSubscribe.delete(stream);
        this.toUnsubscribe.add(stream);
        this.scheduleFlush();
        if (this.streams.size === 0 && !this.idleTimer) {
          this.idleTimer = setTimeout(() => {
            this.idleTimer = null;
            if (this.streams.size === 0) this.socket.stop();
          }, 10_000);
        }
      }
    };
  }

  /** Binance allows five control messages a second: batch subscription changes. */
  private scheduleFlush(): void {
    if (this.flushTimer) return;
    this.flushTimer = setTimeout(() => {
      this.flushTimer = null;
      if (!this.socket.open) {
        // Not connected: onOpen subscribes to everything current.
        this.toSubscribe.clear();
        this.toUnsubscribe.clear();
        return;
      }
      if (this.toUnsubscribe.size) this.socket.send({ method: 'UNSUBSCRIBE', params: [...this.toUnsubscribe], id: this.reqId++ });
      if (this.toSubscribe.size) this.socket.send({ method: 'SUBSCRIBE', params: [...this.toSubscribe], id: this.reqId++ });
      this.toSubscribe.clear();
      this.toUnsubscribe.clear();
    }, 250);
  }

  async candles(symbol: string, tf: Timeframe, query: CandleQuery = {}): Promise<Candle[]> {
    const params = new URLSearchParams({ symbol, interval: tf, limit: String(Math.min(1000, query.limit ?? 1000)) });
    if (query.before !== undefined) params.set('endTime', String(query.before - 1));
    if (query.from !== undefined) params.set('startTime', String(query.from));
    const rows = await rest<Kline[]>(`/api/v3/klines?${params}`);
    if (!Array.isArray(rows)) throw new FeedError('Binance sent candles in a shape Flame does not know.', 'binance');
    return rows.map(fromKline);
  }

  subscribeCandles(symbol: string, tf: Timeframe, on: (c: Candle) => void): Unsubscribe {
    return this.listen(`${symbol.toLowerCase()}@kline_${tf}`, (d) => {
      const k = d?.k;
      if (!k) return;
      on({ t: k.t, o: +k.o, h: +k.h, l: +k.l, c: +k.c, v: +k.v, bv: +k.V });
    });
  }

  subscribeTrades(symbol: string, on: (t: Tick[]) => void): Unsubscribe {
    let batch: Tick[] = [];
    const flush = () => {
      if (batch.length === 0) return;
      const out = batch;
      batch = [];
      on(out);
    };
    return this.listen(`${symbol.toLowerCase()}@aggTrade`, (d) => {
      if (!d || d.p === undefined) return;
      // m: the buyer was the maker, so the seller crossed the spread.
      batch.push({ t: d.T, p: +d.p, q: +d.q, side: d.m ? 'sell' : 'buy' });
      onFrame(flush);
    });
  }

  subscribeBook(symbol: string, on: (b: BookSnapshot) => void): Unsubscribe {
    let book = this.books.get(symbol);
    let stop: Unsubscribe | null = null;
    if (!book) {
      book = new BookSync(symbol);
      this.books.set(symbol, book);
      const sync = book;
      stop = this.listen(`${symbol.toLowerCase()}@depth@100ms`, (d) => {
        if (d && typeof d.U === 'number') sync.onDiff(d as DepthEvent);
      });
      (book as BookSync & { stop?: Unsubscribe }).stop = stop;
    }
    book.listeners.add(on);
    const b = book as BookSync & { stop?: Unsubscribe };
    return () => {
      b.listeners.delete(on);
      if (b.listeners.size === 0) {
        b.stop?.();
        b.close();
        this.books.delete(symbol);
      }
    };
  }

  subscribeTicker(symbol: string, on: (t: Ticker) => void): Unsubscribe {
    return this.listen(`${symbol.toLowerCase()}@miniTicker`, (d) => {
      if (!d || d.c === undefined) return;
      const last = +d.c;
      const open = +d.o;
      on({ last, changePct: open > 0 ? ((last - open) / open) * 100 : 0, t: d.E });
    });
  }
}

export interface BinanceMarket {
  symbol: string;
  base: string;
  last: number;
  changePct: number;
  quoteVolume: number;
}

const STABLES = new Set(['USDC', 'FDUSD', 'TUSD', 'USDP', 'DAI', 'BUSD', 'EUR', 'EURI', 'AEUR', 'USD1', 'XUSD', 'USDE', 'BFUSD', 'PAXG', 'WBTC', 'WBETH']);

/** USDT pairs ranked by 24-hour quote volume, without stablecoins, wrapped coins and leveraged tokens. */
export async function binanceTopMarkets(limit = 40): Promise<BinanceMarket[]> {
  const rows = await rest<{ symbol: string; lastPrice: string; openPrice: string; quoteVolume: string }[]>('/api/v3/ticker/24hr?type=MINI');
  return rows
    .filter((r) => r.symbol.endsWith('USDT'))
    .map((r) => {
      const last = +r.lastPrice;
      const open = +r.openPrice;
      return {
        symbol: r.symbol,
        base: r.symbol.slice(0, -4),
        last,
        changePct: open > 0 ? ((last - open) / open) * 100 : 0,
        quoteVolume: +r.quoteVolume,
      };
    })
    .filter((m) => m.last > 0 && !STABLES.has(m.base) && !/(UP|DOWN|BULL|BEAR)$/.test(m.base))
    .sort((a, b) => b.quoteVolume - a.quoteVolume)
    .slice(0, limit);
}
