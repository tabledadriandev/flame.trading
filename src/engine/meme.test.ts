import { describe, expect, it } from 'vitest';
import { createAccount, placeOrder, valuation } from './engine';
import { buyFromPool, exitValue, poolPrice, type Pool } from './pool';
import { DEFAULT_SETTINGS, posKey, type Account, type OrderInput, type Quote } from './types';

// One test, at least, for every memecoin rule in docs/brief-02-every-market.md.

const T0 = Date.UTC(2026, 10, 17, 15);
const ID = 'dex:solana:5AFbwVSQPJf4cgEjq4TajZYyPYUvYktrRN3SahNrPnmv';
// 1,000,000 tokens against $50,000: five cents a token, $100,000 of liquidity, a 0.3% fee.
const POOL: Pool = { tokens: 1_000_000, dollars: 50_000, fee: 0.003 };

const quote = (pool: Pool, extra: Partial<Quote> = {}): Quote => ({ bid: poolPrice(pool), ask: poolPrice(pool), last: poolPrice(pool), t: T0, pool, ...extra });
const order = (side: 'buy' | 'sell', qty: number, extra: Partial<OrderInput> = {}): OrderInput => ({ instrument: ID, cls: 'meme', mode: 'spot', side, type: 'market', qty, ...extra });
const place = (a: Account, input: OrderInput, q: Quote | undefined) => placeOrder(a, input, q, DEFAULT_SETTINGS, T0);
const reason = (events: { type: string }[]): string => (events.find((e) => e.type === 'rejected') as { reason: string } | undefined)?.reason ?? '';

/** Spend `dollars` on the token, the way the ticket does: it sizes the order in tokens from the pool. */
function buy(a: Account, dollars: number, pool = POOL) {
  const tokens = buyFromPool(pool, dollars).tokens;
  return { tokens, ...place(a, order('buy', tokens), quote(pool)) };
}

describe('a token fills from its pool', () => {
  it('spending Δy buys x·Δy / (y + Δy) tokens, less the pool fee', () => {
    const r = buy(createAccount(10_000, T0), 1_000);
    const net = 1_000 / 1.003;
    expect(r.tokens).toBeCloseTo((1_000_000 * net) / (50_000 + net), 6);
    // The whole $1,000 leaves cash: what reached the pool, and the fee.
    expect(r.account.cash).toBeCloseTo(9_000, 6);
    const fill = r.account.fills[0]!;
    expect(fill.price).toBeCloseTo(net / r.tokens, 12);
    expect(fill.fee).toBeCloseTo(net * 0.003, 9);
    expect(fill.price).toBeGreaterThan(0.05);
    expect(r.account.positions[posKey(ID, 'spot')]).toMatchObject({ qty: r.tokens, liquidity0: 100_000, cls: 'meme' });
  });

  it('the fill matches the price impact the ticket showed', () => {
    const shown = buyFromPool(POOL, 100);
    const r = buy(createAccount(10_000, T0), 100);
    expect(r.account.fills[0]!.price).toBeCloseTo(shown.price, 12);
    expect(shown.impact).toBeCloseTo(shown.dollars / 50_000, 9);
    // A thin pool: the same $100 moves the price about 20%.
    const thin: Pool = { tokens: 10_000, dollars: 500, fee: 0.003 };
    expect(buyFromPool(thin, 100).impact).toBeCloseTo(100 / 1.003 / 500, 9);
    // $100 is more than 2% of a $1,000 pool; $20 is the most it takes.
    const small = buy(createAccount(10_000, T0), 20, thin);
    expect(small.account.fills[0]!.price).toBeCloseTo(buyFromPool(thin, 20).price, 12);
  });

  it('selling is the mirror, at the pool price for that size', () => {
    const bought = buy(createAccount(10_000, T0), 1_000);
    const sold = place(bought.account, order('sell', bought.tokens), quote(POOL));
    const out = (50_000 * bought.tokens) / (1_000_000 + bought.tokens);
    expect(sold.account.cash).toBeCloseTo(9_000 + out * (1 - 0.003), 6);
    expect(sold.account.trades[0]!.closedAt).toBe(T0);
    expect(sold.account.trades[0]!.pnl).toBeLessThan(0);
  });
});

describe('what a token cannot do', () => {
  it('spot only: no leverage, no shorting', () => {
    expect(reason(place(createAccount(), order('buy', 100, { mode: 'lev', leverage: 3 }), quote(POOL)).events)).toMatch(/spot only/);
    expect(reason(place(createAccount(), order('sell', 100), quote(POOL)).events)).toMatch(/cannot go short/);
  });

  it('market orders only: there is no book to rest in, and no stops', () => {
    expect(reason(place(createAccount(), order('buy', 100, { type: 'limit', limit: 0.04 }), quote(POOL)).events)).toMatch(/no order book/);
    expect(reason(place(createAccount(), order('buy', 100, { sl: 0.01 }), quote(POOL)).events)).toMatch(/not offered on tokens/);
  });

  it('one order may not exceed 2% of the pool, and the refusal says why', () => {
    // 2% of $100,000 is $2,000.
    expect(buy(createAccount(10_000, T0), 1_990).events.some((e) => e.type === 'fill')).toBe(true);
    const r = buy(createAccount(10_000, T0), 2_100);
    expect(reason(r.events)).toMatch(/more than 2% of the pool's liquidity \(\$2,000 here\)/);
    expect(reason(r.events)).toMatch(/could not be sold back/);
    expect(Object.keys(r.account.positions)).toHaveLength(0);
  });

  it('is refused without a fresh reading of the pool', () => {
    expect(reason(place(createAccount(), order('buy', 100), { bid: 0.05, ask: 0.05, last: 0.05, t: T0 }).events)).toMatch(/no fresh reading of the pool/);
    expect(reason(place(createAccount(), order('buy', 100), undefined).events)).toMatch(/no fresh reading of the pool/);
  });
});

describe('marking and rugs', () => {
  it('a position is marked at what the pool would pay for all of it now', () => {
    const { account, tokens } = buy(createAccount(10_000, T0), 1_000);
    const mark = exitValue(POOL, tokens) / tokens;
    const v = valuation(account, { [ID]: mark });
    expect(v.holdings).toBeCloseTo(exitValue(POOL, tokens), 9);
    // Less than the last price says: the difference is the price impact of getting out, and the fee.
    expect(v.holdings).toBeLessThan(tokens * poolPrice(POOL));
  });

  it('a drained pool marks the position near zero, and the closed trade is tagged rugged', () => {
    const { account, tokens } = buy(createAccount(10_000, T0), 1_000);
    // The liquidity is pulled: $60 left on the dollar side. The price on the screen barely looks different.
    const drained: Pool = { tokens: 1_200, dollars: 60, fee: 0.003 };
    expect(poolPrice(drained)).toBeCloseTo(0.05, 9);
    expect(exitValue(drained, tokens)).toBeLessThan(60);

    const sold = place(account, order('sell', tokens), quote(drained));
    const trade = sold.account.trades[0]!;
    expect(trade.rugged).toBe(true);
    expect(trade.pnl).toBeLessThan(-940);
    expect(sold.events.find((e) => e.type === 'closed')).toMatchObject({ trade: { rugged: true } });
  });

  it('an ordinary loss is not a rug', () => {
    const { account, tokens } = buy(createAccount(10_000, T0), 1_000);
    const lower: Pool = { tokens: 1_400_000, dollars: 35_000, fee: 0.003 };
    const sold = place(account, order('sell', tokens), quote(lower));
    expect(sold.account.trades[0]!.rugged).toBeUndefined();
    expect(sold.account.trades[0]!.pnl).toBeLessThan(0);
  });
});

describe('a contract that stops or taxes sales', () => {
  it('a paper sale fails with the reason when holders can be stopped from selling', () => {
    const { account, tokens } = buy(createAccount(10_000, T0), 500);
    const r = place(account, order('sell', tokens), quote(POOL, { sellBlocked: 'RugCheck reports that this token can be frozen in holders’ accounts. A frozen account cannot sell.' }));
    expect(reason(r.events)).toBe('This sale would fail. RugCheck reports that this token can be frozen in holders’ accounts. A frozen account cannot sell.');
    expect(r.account.positions[posKey(ID, 'spot')]!.qty).toBeCloseTo(tokens, 9);
    // Buying is still allowed: that is how people end up holding these.
    expect(place(account, order('buy', 100), quote(POOL, { sellBlocked: 'x' })).events.some((e) => e.type === 'fill')).toBe(true);
  });

  it('a transfer tax comes out of the proceeds of a sale', () => {
    const { account, tokens } = buy(createAccount(10_000, T0), 500);
    const plain = place(account, order('sell', tokens), quote(POOL)).account.cash;
    const taxed = place(account, order('sell', tokens), quote(POOL, { sellTax: 0.1 })).account.cash;
    const out = (50_000 * tokens) / (1_000_000 + tokens);
    expect(plain - taxed).toBeCloseTo(out * 0.1, 6);
  });
});
