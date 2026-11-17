import { describe, expect, it } from 'vitest';
import {
  amendOrder,
  applyFunding,
  bracketsFor,
  cancelOrder,
  closedTrades,
  createAccount,
  evaluate,
  onBar,
  placeOrder,
  setBrackets,
  settle,
  valuation,
  workingOrders,
} from './engine';
import { barPath, liquidationPrice, marketFill, rMultiple, sizeByRisk, walkBook } from './rules';
import { DEFAULT_SETTINGS as S, posKey, type Account, type OrderInput, type Quote } from './types';

// One test (at least) for every line under "Paper-trading rules" in
// docs/product-spec.md. The headings below follow that section.

const BTC = 'crypto:BTC';
const SPY = 'yahoo:SPY';

const q = (last: number, extra: Partial<Quote> = {}): Quote => ({ bid: last, ask: last, last, t: 1000, ...extra });
const book = (bid: number, ask: number): Quote => ({
  bid,
  ask,
  last: bid,
  t: 1000,
  book: {
    bids: [[bid, 1], [bid - 10, 2], [bid - 20, 5]],
    asks: [[ask, 1], [ask + 10, 2], [ask + 20, 5]],
  },
});

const order = (o: Partial<OrderInput>): OrderInput => ({
  instrument: BTC,
  cls: 'crypto',
  mode: 'spot',
  side: 'buy',
  type: 'market',
  qty: 1,
  ...o,
});

function place(a: Account, o: Partial<OrderInput>, quote?: Quote, t = 1000) {
  return placeOrder(a, order(o), quote, S, t);
}

describe('account', () => {
  it('starts with $100,000 cash and nothing else', () => {
    const a = createAccount();
    expect(a.cash).toBe(100_000);
    expect(valuation(a, {}).equity).toBe(100_000);
    expect(Object.keys(a.positions)).toHaveLength(0);
  });

  it('equity = cash + spot value + margin held + unrealised P&L on leveraged positions', () => {
    let a = createAccount();
    a = place(a, { qty: 0.5 }, q(60_000)).account; // spot
    a = place(a, { instrument: 'crypto:ETH', mode: 'lev', leverage: 5, qty: 10 }, q(2_000)).account;
    const v = valuation(a, { [BTC]: 62_000, 'crypto:ETH': 2_100 });
    expect(v.holdings).toBeCloseTo(0.5 * 62_000, 6);
    expect(v.margin).toBeCloseTo((10 * 2_000 * 1.0001) / 5, 6);
    expect(v.unrealisedLev).toBeCloseTo((2_100 - 2_000 * 1.0001) * 10, 6);
    expect(v.equity).toBeCloseTo(a.cash + v.holdings + v.margin + v.unrealisedLev, 6);
  });

  it('accounts in USD: a USDT price is used as dollars, one for one', () => {
    const a = place(createAccount(), { qty: 1 }, q(50_000)).account;
    // 1 BTC at 50,000 USDT (+1bp slippage, +0.05% fee) leaves exactly that many dollars less.
    const price = 50_000 * 1.0001;
    expect(a.cash).toBeCloseTo(100_000 - price - price * 0.0005, 6);
  });
});

describe('spot', () => {
  it('buying spends cash and selling returns it', () => {
    let a = place(createAccount(), { qty: 1 }, q(50_000)).account;
    const afterBuy = a.cash;
    expect(afterBuy).toBeLessThan(50_000);
    a = place(a, { side: 'sell', qty: 1 }, q(50_000)).account;
    expect(a.cash).toBeGreaterThan(afterBuy);
    expect(a.positions[posKey(BTC, 'spot')]).toBeUndefined();
  });

  it('cannot go short', () => {
    const r = place(createAccount(), { side: 'sell', qty: 1 }, q(50_000));
    expect(r.events[0]).toMatchObject({ type: 'rejected' });
    expect(r.account.cash).toBe(100_000);
    // Nor sell more than is held.
    const a = place(createAccount(), { qty: 1 }, q(50_000)).account;
    expect(place(a, { side: 'sell', qty: 1.5 }, q(50_000)).events[0]).toMatchObject({ type: 'rejected' });
  });

  it('cannot spend more cash than there is', () => {
    const r = place(createAccount(), { qty: 3 }, q(50_000));
    expect(r.events[0]).toMatchObject({ type: 'rejected', reason: 'Not enough cash for this order.' });
    expect(r.account.cash).toBe(100_000);
    expect(r.account.fills).toHaveLength(0);
  });

  it('keeps one position per instrument, averaged on adds', () => {
    let a = place(createAccount(), { qty: 1, type: 'limit', limit: 40_000 }, book(39_990, 40_000)).account;
    a = place(a, { qty: 1, type: 'limit', limit: 30_000 }, book(29_990, 30_000)).account;
    const p = a.positions[posKey(BTC, 'spot')]!;
    expect(Object.keys(a.positions)).toHaveLength(1);
    expect(p.qty).toBe(2);
    expect(p.entry).toBe(35_000);
  });

  it('realises P&L on a sale against the average entry', () => {
    let a = place(createAccount(), { qty: 1, type: 'limit', limit: 40_000 }, book(39_990, 40_000)).account;
    a = place(a, { qty: 1, type: 'limit', limit: 30_000 }, book(29_990, 30_000)).account;
    a = place(a, { side: 'sell', qty: 2, type: 'limit', limit: 36_000 }, { ...book(36_000, 36_010), book: { bids: [[36_000, 5]], asks: [[36_010, 5]] } }).account;
    const tr = closedTrades(a)[0]!;
    expect(tr.gross).toBeCloseTo((36_000 - 35_000) * 2, 6);
    expect(tr.pnl).toBeCloseTo(tr.gross - tr.fees, 6);
  });
});

describe('perp and margin', () => {
  it('takes isolated margin = notional ÷ leverage out of cash while the position is open', () => {
    const a = place(createAccount(), { mode: 'lev', leverage: 10, qty: 1 }, q(50_000)).account;
    const price = 50_000 * 1.0001;
    const p = a.positions[posKey(BTC, 'lev')]!;
    expect(p.margin).toBeCloseTo(price / 10, 6);
    expect(a.cash).toBeCloseTo(100_000 - price / 10 - price * 0.0005, 6);
  });

  it('returns the margin with the P&L when the position closes', () => {
    let a = place(createAccount(), { mode: 'lev', leverage: 10, qty: 1, type: 'limit', limit: 50_000 }, book(49_990, 50_000)).account;
    a = place(a, { mode: 'lev', side: 'sell', qty: 1, reduceOnly: true, type: 'limit', limit: 51_000 }, { ...q(51_000), book: { bids: [[51_000, 5]], asks: [[51_010, 5]] } }).account;
    const fees = 50_000 * 0.0005 + 51_000 * 0.0005;
    expect(a.cash).toBeCloseTo(100_000 + 1_000 - fees, 6);
    expect(a.positions[posKey(BTC, 'lev')]).toBeUndefined();
  });

  it('can be long or short; unrealised P&L = (mark − entry) × size, reversed for shorts', () => {
    const long = place(createAccount(), { mode: 'lev', leverage: 2, qty: 2 }, q(1_000)).account;
    const short = place(createAccount(), { mode: 'lev', leverage: 2, qty: 2, side: 'sell' }, q(1_000)).account;
    const le = long.positions[posKey(BTC, 'lev')]!.entry;
    const se = short.positions[posKey(BTC, 'lev')]!.entry;
    expect(valuation(long, { [BTC]: 1_100 }).unrealisedLev).toBeCloseTo((1_100 - le) * 2, 6);
    expect(valuation(short, { [BTC]: 1_100 }).unrealisedLev).toBeCloseTo((se - 1_100) * 2, 6);
    expect(short.positions[posKey(BTC, 'lev')]!.dir).toBe('short');
  });

  it('allows 1–20× on crypto perps and 1–2× on stocks', () => {
    expect(place(createAccount(), { mode: 'lev', leverage: 20, qty: 0.1 }, q(50_000)).events[0]!.type).toBe('fill');
    expect(place(createAccount(), { mode: 'lev', leverage: 21, qty: 0.1 }, q(50_000)).events[0]!.type).toBe('rejected');
    expect(place(createAccount(), { mode: 'lev', leverage: 0.5, qty: 0.1 }, q(50_000)).events[0]!.type).toBe('rejected');
    const stock = { instrument: SPY, cls: 'stock' as const, mode: 'lev' as const, qty: 10 };
    expect(place(createAccount(), { ...stock, leverage: 2 }, q(500)).events[0]!.type).toBe('fill');
    expect(place(createAccount(), { ...stock, leverage: 3 }, q(500)).events[0]!.type).toBe('rejected');
  });

  it('liquidation price: long entry × (1 − 1/lev + mmr), short entry × (1 + 1/lev − mmr)', () => {
    expect(liquidationPrice('long', 100, 10, 0.005)).toBeCloseTo(100 * (1 - 0.1 + 0.005), 10);
    expect(liquidationPrice('short', 100, 10, 0.005)).toBeCloseTo(100 * (1 + 0.1 - 0.005), 10);
    // Stocks use a 25% maintenance rate.
    expect(liquidationPrice('long', 100, 2, 0.25)).toBeCloseTo(75, 10);
    expect(liquidationPrice('short', 100, 2, 0.25)).toBeCloseTo(125, 10);
  });

  it('liquidates at the liquidation price when the mark crosses it, and the whole margin is lost', () => {
    let a = place(createAccount(), { mode: 'lev', leverage: 10, qty: 1, type: 'limit', limit: 50_000 }, book(49_990, 50_000)).account;
    const cashOpen = a.cash;
    const margin = a.positions[posKey(BTC, 'lev')]!.margin;
    const liq = liquidationPrice('long', 50_000, 10, 0.005); // 45,250

    a = evaluate(a, BTC, q(liq + 1), S).account;
    expect(a.positions[posKey(BTC, 'lev')]).toBeDefined();

    const r = evaluate(a, BTC, q(liq - 300), S);
    expect(r.events.some((e) => e.type === 'liquidated')).toBe(true);
    expect(r.account.positions[posKey(BTC, 'lev')]).toBeUndefined();
    const fill = r.account.fills.at(-1)!;
    expect(fill.liquidity).toBe('liquidation');
    expect(fill.price).toBeCloseTo(liq, 6);
    // Nothing comes back: the loss to the liquidation price plus the maintenance amount is the margin.
    expect(r.account.cash).toBeCloseTo(cashOpen, 6);
    const tr = closedTrades(r.account)[0]!;
    expect(tr.liquidated).toBe(true);
    expect(tr.gross - (tr.fees - 50_000 * 0.0005)).toBeCloseTo(-margin, 6);
    expect(fill.fee).toBeCloseTo(0.005 * 50_000, 6);
  });

  it('liquidates a short when the mark rises through its liquidation price', () => {
    let a = place(createAccount(), { mode: 'lev', leverage: 5, qty: 1, side: 'sell', type: 'limit', limit: 50_000 }, { ...q(50_000), book: { bids: [[50_000, 5]], asks: [[50_010, 5]] } }).account;
    const liq = liquidationPrice('short', 50_000, 5, 0.005);
    a = evaluate(a, BTC, q(liq - 1), S).account;
    expect(a.positions[posKey(BTC, 'lev')]).toBeDefined();
    a = evaluate(a, BTC, q(liq + 1), S).account;
    expect(a.positions[posKey(BTC, 'lev')]).toBeUndefined();
  });

  it('applies funding to a perp: longs pay when the rate is positive, shorts receive', () => {
    const long = place(createAccount(), { mode: 'lev', leverage: 5, qty: 2 }, q(1_000)).account;
    const paid = applyFunding(long, BTC, 0.0001, 1_000, S).account;
    expect(paid.cash).toBeCloseTo(long.cash - 2 * 1_000 * 0.0001, 8);
    expect(paid.trades[0]!.funding).toBeCloseTo(-0.2, 8);

    const short = place(createAccount(), { mode: 'lev', leverage: 5, qty: 2, side: 'sell' }, q(1_000)).account;
    expect(applyFunding(short, BTC, 0.0001, 1_000, S).account.cash).toBeCloseTo(short.cash + 0.2, 8);
    // No feed, no funding: a zero rate changes nothing.
    expect(applyFunding(long, BTC, 0, 1_000, S).account.cash).toBe(long.cash);
  });

  it('flips a position when the order is larger than it', () => {
    let a = place(createAccount(), { mode: 'lev', leverage: 2, qty: 1 }, q(1_000)).account;
    a = place(a, { mode: 'lev', leverage: 2, qty: 3, side: 'sell' }, q(1_000)).account;
    const p = a.positions[posKey(BTC, 'lev')]!;
    expect(p.dir).toBe('short');
    expect(p.qty).toBeCloseTo(2, 9);
    expect(closedTrades(a)).toHaveLength(1);
  });
});

describe('orders', () => {
  it('market: fills at once by walking the live book, at the volume-weighted price', () => {
    const quote = book(49_990, 50_000); // asks: 1 @ 50,000, 2 @ 50,010, 5 @ 50,020
    const r = place(createAccount(), { mode: 'lev', leverage: 5, qty: 2.5 }, quote);
    const vwap = (1 * 50_000 + 1.5 * 50_010) / 2.5;
    expect(r.account.fills[0]!.price).toBeCloseTo(vwap, 6);
    expect(r.account.fills[0]!.liquidity).toBe('taker');
    expect(walkBook(quote.book!.asks, 2.5, 'buy').avg).toBeCloseTo(vwap, 6);
    // A sell walks the bids.
    expect(marketFill(quote, 'sell', 2, undefined).price).toBeCloseTo((49_990 + 49_980) / 2, 6);
  });

  it('market with no book fills at the last price, one basis point against you', () => {
    const buy = place(createAccount(), { instrument: SPY, cls: 'stock', qty: 10 }, q(500));
    expect(buy.account.fills[0]!.price).toBeCloseTo(500 * 1.0001, 8);
    const sell = place(buy.account, { instrument: SPY, cls: 'stock', qty: 10, side: 'sell' }, q(500));
    expect(sell.account.fills[1]!.price).toBeCloseTo(500 * 0.9999, 8);
  });

  it('limit: rests until the opposite best quote reaches the limit price, then fills as a maker', () => {
    let r = place(createAccount(), { qty: 1, type: 'limit', limit: 49_000 }, book(49_990, 50_000));
    expect(r.events[0]!.type).toBe('rested');
    expect(r.account.fills).toHaveLength(0);

    r = evaluate(r.account, BTC, book(49_000, 49_001), S); // ask still above the limit
    expect(r.account.fills).toHaveLength(0);

    r = evaluate(r.account, BTC, book(48_990, 49_000), S); // ask reaches it
    const f = r.account.fills[0]!;
    expect(f.price).toBe(49_000);
    expect(f.liquidity).toBe('maker');
    expect(f.fee).toBeCloseTo(49_000 * 0.0002, 8);
  });

  it('limit: a buy above the ask fills at once as a taker', () => {
    const r = place(createAccount(), { qty: 1, type: 'limit', limit: 50_500 }, book(49_990, 50_000));
    const f = r.account.fills[0]!;
    expect(f.price).toBe(50_000);
    expect(f.liquidity).toBe('taker');
    expect(f.fee).toBeCloseTo(50_000 * 0.0005, 8);
  });

  it('limit: takes only what the book offers at the limit or better and rests the remainder', () => {
    const r = place(createAccount(), { mode: 'lev', leverage: 10, qty: 2, type: 'limit', limit: 50_005 }, book(49_990, 50_000));
    expect(r.account.fills[0]!.qty).toBe(1);
    expect(workingOrders(r.account)[0]!.qty).toBe(1);
  });

  it('stop: triggers when the last trade reaches the stop price, then behaves as a market order', () => {
    let r = place(createAccount(), { mode: 'lev', leverage: 5, qty: 1, type: 'stop', stop: 51_000 }, book(49_990, 50_000));
    expect(r.events[0]!.type).toBe('rested');
    r = evaluate(r.account, BTC, { ...book(50_900, 50_910), last: 50_950 }, S);
    expect(r.account.fills).toHaveLength(0);
    r = evaluate(r.account, BTC, { ...book(51_000, 51_010), last: 51_000 }, S);
    const f = r.account.fills[0]!;
    expect(f.price).toBe(51_010); // walked the ask
    expect(f.liquidity).toBe('taker');
  });

  it('rejects a stop that is already through the market', () => {
    expect(place(createAccount(), { type: 'stop', stop: 49_000 }, q(50_000)).events[0]!.type).toBe('rejected');
  });

  it('take-profit and stop-loss are reduce-only and cancel each other', () => {
    let a = place(createAccount(), { mode: 'lev', leverage: 5, qty: 1, tp: 52_000, sl: 49_000 }, q(50_000)).account;
    const { tp, sl } = bracketsFor(a, a.positions[posKey(BTC, 'lev')]!);
    expect(tp).toMatchObject({ reduceOnly: true, side: 'sell', type: 'limit', limit: 52_000 });
    expect(sl).toMatchObject({ reduceOnly: true, side: 'sell', type: 'stop', stop: 49_000 });
    expect(tp!.link).toBe(sl!.link);

    a = evaluate(a, BTC, q(52_000), S).account; // target hit
    expect(a.positions[posKey(BTC, 'lev')]).toBeUndefined();
    expect(workingOrders(a)).toHaveLength(0);
    expect(a.orders.find((o) => o.id === sl!.id)!.status).toBe('cancelled');
    // Reduce-only: with the position gone a further tick opens nothing.
    a = evaluate(a, BTC, q(48_000), S).account;
    expect(Object.keys(a.positions)).toHaveLength(0);
  });

  it('a stop-loss closes the whole position even after it was added to', () => {
    let a = place(createAccount(), { mode: 'lev', leverage: 5, qty: 1, sl: 49_000 }, q(50_000)).account;
    a = place(a, { mode: 'lev', leverage: 5, qty: 1 }, q(50_000)).account;
    a = evaluate(a, BTC, q(49_000), S).account;
    expect(a.positions[posKey(BTC, 'lev')]).toBeUndefined();
  });

  it('moves and removes brackets on an open position', () => {
    let a = place(createAccount(), { mode: 'lev', leverage: 5, qty: 1, sl: 49_000 }, q(50_000)).account;
    const key = posKey(BTC, 'lev');
    a = setBrackets(a, key, { sl: 49_500, tp: 53_000 }, S, 2000).account;
    expect(bracketsFor(a, a.positions[key]!).sl!.stop).toBe(49_500);
    expect(bracketsFor(a, a.positions[key]!).tp!.limit).toBe(53_000);
    a = amendOrder(a, bracketsFor(a, a.positions[key]!).sl!.id, { stop: 49_800 }, S).account;
    expect(bracketsFor(a, a.positions[key]!).sl!.stop).toBe(49_800);
    a = setBrackets(a, key, { tp: null }, S, 3000).account;
    expect(bracketsFor(a, a.positions[key]!).tp).toBeUndefined();
  });

  it('cancels a working order', () => {
    let a = place(createAccount(), { type: 'limit', limit: 40_000 }, q(50_000)).account;
    a = cancelOrder(a, workingOrders(a)[0]!.id, S).account;
    expect(workingOrders(a)).toHaveLength(0);
    expect(evaluate(a, BTC, q(39_000), S).account.fills).toHaveLength(0);
  });

  it('stock orders outside market hours rest until the open', () => {
    const closed = q(500, { open: false });
    let r = place(createAccount(), { instrument: SPY, cls: 'stock', qty: 10 }, closed);
    expect(r.events[0]!.type).toBe('rested');
    expect(r.account.fills).toHaveLength(0);
    r = evaluate(r.account, SPY, closed, S); // still closed: nothing happens
    expect(r.account.fills).toHaveLength(0);
    r = evaluate(r.account, SPY, q(503, { open: true }), S); // the open
    expect(r.account.fills[0]!.price).toBeCloseTo(503 * 1.0001, 8);
  });

  it('…unless the user chooses "fill at last close"', () => {
    const r = placeOrder(
      createAccount(),
      order({ instrument: SPY, cls: 'stock', qty: 10 }),
      q(500, { open: false }),
      { ...S, fillAtLastClose: true },
      1000,
    );
    expect(r.account.fills[0]!.price).toBeCloseTo(500 * 1.0001, 8);
  });
});

describe('fees', () => {
  it('crypto: 0.05% taker, 0.02% maker', () => {
    const taker = place(createAccount(), { qty: 1 }, book(49_990, 50_000)).account.fills[0]!;
    expect(taker.fee).toBeCloseTo(50_000 * 0.0005, 8);
    let a = place(createAccount(), { qty: 1, type: 'limit', limit: 49_000 }, book(49_990, 50_000)).account;
    a = evaluate(a, BTC, book(48_990, 49_000), S).account;
    expect(a.fills[0]!.fee).toBeCloseTo(49_000 * 0.0002, 8);
  });

  it('stocks and prediction markets: none', () => {
    expect(place(createAccount(), { instrument: SPY, cls: 'stock', qty: 10 }, q(500)).account.fills[0]!.fee).toBe(0);
    expect(place(createAccount(), { instrument: 'poly:1', cls: 'odds', qty: 100 }, q(0.4)).account.fills[0]!.fee).toBe(0);
  });

  it('are configurable in settings', () => {
    const s = { ...S, fees: { ...S.fees, cryptoTaker: 0.001 } };
    const r = placeOrder(createAccount(), order({ qty: 1 }), book(49_990, 50_000), s, 1000);
    expect(r.account.fills[0]!.fee).toBeCloseTo(50, 8);
  });
});

describe('trades and R', () => {
  it('a trade is the life of a position from first fill to flat', () => {
    let a = place(createAccount(), { qty: 0.5 }, q(50_000), 1_000).account;
    a = place(a, { qty: 0.5 }, q(51_000), 2_000).account;
    a = evaluate(a, BTC, q(49_000, { t: 2_500 }), S).account; // worst point
    a = evaluate(a, BTC, q(53_000, { t: 2_600 }), S).account; // best point
    a = place(a, { side: 'sell', qty: 0.25 }, q(52_000), 3_000).account;
    expect(closedTrades(a)).toHaveLength(0);
    a = place(a, { side: 'sell', qty: 0.75 }, q(52_000), 9_000).account;

    const tr = closedTrades(a)[0]!;
    expect(a.trades).toHaveLength(1);
    expect(tr.fillIds).toHaveLength(4); // every fill
    expect(tr.fees).toBeCloseTo(a.fills.reduce((s, f) => s + f.fee, 0), 8); // total fees
    expect(tr.closedAt! - tr.openedAt).toBe(8_000); // duration
    const entry = (50_000 * 1.0001 + 51_000 * 1.0001) / 2;
    expect(tr.mae).toBeCloseTo(49_000 - entry, 6); // MAE
    expect(tr.mfe).toBeCloseTo(53_000 - entry, 6); // MFE
    expect(tr.pnl).toBeCloseTo(tr.gross - tr.fees, 8);
  });

  it('with a stop at entry, initial risk = |entry − stop| × size and the result is stored in R', () => {
    // The book holds 1 at 50,000: the order fills 1 now and 1 when the ask returns. Risk covers both.
    let a = place(createAccount(), { mode: 'lev', leverage: 5, qty: 2, type: 'limit', limit: 50_000, sl: 49_000 }, book(49_990, 50_000)).account;
    expect(a.trades[0]!.initialRisk).toBeCloseTo(1_000, 8);
    a = evaluate(a, BTC, book(49_990, 50_000), S).account;
    expect(a.trades[0]!.initialRisk).toBeCloseTo(2_000, 8);
    a = evaluate(a, BTC, q(49_000), S).account; // the stop hits
    const tr = closedTrades(a)[0]!;
    expect(tr.r).toBeCloseTo(tr.pnl / 2_000, 10);
    // −1.0R less fees and the stop's slippage.
    expect(tr.r!).toBeLessThan(-1);
    expect(tr.r!).toBeGreaterThan(-1.05);
  });

  it('stores no R when there was no stop at entry', () => {
    let a = place(createAccount(), { qty: 1 }, q(50_000)).account;
    a = place(a, { side: 'sell', qty: 1 }, q(51_000)).account;
    expect(closedTrades(a)[0]!.r).toBeUndefined();
  });

  it('sizes a position so that the stop loses exactly the chosen risk', () => {
    const qty = sizeByRisk(1_000, 50_000, 49_000);
    expect(qty).toBe(1);
    expect(sizeByRisk(1_000, 50_000, 50_000)).toBe(0);
    expect(rMultiple(50_000, 49_000, 52_400)).toBeCloseTo(2.4, 10);
    expect(rMultiple(50_000, 51_000, 47_600)).toBeCloseTo(2.4, 10); // short
  });
});

describe('prediction markets', () => {
  it('shares = dollars ÷ price, and a resolved market pays $1 or $0 a share', () => {
    const buy = place(createAccount(), { instrument: 'poly:1', cls: 'odds', qty: 100 / 0.4 }, { bid: 0.39, ask: 0.4, last: 0.4, t: 1, book: { bids: [[0.39, 1e6]], asks: [[0.4, 1e6]] } });
    expect(buy.account.cash).toBeCloseTo(99_900, 8);
    const won = settle(buy.account, 'poly:1', 1, S, 5).account;
    expect(won.cash).toBeCloseTo(99_900 + 250, 8);
    expect(closedTrades(won)[0]!.pnl).toBeCloseTo(150, 8);
    const lost = settle(buy.account, 'poly:1', 0, S, 5).account;
    expect(lost.cash).toBeCloseTo(99_900, 8);
    expect(closedTrades(lost)[0]!.pnl).toBeCloseTo(-100, 8);
  });
});

describe('bars: replay and the catch-up after Flame was closed', () => {
  it('assumes open → low → high → close for an up bar and open → high → low → close for a down bar', () => {
    expect(barPath({ o: 10, h: 14, l: 9, c: 13 })).toEqual([10, 9, 14, 13]);
    expect(barPath({ o: 13, h: 14, l: 9, c: 10 })).toEqual([13, 14, 9, 10]);
  });

  it('an up bar that spans both hits the stop before the target', () => {
    const a = place(createAccount(), { mode: 'lev', leverage: 5, qty: 1, type: 'limit', limit: 100, sl: 95, tp: 110 }, { ...q(100), book: { bids: [[99, 9]], asks: [[100, 9]] } }).account;
    const r = onBar(a, BTC, { t: 60_000, o: 100, h: 112, l: 94, c: 111 }, S);
    const exit = r.account.fills.at(-1)!;
    expect(exit.price).toBeCloseTo(95 * 0.9999, 8); // stopped, at the stop less 1bp
    expect(closedTrades(r.account)[0]!.pnl).toBeLessThan(0);
  });

  it('a down bar that spans both hits the target before the stop', () => {
    const a = place(createAccount(), { mode: 'lev', leverage: 5, qty: 1, type: 'limit', limit: 100, sl: 95, tp: 110 }, { ...q(100), book: { bids: [[99, 9]], asks: [[100, 9]] } }).account;
    const r = onBar(a, BTC, { t: 60_000, o: 100, h: 112, l: 94, c: 96 }, S);
    expect(r.account.fills.at(-1)!.price).toBe(110);
    expect(closedTrades(r.account)[0]!.pnl).toBeGreaterThan(0);
  });

  it('fills what would have triggered while away at the trigger price, marked "filled while away"', () => {
    const a = place(createAccount(), { type: 'limit', limit: 48_000, qty: 1 }, q(50_000)).account;
    const r = onBar(a, BTC, { t: 60_000, o: 49_500, h: 49_600, l: 47_000, c: 47_500 }, S, true);
    const f = r.account.fills[0]!;
    expect(f.price).toBe(48_000);
    expect(f.away).toBe(true);
  });

  it('liquidates while away at the liquidation price', () => {
    const a = place(createAccount(), { mode: 'lev', leverage: 10, qty: 1, type: 'limit', limit: 50_000 }, book(49_990, 50_000)).account;
    const liq = liquidationPrice('long', 50_000, 10, 0.005);
    const r = onBar(a, BTC, { t: 60_000, o: 49_000, h: 49_100, l: 40_000, c: 41_000 }, S, true);
    const f = r.account.fills.at(-1)!;
    expect(f.liquidity).toBe('liquidation');
    expect(f.price).toBeCloseTo(liq, 6);
    expect(closedTrades(r.account)[0]!).toMatchObject({ liquidated: true, away: true });
  });

  it('an entry and its stop can both trigger inside one bar', () => {
    const a = place(createAccount(), { mode: 'lev', leverage: 5, qty: 1, type: 'limit', limit: 98, sl: 96 }, q(100)).account;
    // Down bar: 100 → 101 → 95 → 97. The limit fills at 98, then the stop at 96.
    const r = onBar(a, BTC, { t: 60_000, o: 100, h: 101, l: 95, c: 97 }, S);
    expect(r.account.fills.map((f) => f.price)).toEqual([98, 96 * 0.9999]);
    expect(Object.keys(r.account.positions)).toHaveLength(0);
  });
});
