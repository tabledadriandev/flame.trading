import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS } from '../engine/types';
import { maxQty, previewTicket, type TicketInput } from './ticketMath';

const base: TicketInput = {
  symbol: 'BTC',
  cls: 'crypto',
  side: 'buy',
  mode: 'spot',
  type: 'market',
  sizeMode: 'units',
  size: 0.156,
  price: NaN,
  leverage: 1,
  tp: NaN,
  sl: NaN,
  quote: { bid: 64_200, ask: 64_210, last: 64_205, t: 0, book: { bids: [[64_200, 5]], asks: [[64_210, 5]] } },
  cash: 100_000,
  equity: 100_000,
  held: 0,
  settings: DEFAULT_SETTINGS,
};

describe('ticket preview', () => {
  it('says what will happen in words, as the spec writes it', () => {
    const p = previewTicket(base);
    expect(p.sentence).toBe('Buy 0.156 BTC at about $64,210.00. Fee $5.01. Uses $10,021.77 of cash.');
    expect(p.problem).toBeNull();
  });

  it('sizes in dollars', () => {
    const p = previewTicket({ ...base, sizeMode: 'dollars', size: 6_421 });
    expect(p.qty).toBeCloseTo(0.1, 10);
  });

  it('sizes by risk so the stop loses exactly the chosen share of equity', () => {
    const p = previewTicket({ ...base, sizeMode: 'risk', size: 1, sl: 63_210, tp: 66_610, mode: 'lev', leverage: 5 });
    expect(p.qty).toBeCloseTo(1, 10); // $1,000 at risk over a $1,000 stop distance
    expect(p.risk).toBeCloseTo(1_000, 6);
    expect(p.tpR).toBeCloseTo(2.4, 10);
    expect(p.liq).toBeCloseTo(64_210 * (1 - 1 / 5 + 0.005), 6);
    expect(p.verb).toBe('Long');
  });

  it('asks for a stop before sizing by risk', () => {
    expect(previewTicket({ ...base, sizeMode: 'risk', size: 1 }).problem).toBe('Sizing by risk needs a stop-loss price.');
  });

  it('names the problem instead of letting the engine reject the order', () => {
    expect(previewTicket({ ...base, size: 5 }).problem).toMatch(/you have \$100,000\.00 in cash/);
    expect(previewTicket({ ...base, side: 'sell' }).problem).toMatch(/Spot cannot go short/);
    expect(previewTicket({ ...base, sl: 65_000 }).problem).toBe('The stop-loss must be below the entry price.');
    expect(previewTicket({ ...base, type: 'stop', price: 60_000 }).problem).toBe('A buy stop must be above the last price.');
    expect(previewTicket({ ...base, quote: undefined }).problem).toBe('Waiting for a live price.');
    expect(previewTicket({ ...base, mode: 'lev', leverage: 20, sl: 50_000 }).problem).toMatch(/beyond the liquidation price/);
  });

  it('charges the maker fee on a resting limit and the taker fee on one that crosses', () => {
    const resting = previewTicket({ ...base, type: 'limit', price: 63_000, size: 1 });
    expect(resting.fee).toBeCloseTo(63_000 * 0.0002, 8);
    const crossing = previewTicket({ ...base, type: 'limit', price: 64_300, size: 1 });
    expect(crossing.fee).toBeCloseTo(64_300 * 0.0005, 8);
  });

  it('finds the largest affordable size', () => {
    const q = maxQty({ ...base }, 64_210);
    expect(previewTicket({ ...base, size: q }).problem).toBeNull();
    expect(q * 64_210).toBeGreaterThan(99_000);
    expect(maxQty({ ...base, side: 'sell', held: 2 }, 64_210)).toBe(2);
  });
});
