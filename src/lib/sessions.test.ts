import { describe, expect, it } from 'vitest';
import { EXCHANGES, countdown, sessionState } from './sessions';

const ex = (id: string) => EXCHANGES.find((e) => e.id === id)!;
const H = 3_600_000;

describe('market-hours clocks', () => {
  it('New York is open from 09:30 to 16:00 Eastern on a weekday', () => {
    // Tuesday 17 November 2026: New York is UTC−5.
    expect(sessionState(ex('nyse'), Date.UTC(2026, 10, 17, 14, 29)).open).toBe(false);
    const open = sessionState(ex('nyse'), Date.UTC(2026, 10, 17, 14, 30));
    expect(open).toMatchObject({ open: true, label: 'Closes in', clock: '09:30' });
    expect(open.until).toBe(6.5 * H);
    expect(sessionState(ex('nyse'), Date.UTC(2026, 10, 17, 21, 0)).open).toBe(false);
  });

  it('follows daylight saving time through the zone, not a fixed offset', () => {
    // 15 July 2026: New York is UTC−4, so 13:30 UTC is the open.
    expect(sessionState(ex('nyse'), Date.UTC(2026, 6, 15, 13, 30))).toMatchObject({ open: true, clock: '09:30' });
    // London in summer is UTC+1: 07:00 UTC is 08:00 local, the open.
    expect(sessionState(ex('lse'), Date.UTC(2026, 6, 15, 7, 0))).toMatchObject({ open: true, clock: '08:00' });
  });

  it('counts down to the next open across a weekend', () => {
    // Friday 20 November 2026, 22:00 UTC = 17:00 in New York, after the close.
    const s = sessionState(ex('nyse'), Date.UTC(2026, 10, 20, 22, 0));
    expect(s).toMatchObject({ open: false, label: 'Opens in' });
    expect(s.until).toBe((2 * 24 + 16.5) * H); // to Monday 09:30
    // Saturday is closed however early or late.
    expect(sessionState(ex('lse'), Date.UTC(2026, 10, 21, 10, 0)).open).toBe(false);
  });

  it('Tokyo and Hong Kong break for lunch', () => {
    // Tokyo is UTC+9. 02:00 UTC = 11:00, morning session.
    expect(sessionState(ex('tse'), Date.UTC(2026, 10, 17, 2, 0))).toMatchObject({ open: true, label: 'Lunch in' });
    // 03:00 UTC = 12:00, lunch.
    expect(sessionState(ex('tse'), Date.UTC(2026, 10, 17, 3, 0))).toMatchObject({ open: false, phase: 'lunch', label: 'Reopens in', until: 0.5 * H });
    // 04:00 UTC = 13:00, afternoon session, closes 15:30.
    expect(sessionState(ex('tse'), Date.UTC(2026, 10, 17, 4, 0))).toMatchObject({ open: true, label: 'Closes in', until: 2.5 * H });
    // Hong Kong is UTC+8. 04:30 UTC = 12:30, lunch.
    expect(sessionState(ex('hkex'), Date.UTC(2026, 10, 17, 4, 30)).phase).toBe('lunch');
  });

  it('writes countdowns the way a person reads them', () => {
    expect(countdown(58 * 60_000)).toBe('58m');
    expect(countdown(134 * 60_000)).toBe('2h 14m');
    expect(countdown((3 * 24 + 4) * H)).toBe('3d 4h');
    expect(countdown(30_000)).toBe('1m');
  });
});
