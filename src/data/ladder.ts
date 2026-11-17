import type { Level } from './types';

// The merged book: every venue's levels bucketed into rows of one tick, with
// the per-venue split, the largest wall on each side and the imbalance near
// the mid. Pure, so it can be tested and reused by the Flow view.

export interface VenueBook {
  venue: string;
  bids: Level[];
  asks: Level[];
  t: number;
}

export interface LadderRow {
  price: number;
  size: number;
  /** Size per venue id. */
  venues: Record<string, number>;
  /** Running total from the mid outward. */
  cumulative: number;
}

export interface Wall {
  price: number;
  size: number;
  /** Distance from the mid, as a percent. */
  distancePct: number;
  /** The venue holding most of it. */
  venue: string;
}

export interface Ladder {
  mid: number;
  bestBid: number;
  bestAsk: number;
  spread: number;
  tick: number;
  /** Nearest the mid first. */
  bids: LadderRow[];
  asks: LadderRow[];
  bidWall: Wall | null;
  askWall: Wall | null;
  /** Resting size within ±0.5% of the mid, in units and as the bid share (0–1). */
  nearBid: number;
  nearAsk: number;
  bidShare: number;
  /** Largest row size, for scaling bars and shading. */
  max: number;
  venues: string[];
}

export interface LadderOptions {
  tick: number;
  /** Keep levels within this fraction of the mid (0.01 = ±1%). */
  range?: number;
  /** Books older than this are left out. */
  maxAgeMs?: number;
  now?: number;
}

const round = (p: number, tick: number): number => {
  const decimals = Math.max(0, Math.ceil(-Math.log10(tick)) + 2);
  return Number(p.toFixed(decimals));
};

/**
 * Merge venue books into one ladder. The first book is the primary: its mid
 * anchors the ladder. Every other venue is lined up on its own mid first, so
 * a venue that quotes a few dollars higher (a USD pair against a USDT pair,
 * say) adds depth at the right distance instead of crossing the book.
 */
export function buildLadder(books: VenueBook[], opts: LadderOptions): Ladder | null {
  const { tick, range = 0.01, maxAgeMs = 10_000, now = Date.now() } = opts;
  const fresh = books.filter((b) => b.bids.length > 0 && b.asks.length > 0 && now - b.t <= maxAgeMs);
  const primary = fresh[0];
  if (!primary || !(tick > 0)) return null;
  const bestBid = primary.bids[0]![0];
  const bestAsk = primary.asks[0]![0];
  const mid = (bestBid + bestAsk) / 2;
  const lo = mid * (1 - range);
  const hi = mid * (1 + range);

  const bidRows = new Map<number, LadderRow>();
  const askRows = new Map<number, LadderRow>();
  const add = (rows: Map<number, LadderRow>, price: number, size: number, venue: string) => {
    let row = rows.get(price);
    if (!row) {
      row = { price, size: 0, venues: {}, cumulative: 0 };
      rows.set(price, row);
    }
    row.size += size;
    row.venues[venue] = (row.venues[venue] ?? 0) + size;
  };

  for (const b of fresh) {
    const shift = b === primary ? 0 : mid - (b.bids[0]![0] + b.asks[0]![0]) / 2;
    for (const [p, size] of b.bids) {
      const price = p + shift;
      if (price < lo) break;
      // A bid never shows above the best bid: rows are rounded down, away from the mid.
      add(bidRows, round(Math.floor(Math.min(price, bestBid) / tick + 1e-9) * tick, tick), size, b.venue);
    }
    for (const [p, size] of b.asks) {
      const price = p + shift;
      if (price > hi) break;
      add(askRows, round(Math.ceil(Math.max(price, bestAsk) / tick - 1e-9) * tick, tick), size, b.venue);
    }
  }

  const bids = [...bidRows.values()].sort((a, b) => b.price - a.price);
  const asks = [...askRows.values()].sort((a, b) => a.price - b.price);
  let run = 0;
  for (const r of bids) r.cumulative = run += r.size;
  run = 0;
  for (const r of asks) r.cumulative = run += r.size;

  const wall = (rows: LadderRow[]): Wall | null => {
    let best: LadderRow | null = null;
    for (const r of rows) if (!best || r.size > best.size) best = r;
    if (!best) return null;
    const venue = Object.entries(best.venues).sort((a, b) => b[1] - a[1])[0]?.[0] ?? '';
    return { price: best.price, size: best.size, distancePct: (Math.abs(best.price - mid) / mid) * 100, venue };
  };

  const near = (rows: LadderRow[], side: 'bid' | 'ask'): number => {
    let sum = 0;
    for (const r of rows) {
      if (side === 'bid' ? r.price < mid * 0.995 : r.price > mid * 1.005) break;
      sum += r.size;
    }
    return sum;
  };
  const nearBid = near(bids, 'bid');
  const nearAsk = near(asks, 'ask');
  let max = 0;
  for (const r of bids) max = Math.max(max, r.size);
  for (const r of asks) max = Math.max(max, r.size);

  return {
    mid,
    bestBid,
    bestAsk,
    spread: bestAsk - bestBid,
    tick,
    bids,
    asks,
    bidWall: wall(bids),
    askWall: wall(asks),
    nearBid,
    nearAsk,
    bidShare: nearBid + nearAsk > 0 ? nearBid / (nearBid + nearAsk) : 0.5,
    max,
    venues: fresh.map((b) => b.venue),
  };
}

/** A plain read of the imbalance: who is heavier within ±0.5% of the mid. */
export function imbalanceRead(bidShare: number): string {
  if (bidShare >= 0.6) return 'Buyers much heavier';
  if (bidShare >= 0.54) return 'Buyers heavier';
  if (bidShare <= 0.4) return 'Sellers much heavier';
  if (bidShare <= 0.46) return 'Sellers heavier';
  return 'Balanced';
}

/** Row sizes on offer for a price: $1, $5, $10, $20, $50 for BTC, scaled by price for other instruments. */
export function tickChoices(price: number): number[] {
  if (!(price > 0)) return [1];
  const base = 10 ** (Math.floor(Math.log10(price)) - 4);
  return [1, 5, 10, 20, 50].map((m) => Number((m * base).toPrecision(6)));
}

/** Heat step 1–5 for a row, relative to the largest row on screen. Square-root so mid-sized rows still read. */
export function heatStep(size: number, max: number): 1 | 2 | 3 | 4 | 5 {
  if (!(max > 0) || !(size > 0)) return 1;
  const f = Math.sqrt(size / max);
  return (f > 0.8 ? 5 : f > 0.6 ? 4 : f > 0.4 ? 3 : f > 0.2 ? 2 : 1) as 1 | 2 | 3 | 4 | 5;
}
