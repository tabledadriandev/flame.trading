import type { AssetClass, Dir, EngineSettings, Levels, Position, Quote, Side } from './types';

// The numbers a venue would publish in its rulebook. See "Paper-trading rules"
// in docs/product-spec.md; every rule here has a test in engine.test.ts.

export const START_CASH = 100_000;
/** With no book to walk, a market order pays one basis point against you. */
export const NO_BOOK_SLIPPAGE = 0.0001;
const EPS = 1e-9;

export interface ClassRules {
  taker: number;
  maker: number;
  /** Maintenance margin rate as a share of notional. */
  mmr: number;
  maxLeverage: number;
}

export function rulesFor(cls: AssetClass, s: EngineSettings): ClassRules {
  if (cls === 'crypto') return { taker: s.fees.cryptoTaker, maker: s.fees.cryptoMaker, mmr: 0.005, maxLeverage: 20 };
  if (cls === 'stock') return { taker: s.fees.stock, maker: s.fees.stock, mmr: 0.25, maxLeverage: 2 };
  return { taker: s.fees.odds, maker: s.fees.odds, mmr: 0, maxLeverage: 1 };
}

/** Long: entry × (1 − 1/leverage + mmr). Short: entry × (1 + 1/leverage − mmr). */
export function liquidationPrice(dir: Dir, entry: number, leverage: number, mmr: number): number {
  const p = dir === 'long' ? entry * (1 - 1 / leverage + mmr) : entry * (1 + 1 / leverage - mmr);
  return Math.max(0, p);
}

/** A position's leverage is its notional at entry over the margin it holds. */
export function effectiveLeverage(p: Position): number {
  return p.margin > 0 ? (p.entry * p.qty) / p.margin : 1;
}

export function positionLiquidationPrice(p: Position, mmr: number): number | null {
  if (p.mode !== 'lev') return null;
  return liquidationPrice(p.dir, p.entry, effectiveLeverage(p), mmr);
}

export function unrealised(p: Position, mark: number): number {
  return (mark - p.entry) * p.qty * (p.dir === 'long' ? 1 : -1);
}

export interface Walk {
  filled: number;
  cost: number;
  avg: number;
  worst: number;
}

/** Take size from the book level by level. `limit` stops the walk at a price. */
export function walkBook(levels: Levels, qty: number, side: Side, limit?: number): Walk {
  let filled = 0;
  let cost = 0;
  let worst = 0;
  for (const [price, size] of levels) {
    if (filled >= qty - EPS) break;
    if (limit !== undefined && (side === 'buy' ? price > limit : price < limit)) break;
    if (!(size > 0)) continue;
    const take = Math.min(size, qty - filled);
    filled += take;
    cost += take * price;
    worst = price;
  }
  return { filled, cost, avg: filled > 0 ? cost / filled : 0, worst };
}

export interface MarketFill {
  qty: number;
  price: number;
}

/**
 * Price a market order. With a book: the volume-weighted price of walking it;
 * if the order is larger than the visible book, the rest fills at the last
 * level reached. Without one: last price, one basis point against you.
 * With `limit`, only the size available at the limit or better is returned.
 */
export function marketFill(q: Quote, side: Side, qty: number, limit?: number): MarketFill {
  const levels = q.book ? (side === 'buy' ? q.book.asks : q.book.bids) : undefined;
  if (levels && levels.length > 0) {
    const w = walkBook(levels, qty, side, limit);
    if (limit !== undefined) return { qty: w.filled, price: w.avg };
    if (w.filled <= 0) return noBookFill(q, side, qty);
    const rest = qty - w.filled;
    return { qty, price: (w.cost + rest * w.worst) / qty };
  }
  if (limit !== undefined) {
    const touch = side === 'buy' ? q.ask : q.bid;
    const ok = side === 'buy' ? touch <= limit : touch >= limit;
    return ok ? { qty, price: touch } : { qty: 0, price: 0 };
  }
  return noBookFill(q, side, qty);
}

function noBookFill(q: Quote, side: Side, qty: number): MarketFill {
  return { qty, price: q.last * (side === 'buy' ? 1 + NO_BOOK_SLIPPAGE : 1 - NO_BOOK_SLIPPAGE) };
}

/** The size at which hitting `stop` from `entry` loses exactly `risk` dollars. */
export function sizeByRisk(risk: number, entry: number, stop: number): number {
  const perUnit = Math.abs(entry - stop);
  return perUnit > 0 && risk > 0 ? risk / perUnit : 0;
}

/** Distance to a target in multiples of the distance to the stop. */
export function rMultiple(entry: number, stop: number, target: number): number | null {
  const risk = Math.abs(entry - stop);
  if (!(risk > 0)) return null;
  const dir = entry > stop ? 1 : -1;
  return ((target - entry) * dir) / risk;
}

/**
 * The order price is assumed to visit inside one bar: open, low, high, close
 * for an up bar; open, high, low, close for a down bar. Used by replay and by
 * the catch-up after Flame was closed, so stops and targets trigger in a
 * defensible order.
 */
export function barPath(c: { o: number; h: number; l: number; c: number }): number[] {
  return c.c >= c.o ? [c.o, c.l, c.h, c.c] : [c.o, c.h, c.l, c.c];
}
