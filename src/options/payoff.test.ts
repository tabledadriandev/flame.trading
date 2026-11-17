import { describe, expect, it } from 'vitest';
import type { OptionSpec } from '../engine/types';
import { chanceAbove } from './bs';
import { chanceOfProfit, payoffAt, payoffAtExpiry, positionGreeks, summarise, type Leg } from './payoff';

const NOW = Date.UTC(2026, 10, 17);
const EXPIRY = NOW + 90 * 86_400_000;
const spec = (kind: 'call' | 'put', strike: number): OptionSpec => ({ underlying: 'stock:AAPL', kind, strike, expiry: EXPIRY, multiplier: 100, venue: 'alpaca' });
const leg = (kind: 'call' | 'put', strike: number, side: 'buy' | 'sell', price: number, iv: number | null = 0.3): Leg => ({ spec: spec(kind, strike), side, qty: 100, price, iv });

describe('payoff at expiry', () => {
  it('a bought call loses the premium below the strike and gains a dollar a share above it', () => {
    const legs = [leg('call', 200, 'buy', 4)];
    expect(payoffAtExpiry(legs, 150)).toBe(-400);
    expect(payoffAtExpiry(legs, 200)).toBe(-400);
    expect(payoffAtExpiry(legs, 204)).toBe(0);
    expect(payoffAtExpiry(legs, 220)).toBe(1600);
    expect(summarise(legs)).toEqual({ maxGain: Infinity, maxLoss: 400, breakevens: [204] });
  });

  it('a bought put gains as the price falls, down to zero', () => {
    const legs = [leg('put', 190, 'buy', 3)];
    expect(summarise(legs)).toEqual({ maxGain: 18_700, maxLoss: 300, breakevens: [187] });
  });

  it('a sold put keeps the premium at best and loses the strike less the premium at worst', () => {
    expect(summarise([leg('put', 190, 'sell', 3)])).toEqual({ maxGain: 300, maxLoss: 18_700, breakevens: [187] });
  });

  it('a sold call has no limit to its loss on its own', () => {
    expect(summarise([leg('call', 210, 'sell', 2)])).toEqual({ maxGain: 200, maxLoss: Infinity, breakevens: [212] });
  });

  it('a vertical spread is capped both ways', () => {
    // Buy the 200 call for 6, sell the 210 call for 2: pay 4 to make at most 6.
    const legs = [leg('call', 200, 'buy', 6), leg('call', 210, 'sell', 2)];
    expect(summarise(legs)).toEqual({ maxGain: 600, maxLoss: 400, breakevens: [204] });
  });

  it('a straddle profits either side and has two breakevens', () => {
    const legs = [leg('call', 200, 'buy', 5), leg('put', 200, 'buy', 4)];
    expect(summarise(legs)).toEqual({ maxGain: Infinity, maxLoss: 900, breakevens: [191, 209] });
  });
});

describe('payoff before expiry', () => {
  it('is worth more than the expiry line while time remains, and meets it at expiry', () => {
    const legs = [leg('call', 200, 'buy', 4)];
    expect(payoffAt(legs, 200, NOW)).toBeGreaterThan(payoffAtExpiry(legs, 200));
    expect(payoffAt(legs, 215, EXPIRY)).toBeCloseTo(payoffAtExpiry(legs, 215), 9);
    // Time decay: the same price is worth less a month on.
    expect(payoffAt(legs, 200, NOW + 30 * 86_400_000)).toBeLessThan(payoffAt(legs, 200, NOW));
  });

  it('falls back to the expiry value when there is no volatility to price with', () => {
    const legs = [leg('call', 200, 'buy', 4, null)];
    expect(payoffAt(legs, 220, NOW)).toBe(payoffAtExpiry(legs, 220));
  });
});

describe('chance of profit', () => {
  it('for a bought call is the chance of finishing above the breakeven', () => {
    const legs = [leg('call', 200, 'buy', 4)];
    expect(chanceOfProfit(legs, 198, NOW)).toBeCloseTo(chanceAbove(198, 204, 90 / 365, 0.3), 9);
  });

  it('for a sold put is the chance of finishing above its breakeven, so the two sides of a trade add to one', () => {
    const sold = chanceOfProfit([leg('put', 190, 'sell', 3)], 198, NOW)!;
    const bought = chanceOfProfit([leg('put', 190, 'buy', 3)], 198, NOW)!;
    expect(sold).toBeCloseTo(chanceAbove(198, 187, 90 / 365, 0.3), 9);
    expect(sold + bought).toBeCloseTo(1, 9);
  });

  it('for a straddle is the chance of finishing outside the two breakevens', () => {
    const legs = [leg('call', 200, 'buy', 5), leg('put', 200, 'buy', 4)];
    const t = 90 / 365;
    expect(chanceOfProfit(legs, 200, NOW)).toBeCloseTo(1 - chanceAbove(200, 191, t, 0.3) + chanceAbove(200, 209, t, 0.3), 9);
  });

  it('is unknown without an implied volatility', () => {
    expect(chanceOfProfit([leg('call', 200, 'buy', 4, null)], 198, NOW)).toBeNull();
  });
});

describe('position greeks', () => {
  it('scale with size and flip for an option that was sold', () => {
    const long = positionGreeks(spec('call', 200), 'long', 100, 200, 0.3, NOW);
    const short = positionGreeks(spec('call', 200), 'short', 200, 200, 0.3, NOW);
    expect(long.delta).toBeGreaterThan(50);
    expect(long.delta).toBeLessThan(60);
    expect(long.theta).toBeLessThan(0);
    expect(short.delta).toBeCloseTo(-2 * long.delta, 9);
    expect(short.theta).toBeCloseTo(-2 * long.theta, 9);
    expect(short.vega).toBeLessThan(0);
  });
});
