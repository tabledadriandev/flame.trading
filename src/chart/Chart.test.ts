import { describe, expect, it } from 'vitest';
import { timeLabel } from './Chart';

describe('chart time labels', () => {
  it('names a daily bar by its UTC date, whatever the local zone', () => {
    const t = Date.UTC(2026, 10, 17) / 1000; // the daily bar that opens 17 November, 00:00 UTC
    expect(timeLabel(t, 'day', false)).toBe('17');
    expect(timeLabel(t, 'month', false)).toBe('Nov');
    expect(timeLabel(t, 'full', false)).toBe('17 Nov 2026');
  });

  it('gives every hour across a clock change its own label input (bar times are never shifted)', () => {
    // 25 October 2026, 00:00–02:00 UTC: Europe falls back an hour inside this window.
    const hours = [0, 1, 2].map((h) => Date.UTC(2026, 9, 25, h) / 1000);
    expect(new Set(hours).size).toBe(3);
    for (const h of hours) expect(timeLabel(h, 'time', true)).toMatch(/^\d\d:\d\d$/);
  });
});
