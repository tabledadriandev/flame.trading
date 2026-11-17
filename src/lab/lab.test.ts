import { describe, expect, it } from 'vitest';
import type { Candle } from '../data/types';
import { DEFAULT_LAB, MIN_TRADES, STRATEGIES, outOfSample, runBacktest, strategy, type Settings } from './backtest';
import { outcomeCone } from './cone';

const DAY = 86_400_000;
const bar = (i: number, o: number, c: number, h = Math.max(o, c), l = Math.min(o, c)): Candle => ({ t: i * DAY, o, h, l, c, v: 1 });
const free: Settings = { startCash: 10_000, fee: 0, slippage: 0, sizing: { kind: 'percent', percent: 100 } };

/** A rule that is long exactly when told, for testing the machinery around it. */
const scripted = (wants: boolean[]) => ({ id: 'ma-cross' as const, name: 'scripted', rule: '', params: [], wants: () => wants });

describe('backtester', () => {
  it('fills at the next bar open, never at the bar that gave the signal', () => {
    const candles = [bar(0, 100, 100), bar(1, 100, 110), bar(2, 120, 125), bar(3, 130, 128), bar(4, 126, 126)];
    // The rule wants in after bar 1 closes and out after bar 2 closes.
    const r = runBacktest(candles, scripted([false, true, false, false, false]), {}, free);
    expect(r.trades).toHaveLength(1);
    expect(r.trades[0]).toMatchObject({ entryPrice: 120, exitPrice: 130, reason: 'signal', bars: 1 });
    expect(r.totalReturn).toBeCloseTo(130 / 120 - 1, 10);
  });

  it('charges the fee and slippage on both sides', () => {
    const candles = [bar(0, 100, 100), bar(1, 100, 100), bar(2, 100, 100), bar(3, 100, 100)];
    const costly: Settings = { ...free, fee: 0.001, slippage: 0.001 };
    const r = runBacktest(candles, scripted([true, false, false, false]), {}, costly);
    const buy = 100 * 1.001;
    const sell = 100 * 0.999;
    const qty = 10_000 / (buy * 1.001);
    expect(r.trades[0]!.pnl).toBeCloseTo((sell - buy) * qty - qty * buy * 0.001 - qty * sell * 0.001, 6);
    expect(r.totalReturn).toBeLessThan(0);
  });

  it('sizes by fixed dollars, percent of equity or fixed risk', () => {
    const candles = Array.from({ length: 40 }, (_, i) => bar(i, 100 + i, 101 + i, 102 + i, 99 + i));
    const wants = candles.map((_, i) => i >= 20 && i < 30);
    const fixed = runBacktest(candles, scripted(wants), {}, { ...free, sizing: { kind: 'fixed', dollars: 1_000 } });
    expect(fixed.trades[0]!.qty).toBeCloseTo(1_000 / 121, 8);
    const half = runBacktest(candles, scripted(wants), {}, { ...free, sizing: { kind: 'percent', percent: 50 } });
    expect(half.trades[0]!.qty).toBeCloseTo(5_000 / 121, 8);
    // Risk 1% of 10,000 with a stop two ATRs away: ATR here is 3, so the stop is 6 below and size is 100 / 6.
    const risk = runBacktest(candles, scripted(wants), {}, { ...free, sizing: { kind: 'risk', percent: 1, atrMultiple: 2 } });
    expect(risk.trades[0]!.qty).toBeCloseTo(100 / 6, 6);
  });

  it('exits at the stop when a bar trades through it, or at the open if it gaps through', () => {
    const candles = [...Array.from({ length: 20 }, (_, i) => bar(i, 100, 100, 101, 99)), bar(20, 100, 100, 101, 99), bar(21, 100, 90, 100, 90), bar(22, 80, 80)];
    const wants = candles.map((_, i) => i === 19 || i === 20 || i === 21);
    const s: Settings = { ...free, sizing: { kind: 'risk', percent: 1, atrMultiple: 2 } };
    const r = runBacktest(candles, scripted(wants), {}, s);
    // ATR is 2, so the stop sits 4 below the 100 entry, at 96; bar 21 trades down through it.
    expect(r.trades[0]).toMatchObject({ reason: 'stop', exitPrice: 96 });
  });

  it('reports drawdown, exposure, win rate, profit factor and buy-and-hold', () => {
    const prices = [100, 100, 110, 121, 100, 100, 100, 130];
    const candles = prices.map((p, i) => bar(i, i === 0 ? p : prices[i - 1]!, p));
    // In from bar 1 to bar 5 (up to 121, back to 100: flat), then in again from bar 6 to the end (100 to 130).
    const r = runBacktest(candles, scripted([true, true, true, true, false, true, true, false]), {}, free);
    expect(r.trades).toHaveLength(2);
    expect(r.winRate).toBe(0.5);
    expect(r.maxDrawdown).toBeCloseTo(1 - 100 / 121, 10);
    expect(r.exposure).toBeCloseTo(5 / 8, 10);
    expect(r.buyHold).toBeCloseTo(0.3, 10);
    expect(r.curve).toHaveLength(8);
  });

  it('closes an open position on the last bar and says so', () => {
    const candles = [bar(0, 100, 100), bar(1, 100, 105), bar(2, 105, 110)];
    const r = runBacktest(candles, scripted([true, true, true]), {}, free);
    expect(r.trades[0]).toMatchObject({ reason: 'end', exitPrice: 110 });
  });

  it('every built-in strategy runs and never trades on missing indicator values', () => {
    const candles = Array.from({ length: 400 }, (_, i) => {
      const p = 100 + 20 * Math.sin(i / 15) + i * 0.05;
      return bar(i, p, p + Math.cos(i / 3), p + 2, p - 2);
    });
    for (const def of STRATEGIES) {
      const params = Object.fromEntries(def.params.map((p) => [p.key, p.value]));
      const wants = def.wants(candles, params);
      expect(wants).toHaveLength(400);
      expect(wants[0]).toBe(false);
      const r = runBacktest(candles, def, params, DEFAULT_LAB);
      expect(Number.isFinite(r.totalReturn)).toBe(true);
      expect(r.curve.every((p) => p.equity > 0)).toBe(true);
    }
  });

  it('the moving-average cross is long only while the fast average is above the slow one', () => {
    const up = Array.from({ length: 60 }, (_, i) => bar(i, 100 + i, 100 + i));
    const down = Array.from({ length: 60 }, (_, i) => bar(60 + i, 160 - 2 * i, 160 - 2 * i));
    const wants = strategy('ma-cross').wants([...up, ...down], { fast: 5, slow: 20 });
    expect(wants[30]).toBe(true);
    expect(wants[110]).toBe(false);
  });
});

describe('out-of-sample check', () => {
  const trend = Array.from({ length: 600 }, (_, i) => {
    const p = 100 * Math.exp(i * 0.002) * (1 + 0.03 * Math.sin(i / 9));
    return bar(i, p, p * 1.001, p * 1.01, p * 0.99);
  });

  it('tunes on the first 70% and reports the last 30% separately', () => {
    const r = outOfSample(trend, strategy('ma-cross'), DEFAULT_LAB)!;
    expect(r.tried).toBeGreaterThan(3);
    expect(r.inSample.bars).toBe(420);
    expect(r.outOfSample.bars).toBe(180);
    expect(r.outOfSample.from).toBe(trend[420]!.t);
    expect(r.best.fast!).toBeLessThan(r.best.slow!);
    expect(r.outOfSample.trades.every((t) => t.entryT >= trend[420]!.t)).toBe(true);
  });

  it('the unseen part holds nothing over from the tuning part: its numbers describe one stretch', () => {
    const r = outOfSample(trend, strategy('ma-cross'), DEFAULT_LAB)!;
    const o = r.outOfSample;
    expect(o.curve).toHaveLength(180);
    expect(o.curve[0]!.t).toBe(trend[420]!.t);
    // The return is exactly what its own trades made.
    const fromTrades = o.trades.reduce((sum, t) => sum + t.pnl, 0);
    expect(o.totalReturn * DEFAULT_LAB.startCash).toBeCloseTo(fromTrades, 4);
    // Buy and hold over the same bars, with the same costs as the rule pays.
    const cost = (1 - DEFAULT_LAB.slippage) * (1 - DEFAULT_LAB.fee) / ((1 + DEFAULT_LAB.slippage) * (1 + DEFAULT_LAB.fee));
    expect(o.buyHold).toBeCloseTo((trend[599]!.c / trend[420]!.o) * cost - 1, 10);
  });

  it('warm-up bars are not traded and not counted', () => {
    const candles = Array.from({ length: 10 }, (_, i) => bar(i, 100 + i, 101 + i));
    const r = runBacktest(candles, scripted(candles.map(() => true)), {}, free, 6);
    expect(r.bars).toBe(4);
    expect(r.curve).toHaveLength(4);
    expect(r.trades[0]!.entryT).toBe(candles[6]!.t);
    expect(r.exposure).toBeCloseTo(3 / 4, 10); // in from bar 6, closed on the last bar
  });

  it('says plainly when the two disagree', () => {
    // Rises for the tuning part, then falls for the unseen part.
    const flip = Array.from({ length: 600 }, (_, i) => {
      const p = i < 420 ? 100 + i * 0.5 + 6 * Math.sin(i / 7) : 310 - (i - 420) * 1.2 + 6 * Math.sin(i / 7);
      return bar(i, p, p + 0.2, p + 0.3, p - 0.3);
    });
    const r = outOfSample(flip, strategy('donchian'), DEFAULT_LAB)!;
    expect(r.inSample.totalReturn).toBeGreaterThan(0);
    expect(r.agrees).toBe(false);
    expect(r.verdict).toMatch(/disagree|nothing here/);
  });

  it('needs enough bars to split', () => {
    expect(outOfSample(trend.slice(0, 50), strategy('ma-cross'), DEFAULT_LAB)).toBeNull();
    expect(MIN_TRADES).toBe(30);
  });
});

describe('outcome cone', () => {
  // A flat market with a regular ±1% wobble: no drift.
  const flat = Array.from({ length: 500 }, (_, i) => 100 * (i % 2 === 0 ? 1 : 1.01));
  const base = { closes: flat, horizon: 5, entry: 100, side: 'buy' as const, qty: 10, feeRate: 0, seed: 7 };

  it('starts at the entry and widens with time', () => {
    const c = outcomeCone(base)!;
    expect(c.p10).toHaveLength(6);
    expect(c.p50[0]).toBe(100);
    expect(c.p90[0]! - c.p10[0]!).toBe(0);
    expect(c.p90[5]!).toBeGreaterThanOrEqual(c.p50[5]!);
    expect(c.p50[5]!).toBeGreaterThanOrEqual(c.p10[5]!);
  });

  it('is reproducible, and fees lower the share of profitable outcomes', () => {
    expect(outcomeCone(base)).toEqual(outcomeCone(base));
    const withFees = outcomeCone({ ...base, feeRate: 0.01 })!;
    expect(withFees.profitShare).toBeLessThan(outcomeCone(base)!.profitShare);
    expect(withFees.bad).toBeLessThan(withFees.good);
  });

  it('a rising series favours the long side and punishes the short side', () => {
    const rising = Array.from({ length: 500 }, (_, i) => 100 * 1.004 ** i * (i % 2 ? 1.01 : 1));
    const long = outcomeCone({ ...base, closes: rising, horizon: 21 })!;
    const short = outcomeCone({ ...base, closes: rising, horizon: 21, side: 'sell' })!;
    expect(long.profitShare).toBeGreaterThan(0.8);
    expect(short.profitShare).toBeLessThan(0.2);
    expect(long.p50[21]!).toBeGreaterThan(100);
  });

  it('books a stop that the close gaps through at the close, not at the stop', () => {
    // Every day falls 10%: a stop 1% away is passed on day one, far below it.
    const falling = Array.from({ length: 200 }, (_, i) => 100 * 0.9 ** i);
    const c = outcomeCone({ ...base, closes: falling, horizon: 5, stop: 99 })!;
    expect(c.stopFirst).toBe(1);
    expect(c.bad).toBeCloseTo((90 - 100) * 10, 6); // out at 90, not 99
  });

  it('counts which of the stop and the target is touched first', () => {
    const c = outcomeCone({ ...base, horizon: 21, stop: 99.5, target: 100.5 })!;
    expect(c.stopFirst! + c.targetFirst!).toBeLessThanOrEqual(1);
    expect(c.stopFirst! + c.targetFirst!).toBeGreaterThan(0.9); // a 1% wobble crosses a 0.5% bracket almost at once
    expect(outcomeCone(base)!.stopFirst).toBeNull();
  });

  it('says nothing with too little history', () => {
    expect(outcomeCone({ ...base, closes: flat.slice(0, 30) })).toBeNull();
    expect(outcomeCone({ ...base, qty: 0 })).toBeNull();
  });
});
