import { describe, expect, it } from 'vitest';
import { POOL_ORDER_CAP, buyFromPool, costToBuy, exitValue, isDrained, poolFrom, poolLiquidity, poolOrderCap, poolPrice, sellToPool, type Pool } from './pool';

// A pool with 1,000,000 tokens against $50,000: five cents a token, $100,000 of liquidity, a 0.3% fee.
const POOL: Pool = { tokens: 1_000_000, dollars: 50_000, fee: 0.003 };

describe('a constant-product pool', () => {
  it('prices the token as dollars over tokens, and counts both sides as liquidity', () => {
    expect(poolPrice(POOL)).toBeCloseTo(0.05, 12);
    expect(poolLiquidity(POOL)).toBe(100_000);
    expect(poolFrom(100_000, 0.05, 0.003)).toEqual(POOL);
    expect(poolFrom(0, 0.05, 0.003)).toBeNull();
  });

  it('a buy takes out x·Δy / (y + Δy) tokens, with the fee on top', () => {
    const t = buyFromPool({ ...POOL, fee: 0 }, 1_000);
    expect(t.tokens).toBeCloseTo((1_000_000 * 1_000) / 51_000, 6);
    expect(t.fee).toBe(0);
    // With a fee, less of the $1,000 reaches the pool.
    const f = buyFromPool(POOL, 1_000);
    expect(f.dollars + f.fee).toBeCloseTo(1_000, 9);
    expect(f.fee).toBeCloseTo(1_000 - 1_000 / 1.003, 9);
    expect(f.tokens).toBeLessThan(t.tokens);
  });

  it('the product of the reserves is unchanged by a trade with no fee', () => {
    const p = { ...POOL, fee: 0 };
    const t = buyFromPool(p, 2_500);
    expect((p.tokens - t.tokens) * (p.dollars + t.dollars)).toBeCloseTo(p.tokens * p.dollars, 3);
    const s = sellToPool(p, 80_000);
    expect((p.tokens + s.tokens) * (p.dollars - s.dollars)).toBeCloseTo(p.tokens * p.dollars, 3);
  });

  it('shows the price impact before the order, in percent and in dollars', () => {
    const t = buyFromPool({ ...POOL, fee: 0 }, 1_000);
    // $1,000 into a $50,000 side moves the average price 2%: Δy / y.
    expect(t.impact).toBeCloseTo(0.02, 9);
    expect(t.price).toBeCloseTo(0.051, 9);
    // The tokens received would have cost $980.39 at the price on the screen.
    expect(t.impactDollars).toBeCloseTo(1_000 - t.tokens * 0.05, 9);
    expect(t.impactDollars).toBeCloseTo(19.6078, 3);
  });

  it('impact grows with the size of the order next to the pool', () => {
    const small = buyFromPool(POOL, 100).impact;
    const big = buyFromPool(POOL, 2_000).impact;
    expect(big).toBeGreaterThan(small * 15);
    // The same $100 hurts a hundred times more in a pool a hundredth the size.
    const thin = buyFromPool({ tokens: 10_000, dollars: 500, fee: 0.003 }, 100).impact;
    expect(thin).toBeGreaterThan(small * 90);
  });

  it('selling is the mirror: Δx tokens take out y·Δx / (x + Δx) dollars, less the fee', () => {
    const s = sellToPool(POOL, 20_000);
    expect(s.dollars).toBeCloseTo((50_000 * 20_000) / 1_020_000, 6);
    expect(s.fee).toBeCloseTo(s.dollars * 0.003, 9);
    expect(s.price).toBeLessThan(0.05);
    expect(s.impact).toBeCloseTo(1 - 1_000_000 / 1_020_000, 9);
  });

  it('buying and at once selling loses the impact both ways and two fees', () => {
    const b = buyFromPool(POOL, 1_000);
    const after: Pool = { tokens: POOL.tokens - b.tokens, dollars: POOL.dollars + b.dollars, fee: POOL.fee };
    expect(exitValue(after, b.tokens)).toBeCloseTo(b.dollars * (1 - 0.003), 6);
    // Against the untouched pool (other people's paper trades do not move it), the round trip costs about 4% plus fees.
    expect(exitValue(POOL, b.tokens)).toBeLessThan(1_000 * 0.96);
  });

  it('costToBuy is the inverse of buyFromPool', () => {
    const b = buyFromPool(POOL, 750);
    const c = costToBuy(POOL, b.tokens);
    expect(c.dollars).toBeCloseTo(b.dollars, 6);
    expect(c.price).toBeCloseTo(b.price, 12);
    expect(costToBuy(POOL, 1_000_000).dollars).toBe(Infinity);
  });

  it('caps one order at 2% of the liquidity', () => {
    expect(POOL_ORDER_CAP).toBe(0.02);
    expect(poolOrderCap(POOL)).toBe(2_000);
  });
});

describe('marking a position', () => {
  it('is what the pool would pay for all of it now, not the last price times the size', () => {
    const tokens = 100_000;
    expect(exitValue(POOL, tokens)).toBeLessThan(tokens * poolPrice(POOL));
    expect(exitValue(POOL, tokens)).toBeCloseTo(((50_000 * 100_000) / 1_100_000) * 0.997, 6);
  });

  it('a drained pool marks the position near zero', () => {
    const drained: Pool = { tokens: 1_000_000, dollars: 40, fee: 0.003 };
    // Still "priced" at $0.00004 a token, but 100,000 tokens fetch under $4.
    expect(exitValue(drained, 100_000)).toBeLessThan(4);
    expect(exitValue({ tokens: 0, dollars: 0, fee: 0.003 }, 100_000)).toBe(0);
  });

  it('calls a pool drained when nine tenths of its liquidity has gone', () => {
    expect(isDrained(100_000, 9_000)).toBe(true);
    expect(isDrained(100_000, 10_000)).toBe(true);
    expect(isDrained(100_000, 30_000)).toBe(false);
    expect(isDrained(0, 0)).toBe(false);
  });
});
