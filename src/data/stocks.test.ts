import { describe, expect, it } from 'vitest';
import { groupBars } from './stocks';

describe('four-hour stock bars', () => {
  it('joins hourly bars four at a time and never across days', () => {
    const day1 = new Date(2026, 10, 16, 9, 30).getTime();
    const day2 = new Date(2026, 10, 17, 9, 30).getTime();
    const H = 3_600_000;
    const bar = (t: number, o: number, h: number, l: number, c: number) => ({ t, o, h, l, c, v: 10 });
    const bars = [
      bar(day1, 10, 11, 9, 10.5),
      bar(day1 + H, 10.5, 12, 10, 11),
      bar(day1 + 2 * H, 11, 11.5, 10.8, 11.2),
      bar(day1 + 3 * H, 11.2, 13, 11, 12),
      bar(day1 + 4 * H, 12, 12.5, 11.5, 12.2),
      bar(day2, 13, 14, 12.5, 13.5),
    ];
    const out = groupBars(bars, 4);
    expect(out).toHaveLength(3);
    expect(out[0]).toEqual({ t: day1, o: 10, h: 13, l: 9, c: 12, v: 40 });
    expect(out[1]).toMatchObject({ t: day1 + 4 * H, o: 12, c: 12.2, v: 10 });
    expect(out[2]).toMatchObject({ t: day2, o: 13 });
  });
});
