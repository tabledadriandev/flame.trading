import { describe, expect, it } from 'vitest';
import { createAccount, placeOrder, valuation } from './engine';
import { buyFromPool, exitValue, poolPrice, tokensFor, type Pool } from './pool';
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

describe('found in review', () => {
  it('splitting a buy into pieces gets no more tokens than one order: each continues up the curve from what is held', () => {
    const whole = buy(createAccount(100_000, T0), 1_500);
    let a = createAccount(100_000, T0);
    let tokens = 0;
    for (let i = 0; i < 3; i++) {
      const held = a.positions[posKey(ID, 'spot')]?.qty ?? 0;
      const qty = tokensFor(POOL, held, 500);
      a = place(a, order('buy', qty), quote(POOL)).account;
      tokens += qty;
    }
    expect(tokens).toBeCloseTo(whole.tokens, 4);
    expect(a.cash).toBeCloseTo(whole.account.cash, 6);
  });

  it('the cap is on the position, not on each order', () => {
    // $2,000 is the most this pool supports. $1,500 is held; $600 more would pass it.
    const first = buy(createAccount(100_000, T0), 1_500);
    const more = tokensFor(POOL, first.tokens, 600);
    expect(reason(place(first.account, order('buy', more), quote(POOL)).events)).toMatch(/A position may not be more than 2%.*already hold some/);
    expect(place(first.account, order('buy', tokensFor(POOL, first.tokens, 400)), quote(POOL)).events.some((e) => e.type === 'fill')).toBe(true);
  });

  it('selling in pieces returns what selling it all at once would', () => {
    const { account, tokens } = buy(createAccount(100_000, T0), 1_500);
    const once = place(account, order('sell', tokens), quote(POOL)).account.cash;
    let a = account;
    for (const part of [tokens / 4, tokens / 4, tokens / 2]) a = place(a, order('sell', part), quote(POOL)).account;
    expect(a.cash).toBeCloseTo(once, 6);
    expect(Object.keys(a.positions)).toHaveLength(0);
  });

  it('an empty pool: nothing can be bought, and a sale returns nothing but closes the trade as a rug', () => {
    const { account, tokens } = buy(createAccount(10_000, T0), 1_000);
    const empty: Pool = { tokens: 0, dollars: 0, fee: 0.003 };
    const q: Quote = { bid: 0, ask: 0, last: 0, t: T0, pool: empty };
    expect(reason(place(account, order('buy', 100), q).events)).toMatch(/pool is empty/);
    const sold = place(account, order('sell', tokens), q);
    expect(sold.account.cash).toBeCloseTo(account.cash, 9);
    expect(sold.account.trades[0]).toMatchObject({ rugged: true, closedQty: tokens });
    expect(sold.account.trades[0]!.pnl).toBeCloseTo(-1_000, 6);
    expect(Object.keys(sold.account.positions)).toHaveLength(0);
  });

  it('a pool with impossible numbers is refused, not filled for free', () => {
    for (const pool of [{ tokens: NaN, dollars: 100, fee: 0.003 }, { tokens: 100, dollars: -1, fee: 0.003 }, { tokens: 100, dollars: 100, fee: 1.5 }]) {
      expect(reason(place(createAccount(), order('buy', 10), { bid: 1, ask: 1, last: 1, t: T0, pool }).events)).toMatch(/no fresh reading of the pool/);
    }
  });

  it('what the risk source said at the buy stays with the position when the report cannot be read later', () => {
    const blocked = 'RugCheck reports that this token can be frozen.';
    const tokens = buyFromPool(POOL, 500).tokens;
    const bought = place(createAccount(10_000, T0), order('buy', tokens), quote(POOL, { sellBlocked: blocked, sellTax: 0.1 })).account;
    expect(bought.positions[posKey(ID, 'spot')]).toMatchObject({ sellBlocked: blocked, sellTax: 0.1 });
    // After a reload the quote carries no report: the sale is still refused.
    expect(reason(place(bought, order('sell', tokens), quote(POOL)).events)).toBe(`This sale would fail. ${blocked}`);

    const taxedOnly = place(createAccount(10_000, T0), order('buy', tokens), quote(POOL, { sellTax: 0.1 })).account;
    const out = (50_000 * tokens) / (1_000_000 + tokens);
    expect(place(taxedOnly, order('sell', tokens), quote(POOL)).account.cash).toBeCloseTo(taxedOnly.cash + out * (1 - 0.003 - 0.1), 6);
  });

  it('a fee and tax of more than everything take everything, never more', () => {
    const { account, tokens } = buy(createAccount(10_000, T0), 500);
    const sold = place(account, order('sell', tokens), quote({ ...POOL, fee: 0.3 }, { sellTax: 0.9 })).account;
    expect(sold.cash).toBeCloseTo(account.cash, 6);
  });

  it('the liquidity a drain is judged against is the average over the buys, by size', () => {
    // $10 bought when the pool held $1,000,000; $1,500 more when it held $100,000.
    const big: Pool = { tokens: 10_000_000, dollars: 500_000, fee: 0.003 };
    const first = buy(createAccount(100_000, T0), 10, big);
    const more = tokensFor(POOL, first.tokens, 1_500);
    const a = place(first.account, order('buy', more), quote(POOL)).account;
    const l0 = a.positions[posKey(ID, 'spot')]!.liquidity0!;
    expect(l0).toBeGreaterThan(100_000);
    expect(l0).toBeLessThan(110_000);
    // Sold into a $94,000 pool: nothing like a tenth of what was there when most of it was bought.
    const later: Pool = { tokens: 1_060_000, dollars: 47_000, fee: 0.003 };
    const sold = place(a, order('sell', a.positions[posKey(ID, 'spot')]!.qty), quote(later));
    expect(sold.account.trades[0]!.rugged).toBeUndefined();
  });

  it('part sold into a drained pool marks the trade as a rug, and it stays marked', () => {
    const { account, tokens } = buy(createAccount(10_000, T0), 1_000);
    const drained: Pool = { tokens: 1_200, dollars: 60, fee: 0.003 };
    const half = place(account, order('sell', tokens / 2), quote(drained)).account;
    expect(half.trades[0]!.rugged).toBe(true);
    expect(half.trades[0]!.closedAt).toBeUndefined();
    const rest = place(half, order('sell', tokens / 2), quote(POOL)).account;
    expect(rest.trades[0]).toMatchObject({ rugged: true, closedAt: T0 });
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
