import { describe, expect, it } from 'vitest';
import { optionName, optionSymbol, parseOptionId, yearsTo } from './contract';

describe('option ids', () => {
  it('reads a Deribit contract', () => {
    expect(parseOptionId('opt:deribit:BTC-25JUN27-88000-C')).toEqual({
      underlying: 'crypto:BTC',
      kind: 'call',
      strike: 88000,
      expiry: Date.UTC(2027, 5, 25, 8),
      multiplier: 1,
      venue: 'deribit',
    });
    // 18 November 2026 is a Wednesday: a daily expiry, which pays no fee at settlement.
    expect(parseOptionId('opt:deribit:ETH-18NOV26-1940-P')).toMatchObject({ underlying: 'crypto:ETH', kind: 'put', strike: 1940, daily: true });
    expect(parseOptionId('opt:deribit:XRP-27NOV26-0d55-C')).toMatchObject({ strike: 0.55 });
  });

  it('reads an OCC stock option symbol: 100 shares, expiring at the New York close', () => {
    const winter = parseOptionId('opt:alpaca:AAPL261218C00200000')!;
    expect(winter).toMatchObject({ underlying: 'stock:AAPL', kind: 'call', strike: 200, multiplier: 100, venue: 'alpaca' });
    expect(new Date(winter.expiry).toISOString()).toBe('2026-12-18T21:00:00.000Z');
    // In summer New York is four hours behind UTC, not five.
    expect(new Date(parseOptionId('opt:alpaca:SPY270618P00512500')!.expiry).toISOString()).toBe('2027-06-18T20:00:00.000Z');
    expect(parseOptionId('opt:alpaca:SPY270618P00512500')).toMatchObject({ kind: 'put', strike: 512.5 });
  });

  it('refuses what is not a contract', () => {
    for (const id of ['crypto:BTC', 'opt:deribit:BTC-PERPETUAL', 'opt:deribit:BTC-25XXX27-88000-C', 'opt:alpaca:AAPL', 'opt:other:AAPL261218C00200000']) {
      expect(parseOptionId(id)).toBeNull();
    }
  });

  it('names a contract in words', () => {
    const spec = parseOptionId('opt:deribit:BTC-25JUN27-88000-C')!;
    expect(optionSymbol(spec)).toBe('BTC 88,000 call 25 Jun 27');
    expect(optionName(spec)).toBe('The right to buy 1 BTC at $88,000 on 25 Jun 27');
    expect(optionName(parseOptionId('opt:alpaca:AAPL261218P00200000')!)).toBe('The right to sell 100 AAPL shares at $200 on 18 Dec 26');
  });

  it('measures time to expiry in years', () => {
    expect(yearsTo(Date.UTC(2027, 0, 1), Date.UTC(2026, 0, 1))).toBeCloseTo(1, 9);
    expect(yearsTo(1, 2)).toBe(0);
  });
});
