import { describe, expect, it } from 'vitest';
import { CHART_SHARE, DEFAULT_SIZES, LIMITS, MIN_CHART, fitSizes } from './layout';

const chart = (s: typeof DEFAULT_SIZES, width: number) => width - s.watch - s.book - s.ticket - 3;

describe('desk column fit', () => {
  it('leaves the chosen sizes alone on a wide desk', () => {
    expect(fitSizes(DEFAULT_SIZES, 1600)).toBe(DEFAULT_SIZES);
  });

  it('gives the chart its share on a narrower desk without going under any minimum', () => {
    for (const width of [960, 1100, 1224]) {
      const s = fitSizes(DEFAULT_SIZES, width);
      expect(s.watch).toBeGreaterThanOrEqual(LIMITS.watch[0]);
      expect(s.book).toBeGreaterThanOrEqual(LIMITS.book[0]);
      expect(s.ticket).toBeGreaterThanOrEqual(LIMITS.ticket[0]);
      expect(chart(s, width)).toBeGreaterThanOrEqual(MIN_CHART);
    }
    const s = fitSizes(DEFAULT_SIZES, 1224);
    expect(chart(s, 1224)).toBeGreaterThanOrEqual(Math.round(1224 * CHART_SHARE));
  });

  it('shrinks columns in proportion to what each has above its minimum', () => {
    const wide = { ...DEFAULT_SIZES, watch: 360, book: 200, ticket: 260 };
    const s = fitSizes(wide, 1100);
    expect(s.book).toBe(200);
    expect(s.ticket).toBe(260);
    expect(s.watch).toBeLessThan(360);
    expect(s.drawer).toBe(wide.drawer);
  });

  it('does nothing before the desk has been measured', () => {
    expect(fitSizes(DEFAULT_SIZES, 0)).toBe(DEFAULT_SIZES);
  });
});
