import { describe, expect, it } from 'vitest';
import type { Tick } from '../data/types';
import { buildFootprint, footStep, footprintRead, imbalance } from './footprint';

const tk = (t: number, p: number, q: number, side: 'buy' | 'sell'): Tick => ({ t, p, q, side });

describe('footprint', () => {
  const ticks = [tk(1_000, 100.2, 2, 'buy'), tk(2_000, 100.7, 1, 'sell'), tk(3_000, 101.1, 4, 'buy'), tk(61_000, 101.4, 3, 'sell'), tk(62_000, 100.9, 1, 'sell')];
  const bars = buildFootprint(ticks, 60_000, 1);

  it('splits each bar into price rows with sell and buy volume', () => {
    expect(bars).toHaveLength(2);
    const first = bars[0]!;
    expect(first.t).toBe(0);
    expect(first.cells.get(100)).toEqual({ buy: 2, sell: 1 });
    expect(first.cells.get(101)).toEqual({ buy: 4, sell: 0 });
    expect(first).toMatchObject({ buy: 6, sell: 1, delta: 5, open: 100.2, close: 101.1, high: 101.1, low: 100.2, poc: 101 });
  });

  it('gives the second bar its own cells and a negative delta', () => {
    const second = bars[1]!;
    expect(second.t).toBe(60_000);
    expect(second.cells.get(101)).toEqual({ buy: 0, sell: 3 });
    expect(second.cells.get(100)).toEqual({ buy: 0, sell: 1 });
    expect(second.delta).toBe(-4);
  });

  it('does not care what order the trades arrive in', () => {
    expect(buildFootprint([...ticks].reverse(), 60_000, 1)).toEqual(bars);
  });

  it('marks a cell where one side is three times the other and big enough to matter', () => {
    expect(imbalance({ buy: 9, sell: 3 }, 1)).toBe('buy');
    expect(imbalance({ buy: 1, sell: 5 }, 1)).toBe('sell');
    expect(imbalance({ buy: 5, sell: 3 }, 1)).toBeNull();
    expect(imbalance({ buy: 0.3, sell: 0 }, 1)).toBeNull();
  });

  it('reads who is in control, and notices absorption', () => {
    expect(footprintRead(bars.slice(0, 1))).toMatch(/^Buyers in control/);
    expect(footprintRead(bars.slice(1))).toMatch(/^Sellers in control/);
    const absorbed = buildFootprint([tk(0, 100, 1, 'sell'), tk(1, 100, 9, 'buy'), tk(2, 99.9, 1, 'sell')], 60_000, 1);
    expect(footprintRead(absorbed)).toMatch(/sellers are absorbing/);
    expect(footprintRead([])).toBe('Waiting for trades.');
  });

  it('picks a round row height for the range on screen', () => {
    expect(footStep([{ high: 64_180, low: 64_000 }], 18)).toBe(10);
    expect(footStep([{ high: 1_801, low: 1_799 }], 20)).toBe(0.1);
    expect(footStep([], 18)).toBe(1);
  });
});
