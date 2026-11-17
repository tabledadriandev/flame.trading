import { ManagedSocket } from './socket';
import { throttle } from './schedule';
import type { BookSnapshot, FeedStatus, Level, Unsubscribe } from './types';

// The other venues behind the merged book. Each one only has to deliver an
// order book for a coin; charts, tape and fills come from the primary venue.
// All verified 17 November 2026: see docs/data-sources.md.

export interface BookVenue {
  id: string;
  name: string;
  /** Three or four letters for the venue split in a ladder row. */
  short: string;
  /** Quote currency, for the pane's help text. */
  quote: 'USD' | 'USDT' | 'USDC';
  subscribeBook(base: string, on: (b: BookSnapshot) => void): Unsubscribe;
  status(): FeedStatus;
  onStatus(cb: (s: FeedStatus) => void): Unsubscribe;
}

type Raw = [string | number, string | number];

/** A price → size map per side, published as sorted levels a few times a second. */
class LocalBook {
  bids = new Map<number, number>();
  asks = new Map<number, number>();
  ready = false;
  readonly listeners = new Set<(b: BookSnapshot) => void>();
  private publish = throttle(() => this.emit(), 250);

  constructor(
    private readonly cap: number,
    private readonly onCrossed: () => void,
  ) {}

  clear(): void {
    this.bids.clear();
    this.asks.clear();
    this.ready = false;
  }

  /** Replace the whole book. */
  snapshot(bids: Raw[], asks: Raw[]): void {
    this.bids = new Map(bids.map(([p, q]) => [+p, +q] as [number, number]).filter(([, q]) => q > 0));
    this.asks = new Map(asks.map(([p, q]) => [+p, +q] as [number, number]).filter(([, q]) => q > 0));
    this.ready = true;
    this.publish();
  }

  /** Apply changes; a size of zero removes the level. */
  update(bids: Raw[], asks: Raw[]): void {
    if (!this.ready) return;
    for (const [p, q] of bids) {
      if (+q === 0) this.bids.delete(+p);
      else this.bids.set(+p, +q);
    }
    for (const [p, q] of asks) {
      if (+q === 0) this.asks.delete(+p);
      else this.asks.set(+p, +q);
    }
    this.publish();
  }

  private emit(): void {
    if (!this.ready || this.listeners.size === 0) return;
    const bids: Level[] = [...this.bids].sort((a, b) => b[0] - a[0]);
    const asks: Level[] = [...this.asks].sort((a, b) => a[0] - b[0]);
    // Venues that publish only the top N levels expect the client to drop what falls out of range.
    if (bids.length > this.cap) for (const [p] of bids.splice(this.cap)) this.bids.delete(p);
    if (asks.length > this.cap) for (const [p] of asks.splice(this.cap)) this.asks.delete(p);
    const bb = bids[0]?.[0];
    const ba = asks[0]?.[0];
    if (bb === undefined || ba === undefined) return;
    if (bb >= ba) {
      // A crossed book means an update was missed. Throw it away and ask again.
      this.clear();
      this.onCrossed();
      return;
    }
    const snap: BookSnapshot = { bids, asks, t: Date.now() };
    for (const cb of this.listeners) cb(snap);
  }
}

interface VenueSpec {
  id: string;
  name: string;
  short: string;
  quote: BookVenue['quote'];
  urls: string[];
  /** Levels kept per side. */
  cap: number;
  symbol(base: string): string;
  subscribe(symbol: string): unknown;
  unsubscribe(symbol: string): unknown;
  ping?: { every: number; payload: () => unknown };
  /** Handle one parsed message. Return the symbol to resubscribe when the stream lost its place. */
  handle(msg: any, book: (symbol: string) => LocalBook | undefined, state: Map<string, number>): string | void;
}

function makeVenue(spec: VenueSpec): BookVenue {
  const books = new Map<string, LocalBook>();
  const state = new Map<string, number>();
  let idle: ReturnType<typeof setTimeout> | null = null;

  const resubscribe = (symbol: string) => {
    state.delete(symbol);
    books.get(symbol)?.clear();
    socket.send(spec.unsubscribe(symbol));
    setTimeout(() => {
      if (books.has(symbol)) socket.send(spec.subscribe(symbol));
    }, 500);
  };

  const socket: ManagedSocket = new ManagedSocket({
    urls: spec.urls,
    silenceMs: 30_000,
    ...(spec.ping ? { ping: spec.ping } : {}),
    onOpen: (send) => {
      state.clear();
      for (const [symbol, book] of books) {
        book.clear();
        send(spec.subscribe(symbol));
      }
    },
    onMessage: (raw) => {
      if (raw === 'pong') return;
      let msg: unknown;
      try {
        msg = JSON.parse(raw);
      } catch {
        console.warn(`[flame] ${spec.name} sent something that is not JSON`, raw.slice(0, 80));
        return;
      }
      try {
        const lost = spec.handle(msg, (s) => books.get(s), state);
        if (lost) resubscribe(lost);
      } catch (err) {
        console.warn(`[flame] could not read a ${spec.name} message`, err);
      }
    },
  });

  return {
    id: spec.id,
    name: spec.name,
    short: spec.short,
    quote: spec.quote,
    status: () => socket.status(),
    onStatus: (cb) => socket.onStatus(cb),
    subscribeBook(base, on) {
      const symbol = spec.symbol(base);
      let book = books.get(symbol);
      if (!book) {
        book = new LocalBook(spec.cap, () => resubscribe(symbol));
        books.set(symbol, book);
        if (socket.open) socket.send(spec.subscribe(symbol));
      }
      book.listeners.add(on);
      if (idle) {
        clearTimeout(idle);
        idle = null;
      }
      socket.start();
      const mine = book;
      return () => {
        mine.listeners.delete(on);
        if (mine.listeners.size > 0 || books.get(symbol) !== mine) return;
        books.delete(symbol);
        state.delete(symbol);
        socket.send(spec.unsubscribe(symbol));
        if (books.size === 0 && !idle) {
          idle = setTimeout(() => {
            idle = null;
            if (books.size === 0) socket.stop();
          }, 10_000);
        }
      };
    },
  };
}

const coinbase = makeVenue({
  id: 'coinbase',
  name: 'Coinbase',
  short: 'CB',
  quote: 'USD',
  urls: ['wss://ws-feed.exchange.coinbase.com'],
  cap: 3_000,
  symbol: (b) => `${b}-USD`,
  subscribe: (s) => ({ type: 'subscribe', product_ids: [s], channels: ['level2_batch'] }),
  unsubscribe: (s) => ({ type: 'unsubscribe', product_ids: [s], channels: ['level2_batch'] }),
  handle(m, book) {
    if (m.type === 'snapshot') book(m.product_id)?.snapshot(m.bids, m.asks);
    else if (m.type === 'l2update') {
      const bids: Raw[] = [];
      const asks: Raw[] = [];
      for (const [side, p, q] of m.changes as [string, string, string][]) (side === 'buy' ? bids : asks).push([p, q]);
      book(m.product_id)?.update(bids, asks);
    }
  },
});

const kraken = makeVenue({
  id: 'kraken',
  name: 'Kraken',
  short: 'KR',
  quote: 'USD',
  urls: ['wss://ws.kraken.com/v2'],
  cap: 500,
  symbol: (b) => `${b}/USD`,
  subscribe: (s) => ({ method: 'subscribe', params: { channel: 'book', symbol: [s], depth: 500 } }),
  unsubscribe: (s) => ({ method: 'unsubscribe', params: { channel: 'book', symbol: [s], depth: 500 } }),
  handle(m, book) {
    if (m.channel !== 'book' || !Array.isArray(m.data)) return;
    for (const d of m.data) {
      const bids: Raw[] = (d.bids ?? []).map((l: { price: number; qty: number }) => [l.price, l.qty]);
      const asks: Raw[] = (d.asks ?? []).map((l: { price: number; qty: number }) => [l.price, l.qty]);
      if (m.type === 'snapshot') book(d.symbol)?.snapshot(bids, asks);
      else book(d.symbol)?.update(bids, asks);
    }
  },
});

const bitstamp = makeVenue({
  id: 'bitstamp',
  name: 'Bitstamp',
  short: 'BS',
  quote: 'USD',
  urls: ['wss://ws.bitstamp.net'],
  cap: 100,
  symbol: (b) => `${b.toLowerCase()}usd`,
  subscribe: (s) => ({ event: 'bts:subscribe', data: { channel: `order_book_${s}` } }),
  unsubscribe: (s) => ({ event: 'bts:unsubscribe', data: { channel: `order_book_${s}` } }),
  handle(m, book) {
    // Every message is the full top 100.
    if (m.event === 'data' && typeof m.channel === 'string' && m.channel.startsWith('order_book_')) {
      book(m.channel.slice('order_book_'.length))?.snapshot(m.data.bids, m.data.asks);
    }
  },
});

const okx = makeVenue({
  id: 'okx',
  name: 'OKX',
  short: 'OKX',
  quote: 'USDT',
  urls: ['wss://ws.okx.com/ws/v5/public', 'wss://ws.okx.com:8443/ws/v5/public'],
  cap: 400,
  symbol: (b) => `${b}-USDT`,
  subscribe: (s) => ({ op: 'subscribe', args: [{ channel: 'books', instId: s }] }),
  unsubscribe: (s) => ({ op: 'unsubscribe', args: [{ channel: 'books', instId: s }] }),
  ping: { every: 25_000, payload: () => 'ping' },
  handle(m, book, state) {
    if (m.arg?.channel !== 'books' || !Array.isArray(m.data)) return;
    const symbol: string = m.arg.instId;
    const d = m.data[0];
    if (m.action === 'snapshot') {
      book(symbol)?.snapshot(d.bids, d.asks);
    } else {
      // Each update names the sequence it follows; a mismatch means one was lost.
      const prev = state.get(symbol);
      if (prev !== undefined && d.prevSeqId !== prev) return symbol;
      book(symbol)?.update(d.bids, d.asks);
    }
    state.set(symbol, d.seqId);
  },
});

const bybit = makeVenue({
  id: 'bybit',
  name: 'Bybit',
  short: 'BYB',
  quote: 'USDT',
  urls: ['wss://stream.bybit.com/v5/public/spot'],
  cap: 200,
  symbol: (b) => `${b}USDT`,
  subscribe: (s) => ({ op: 'subscribe', args: [`orderbook.200.${s}`] }),
  unsubscribe: (s) => ({ op: 'unsubscribe', args: [`orderbook.200.${s}`] }),
  ping: { every: 20_000, payload: () => ({ op: 'ping' }) },
  handle(m, book, state) {
    if (typeof m.topic !== 'string' || !m.topic.startsWith('orderbook.') || !m.data) return;
    const symbol: string = m.data.s;
    if (m.type === 'snapshot') {
      book(symbol)?.snapshot(m.data.b, m.data.a);
    } else {
      const prev = state.get(symbol);
      if (prev !== undefined && m.data.u !== prev + 1) return symbol;
      book(symbol)?.update(m.data.b, m.data.a);
    }
    state.set(symbol, m.data.u);
  },
});

const hyperliquid = makeVenue({
  id: 'hyperliquid',
  name: 'Hyperliquid',
  short: 'HL',
  quote: 'USDC',
  urls: ['wss://api.hyperliquid.xyz/ws'],
  cap: 100,
  symbol: (b) => b,
  subscribe: (s) => ({ method: 'subscribe', subscription: { type: 'l2Book', coin: s } }),
  unsubscribe: (s) => ({ method: 'unsubscribe', subscription: { type: 'l2Book', coin: s } }),
  ping: { every: 50_000, payload: () => ({ method: 'ping' }) },
  handle(m, book) {
    // Twenty levels a side, sent whole each time.
    if (m.channel !== 'l2Book' || !m.data?.levels) return;
    const [bids, asks] = m.data.levels as [{ px: string; sz: string }[], { px: string; sz: string }[]];
    book(m.data.coin)?.snapshot(
      bids.map((l) => [l.px, l.sz]),
      asks.map((l) => [l.px, l.sz]),
    );
  },
});

/** The venues merged into the book alongside the primary one, in display order. */
export const BOOK_VENUES: BookVenue[] = [coinbase, kraken, bitstamp, okx, bybit, hyperliquid];

export const VENUE_NAMES: Record<string, { name: string; short: string }> = {
  binance: { name: 'Binance', short: 'BIN' },
  sim: { name: 'Simulated', short: 'SIM' },
  ...Object.fromEntries(BOOK_VENUES.map((v) => [v.id, { name: v.name, short: v.short }])),
};
