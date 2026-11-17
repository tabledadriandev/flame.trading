import { onFrame } from './schedule';
import {
  tfMs,
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

// A simulated feed for offline demos and screenshots, switched on with ?sim=1.
// Hard rule 5: it is never a silent fallback, and every pane that shows its
// numbers says "Simulated".
//
// Price is a fixed function of time (a sum of slow waves plus hashed noise),
// so candles on every timeframe, the tape and the book all agree with each
// other and a reload shows the same history.

function hash(n: number): number {
  let x = Math.imul(n ^ 0x9e3779b9, 0x85ebca6b);
  x ^= x >>> 13;
  x = Math.imul(x, 0xc2b2ae35);
  x ^= x >>> 16;
  return (x >>> 0) / 4294967296;
}

function seedOf(symbol: string): number {
  let h = 2166136261;
  for (let i = 0; i < symbol.length; i++) h = Math.imul(h ^ symbol.charCodeAt(i), 16777619);
  return h >>> 0;
}

const BASES: Record<string, number> = {
  BTC: 64_000, ETH: 1_800, SOL: 142, BNB: 610, XRP: 0.62, DOGE: 0.14, ADA: 0.45, AVAX: 28, LINK: 14.5,
  SPY: 590, QQQ: 510, AAPL: 228, NVDA: 141, MSFT: 430, TSLA: 340,
};

function base(symbol: string): number {
  const known = BASES[symbol.toUpperCase()];
  if (known) return known;
  return Math.round(10 + hash(seedOf(symbol)) * 400);
}

/** Smooth noise: hashed values at integer steps, eased between. */
function noise(seed: number, x: number): number {
  const i = Math.floor(x);
  const f = x - i;
  const a = hash(seed + i * 7919);
  const b = hash(seed + (i + 1) * 7919);
  const u = f * f * (3 - 2 * f);
  return a + (b - a) * u - 0.5;
}

export function simPrice(symbol: string, t: number): number {
  const seed = seedOf(symbol);
  const day = t / 86_400_000;
  const drift =
    0.22 * noise(seed, day / 90) +
    0.12 * noise(seed + 1, day / 14) +
    0.05 * noise(seed + 2, day / 2) +
    0.022 * noise(seed + 3, day * 6) +
    0.008 * noise(seed + 4, day * 96) +
    0.0025 * noise(seed + 5, day * 1440) +
    0.0008 * noise(seed + 6, day * 17_280);
  return base(symbol) * Math.exp(drift);
}

function simCandle(symbol: string, t: number, ms: number): Candle {
  const steps = 12;
  let h = -Infinity;
  let l = Infinity;
  for (let i = 0; i <= steps; i++) {
    const p = simPrice(symbol, t + (ms * i) / steps);
    if (p > h) h = p;
    if (p < l) l = p;
  }
  const o = simPrice(symbol, t);
  const c = simPrice(symbol, t + ms);
  const seed = seedOf(symbol);
  const v = (40 + 400 * hash(seed + Math.floor(t / ms))) * (ms / 60_000) * (1 + (h - l) / o * 80) * (1_000 / base(symbol));
  const bv = v * (0.5 + Math.max(-0.4, Math.min(0.4, ((c - o) / o) * 60)));
  return { t, o, h, l, c, v, bv };
}

export class SimAdapter implements VenueAdapter {
  readonly id = 'sim';
  readonly kind = 'simulated' as const;
  readonly hasBook = true;

  status(): FeedStatus {
    return 'live';
  }

  onStatus(): Unsubscribe {
    return () => {};
  }

  async candles(symbol: string, tf: Timeframe, query: CandleQuery = {}): Promise<Candle[]> {
    const ms = tfMs(tf);
    const limit = Math.min(1000, query.limit ?? 1000);
    const now = Date.now();
    const lastOpen = Math.floor(now / ms) * ms;
    let end = query.before !== undefined ? Math.floor((query.before - 1) / ms) * ms : lastOpen;
    let start = end - (limit - 1) * ms;
    if (query.from !== undefined) {
      start = Math.ceil(query.from / ms) * ms;
      end = Math.min(lastOpen, start + (limit - 1) * ms);
    }
    const out: Candle[] = [];
    for (let t = start; t <= end; t += ms) {
      const c = simCandle(symbol, t, ms);
      if (t === lastOpen) {
        // The bar in progress only knows the price so far.
        const live = simPrice(symbol, now);
        c.c = live;
        c.h = Math.max(c.o, live, ...[0.25, 0.5, 0.75].map((f) => simPrice(symbol, t + (now - t) * f)));
        c.l = Math.min(c.o, live, ...[0.25, 0.5, 0.75].map((f) => simPrice(symbol, t + (now - t) * f)));
        c.v *= (now - t) / ms;
        if (c.bv !== undefined) c.bv *= (now - t) / ms;
      }
      out.push(c);
    }
    return out;
  }

  subscribeCandles(symbol: string, tf: Timeframe, on: (c: Candle) => void): Unsubscribe {
    const ms = tfMs(tf);
    let stopped = false;
    const timer = setInterval(() => {
      void this.candles(symbol, tf, { limit: 1 }).then((cs) => {
        const c = cs[0];
        if (c && !stopped) on(c);
      });
    }, Math.min(1_000, ms));
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }

  subscribeTrades(symbol: string, on: (t: Tick[]) => void): Unsubscribe {
    let batch: Tick[] = [];
    let prev = simPrice(symbol, Date.now());
    const flush = () => {
      const out = batch;
      batch = [];
      if (out.length) on(out);
    };
    const timer = setInterval(() => {
      const now = Date.now();
      const p = simPrice(symbol, now);
      const n = 1 + Math.floor(Math.random() * 3);
      for (let i = 0; i < n; i++) {
        const big = Math.random() < 0.04;
        const q = ((big ? 4 + Math.random() * 12 : Math.random() * Math.random() * 1.2) * 1_000) / base(symbol) / 15;
        batch.push({ t: now, p: round(p, symbol), q, side: p >= prev ? (Math.random() < 0.7 ? 'buy' : 'sell') : Math.random() < 0.7 ? 'sell' : 'buy' });
      }
      prev = p;
      onFrame(flush);
    }, 220);
    return () => clearInterval(timer);
  }

  subscribeBook(symbol: string, on: (b: BookSnapshot) => void): Unsubscribe {
    const seed = seedOf(symbol);
    const emit = () => {
      const now = Date.now();
      const mid = simPrice(symbol, now);
      const tick = tickOf(mid);
      const spread = tick;
      const bids: Level[] = [];
      const asks: Level[] = [];
      const slow = Math.floor(now / 4_000);
      for (let i = 0; i < 600; i++) {
        const bp = Math.floor((mid - spread / 2) / tick) * tick - i * tick;
        const ap = Math.ceil((mid + spread / 2) / tick) * tick + i * tick;
        const size = (level: number, salt: number) => {
          const wall = hash(seed + Math.round(level / tick) * 31 + salt) > 0.985 ? 14 : 1;
          return ((0.05 + hash(seed + Math.round(level / tick) + slow * 13 + salt) * 0.9) * wall * 1_500) / mid;
        };
        bids.push([bp, size(bp, 1)]);
        asks.push([ap, size(ap, 2)]);
      }
      on({ bids, asks, t: now });
    };
    emit();
    const timer = setInterval(emit, 250);
    return () => clearInterval(timer);
  }

  subscribeTicker(symbol: string, on: (t: Ticker) => void): Unsubscribe {
    const emit = () => {
      const now = Date.now();
      const last = simPrice(symbol, now);
      const ago = simPrice(symbol, now - 86_400_000);
      on({ last: round(last, symbol), changePct: ((last - ago) / ago) * 100, t: now });
    };
    emit();
    const timer = setInterval(emit, 1_000);
    return () => clearInterval(timer);
  }
}

function tickOf(price: number): number {
  if (price >= 10_000) return 1;
  if (price >= 1_000) return 0.1;
  if (price >= 10) return 0.01;
  if (price >= 1) return 0.001;
  return 0.0001;
}

function round(p: number, symbol: string): number {
  const tick = tickOf(base(symbol)) / 10;
  return Math.round(p / tick) * tick;
}
