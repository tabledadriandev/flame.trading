import { describe, expect, it } from 'vitest';
import { chainFromSummary, quoteFromTick, tickFromTicker } from './deribit';

// Rows copied from Deribit's get_book_summary_by_currency and ticker on 17 November 2026.
const SUMMARY = [
  { instrument_name: 'BTC-25JUN27-88000-C', bid_price: 0.037, ask_price: 0.038, mark_price: 0.03764756, mark_iv: 40.12, open_interest: 75.5, volume: 6, underlying_price: 67157.9, estimated_delivery_price: 64999.61 },
  { instrument_name: 'BTC-25JUN27-88000-P', bid_price: null, ask_price: 0.4, mark_price: 0.35, mark_iv: 41, open_interest: 0, volume: 0, underlying_price: 67157.9, estimated_delivery_price: 64999.61 },
  { instrument_name: 'BTC-18NOV26-52000-C', bid_price: 0.19, ask_price: 0.21, mark_price: 0.2, mark_iv: 55, open_interest: 3, volume: 1, underlying_price: 65010, estimated_delivery_price: 64999.61 },
  { instrument_name: 'BTC-PERPETUAL', mark_price: 65000, estimated_delivery_price: 64999.61 },
  { instrument_name: 'BTC-25JUN27-90000-C', mark_price: 'n/a', estimated_delivery_price: 64999.61 },
];

describe('Deribit chain', () => {
  it('converts coin prices to dollars at the index price', () => {
    const chain = chainFromSummary('BTC', SUMMARY, 1_000);
    expect(chain.index).toBe(64999.61);
    const call = chain.rows.find((r) => r.id === 'opt:deribit:BTC-25JUN27-88000-C')!;
    expect(call.bid).toBeCloseTo(0.037 * 64999.61, 6);
    expect(call.ask).toBeCloseTo(0.038 * 64999.61, 6);
    expect(call.mark).toBeCloseTo(0.03764756 * 64999.61, 6);
    expect(call.iv).toBeCloseTo(0.4012, 9);
    expect(call).toMatchObject({ oi: 75.5, volume: 6, forward: 67157.9 });
    expect(call.spec).toMatchObject({ underlying: 'crypto:BTC', strike: 88000, kind: 'call', multiplier: 1 });
  });

  it('says so when a side has no quote, and drops rows it cannot read', () => {
    const chain = chainFromSummary('BTC', SUMMARY, 1_000);
    expect(chain.rows).toHaveLength(3);
    expect(chain.rows.find((r) => r.spec.kind === 'put')!.bid).toBeNull();
    // Nearest expiry first, then by strike.
    expect(chain.rows[0]!.id).toBe('opt:deribit:BTC-18NOV26-52000-C');
    expect(chainFromSummary('BTC', { not: 'a list' }, 1).rows).toHaveLength(0);
  });
});

describe('Deribit ticker', () => {
  const TICKER = { instrument_name: 'BTC-25JUN27-88000-C', index_price: 65003.68, mark_price: 0.0376, best_bid_price: 0.037, best_ask_price: 0.038, mark_iv: 40.12, underlying_price: 67161.08 };

  it('fills buys at the ask and sells at the bid, in dollars, and marks at the mid', () => {
    const tick = tickFromTicker(TICKER, 5)!;
    const q = quoteFromTick(tick, 9);
    expect(q.bid).toBeCloseTo(0.037 * 65003.68, 6);
    expect(q.ask).toBeCloseTo(0.038 * 65003.68, 6);
    expect(q.last).toBeCloseTo(0.0375 * 65003.68, 6);
    expect(q.underlying).toBe(65003.68);
    expect(q.t).toBe(9);
  });

  it('with nobody offering, a buy can never fill, and the mark falls back to the fair value', () => {
    const q = quoteFromTick(tickFromTicker({ ...TICKER, best_ask_price: 0 }, 5)!, 9);
    expect(q.ask).toBe(Infinity);
    expect(q.last).toBeCloseTo(0.0376 * 65003.68, 6);
    const none = quoteFromTick(tickFromTicker({ ...TICKER, best_bid_price: 0 }, 5)!, 9);
    expect(none.bid).toBe(0);
  });

  it('ignores a message with no index price', () => {
    expect(tickFromTicker({ mark_price: 0.03 }, 1)).toBeNull();
  });
});
