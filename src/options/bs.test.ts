import { describe, expect, it } from 'vitest';
import { chanceAbove, greeks, impliedVol, intrinsic, normCdf, price } from './bs';

describe('normal distribution', () => {
  it('matches the tables', () => {
    expect(normCdf(0)).toBeCloseTo(0.5, 12);
    expect(normCdf(1)).toBeCloseTo(0.8413447461, 9);
    expect(normCdf(1.96)).toBeCloseTo(0.9750021049, 9);
    expect(normCdf(-2.5)).toBeCloseTo(0.0062096653, 9);
    expect(normCdf(0.5) + normCdf(-0.5)).toBeCloseTo(1, 12);
  });
});

describe('Black-Scholes', () => {
  // Hull, "Options, Futures, and Other Derivatives": stock 42, strike 40, 10% rate, 20% volatility, six months.
  it("prices Hull's textbook call and put", () => {
    const base = { s: 42, k: 40, t: 0.5, iv: 0.2, r: 0.1 };
    expect(price({ kind: 'call', ...base })).toBeCloseTo(4.76, 2);
    expect(price({ kind: 'put', ...base })).toBeCloseTo(0.81, 2);
  });

  it('respects put-call parity', () => {
    const base = { s: 105, k: 100, t: 0.75, iv: 0.35, r: 0.03 };
    const c = price({ kind: 'call', ...base });
    const p = price({ kind: 'put', ...base });
    expect(c - p).toBeCloseTo(105 - 100 * Math.exp(-0.03 * 0.75), 9);
  });

  // Hull's greeks example: stock 49, strike 50, 5% rate, 20% volatility, 20 weeks.
  it("gives Hull's greeks", () => {
    const g = greeks({ kind: 'call', s: 49, k: 50, t: 0.3846, iv: 0.2, r: 0.05 });
    expect(g.delta).toBeCloseTo(0.522, 3);
    expect(g.gamma).toBeCloseTo(0.066, 3);
    expect(g.theta * 365).toBeCloseTo(-4.31, 2);
    expect(g.vega * 100).toBeCloseTo(12.1, 1);
    expect(g.rho * 100).toBeCloseTo(8.91, 2);
  });

  // A real contract: Deribit's own ticker for BTC-25JUN27-88000-C on 17 November 2026.
  // Forward 67,161.08, mark IV 40.12%; Deribit reported delta 0.23809, theta -14.72653, vega 161.28518.
  it("reproduces Deribit's greeks for a live contract", () => {
    const t = (Date.UTC(2027, 5, 25, 8) - 1794926825974) / (365 * 86_400_000);
    const g = greeks({ kind: 'call', s: 67161.08, k: 88000, t, iv: 0.4012 });
    expect(g.delta).toBeCloseTo(0.23809, 3);
    expect(g.theta).toBeCloseTo(-14.72653, 1);
    expect(g.vega).toBeCloseTo(161.28518, 0);
    // Deribit quotes the price in coin: its mark was 0.0376 BTC.
    expect(g.price / 67161.08).toBeCloseTo(0.0376, 3);
  });

  it('is the intrinsic value at expiry', () => {
    expect(greeks({ kind: 'call', s: 110, k: 100, t: 0, iv: 0.3 })).toMatchObject({ price: 10, delta: 1, theta: 0 });
    expect(greeks({ kind: 'put', s: 110, k: 100, t: 0, iv: 0.3 })).toMatchObject({ price: 0, delta: 0 });
    expect(intrinsic('put', 90, 100)).toBe(10);
    expect(intrinsic('call', 90, 100)).toBe(0);
  });

  it('long options lose value as time passes and gain with volatility', () => {
    const g = greeks({ kind: 'put', s: 100, k: 95, t: 0.25, iv: 0.5 });
    expect(g.theta).toBeLessThan(0);
    expect(g.vega).toBeGreaterThan(0);
    expect(g.delta).toBeLessThan(0);
    expect(g.delta).toBeGreaterThan(-1);
  });
});

describe('implied volatility', () => {
  it('recovers the volatility that made the price', () => {
    for (const iv of [0.08, 0.2, 0.6, 1.5]) {
      for (const kind of ['call', 'put'] as const) {
        const p = price({ kind, s: 100, k: 110, t: 0.4, iv, r: 0.02 });
        expect(impliedVol(kind, 100, 110, 0.4, p, 0.02)).toBeCloseTo(iv, 6);
      }
    }
  });

  it('says so when no volatility explains the price', () => {
    expect(impliedVol('call', 100, 80, 0.5, 15)).toBeNull(); // below intrinsic
    expect(impliedVol('call', 100, 80, 0.5, 150)).toBeNull(); // more than the stock
    expect(impliedVol('call', 100, 80, 0, 25)).toBeNull();
  });
});

describe('chance of finishing above a level', () => {
  it('is a half, less the volatility drag, at the money', () => {
    const p = chanceAbove(100, 100, 1, 0.2);
    expect(p).toBeCloseTo(normCdf(-0.1), 9);
    expect(chanceAbove(100, 150, 1, 0.2)).toBeLessThan(0.05);
    expect(chanceAbove(100, 50, 1, 0.2)).toBeGreaterThan(0.99);
  });

  it('is certain once time has run out', () => {
    expect(chanceAbove(100, 90, 0, 0.2)).toBe(1);
    expect(chanceAbove(100, 110, 0, 0.2)).toBe(0);
  });
});
