import { describe, expect, it } from 'vitest';
import type { TradeRec } from '../engine/types';
import { equityCurve, rDistribution, slice, stats, tradesCsv, weeklyReview } from './stats';

const DAY = 86_400_000;
let n = 0;
const trade = (pnl: number, extra: Partial<TradeRec> = {}): TradeRec => {
  n += 1;
  return {
    id: `t${n}`,
    instrument: 'crypto:BTC',
    cls: 'crypto',
    mode: 'lev',
    dir: 'long',
    openedAt: n * 1000,
    closedAt: n * 1000 + 500,
    qty: 1,
    entryAvg: 100,
    exitAvg: 100 + pnl,
    openedQty: 1,
    closedQty: 1,
    gross: pnl + 1,
    fees: 1,
    funding: 0,
    pnl,
    mae: 0,
    mfe: 0,
    fillIds: [],
    ...extra,
  };
};

describe('journal statistics', () => {
  const set = [trade(100, { r: 2 }), trade(-50, { r: -1 }), trade(-50, { r: -1 }), trade(200, { r: 4 }), trade(-100)];
  const s = stats(set);

  it('win rate, average win and average loss', () => {
    expect(s.trades).toBe(5);
    expect(s.winRate).toBeCloseTo(0.4, 10);
    expect(s.avgWin).toBe(150);
    expect(s.avgLoss).toBeCloseTo(200 / 3, 10);
  });

  it('expectancy per trade and per R', () => {
    expect(s.expectancy).toBe(20); // 100 net over 5 trades
    expect(s.expectancyR).toBe(1); // (2 − 1 − 1 + 4) / 4 trades that had a stop
    expect(s.withR).toBe(4);
    expect(stats([trade(5)]).expectancyR).toBeNull();
  });

  it('profit factor: dollars won for every dollar lost', () => {
    expect(s.profitFactor).toBe(1.5); // 300 won, 200 lost
    expect(stats([trade(10)]).profitFactor).toBe(Infinity);
    expect(stats([]).profitFactor).toBeNull();
  });

  it('max drawdown is the largest fall from a peak in closed P&L', () => {
    // Running total: 100, 50, 0, 200, 100. Peak 100 → trough 0 is the largest fall.
    expect(s.maxDrawdown).toBe(100);
  });

  it('longest losing streak', () => {
    expect(s.longestLosingStreak).toBe(2);
    expect(stats([trade(-1), trade(-1), trade(-1), trade(1), trade(-1)]).longestLosingStreak).toBe(3);
  });

  it('ignores trades that are still open', () => {
    const open = trade(999);
    delete open.closedAt;
    expect(stats([...set, open]).trades).toBe(5);
  });

  it('draws the equity curve from the opening cash, with drawdown at each point', () => {
    const curve = equityCurve(set, 100_000);
    expect(curve.map((p) => p.equity)).toEqual([100_000, 100_100, 100_050, 100_000, 100_200, 100_100]);
    expect(curve.map((p) => p.drawdown)).toEqual([0, 0, 50, 100, 0, 100]);
  });
});

describe('slices', () => {
  it('splits the statistics by setup, emotion, plan and instrument', () => {
    const tagged = [
      trade(100, { review: { setup: 'Breakout', emotion: 'Calm', followedPlan: true, note: '' } }),
      trade(-40, { review: { setup: 'Breakout', emotion: 'Rushed', followedPlan: false, note: '' } }),
      trade(30, { instrument: 'crypto:ETH', review: { setup: 'Pullback', emotion: 'Calm', followedPlan: true, note: '' } }),
      trade(-10),
    ];
    const bySetup = slice(tagged, 'setup');
    expect(bySetup.map((x) => [x.key, x.stats.net, x.stats.trades])).toEqual([
      ['Breakout', 60, 2],
      ['Pullback', 30, 1],
      ['Not tagged', -10, 1],
    ]);
    expect(slice(tagged, 'emotion').find((x) => x.key === 'Calm')!.stats.net).toBe(130);
    expect(slice(tagged, 'plan').map((x) => x.key)).toEqual(['Followed the plan', 'No plan recorded', 'Broke the plan']);
    expect(slice(tagged, 'instrument', (id) => id.split(':')[1]!).map((x) => x.key)).toEqual(['BTC', 'ETH']);
  });

  it('splits by day of week and hour, in calendar order', () => {
    const mon = new Date(2026, 10, 16, 9, 15).getTime();
    const tue = new Date(2026, 10, 17, 14, 40).getTime();
    const ts = [trade(10, { openedAt: tue, closedAt: tue + 1 }), trade(-5, { openedAt: mon, closedAt: mon + 1 }), trade(7, { openedAt: mon + 60_000, closedAt: mon + 60_001 })];
    expect(slice(ts, 'weekday').map((x) => [x.key, x.stats.trades])).toEqual([['Monday', 2], ['Tuesday', 1]]);
    expect(slice(ts, 'hour').map((x) => x.key)).toEqual(['09:00', '14:00']);
  });
});

describe('R distribution', () => {
  it('counts results in whole-R buckets with open ends', () => {
    const d = rDistribution([trade(1, { r: -4 }), trade(1, { r: -1 }), trade(1, { r: -0.4 }), trade(1, { r: 0.2 }), trade(1, { r: 2.4 }), trade(1, { r: 9 }), trade(1)]);
    const count = (label: string) => d.find((b) => b.label === label)!.count;
    expect(count('−3R or worse')).toBe(1);
    expect(count('−1R to 0R')).toBe(2); // −1.0 and −0.4
    expect(count('0R to +1R')).toBe(1);
    expect(count('+2R to +3R')).toBe(1);
    expect(count('+5R or better')).toBe(1);
    expect(d.reduce((s, b) => s + b.count, 0)).toBe(6); // the trade without R is left out
  });
});

describe('weekly review', () => {
  it('names the three numbers that changed most, with a sentence each', () => {
    const now = 100 * DAY;
    const at = (daysAgo: number, pnl: number) => trade(pnl, { openedAt: now - daysAgo * DAY - 1000, closedAt: now - daysAgo * DAY });
    const review = weeklyReview([at(10, 100), at(9, -50), at(3, -200), at(2, -100), at(1, 20)], now)!;
    expect(review).toHaveLength(3);
    expect(review[0]!.name).toBe('Net P&L');
    expect(review[0]).toMatchObject({ before: 50, after: -280 });
    for (const r of review) expect(r.sentence.length).toBeGreaterThan(10);
  });

  it('says nothing when there is no earlier week to compare with', () => {
    expect(weeklyReview([trade(5, { closedAt: 100 * DAY - 1 })], 100 * DAY)).toBeNull();
  });
});

describe('CSV export', () => {
  it('writes one row per closed trade and escapes what a spreadsheet could misread', () => {
    const csv = tradesCsv([trade(12.5, { r: 1.25, review: { setup: 'Break, out', emotion: 'Calm', followedPlan: true, note: '=SUM(A1) "quoted"' } })], (id) => id.split(':')[1]!);
    const [head, row] = csv.trim().split('\r\n');
    expect(head!.split(',')).toContain('followed_plan');
    expect(row).toContain('BTC,perp,long');
    expect(row).toContain('"Break, out"');
    expect(row).toContain(`"'=SUM(A1) ""quoted"""`);
    expect(row).toContain(',12.50,');
  });
});
