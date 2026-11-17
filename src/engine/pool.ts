// A liquidity pool, and what trading against it costs. On-chain tokens have no
// order book: the only counterparty is the pool, which holds some of the token
// and some of a quote asset and prices one against the other so that the
// product of the two stays constant. Every trade moves the price against the
// trader, and the bigger the trade is next to the pool, the more it moves.
//
// Flame keeps the quote side in dollars. Pure maths: no network, no clock.

export interface Pool {
  /** The token held by the pool. */
  tokens: number;
  /** The other side, valued in dollars. */
  dollars: number;
  /** The pool's fee as a share of each trade (0.003 = 0.3%). */
  fee: number;
}

/** One order may not be more than this share of the pool's liquidity: a bigger position could not be sold. */
export const POOL_ORDER_CAP = 0.02;

/** Both sides of the pool, in dollars. A constant-product pool holds equal value on each side. */
export const poolLiquidity = (p: Pool): number => 2 * p.dollars;

/** What the pool would quote for an order too small to move it. */
export const poolPrice = (p: Pool): number => (p.tokens > 0 ? p.dollars / p.tokens : 0);

/** A pool known only by its total liquidity and its price: equal value on each side. */
export function poolFrom(liquidityUsd: number, price: number, fee: number): Pool | null {
  if (!(liquidityUsd > 0) || !(price > 0) || !(fee >= 0)) return null;
  return { tokens: liquidityUsd / 2 / price, dollars: liquidityUsd / 2, fee };
}

export interface PoolTrade {
  /** Tokens bought or sold. */
  tokens: number;
  /** Dollars that reach or leave the pool, before the pool fee. */
  dollars: number;
  /** The pool fee, in dollars: on top of what a buyer puts in, out of what a seller gets. */
  fee: number;
  /** Dollars per token for this trade, before the fee. */
  price: number;
  /** How much worse that price is than the pool's price before the trade, as a share. */
  impact: number;
  /** The same in dollars: what the trade costs beyond the price on the screen. */
  impactDollars: number;
}

const none: PoolTrade = { tokens: 0, dollars: 0, fee: 0, price: 0, impact: 0, impactDollars: 0 };

/**
 * Spend `spend` dollars in total (the fee included). With reserves x (token)
 * and y (dollars), putting in Δy takes out x·Δy / (y + Δy) tokens.
 */
export function buyFromPool(p: Pool, spend: number): PoolTrade {
  if (!(spend > 0) || !(p.tokens > 0) || !(p.dollars > 0)) return none;
  const dollars = spend / (1 + p.fee);
  const tokens = (p.tokens * dollars) / (p.dollars + dollars);
  const price = dollars / tokens;
  const spot = poolPrice(p);
  return { tokens, dollars, fee: spend - dollars, price, impact: price / spot - 1, impactDollars: dollars - tokens * spot };
}

/** What buying exactly `tokens` costs: the inverse of buyFromPool. Infinite when the pool does not hold that many. */
export function costToBuy(p: Pool, tokens: number): PoolTrade {
  if (!(tokens > 0) || !(p.tokens > 0) || !(p.dollars > 0)) return none;
  if (tokens >= p.tokens) return { ...none, tokens, dollars: Infinity, price: Infinity, impact: Infinity, impactDollars: Infinity };
  const dollars = (p.dollars * tokens) / (p.tokens - tokens);
  const price = dollars / tokens;
  const spot = poolPrice(p);
  return { tokens, dollars, fee: dollars * p.fee, price, impact: price / spot - 1, impactDollars: dollars - tokens * spot };
}

/** Sell `tokens` into the pool: the mirror. Putting in Δx takes out y·Δx / (x + Δx) dollars, less the fee. */
export function sellToPool(p: Pool, tokens: number): PoolTrade {
  if (!(tokens > 0) || !(p.tokens > 0) || !(p.dollars > 0)) return none;
  const dollars = (p.dollars * tokens) / (p.tokens + tokens);
  const price = dollars / tokens;
  const spot = poolPrice(p);
  return { tokens, dollars, fee: dollars * p.fee, price, impact: 1 - price / spot, impactDollars: tokens * spot - dollars };
}

/** What the whole position would fetch if it were sold into the pool now, after the fee: how a pool position is marked. */
export function exitValue(p: Pool, tokens: number): number {
  const t = sellToPool(p, tokens);
  return t.dollars - t.fee;
}

/** The largest order the pool takes, in dollars. */
export const poolOrderCap = (p: Pool): number => POOL_ORDER_CAP * poolLiquidity(p);

/** A pool with this share, or less, of the liquidity it had when the position was opened counts as drained. */
export const DRAINED_LEFT = 0.1;

export function isDrained(liquidityAtEntry: number, liquidityNow: number): boolean {
  return liquidityAtEntry > 0 && liquidityNow <= liquidityAtEntry * DRAINED_LEFT;
}
