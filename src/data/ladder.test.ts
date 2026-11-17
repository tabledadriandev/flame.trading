import { describe, expect, it } from 'vitest';
import { buildLadder, heatStep, imbalanceRead, tickChoices, type VenueBook } from './ladder';

const now = 1_000_000;
const binance: VenueBook = {
  venue: 'binance',
  t: now,
  bids: [[99.98, 1], [99.4, 2], [98.2, 5], [80, 100]],
  asks: [[100.02, 1.5], [100.6, 2], [101.9, 9], [130, 100]],
};
const coinbase: VenueBook = {
  venue: 'coinbase',
  t: now,
  // Quoted 0.30 higher than Binance: its mid is 100.30.
  bids: [[100.28, 3], [99.7, 4]],
  asks: [[100.32, 2], [100.9, 1]],
};

describe('merged ladder', () => {
  it('buckets one venue into rows of the chosen tick, bids rounded down and asks up', () => {
    const l = buildLadder([binance], { tick: 1, now })!;
    expect(l.mid).toBeCloseTo(100, 10);
    expect(l.spread).toBeCloseTo(0.04, 10);
    expect(l.bids.map((r) => [r.price, r.size])).toEqual([[99, 3]]); // 99.98 and 99.4; 98.2 is outside ±1%
    expect(l.asks.map((r) => [r.price, r.size])).toEqual([[101, 3.5]]);
  });

  it('keeps only levels within the range of the mid', () => {
    const l = buildLadder([binance], { tick: 1, range: 0.05, now })!;
    expect(l.bids.map((r) => r.price)).toEqual([99, 98]);
    expect(l.asks.map((r) => r.price)).toEqual([101, 102]);
    expect(l.bids.some((r) => r.price === 80)).toBe(false);
  });

  it('lines each venue up on its own mid and records the venue split', () => {
    const l = buildLadder([binance, coinbase], { tick: 1, now })!;
    // Coinbase's 100.28 bid sits 0.02 under its mid, so it lands at 99.98 → the 99 row.
    expect(l.bids[0]).toMatchObject({ price: 99, size: 3 + 3 + 4 });
    expect(l.bids[0]!.venues).toEqual({ binance: 3, coinbase: 7 });
    expect(l.asks[0]!.venues).toEqual({ binance: 3.5, coinbase: 3 });
    expect(l.venues).toEqual(['binance', 'coinbase']);
    // No bid row is ever at or above an ask row.
    expect(l.bids[0]!.price).toBeLessThan(l.asks[0]!.price);
  });

  it('leaves out a venue whose book is stale or empty', () => {
    const stale = { ...coinbase, t: now - 60_000 };
    expect(buildLadder([binance, stale], { tick: 1, now })!.venues).toEqual(['binance']);
    expect(buildLadder([binance, { ...coinbase, bids: [] }], { tick: 1, now })!.venues).toEqual(['binance']);
    expect(buildLadder([{ ...binance, t: 0 }], { tick: 1, now })).toBeNull();
  });

  it('names the largest wall on each side with its size, distance and main venue', () => {
    const l = buildLadder([binance, coinbase], { tick: 0.5, range: 0.05, now })!;
    expect(l.askWall).toMatchObject({ price: 102, size: 9, venue: 'binance' });
    expect(l.askWall!.distancePct).toBeCloseTo(2, 6);
    expect(l.bidWall!.size).toBeGreaterThanOrEqual(5);
  });

  it('measures the imbalance within ±0.5% of the mid and accumulates depth outward', () => {
    const l = buildLadder([binance], { tick: 0.1, range: 0.05, now })!;
    expect(l.nearBid).toBe(1); // only the 99.98 bid is within 0.5%
    expect(l.nearAsk).toBe(1.5);
    expect(l.bidShare).toBeCloseTo(1 / 2.5, 10);
    expect(l.bids.map((r) => r.cumulative)).toEqual([1, 3, 8]);
  });
});

describe('ladder helpers', () => {
  it('reads the imbalance in plain words', () => {
    expect(imbalanceRead(0.7)).toBe('Buyers much heavier');
    expect(imbalanceRead(0.56)).toBe('Buyers heavier');
    expect(imbalanceRead(0.5)).toBe('Balanced');
    expect(imbalanceRead(0.44)).toBe('Sellers heavier');
    expect(imbalanceRead(0.2)).toBe('Sellers much heavier');
  });

  it('offers $1, $5, $10, $20 and $50 rows for BTC, scaled for other prices', () => {
    expect(tickChoices(64_000)).toEqual([1, 5, 10, 20, 50]);
    expect(tickChoices(1_800)).toEqual([0.1, 0.5, 1, 2, 5]);
    expect(tickChoices(0.62)).toEqual([0.00001, 0.00005, 0.0001, 0.0002, 0.0005]);
  });

  it('steps the heat ramp from 1 to 5', () => {
    expect(heatStep(0, 10)).toBe(1);
    expect(heatStep(1, 100)).toBe(1);
    expect(heatStep(10, 100)).toBe(2);
    expect(heatStep(30, 100)).toBe(3);
    expect(heatStep(50, 100)).toBe(4);
    expect(heatStep(100, 100)).toBe(5);
  });
});
