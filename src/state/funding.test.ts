import { describe, expect, it } from 'vitest';
import { fundingDue } from './funding';

const HOUR = 3_600_000;

describe('perp funding schedule', () => {
  it('charges a position once for each hour it was open at the top of', () => {
    const now = 100 * HOUR + 5 * 60_000; // five past the hour
    expect(fundingDue(99 * HOUR + 1, undefined, now)).toBe(100); // open since before 100:00
    expect(fundingDue(99 * HOUR + 1, 100, now)).toBeNull(); // already paid this hour
    expect(fundingDue(99 * HOUR + 1, 99, now)).toBe(100); // paid last hour, due again
  });

  it('does not charge a position opened after the hour struck', () => {
    const now = 100 * HOUR + 5 * 60_000;
    expect(fundingDue(100 * HOUR + 60_000, undefined, now)).toBeNull();
    expect(fundingDue(100 * HOUR, undefined, now)).toBeNull();
  });
});
