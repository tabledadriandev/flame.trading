import type { OptionSpec } from '../engine/types';
import { chanceAbove, greeks, intrinsic, type Greeks } from './bs';
import { yearsTo } from './contract';

// What a set of option legs is worth across prices of the underlying: at
// expiry (straight lines with a kink at each strike) and on any day before it
// (Black-Scholes at the implied volatility). All in dollars.

export interface Leg {
  spec: OptionSpec;
  side: 'buy' | 'sell';
  /** Units of the underlying: contracts × multiplier. */
  qty: number;
  /** Premium per unit, in dollars. */
  price: number;
  /** Implied volatility as a decimal; null when the venue gave none. */
  iv: number | null;
  /** The forward price for this expiry over the spot price, when the venue prices off a forward. 1 otherwise. */
  carry?: number;
}

const sign = (leg: Leg): number => (leg.side === 'buy' ? 1 : -1);

/** Profit or loss if the underlying is at `s` when the legs expire. */
export function payoffAtExpiry(legs: Leg[], s: number): number {
  let total = 0;
  for (const leg of legs) total += sign(leg) * (intrinsic(leg.spec.kind, s, leg.spec.strike) - leg.price) * leg.qty;
  return total;
}

/** Profit or loss if the underlying is at `s` at time `at`, before expiry. A leg with no implied volatility counts at its expiry value. */
export function payoffAt(legs: Leg[], s: number, at: number): number {
  let total = 0;
  for (const leg of legs) {
    const t = yearsTo(leg.spec.expiry, at);
    const worth = leg.iv !== null && t > 0 ? greeks({ kind: leg.spec.kind, s: s * (leg.carry ?? 1), k: leg.spec.strike, t, iv: leg.iv }).price : intrinsic(leg.spec.kind, s, leg.spec.strike);
    total += sign(leg) * (worth - leg.price) * leg.qty;
  }
  return total;
}

export interface PayoffSummary {
  /** The most the legs can make at expiry. Infinity when there is no limit. */
  maxGain: number;
  /** The most they can lose, as a positive number. Infinity when there is no limit. */
  maxLoss: number;
  /** Underlying prices at which the legs neither make nor lose at expiry. */
  breakevens: number[];
}

/** The payoff at expiry is straight between strikes, so its extremes and its zero crossings can be read exactly. */
export function summarise(legs: Leg[]): PayoffSummary {
  const strikes = [...new Set(legs.map((l) => l.spec.strike))].sort((a, b) => a - b);
  const top = strikes[strikes.length - 1] ?? 0;
  // Beyond the highest strike only calls still change: the slope there says whether the upside is open.
  const slope = legs.reduce((sum, l) => sum + (l.spec.kind === 'call' ? sign(l) * l.qty : 0), 0);
  const points = [0, ...strikes];
  const values = points.map((s) => payoffAtExpiry(legs, s));
  let best = Math.max(...values);
  let worst = Math.min(...values);
  if (slope > 1e-12) best = Infinity;
  if (slope < -1e-12) worst = -Infinity;

  const breakevens: number[] = [];
  for (let i = 1; i < points.length; i++) {
    const a = values[i - 1]!;
    const b = values[i]!;
    if (a === 0) breakevens.push(points[i - 1]!);
    else if (a * b < 0) breakevens.push(points[i - 1]! + ((points[i]! - points[i - 1]!) * -a) / (b - a));
  }
  const last = values[values.length - 1]!;
  if (last === 0 && points.length > 0) breakevens.push(top);
  else if (Math.abs(slope) > 1e-12 && last * slope < 0) breakevens.push(top - last / slope);
  return { maxGain: best, maxLoss: -worst, breakevens: [...new Set(breakevens.map((b) => Math.round(b * 1e6) / 1e6))] };
}

/**
 * The chance the legs finish in profit: the probability, under the lognormal
 * distribution the implied volatility describes, that the underlying ends in
 * a price range where the payoff at expiry is positive. Null without a
 * volatility to read it from.
 */
export function chanceOfProfit(legs: Leg[], s: number, now: number): number | null {
  const first = legs[0];
  if (!first || first.iv === null) return null;
  const t = yearsTo(first.spec.expiry, now);
  const forward = s * (first.carry ?? 1);
  const { breakevens } = summarise(legs);
  const edges = [0, ...breakevens.filter((b) => b > 0), Infinity];
  let chance = 0;
  for (let i = 1; i < edges.length; i++) {
    const lo = edges[i - 1]!;
    const hi = edges[i]!;
    const probe = hi === Infinity ? Math.max(lo * 2, s * 4, 1) : (lo + hi) / 2;
    if (payoffAtExpiry(legs, probe) <= 0) continue;
    const above = (level: number) => (level === Infinity ? 0 : chanceAbove(forward, level, t, first.iv!));
    chance += above(lo) - above(hi);
  }
  return Math.min(1, Math.max(0, chance));
}

/** A position's greeks in dollars: per-unit greeks times its size, negative for an option that was sold. */
export function positionGreeks(spec: OptionSpec, dir: 'long' | 'short', qty: number, forward: number, iv: number, now: number): Greeks {
  const g = greeks({ kind: spec.kind, s: forward, k: spec.strike, t: yearsTo(spec.expiry, now), iv });
  const k = (dir === 'long' ? 1 : -1) * qty;
  return { price: g.price * k, delta: g.delta * k, gamma: g.gamma * k, theta: g.theta * k, vega: g.vega * k, rho: g.rho * k };
}
