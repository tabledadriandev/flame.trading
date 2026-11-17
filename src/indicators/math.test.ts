import { describe, expect, it } from 'vitest';
import type { Candle } from '../data/types';
import { anchoredVwap, atr, bollinger, cumulativeDelta, donchian, ema, macd, previousDay, rsi, sessionVwap, sma, volumeProfile } from './math';

const bar = (t: number, o: number, h: number, l: number, c: number, v = 1, bv?: number): Candle => ({ t, o, h, l, c, v, ...(bv !== undefined ? { bv } : {}) });

describe('moving averages', () => {
  it('SMA averages the last n values', () => {
    expect(sma([1, 2, 3, 4, 5], 3)).toEqual([null, null, 2, 3, 4]);
  });

  it('EMA is seeded with the SMA and weights 2 / (n + 1)', () => {
    // Seed = (1+2+3)/3 = 2; k = 0.5; then 4*0.5 + 2*0.5 = 3; 5*0.5 + 3*0.5 = 4.
    expect(ema([1, 2, 3, 4, 5], 3)).toEqual([null, null, 2, 3, 4]);
    // The classic 10-period example: 22.27 … seed 22.22, next values 22.21, 22.24.
    const px = [22.27, 22.19, 22.08, 22.17, 22.18, 22.13, 22.23, 22.43, 22.24, 22.29, 22.15, 22.39];
    const e = ema(px, 10);
    expect(e[9]!).toBeCloseTo(22.221, 3);
    expect(e[10]!).toBeCloseTo(22.208, 3);
    expect(e[11]!).toBeCloseTo(22.241, 3);
  });
});

describe('Bollinger bands', () => {
  it('uses the population standard deviation', () => {
    const b = bollinger([2, 4, 4, 4, 5, 5, 7, 9], 8, 2);
    // Mean 5, population sd 2.
    expect(b.mid[7]).toBe(5);
    expect(b.upper[7]).toBeCloseTo(9, 10);
    expect(b.lower[7]).toBeCloseTo(1, 10);
    expect(b.upper[6]).toBeNull();
  });
});

describe('RSI', () => {
  it("matches Wilder's worked example", () => {
    const px = [44.34, 44.09, 44.15, 43.61, 44.33, 44.83, 45.1, 45.42, 45.84, 46.08, 45.89, 46.03, 45.61, 46.28, 46.28, 46.0, 46.03, 46.41, 46.22, 45.64];
    const r = rsi(px, 14);
    expect(r[13]).toBeNull();
    expect(r[14]!).toBeCloseTo(70.46, 1);
    expect(r[15]!).toBeCloseTo(66.25, 1);
    expect(r[16]!).toBeCloseTo(66.48, 1);
    expect(r[17]!).toBeCloseTo(69.35, 1);
    expect(r[18]!).toBeCloseTo(66.29, 1);
    expect(r[19]!).toBeCloseTo(57.92, 1);
  });

  it('is 100 when there are no losses', () => {
    expect(rsi([1, 2, 3, 4], 3)[3]).toBe(100);
  });
});

describe('MACD', () => {
  it('is the fast EMA minus the slow EMA, with an EMA of that as the signal', () => {
    const px = Array.from({ length: 60 }, (_, i) => 100 + i); // a steady climb
    const m = macd(px, 12, 26, 9);
    expect(m.macd[24]).toBeNull();
    // On a straight line both EMAs lag by a constant: (n − 1) / 2 steps each.
    expect(m.macd[59]!).toBeCloseTo((26 - 1) / 2 - (12 - 1) / 2, 6);
    expect(m.signal[59]!).toBeCloseTo(7, 6);
    expect(m.hist[59]!).toBeCloseTo(0, 6);
  });
});

describe('ATR', () => {
  it('averages the true range, which includes gaps from the previous close', () => {
    const cs = [bar(0, 10, 11, 9, 10), bar(1, 10, 12, 10, 11), bar(2, 14, 15, 13, 14), bar(3, 14, 14.5, 13.5, 14)];
    // True ranges: 2, then 4 (gap up from 11 to a 15 high), then 1.
    expect(atr(cs, 2)[2]).toBe(3);
    expect(atr(cs, 2)[3]).toBe((3 * 1 + 1) / 2);
  });
});

describe('VWAP', () => {
  const H = 3_600_000;
  const D = 24 * H;
  const cs = [bar(0, 10, 12, 8, 10, 100), bar(H, 10, 14, 10, 12, 300), bar(D, 20, 22, 18, 20, 50), bar(D + H, 20, 26, 22, 24, 50)];

  it('weights the typical price by volume and resets each session', () => {
    const v = sessionVwap(cs);
    expect(v.vwap[0]).toBeCloseTo(10, 10);
    expect(v.vwap[1]).toBeCloseTo((10 * 100 + 12 * 300) / 400, 10);
    expect(v.vwap[2]).toBeCloseTo(20, 10); // a new day
    expect(v.vwap[3]).toBeCloseTo(22, 10);
  });

  it('puts the bands one and two volume-weighted standard deviations away', () => {
    const v = sessionVwap(cs);
    const mean = 11.5;
    const sd = Math.sqrt((100 * (10 - mean) ** 2 + 300 * (12 - mean) ** 2) / 400);
    expect(v.upper1[1]!).toBeCloseTo(mean + sd, 10);
    expect(v.lower2[1]!).toBeCloseTo(mean - 2 * sd, 10);
  });

  it('anchors from a chosen bar and never resets', () => {
    const v = anchoredVwap(cs, H);
    expect(v.vwap[0]).toBeNull();
    expect(v.vwap[1]).toBeCloseTo(12, 10);
    expect(v.vwap[3]).toBeCloseTo((12 * 300 + 20 * 50 + 24 * 50) / 400, 10);
  });

  it('is blank, not anchored somewhere else, when the anchor is older than the bars', () => {
    const later = cs.map((c) => ({ ...c, t: c.t + 10 * D }));
    expect(anchoredVwap(later, 0).vwap.every((v) => v === null)).toBe(true);
    expect(anchoredVwap(later, 99 * D).vwap.every((v) => v === null)).toBe(true);
  });
});

describe('previous-day levels', () => {
  it("returns yesterday's high, low and close", () => {
    const D = 86_400_000;
    const cs = [bar(0, 1, 5, 0.5, 2), bar(D, 10, 14, 9, 12), bar(D + 1000, 12, 13, 8, 11), bar(2 * D, 11, 12, 10, 11.5)];
    expect(previousDay(cs)).toEqual({ high: 14, low: 8, close: 11 });
    expect(previousDay([bar(0, 1, 2, 0, 1)])).toBeNull();
  });
});

describe('order flow', () => {
  it('cumulative delta sums taker buys minus taker sells', () => {
    const cs = [bar(0, 1, 1, 1, 1, 10, 7), bar(1, 1, 1, 1, 1, 10, 2), bar(2, 1, 1, 1, 1, 4, 4)];
    expect(cumulativeDelta(cs)).toEqual([4, -2, 2]);
    expect(cumulativeDelta([bar(0, 1, 1, 1, 1, 10)])).toEqual([null]);
  });

  it('volume profile finds the point of control and a 70% value area', () => {
    const cs = [bar(0, 10, 11, 10, 10.5, 10), bar(1, 12, 13, 12, 12.5, 80), bar(2, 14, 15, 14, 14.5, 10)];
    const p = volumeProfile(cs, 5)!;
    expect(p.total).toBeCloseTo(100, 8);
    expect(p.poc).toBeGreaterThan(12);
    expect(p.poc).toBeLessThan(13);
    expect(p.valueLow).toBeGreaterThanOrEqual(12);
    expect(p.valueHigh).toBeLessThanOrEqual(13.0001);
  });
});

describe('Donchian channel', () => {
  it('uses the previous n bars, not the current one', () => {
    const cs = [bar(0, 1, 5, 1, 2), bar(1, 2, 7, 2, 3), bar(2, 3, 20, 0, 4)];
    const d = donchian(cs, 2);
    expect(d.upper[2]).toBe(7);
    expect(d.lower[2]).toBe(1);
    expect(d.upper[1]).toBeNull();
  });
});
