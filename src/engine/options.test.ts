import { describe, expect, it } from 'vitest';
import { createAccount, evaluate, expiredOptions, lockedQty, placeOrder, setBrackets, settleOption, valuation } from './engine';
import { DEFAULT_SETTINGS, posKey, type Account, type EngineSettings, type OptionSpec, type OrderInput, type Quote } from './types';

// One test, at least, for every option rule in docs/brief-02-every-market.md.

const S: EngineSettings = { ...DEFAULT_SETTINGS, fees: { ...DEFAULT_SETTINGS.fees, optionContract: 0.5 } };
const T0 = Date.UTC(2026, 10, 17, 15);
const EXPIRY = Date.UTC(2026, 11, 18, 21);

const stockOpt = (kind: 'call' | 'put', strike: number, expiry = EXPIRY): OptionSpec => ({ underlying: 'stock:AAPL', kind, strike, expiry, multiplier: 100, venue: 'alpaca' });
const coinOpt = (kind: 'call' | 'put', strike: number, expiry = EXPIRY, daily = false): OptionSpec => ({ underlying: 'crypto:BTC', kind, strike, expiry, multiplier: 1, venue: 'deribit', ...(daily ? { daily } : {}) });
const id = (o: OptionSpec) => `opt:${o.venue}:${o.underlying}-${o.kind}-${o.strike}-${o.expiry}`;

const quote = (bid: number, ask: number, underlying?: number): Quote => ({ bid, ask, last: (bid + ask) / 2, t: T0, ...(underlying !== undefined ? { underlying } : {}) });

function order(spec: OptionSpec, side: 'buy' | 'sell', contracts: number, extra: Partial<OrderInput> = {}): OrderInput {
  return { instrument: id(spec), cls: 'option', mode: 'spot', side, type: 'market', qty: contracts * spec.multiplier, option: spec, ...extra };
}

function place(a: Account, input: OrderInput, q: Quote, t = T0) {
  return placeOrder(a, input, q, S, t);
}

/** An account holding shares or coins, bought at `price`. */
function holding(instrument: string, cls: 'stock' | 'crypto', qty: number, price: number, cash = 100_000): Account {
  const r = placeOrder(createAccount(cash, T0), { instrument, cls, mode: 'spot', side: 'buy', type: 'market', qty }, { bid: price, ask: price, last: price, t: T0 }, { ...S, fees: { ...S.fees, cryptoTaker: 0 } }, T0);
  expect(r.events[0]?.type).toBe('fill');
  return r.account;
}

const reason = (events: { type: string }[]): string => {
  const e = events.find((x) => x.type === 'rejected') as { reason: string } | undefined;
  return e?.reason ?? '';
};

describe('buying an option', () => {
  it('a stock option contract covers 100 shares and pays a fee per contract', () => {
    const spec = stockOpt('call', 200);
    const r = place(createAccount(100_000, T0), order(spec, 'buy', 2), quote(3.9, 4.1));
    // Two contracts at the ask: 200 shares' worth at $4.10, plus 2 × $0.50.
    expect(r.account.cash).toBeCloseTo(100_000 - 200 * 4.1 - 1, 9);
    const pos = r.account.positions[posKey(id(spec), 'spot')]!;
    expect(pos).toMatchObject({ qty: 200, entry: 4.1, dir: 'long', margin: 0, option: spec });
  });

  it('a Deribit option covers one coin; its fee is a share of the underlying, capped at a share of the premium', () => {
    const spec = coinOpt('call', 70_000);
    // 3 basis points of $65,000 is $19.50 a coin; the premium is $2,400, so the 12.5% cap ($300) does not bite.
    const dear = place(createAccount(100_000, T0), order(spec, 'buy', 1), quote(2_300, 2_400, 65_000));
    expect(dear.account.cash).toBeCloseTo(100_000 - 2_400 - 19.5, 9);
    // A $40 option: 12.5% of the premium is $5, less than $19.50, so the cap is the fee.
    const cheap = place(createAccount(100_000, T0), order(spec, 'buy', 1), quote(38, 40, 65_000));
    expect(cheap.account.cash).toBeCloseTo(100_000 - 40 - 5, 9);
    // A tenth of a contract is the smallest size.
    const tenth = place(createAccount(100_000, T0), order(spec, 'buy', 0.1), quote(2_300, 2_400, 65_000));
    expect(tenth.account.positions[posKey(id(spec), 'spot')]!.qty).toBeCloseTo(0.1, 9);
    expect(reason(place(createAccount(100_000, T0), order(spec, 'buy', 0.05), quote(2_300, 2_400, 65_000)).events)).toMatch(/steps of 0.1/);
  });

  it('costs the premium, and the premium is the most it can lose', () => {
    const spec = stockOpt('call', 200);
    const bought = place(createAccount(10_000, T0), order(spec, 'buy', 1), quote(3.9, 4.1)).account;
    const paid = 10_000 - bought.cash;
    expect(paid).toBeCloseTo(410.5, 9);
    // The stock collapses: the call expires worthless and nothing more is owed.
    const after = settleOption(bought, id(spec), 50, S, EXPIRY).account;
    expect(after.cash).toBeCloseTo(bought.cash, 9);
    expect(after.trades[0]!.pnl).toBeCloseTo(-paid, 9);
    expect(Object.keys(after.positions)).toHaveLength(0);
  });

  it('is refused without the cash for the premium', () => {
    const r = place(createAccount(300, T0), order(stockOpt('call', 200), 'buy', 1), quote(3.9, 4.1));
    expect(reason(r.events)).toBe('Not enough cash for the premium.');
  });

  it('trades in whole contracts for stocks, and never after expiry', () => {
    const spec = stockOpt('call', 200);
    expect(reason(place(createAccount(), order(spec, 'buy', 1.5), quote(3.9, 4.1)).events)).toBe('Options trade in whole contracts.');
    expect(reason(place(createAccount(), order(spec, 'buy', 1), quote(3.9, 4.1), EXPIRY + 1).events)).toBe('This option has expired.');
    expect(reason(place(createAccount(), order(spec, 'buy', 1, { type: 'stop', stop: 5 }), quote(3.9, 4.1)).events)).toMatch(/not stops/);
    expect(reason(place(createAccount(), order(spec, 'buy', 1, { sl: 2 }), quote(3.9, 4.1)).events)).toMatch(/not offered on options/);
  });
});

describe('prices', () => {
  it('buys fill at the ask and sells at the bid', () => {
    const spec = stockOpt('put', 190);
    const bought = place(createAccount(100_000, T0), order(spec, 'buy', 1), quote(2, 2.4));
    expect(bought.events[0]).toMatchObject({ type: 'fill', fill: { price: 2.4, side: 'buy' } });
    const sold = place(bought.account, order(spec, 'sell', 1), quote(2.6, 3));
    expect(sold.events.find((e) => e.type === 'fill')).toMatchObject({ fill: { price: 2.6, side: 'sell' } });
    // Bought at 2.40, sold at 2.60, 100 shares, two fees of $0.50.
    expect(sold.account.trades[0]!.pnl).toBeCloseTo(20 - 1, 9);
  });

  it('a limit rests until the other side reaches it', () => {
    const spec = stockOpt('call', 200);
    const rested = place(createAccount(100_000, T0), order(spec, 'buy', 1, { type: 'limit', limit: 4 }), quote(3.9, 4.1));
    expect(rested.events[0]?.type).toBe('rested');
    expect(evaluate(rested.account, id(spec), quote(3.95, 4.05), S).events).toHaveLength(0);
    const filled = evaluate(rested.account, id(spec), quote(3.8, 4), S);
    expect(filled.events[0]).toMatchObject({ type: 'fill', fill: { price: 4 } });
  });

  it('positions are marked at the mid', () => {
    const spec = stockOpt('call', 200);
    const a = place(createAccount(100_000, T0), order(spec, 'buy', 1), quote(3.9, 4.1)).account;
    const q = quote(5, 5.4);
    const v = valuation(a, { [id(spec)]: q.last });
    expect(v.holdings).toBeCloseTo(100 * 5.2, 9);
    expect(v.equity).toBeCloseTo(a.cash + 520, 9);
  });
});

describe('selling an option needs cover', () => {
  it('a call with no shares held is refused, and says why', () => {
    const r = place(createAccount(100_000, T0), order(stockOpt('call', 210), 'sell', 1), quote(2, 2.2));
    expect(reason(r.events)).toMatch(/Selling a call needs cover/);
    expect(reason(r.events)).toMatch(/does not allow uncovered short options/);
    expect(Object.keys(r.account.positions)).toHaveLength(0);
  });

  it('a covered call: 100 shares stand behind each contract and cannot be sold while they do', () => {
    const spec = stockOpt('call', 210);
    const start = holding('stock:AAPL', 'stock', 150, 200);
    const r = place(start, order(spec, 'sell', 1), quote(2, 2.2));
    expect(r.events[0]).toMatchObject({ type: 'fill', fill: { price: 2, side: 'sell' } });
    // The premium comes in (100 × $2, less the fee); no cash is set aside.
    expect(r.account.cash).toBeCloseTo(start.cash + 200 - 0.5, 9);
    const short = r.account.positions[posKey(id(spec), 'lev')]!;
    expect(short).toMatchObject({ dir: 'short', qty: 100, margin: 0, cover: { kind: 'shares', key: posKey('stock:AAPL', 'spot') } });
    expect(lockedQty(r.account, posKey('stock:AAPL', 'spot'))).toBe(100);

    // 150 shares, 100 of them cover the call: 50 can be sold, 60 cannot.
    const px = { bid: 205, ask: 205, last: 205, t: T0 };
    const sell = (qty: number) => placeOrder(r.account, { instrument: 'stock:AAPL', cls: 'stock', mode: 'spot', side: 'sell', type: 'market', qty }, px, S, T0);
    expect(sell(50).events[0]?.type).toBe('fill');
    expect(reason(sell(60).events)).toMatch(/cover a call you sold/);
    // A second contract has only 50 free shares behind it.
    expect(reason(place(r.account, order(spec, 'sell', 1), quote(2, 2.2)).events)).toMatch(/already sold this contract against different cover|needs cover/);

    // Buying the call back frees the shares.
    const back = place(r.account, order(spec, 'buy', 1), quote(1, 1.2));
    expect(back.account.positions[posKey(id(spec), 'lev')]).toBeUndefined();
    expect(lockedQty(back.account, posKey('stock:AAPL', 'spot'))).toBe(0);
    expect(back.account.trades.find((t) => t.instrument === id(spec))!.pnl).toBeCloseTo((2 - 1.2) * 100 - 1, 9);
  });

  it('a cash-secured put sets the strike aside for every share', () => {
    const spec = stockOpt('put', 190);
    const r = place(createAccount(25_000, T0), order(spec, 'sell', 1), quote(3, 3.2));
    // $300 premium in, $0.50 fee, $19,000 set aside.
    expect(r.account.cash).toBeCloseTo(25_000 + 300 - 0.5 - 19_000, 9);
    expect(r.account.positions[posKey(id(spec), 'lev')]).toMatchObject({ margin: 19_000, cover: { kind: 'cash' }, dir: 'short' });
    // Equity moves only by the fee and the half-spread: the cash set aside is still the account's.
    expect(valuation(r.account, { [id(spec)]: 3.1 }).equity).toBeCloseTo(25_000 - 0.5 - 10, 9);

    const poor = place(createAccount(10_000, T0), order(spec, 'sell', 1), quote(3, 3.2));
    expect(reason(poor.events)).toMatch(/sets aside the strike price for every unit: \$19,000/);
  });

  it('a spread: a bought option caps the loss, the gap between strikes is set aside, and the bought leg is held', () => {
    const longLeg = stockOpt('call', 200);
    const shortLeg = stockOpt('call', 190);
    const a = place(createAccount(10_000, T0), order(longLeg, 'buy', 1), quote(5.8, 6)).account;
    const r = place(a, order(shortLeg, 'sell', 1), quote(11, 11.4));
    expect(r.events[0]?.type).toBe('fill');
    // Sold the 190 call against the 200 call: at worst both finish in the money and the pair loses $10 a share.
    expect(r.account.positions[posKey(id(shortLeg), 'lev')]).toMatchObject({ margin: 1_000, cover: { kind: 'spread', key: posKey(id(longLeg), 'spot') } });
    expect(r.account.cash).toBeCloseTo(a.cash + 1_100 - 0.5 - 1_000, 9);
    expect(reason(place(r.account, order(longLeg, 'sell', 1), quote(5.8, 6)).events)).toMatch(/cover one you sold/);

    // The other way round (sell the dearer strike) is a debit spread: nothing more can be lost, nothing is set aside.
    const debit = place(a, order(stockOpt('call', 210), 'sell', 1), quote(2, 2.2));
    expect(debit.account.positions[posKey(id(stockOpt('call', 210)), 'lev')]).toMatchObject({ margin: 0, cover: { kind: 'spread' } });

    // A bought option that expires sooner covers nothing.
    const early = place(createAccount(10_000, T0), order(stockOpt('call', 200, EXPIRY - 86_400_000), 'buy', 1), quote(5.8, 6)).account;
    expect(reason(place(early, order(shortLeg, 'sell', 1), quote(11, 11.4)).events)).toMatch(/needs cover/);
  });

  it('a put spread is preferred to setting the whole strike aside', () => {
    const a = place(createAccount(10_000, T0), order(stockOpt('put', 180), 'buy', 1), quote(1.8, 2)).account;
    const r = place(a, order(stockOpt('put', 190), 'sell', 1), quote(3, 3.2));
    expect(r.account.positions[posKey(id(stockOpt('put', 190)), 'lev')]).toMatchObject({ margin: 1_000, cover: { kind: 'spread' } });
  });

  it('nothing liquidates or stops out a sold option', () => {
    const spec = stockOpt('put', 190);
    const a = place(createAccount(25_000, T0), order(spec, 'sell', 1), quote(3, 3.2)).account;
    const worse = evaluate(a, id(spec), quote(60, 61), S);
    expect(worse.account.positions[posKey(id(spec), 'lev')]).toBeDefined();
    expect(worse.events.filter((e) => e.type === 'liquidated')).toHaveLength(0);
    expect(setBrackets(a, posKey(id(spec), 'lev'), { sl: 10 }, S, T0).account.orders.filter((o) => o.status === 'working')).toHaveLength(0);
  });
});

describe('expiry', () => {
  it('a call settles in cash at what it is worth, times the multiplier', () => {
    const spec = stockOpt('call', 200);
    const a = place(createAccount(100_000, T0), order(spec, 'buy', 2), quote(3.9, 4.1)).account;
    const r = settleOption(a, id(spec), 212.5, S, EXPIRY);
    expect(r.account.cash).toBeCloseTo(a.cash + 12.5 * 200, 9);
    expect(r.events.some((e) => e.type === 'closed')).toBe(true);
    expect(r.account.fills.at(-1)).toMatchObject({ liquidity: 'settlement', price: 12.5, qty: 200, side: 'sell' });
    expect(r.account.trades[0]!.pnl).toBeCloseTo((12.5 - 4.1) * 200 - 1, 9);
  });

  it('a put settles at strike less underlying, or nothing', () => {
    const spec = stockOpt('put', 190);
    const a = place(createAccount(100_000, T0), order(spec, 'buy', 1), quote(2, 2.4)).account;
    expect(settleOption(a, id(spec), 181, S, EXPIRY).account.cash).toBeCloseTo(a.cash + 900, 9);
    expect(settleOption(a, id(spec), 195, S, EXPIRY).account.cash).toBeCloseTo(a.cash, 9);
  });

  it('a cash-secured put gets back what was set aside, less what the put is owed', () => {
    const spec = stockOpt('put', 190);
    const a = place(createAccount(25_000, T0), order(spec, 'sell', 1), quote(3, 3.2)).account;
    // Finishes at 185: the put is owed $5 a share.
    const itm = settleOption(a, id(spec), 185, S, EXPIRY).account;
    expect(itm.cash).toBeCloseTo(25_000 + 300 - 0.5 - 500, 9);
    expect(itm.trades[0]!.pnl).toBeCloseTo(300 - 500 - 0.5, 9);
    // Finishes above the strike: the premium is kept.
    const otm = settleOption(a, id(spec), 200, S, EXPIRY).account;
    expect(otm.cash).toBeCloseTo(25_000 + 300 - 0.5, 9);
  });

  it('a covered call in the money is paid in cash; shares are sold only if the cash is short', () => {
    const spec = stockOpt('call', 210);
    const rich = place(holding('stock:AAPL', 'stock', 100, 200), order(spec, 'sell', 1), quote(2, 2.2)).account;
    const paid = settleOption(rich, id(spec), 220, S, EXPIRY).account;
    expect(paid.cash).toBeCloseTo(rich.cash - 1_000, 9);
    expect(paid.positions[posKey('stock:AAPL', 'spot')]!.qty).toBe(100);

    // All the cash is in the shares: $200 premium (less the fee) is all there is to pay a $1,000 debt.
    // (The share purchase pays a basis point of slippage: $20,002 buys exactly 100 shares.)
    const poor = place(holding('stock:AAPL', 'stock', 100, 200, 20_002), order(spec, 'sell', 1), quote(2, 2.2)).account;
    expect(poor.cash).toBeCloseTo(199.5, 9);
    const settled = settleOption(poor, id(spec), 220, S, EXPIRY).account;
    expect(settled.cash).toBeCloseTo(0, 6);
    expect(settled.positions[posKey('stock:AAPL', 'spot')]!.qty).toBeCloseTo(100 - (1_000 - 199.5) / 220, 9);
  });

  it('both legs of a spread settle, the bought leg first', () => {
    const longLeg = stockOpt('call', 200);
    const shortLeg = stockOpt('call', 190);
    let a = place(createAccount(1_700, T0), order(longLeg, 'buy', 1), quote(5.8, 6)).account;
    a = place(a, order(shortLeg, 'sell', 1), quote(11, 11.4)).account;
    const due = expiredOptions(a, EXPIRY + 1);
    expect(due.map((x) => x.instrument)).toEqual([id(longLeg), id(shortLeg)]);
    expect(expiredOptions(a, EXPIRY - 1)).toHaveLength(0);
    for (const x of due) a = settleOption(a, x.instrument, 230, S, EXPIRY).account;
    // Paid $600, took in $1,100, two fees; at 230 the pair loses its full $10 a share.
    expect(a.cash).toBeCloseTo(1_700 - 600 - 0.5 + 1_100 - 0.5 - 1_000, 9);
    expect(Object.keys(a.positions)).toHaveLength(0);
  });

  it('a Deribit option pays a delivery fee, capped, unless it is a daily', () => {
    const spec = coinOpt('call', 60_000);
    const a = place(createAccount(100_000, T0), order(spec, 'buy', 1), quote(5_900, 6_000, 65_000)).account;
    // Settles with the index at 66,000: worth $6,000; fee 1.5 basis points of 66,000 = $9.90.
    expect(settleOption(a, id(spec), 66_000, S, EXPIRY).account.cash).toBeCloseTo(a.cash + 6_000 - 9.9, 9);
    // Worth $40 at expiry: the cap (12.5% of $40 = $5) is less than $9.01.
    expect(settleOption(a, id(spec), 60_040, S, EXPIRY).account.cash).toBeCloseTo(a.cash + 40 - 5, 9);
    const daily = coinOpt('call', 60_000, EXPIRY, true);
    const b = place(createAccount(100_000, T0), order(daily, 'buy', 1), quote(5_900, 6_000, 65_000)).account;
    expect(settleOption(b, id(daily), 66_000, S, EXPIRY).account.cash).toBeCloseTo(b.cash + 6_000, 9);
  });

  it('an order still working on an expired option is cancelled', () => {
    const spec = stockOpt('call', 200);
    const a = place(createAccount(100_000, T0), order(spec, 'buy', 1, { type: 'limit', limit: 1 }), quote(3.9, 4.1)).account;
    expect(expiredOptions(a, EXPIRY + 1)).toHaveLength(1);
    const r = settleOption(a, id(spec), 150, S, EXPIRY);
    expect(r.account.orders.filter((o) => o.status === 'working')).toHaveLength(0);
  });

  it("the drawer's close order needs no contract details: the position carries them", () => {
    const spec = stockOpt('put', 190);
    const a = place(createAccount(25_000, T0), order(spec, 'sell', 1), quote(3, 3.2)).account;
    const close: OrderInput = { instrument: id(spec), cls: 'option', mode: 'lev', side: 'buy', type: 'market', qty: 100, reduceOnly: true };
    const r = place(a, close, quote(1, 1.2));
    expect(r.events.find((e) => e.type === 'fill')).toMatchObject({ fill: { price: 1.2, side: 'buy' } });
    expect(r.account.cash).toBeCloseTo(25_000 + 300 - 0.5 - 120 - 0.5, 9);
  });
});
