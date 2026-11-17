import {
  START_CASH,
  barPath,
  deliveryFee,
  effectiveLeverage,
  marketFill,
  optionFee,
  optionLot,
  optionPayout,
  positionLiquidationPrice,
  rulesFor,
  unrealised,
} from './rules';
import { addCost, isDrained, isEmpty, poolLiquidity, poolOrderCap, sellProceeds, validPool, type Pool } from './pool';
import {
  posKey,
  type Account,
  type Cover,
  type Dir,
  type EngineEvent,
  type EngineSettings,
  type Fill,
  type Liquidity,
  type Mode,
  type OptionSpec,
  type Order,
  type OrderInput,
  type Position,
  type Quote,
  type Result,
  type Review,
  type Side,
  type TradeRec,
} from './types';

// The paper-trading engine: pure functions from (account, input) to
// (account, events). Nothing here touches the network, the clock or the DOM;
// time and prices are always passed in. docs/product-spec.md, "Paper-trading
// rules", is the contract.

const EPS = 1e-9;
const KEPT_CLOSED_ORDERS = 300;

interface Draft {
  a: Account;
  s: EngineSettings;
  events: EngineEvent[];
  /** The account as it was passed in, returned untouched when nothing changed. */
  from: Account;
  dirty: boolean;
  /** The underlying's price that came with the quote being acted on, for option fees. */
  ref?: number;
  /** The pool an on-chain token order is filling against, and any tax its contract takes from a sale. */
  pool?: Pool;
  sellTax?: number;
  sellBlocked?: string;
}

function draft(a: Account, s: EngineSettings): Draft {
  return {
    a: { ...a, positions: { ...a.positions }, orders: [...a.orders], fills: [...a.fills], trades: [...a.trades] },
    s,
    events: [],
    from: a,
    dirty: false,
  };
}

function finish(d: Draft): Result {
  // Most ticks change nothing; hand back the same object so nothing re-renders or re-saves.
  if (!d.dirty && d.events.length === 0) return { account: d.from, events: [] };
  const closed = d.a.orders.filter((o) => o.status !== 'working');
  if (closed.length > KEPT_CLOSED_ORDERS) {
    const drop = new Set(closed.slice(0, closed.length - KEPT_CLOSED_ORDERS).map((o) => o.id));
    d.a.orders = d.a.orders.filter((o) => !drop.has(o.id));
  }
  return { account: d.a, events: d.events };
}

export function createAccount(cash: number = START_CASH, t = 0): Account {
  return { cash, startCash: cash, seq: 0, positions: {}, orders: [], fills: [], trades: [], lastSeen: t };
}

const nextId = (d: Draft, prefix: string): string => `${prefix}${++d.a.seq}`;
const dirOf = (side: Side): Dir => (side === 'buy' ? 'long' : 'short');
const closingSide = (dir: Dir): Side => (dir === 'long' ? 'sell' : 'buy');
const isWorking = (o: Order): boolean => o.status === 'working';

function putOrder(d: Draft, o: Order): void {
  d.dirty = true;
  const i = d.a.orders.findIndex((x) => x.id === o.id);
  if (i >= 0) d.a.orders[i] = o;
  else d.a.orders.push(o);
}

function putTrade(d: Draft, tr: TradeRec): void {
  d.dirty = true;
  const i = d.a.trades.findIndex((x) => x.id === tr.id);
  if (i >= 0) d.a.trades[i] = tr;
  else d.a.trades.push(tr);
}

const getTrade = (d: Draft, id: string): TradeRec | undefined => d.a.trades.find((x) => x.id === id);
const getOrder = (d: Draft, id: string): Order | undefined => d.a.orders.find((x) => x.id === id);

function reject(d: Draft, o: Order, reason: string): void {
  const next: Order = { ...o, status: 'rejected', reason };
  if (getOrder(d, o.id)) putOrder(d, next);
  d.events.push({ type: 'rejected', order: next, reason });
}

function cancel(d: Draft, o: Order, reason?: string): void {
  const next: Order = { ...o, status: 'cancelled', reason };
  putOrder(d, next);
  d.events.push({ type: 'cancelled', order: next });
}

/** Take-profit, stop-loss and other reduce-only orders die with their position. */
function cancelReducers(d: Draft, instrument: string, mode: Mode): void {
  for (const o of d.a.orders) {
    if (isWorking(o) && o.instrument === instrument && o.mode === mode && (o.role !== 'entry' || o.reduceOnly)) {
      cancel(d, o, 'Position closed');
    }
  }
}

// ---------- Applying a fill ----------

function recordFill(
  d: Draft,
  order: Pick<Order, 'id' | 'instrument' | 'mode' | 'side'>,
  tradeId: string,
  qty: number,
  price: number,
  fee: number,
  liquidity: Liquidity,
  t: number,
  away?: boolean,
): Fill {
  const fill: Fill = {
    id: nextId(d, 'f'),
    orderId: order.id,
    tradeId,
    instrument: order.instrument,
    mode: order.mode,
    side: order.side,
    qty,
    price,
    fee,
    t,
    liquidity,
    ...(away ? { away: true } : {}),
  };
  d.a.fills.push(fill);
  d.dirty = true;
  return fill;
}

function openPosition(d: Draft, o: Order, qty: number, price: number, margin: number, fee: number, t: number): TradeRec {
  const tr: TradeRec = {
    id: nextId(d, 't'),
    instrument: o.instrument,
    cls: o.cls,
    mode: o.mode,
    dir: dirOf(o.side),
    openedAt: t,
    qty,
    entryAvg: price,
    exitAvg: 0,
    openedQty: qty,
    closedQty: 0,
    gross: 0,
    fees: fee,
    funding: 0,
    pnl: -fee,
    mae: 0,
    mfe: 0,
    fillIds: [],
  };
  // A stop that exists at entry defines the initial risk, and so the trade's R.
  if (o.sl !== undefined) tr.initialRisk = Math.abs(price - o.sl) * qty;
  const key = posKey(o.instrument, o.mode);
  d.a.positions[key] = {
    key,
    instrument: o.instrument,
    cls: o.cls,
    mode: o.mode,
    dir: tr.dir,
    qty,
    entry: price,
    margin,
    tradeId: tr.id,
    openedAt: t,
    ...(o.option ? { option: o.option } : {}),
    ...(o.cls === 'meme' && d.pool ? { liquidity0: poolLiquidity(d.pool) } : {}),
    ...(o.cls === 'meme' && d.sellBlocked ? { sellBlocked: d.sellBlocked } : {}),
    ...(o.cls === 'meme' && d.sellTax ? { sellTax: d.sellTax } : {}),
  };
  putTrade(d, tr);
  return tr;
}

function addToPosition(d: Draft, pos: Position, o: Order, qty: number, price: number, margin: number, fee: number): TradeRec {
  const total = pos.qty + qty;
  const entry = (pos.entry * pos.qty + price * qty) / total;
  d.a.positions[pos.key] = { ...pos, qty: total, entry, margin: pos.margin + margin };
  const prev = getTrade(d, pos.tradeId)!;
  const tr: TradeRec = {
    ...prev,
    qty: Math.max(prev.qty, total),
    entryAvg: (prev.entryAvg * prev.openedQty + price * qty) / (prev.openedQty + qty),
    openedQty: prev.openedQty + qty,
    fees: prev.fees + fee,
    pnl: prev.pnl - fee,
  };
  // Adding with the same stop (a second fill of the entry order, or scaling in) adds to the risk taken.
  if (prev.initialRisk !== undefined && o.sl !== undefined) tr.initialRisk = prev.initialRisk + Math.abs(price - o.sl) * qty;
  putTrade(d, tr);
  return tr;
}

function reducePosition(
  d: Draft,
  pos: Position,
  qty: number,
  price: number,
  gross: number,
  fee: number,
  t: number,
  flags: { liquidated?: boolean; away?: boolean },
): TradeRec {
  const left = pos.qty - qty;
  const flat = left <= EPS * Math.max(1, pos.qty);
  if (flat) delete d.a.positions[pos.key];
  else d.a.positions[pos.key] = { ...pos, qty: left, margin: pos.margin * (left / pos.qty) };

  const prev = getTrade(d, pos.tradeId)!;
  const closedQty = prev.closedQty + qty;
  const tr: TradeRec = {
    ...prev,
    exitAvg: (prev.exitAvg * prev.closedQty + price * qty) / closedQty,
    closedQty,
    gross: prev.gross + gross,
    fees: prev.fees + fee,
    pnl: prev.pnl + gross - fee,
    ...(flags.away ? { away: true } : {}),
  };
  if (flat) {
    tr.closedAt = t;
    if (flags.liquidated) tr.liquidated = true;
    if (tr.initialRisk && tr.initialRisk > 0) tr.r = tr.pnl / tr.initialRisk;
  }
  putTrade(d, tr);
  if (flat) {
    cancelReducers(d, pos.instrument, pos.mode);
    d.events.push({ type: flags.liquidated ? 'liquidated' : 'closed', trade: tr });
  }
  return tr;
}

/** Apply one execution to cash, the position and its trade. Returns a reason when it cannot be done. */
// ---------- Options ----------
//
// A bought option is held like a spot position: the premium is paid and is the
// most it can lose. A sold option is held as a 'lev' position whose margin is
// the cash set aside, and it must be covered: by the shares, by cash, or by a
// bought option that caps the loss. There are no uncovered short options.

const usd = (v: number): string => `$${v.toLocaleString('en-US', { maximumFractionDigits: 2 })}`;
const contracts = (spec: OptionSpec, qty: number): string => {
  const n = Math.round((qty / spec.multiplier) * 1000) / 1000;
  return `${n} ${n === 1 ? 'contract' : 'contracts'}`;
};
const ticker = (id: string): string => id.slice(id.indexOf(':') + 1);

/** How much of a position is spoken for as cover for options that were sold. */
export function lockedQty(a: Account, key: string): number {
  let locked = 0;
  for (const p of Object.values(a.positions)) {
    if (p.cover && p.cover.kind !== 'cash' && p.cover.key === key) locked += p.qty;
  }
  return locked;
}

const coveringMessage = (instrument: string, locked: number): string =>
  `${locked} of your ${ticker(instrument)} cover a call you sold. Buy the call back first, or sell less.`;

type CoverPlan = { cover: Cover; cash: number } | { error: string };

function findCover(d: Draft, instrument: string, spec: OptionSpec, qty: number, premium: number, existing: Position | undefined): CoverPlan {
  const tol = EPS * Math.max(1, qty);
  const want = existing?.cover?.kind;
  const what = ticker(spec.underlying);
  const plans: { cover: Cover; cash: number }[] = [];

  if (spec.kind === 'call' && (!want || want === 'shares')) {
    const key = posKey(spec.underlying, 'spot');
    const held = d.a.positions[key];
    if (held && held.qty - lockedQty(d.a, key) >= qty - tol) plans.push({ cover: { kind: 'shares', key }, cash: 0 });
  }
  if (!want || want === 'spread') {
    for (const p of Object.values(d.a.positions)) {
      const o = p.option;
      if (!o || p.mode !== 'spot' || p.instrument === instrument) continue;
      // The bought leg must expire at the same moment: then both settle against one price and the gap between
      // the strikes really is the most the pair can lose. A leg that outlives the sold one would leave its
      // loss uncovered at the first expiry.
      if (o.underlying !== spec.underlying || o.kind !== spec.kind || o.multiplier !== spec.multiplier || o.expiry !== spec.expiry) continue;
      if (existing?.cover?.kind === 'spread' && existing.cover.key !== p.key) continue;
      if (p.qty - lockedQty(d.a, p.key) < qty - tol) continue;
      // The most the pair can lose at expiry is the gap between the strikes, when the sold one is the richer.
      const gap = spec.kind === 'call' ? o.strike - spec.strike : spec.strike - o.strike;
      plans.push({ cover: { kind: 'spread', key: p.key }, cash: Math.max(0, gap) * qty });
    }
  }
  if (spec.kind === 'put' && (!want || want === 'cash')) plans.push({ cover: { kind: 'cash' }, cash: spec.strike * qty });

  if (plans.length === 0) {
    if (want) return { error: 'You already sold this contract against different cover. Buy it back before selling more.' };
    return {
      error:
        spec.kind === 'call'
          ? `Selling a call needs cover: hold ${qty} ${what} (a covered call), or hold a call on ${what} with the same expiry (a spread). Flame does not allow uncovered short options, because their loss has no limit.`
          : `Selling a put needs cover. Flame does not allow uncovered short options.`,
    };
  }
  // Of the covers that work, take the one that sets aside the least cash, if the cash is there.
  plans.sort((x, y) => x.cash - y.cash);
  const free = d.a.cash + premium;
  const ok = plans.find((x) => x.cash <= free + EPS);
  if (ok) return ok;
  const need = plans[0]!;
  return {
    error:
      need.cover.kind === 'cash'
        ? `A cash-secured put sets aside the strike price for every unit: ${usd(need.cash)}. You have ${usd(Math.max(0, free))} free.`
        : `This spread can lose up to ${usd(need.cash)}, which has to be set aside. You have ${usd(Math.max(0, free))} free.`,
  };
}

type OptionPlan =
  | { act: 'open-long' }
  | { act: 'close-long'; pos: Position }
  | { act: 'close-short'; pos: Position; released: number }
  | { act: 'open-short'; pos: Position | undefined; cover: Cover; collateral: number }
  | { error: string };

/** Decide what an option order would do, and whether the account can do it. */
function planOption(d: Draft, o: Order, qty: number, price: number, fee: number): OptionPlan {
  const spec = o.option!;
  const tol = EPS * Math.max(1, qty);
  const long = d.a.positions[posKey(o.instrument, 'spot')];
  const short = d.a.positions[posKey(o.instrument, 'lev')];
  const notional = qty * price;

  if (o.side === 'buy') {
    if (short) {
      if (qty > short.qty + tol) return { error: `You sold ${contracts(spec, short.qty)} of this option. Buy those back before buying more.` };
      const released = short.margin * Math.min(1, qty / short.qty);
      if (notional + fee > d.a.cash + released + EPS) return { error: 'Not enough cash to buy this option back.' };
      return { act: 'close-short', pos: short, released };
    }
    if (notional + fee > d.a.cash + EPS) return { error: 'Not enough cash for the premium.' };
    return { act: 'open-long' };
  }

  if (long) {
    if (qty > long.qty + tol) return { error: `You hold ${contracts(spec, long.qty)} of this option. Sell those before selling more.` };
    const locked = lockedQty(d.a, long.key);
    if (qty > long.qty - locked + tol) {
      return { error: `${contracts(spec, locked)} of this option cover one you sold. Buy that one back first.` };
    }
    return { act: 'close-long', pos: long };
  }
  const plan = findCover(d, o.instrument, spec, qty, notional - fee, short);
  if ('error' in plan) return plan;
  return { act: 'open-short', pos: short, cover: plan.cover, collateral: plan.cash };
}

function executeOption(d: Draft, o: Order, qty: number, price: number, liquidity: Liquidity, t: number, away?: boolean): { fill: Fill } | { error: string } {
  const spec = o.option;
  if (!spec) return { error: 'This order does not say which option contract it is for.' };
  if (t >= spec.expiry) return { error: 'This option has expired.' };
  // Whatever path led here, an option never changes hands at no price or at an impossible one.
  if (!(price > 0) || !Number.isFinite(price)) return { error: o.side === 'buy' ? 'Nobody is offering this option right now.' : 'Nobody is bidding for this option right now.' };
  const fee = optionFee(d.s, spec, qty, price, d.ref);
  const plan = planOption(d, o, qty, price, fee);
  if ('error' in plan) return plan;
  const notional = qty * price;
  // A bought option lives under the 'spot' key and a sold one under 'lev', whatever the ticket sent.
  const held: Order = { ...o, mode: plan.act === 'open-long' || plan.act === 'close-long' ? 'spot' : 'lev' };
  let tr: TradeRec;

  if (plan.act === 'open-long') {
    d.a.cash -= notional + fee;
    const pos = d.a.positions[posKey(o.instrument, 'spot')];
    tr = pos ? addToPosition(d, pos, held, qty, price, 0, fee) : openPosition(d, held, qty, price, 0, fee, t);
  } else if (plan.act === 'close-long') {
    d.a.cash += notional - fee;
    tr = reducePosition(d, plan.pos, qty, price, (price - plan.pos.entry) * qty, fee, t, { away });
  } else if (plan.act === 'close-short') {
    d.a.cash += plan.released - notional - fee;
    tr = reducePosition(d, plan.pos, qty, price, (plan.pos.entry - price) * qty, fee, t, { away });
  } else {
    // The premium comes in; what covers the option is set aside.
    d.a.cash += notional - fee - plan.collateral;
    tr = plan.pos ? addToPosition(d, plan.pos, held, qty, price, plan.collateral, fee) : openPosition(d, held, qty, price, plan.collateral, fee, t);
    const key = posKey(o.instrument, 'lev');
    d.a.positions[key] = { ...d.a.positions[key]!, cover: plan.cover };
  }
  return { fill: attach(d, tr, recordFill(d, held, tr.id, qty, price, fee, liquidity, t, away)) };
}

function validateOption(d: Draft, o: Order, q: Quote | undefined, t: number): string | null {
  const spec = o.option;
  if (!spec) return 'This order does not say which option contract it is for.';
  if (o.type === 'stop') return 'Options take market and limit orders here, not stops.';
  if (o.tp !== undefined || o.sl !== undefined) return 'Take-profit and stop-loss are not offered on options.';
  if (t >= spec.expiry) return 'This option has expired.';
  const steps = o.qty / (optionLot(spec) * spec.multiplier);
  if (steps < 1 - 1e-6 || Math.abs(steps - Math.round(steps)) > 1e-6) {
    return optionLot(spec) === 1 ? 'Options trade in whole contracts.' : `Size goes in steps of ${optionLot(spec)} contracts.`;
  }
  const price = o.limit ?? (q ? (o.side === 'buy' ? q.ask : q.bid) : undefined);
  if (price === undefined) return null;
  if (!(price > 0) || !Number.isFinite(price)) return o.side === 'buy' ? 'Nobody is offering this option right now.' : 'Nobody is bidding for this option right now.';
  const plan = planOption(d, o, o.qty, price, optionFee(d.s, spec, o.qty, price, q?.underlying));
  return 'error' in plan ? plan.error : null;
}

function execute(
  d: Draft,
  o: Order,
  qty: number,
  price: number,
  liquidity: Liquidity,
  t: number,
  away?: boolean,
): { fill: Fill } | { error: string } {
  if (o.cls === 'option') return executeOption(d, o, qty, price, liquidity, t, away);
  const r = rulesFor(o.cls, d.s);
  // A token pays its pool's fee, and on a sale whatever tax its contract takes.
  let rate = liquidity === 'maker' ? r.maker : liquidity === 'taker' ? r.taker : 0;
  if (o.cls === 'meme') {
    // Never priced without a pool: an order that got this far without one is refused, not filled for free.
    if (!validPool(d.pool)) return { error: 'There is no reading of the pool to fill against.' };
    const tax = o.side === 'sell' ? (d.sellTax ?? d.a.positions[posKey(o.instrument, o.mode)]?.sellTax ?? 0) : 0;
    rate = Math.min(1, d.pool.fee + tax);
    if (o.side === 'buy' && !(price > 0 && Number.isFinite(price))) return { error: 'The pool is empty: there is nothing to buy.' };
    if (!(price >= 0) || !Number.isFinite(price)) return { error: 'The pool gave no usable price for this order.' };
  }
  const key = posKey(o.instrument, o.mode);
  const pos = d.a.positions[key];
  const notional = qty * price;
  const fee = notional * rate;

  if (o.mode === 'spot') {
    if (o.side === 'buy') {
      if (notional + fee > d.a.cash + EPS) return { error: 'Not enough cash for this order.' };
      d.a.cash -= notional + fee;
      const tr = pos ? addToPosition(d, pos, o, qty, price, 0, fee) : openPosition(d, o, qty, price, 0, fee, t);
      if (o.cls === 'meme' && pos && d.pool) {
        // The liquidity a later drain is judged against is the average of what was there at each buy, by size.
        const now = d.a.positions[key]!;
        const was = pos.liquidity0 ?? poolLiquidity(d.pool);
        d.a.positions[key] = {
          ...now,
          liquidity0: (was * pos.qty + poolLiquidity(d.pool) * qty) / (pos.qty + qty),
          ...(d.sellBlocked ? { sellBlocked: d.sellBlocked } : {}),
          ...(d.sellTax ? { sellTax: d.sellTax } : {}),
        };
      }
      return { fill: attach(d, tr, recordFill(d, o, tr.id, qty, price, fee, liquidity, t, away)) };
    }
    if (!pos || pos.qty < qty - EPS * Math.max(1, qty)) {
      return { error: 'Spot cannot go short: you can only sell what you hold.' };
    }
    const locked = lockedQty(d.a, key);
    if (locked > 0 && pos.qty - locked < qty - EPS * Math.max(1, qty)) return { error: coveringMessage(o.instrument, locked) };
    const sell = Math.min(qty, pos.qty);
    const sellFee = sell * price * rate;
    d.a.cash += sell * price - sellFee;
    let tr = reducePosition(d, pos, sell, price, (price - pos.entry) * sell, sellFee, t, { away });
    // Any sale, whole or part, into a pool that has lost nine tenths of the liquidity it had when the
    // position was bought marks the trade as rugged, and it stays marked.
    if (!tr.rugged && pos.liquidity0 !== undefined && d.pool && isDrained(pos.liquidity0, poolLiquidity(d.pool))) {
      tr = { ...tr, rugged: true };
      putTrade(d, tr);
      d.events = d.events.map((e) => (e.type === 'closed' && e.trade.id === tr.id ? { ...e, trade: tr } : e));
    }
    return { fill: attach(d, tr, recordFill(d, o, tr.id, sell, price, sellFee, liquidity, t, away)) };
  }

  // Leveraged: isolated margin per position.
  if (!pos || pos.dir === dirOf(o.side)) {
    if (o.reduceOnly || o.role !== 'entry') return { error: 'There is no position to reduce.' };
    const lev = Math.min(r.maxLeverage, Math.max(1, o.leverage ?? (pos ? effectiveLeverage(pos) : 1)));
    const margin = notional / lev;
    if (margin + fee > d.a.cash + EPS) return { error: 'Not enough cash for the margin on this order.' };
    d.a.cash -= margin + fee;
    const tr = pos ? addToPosition(d, pos, o, qty, price, margin, fee) : openPosition(d, o, qty, price, margin, fee, t);
    return { fill: attach(d, tr, recordFill(d, o, tr.id, qty, price, fee, liquidity, t, away)) };
  }

  const closeQty = Math.min(qty, pos.qty);
  const closeFee = closeQty * price * rate;
  const released = pos.margin * (closeQty / pos.qty);
  // Isolated margin: a position can never lose more than the margin behind it.
  const gross = Math.max(-released, unrealised({ ...pos, qty: closeQty }, price));
  d.a.cash += released + gross - closeFee;
  const tr = reducePosition(d, pos, closeQty, price, gross, closeFee, t, { away });
  const fill = attach(d, tr, recordFill(d, o, tr.id, closeQty, price, closeFee, liquidity, t, away));

  // An order larger than the position flips it: close, then open the rest the other way.
  const rest = qty - closeQty;
  if (rest > EPS * Math.max(1, qty) && !o.reduceOnly && o.role === 'entry') {
    const opened = execute(d, o, rest, price, liquidity, t, away);
    if ('error' in opened) {
      d.events.push({ type: 'rejected', order: o, reason: `Closed the position. ${opened.error}` });
    } else {
      d.events.push({ type: 'fill', fill: opened.fill, order: o });
    }
  }
  return { fill };
}

function attach(d: Draft, tr: TradeRec, fill: Fill): Fill {
  const cur = getTrade(d, tr.id)!;
  putTrade(d, { ...cur, fillIds: [...cur.fillIds, fill.id] });
  return fill;
}

// ---------- Brackets (take-profit and stop-loss on a position) ----------

function upsertBrackets(d: Draft, key: string, tp: number | null | undefined, sl: number | null | undefined, t: number): void {
  const pos = d.a.positions[key];
  // Options carry no stops here: an option's price moves with time and volatility as well as the underlying.
  // Nor do tokens: nothing guarantees the pool will be there for a stop to sell into.
  if (!pos || pos.cls === 'option' || pos.cls === 'meme') return;
  const mine = d.a.orders.filter(
    (o) => isWorking(o) && o.instrument === pos.instrument && o.mode === pos.mode && o.role !== 'entry',
  );
  const link = mine[0]?.link ?? nextId(d, 'l');
  const side = closingSide(pos.dir);
  for (const role of ['tp', 'sl'] as const) {
    const price = role === 'tp' ? tp : sl;
    if (price === undefined) continue;
    const cur = mine.find((o) => o.role === role);
    if (price === null) {
      if (cur) cancel(d, cur);
      continue;
    }
    const base: Order = cur ?? {
      id: nextId(d, 'o'),
      instrument: pos.instrument,
      cls: pos.cls,
      mode: pos.mode,
      side,
      type: role === 'tp' ? 'limit' : 'stop',
      qty: pos.qty,
      reduceOnly: true,
      status: 'working',
      role,
      createdAt: t,
      link,
    };
    putOrder(d, { ...base, qty: pos.qty, ...(role === 'tp' ? { limit: price } : { stop: price }) });
  }
}

// ---------- Filling orders ----------

function fillOrder(
  d: Draft,
  o: Order,
  qty: number,
  price: number,
  liquidity: Liquidity,
  t: number,
  away?: boolean,
  partial?: boolean,
): void {
  const key = posKey(o.instrument, o.mode);
  const before = d.a.positions[key]?.tradeId;
  const done = execute(d, o, qty, price, liquidity, t, away);
  if ('error' in done) {
    reject(d, o, done.error);
    return;
  }
  const next: Order = partial ? { ...o, qty: o.qty - qty } : { ...o, status: 'filled' };
  putOrder(d, next);
  d.events.push({ type: 'fill', fill: done.fill, order: next });

  const pos = d.a.positions[key];
  // A flip starts a new trade; the old position's brackets must not follow it.
  if (pos && before && pos.tradeId !== before) cancelReducers(d, o.instrument, o.mode);
  if (o.role !== 'entry' && o.link) {
    for (const sib of d.a.orders) if (isWorking(sib) && sib.link === o.link && sib.id !== o.id) cancel(d, sib, 'Other side filled');
  }
  if (o.role === 'entry' && pos && pos.dir === dirOf(o.side) && (o.tp !== undefined || o.sl !== undefined)) {
    upsertBrackets(d, key, o.tp, o.sl, t);
  }
}

function fillAtMarket(d: Draft, o: Order, q: Quote, away?: boolean): void {
  const pos = d.a.positions[posKey(o.instrument, o.mode)];
  let qty = o.qty;
  if (o.role !== 'entry' && pos) qty = pos.qty;
  else if (o.reduceOnly && pos) qty = Math.min(o.qty, pos.qty);
  // A stop or target on shares that partly cover a sold call sells the part that is free.
  if (o.role !== 'entry' && pos && pos.mode === 'spot') {
    const free = pos.qty - lockedQty(d.a, pos.key);
    if (free <= EPS * Math.max(1, pos.qty)) {
      reject(d, o, coveringMessage(o.instrument, pos.qty));
      return;
    }
    qty = Math.min(qty, free);
  }
  // A token fills against its pool: the price is whatever the constant-product curve gives for this size.
  if (o.cls === 'meme' && validPool(q.pool)) {
    // The account's own position counts as tokens already taken out of the pool: a buy continues up the curve
    // from there and a sale comes back down it, so splitting an order changes nothing.
    const held = pos?.qty ?? 0;
    const dollars = o.side === 'buy' ? addCost(q.pool, held, qty) : sellProceeds(q.pool, held, qty);
    fillOrder(d, o, qty, qty > 0 ? dollars / qty : 0, 'taker', q.t, away);
    return;
  }
  // An option has no last trade worth filling at: a buy pays the ask and a sale gets the bid.
  const mf = o.cls === 'option' && !q.book ? { qty, price: o.side === 'buy' ? q.ask : q.bid } : marketFill(q, o.side, qty);
  fillOrder(d, o, mf.qty, mf.price, 'taker', q.t, away);
}

function tryOrder(d: Draft, o: Order, q: Quote, away?: boolean): void {
  const pos = d.a.positions[posKey(o.instrument, o.mode)];
  if (o.role !== 'entry' || o.reduceOnly) {
    if (!pos || pos.dir === dirOf(o.side)) {
      cancel(d, o, 'Position closed');
      return;
    }
  }
  if (o.queued) {
    fillAtMarket(d, { ...o, queued: false }, q, away);
  } else if (o.type === 'stop' && o.stop !== undefined) {
    // A stop triggers when the last trade reaches it, then behaves as a market order.
    if (o.side === 'buy' ? q.last >= o.stop : q.last <= o.stop) fillAtMarket(d, o, q, away);
  } else if (o.type === 'limit' && o.limit !== undefined) {
    // A resting limit fills, as a maker, when the opposite best quote reaches it.
    if (o.side === 'buy' ? q.ask <= o.limit : q.bid >= o.limit) {
      let qty = o.role !== 'entry' && pos ? pos.qty : o.reduceOnly && pos ? Math.min(o.qty, pos.qty) : o.qty;
      if (o.role !== 'entry' && pos && pos.mode === 'spot') {
        const free = pos.qty - lockedQty(d.a, pos.key);
        if (free <= EPS * Math.max(1, pos.qty)) {
          reject(d, o, coveringMessage(o.instrument, pos.qty));
          return;
        }
        qty = Math.min(qty, free);
      }
      fillOrder(d, o, qty, o.limit, 'maker', q.t, away);
    }
  }
}

/** In a catch-up, an order counts only if it (or, for a bracket, its position) existed at `asOf`. */
function existedAt(d: Draft, o: Order, asOf: number | undefined): boolean {
  if (asOf === undefined) return true;
  if (o.role === 'entry') return o.createdAt <= asOf;
  const pos = d.a.positions[posKey(o.instrument, o.mode)];
  return pos !== undefined && pos.openedAt <= asOf;
}

function liquidate(d: Draft, pos: Position, price: number, t: number, away?: boolean): void {
  // The loss to the liquidation price plus the maintenance margin that was
  // left (taken as the liquidation fee) is exactly the margin.
  const gross = Math.max(-pos.margin, unrealised(pos, price));
  const fee = pos.margin + gross;
  const side = closingSide(pos.dir);
  const tr = reducePosition(d, pos, pos.qty, price, gross, fee, t, { liquidated: true, away });
  const order = { id: 'liquidation', instrument: pos.instrument, mode: pos.mode, side };
  attach(d, tr, recordFill(d, order, tr.id, pos.qty, price, fee, 'liquidation', t, away));
}

function step(d: Draft, instrument: string, q: Quote, away?: boolean, asOf?: number): void {
  for (const mode of ['spot', 'lev'] as const) {
    const pos = d.a.positions[posKey(instrument, mode)];
    // A replay of old bars must not touch what did not exist when they printed.
    if (!pos || (asOf !== undefined && pos.openedAt > asOf)) continue;
    const tr = getTrade(d, pos.tradeId);
    const u = unrealised(pos, q.last);
    if (tr && (u < tr.mae || u > tr.mfe)) putTrade(d, { ...tr, mae: Math.min(tr.mae, u), mfe: Math.max(tr.mfe, u) });

    // A sold option is fully covered, so nothing is ever liquidated.
    if (mode === 'lev' && pos.cls !== 'option') {
      const liq = positionLiquidationPrice(pos, rulesFor(pos.cls, d.s).mmr);
      if (liq !== null && liq > 0 && (pos.dir === 'long' ? q.last <= liq : q.last >= liq)) {
        liquidate(d, pos, liq, q.t, away);
      }
    }
  }
  const eligible = (o: Order) => isWorking(o) && o.instrument === instrument && existedAt(d, o, asOf);
  for (const id of d.a.orders.filter(eligible).map((o) => o.id)) {
    const o = getOrder(d, id);
    if (o && isWorking(o)) tryOrder(d, o, q, away);
  }
}

// ---------- Public API ----------

function validate(d: Draft, o: Order, q: Quote | undefined, t: number): string | null {
  if (!(o.qty > 0) || !Number.isFinite(o.qty)) return 'Enter a size greater than zero.';
  if (o.type === 'limit' && !(o.limit !== undefined && o.limit > 0)) return 'Enter a limit price.';
  if (o.type === 'stop' && !(o.stop !== undefined && o.stop > 0)) return 'Enter a stop price.';
  if (o.cls === 'option') return validateOption(d, o, q, t);
  if (o.cls === 'meme') {
    if (o.mode !== 'spot') return 'Tokens trade spot only: no leverage and no shorting.';
    if (o.type !== 'market') return 'A pool has no order book to rest an order in: token orders fill at once, at the pool\'s price.';
    if (o.tp !== undefined || o.sl !== undefined) return 'Take-profit and stop-loss are not offered on tokens: nothing guarantees the pool will still be there.';
    if (!validPool(q?.pool)) return 'There is no fresh reading of the pool to fill against.';
    const pool = q!.pool!;
    const held = d.a.positions[posKey(o.instrument, 'spot')];
    if (o.side === 'buy') {
      if (isEmpty(pool)) return 'The pool is empty: its liquidity has been pulled, and there is nothing to buy.';
      const position = addCost(pool, 0, (held?.qty ?? 0) + o.qty);
      const cap = poolOrderCap(pool);
      if (!(position <= cap * (1 + 1e-9))) {
        return `A position may not be more than 2% of the pool's liquidity (${usd(cap)} here${held ? ', and you already hold some' : ''}). A bigger one could not be sold back without moving the price against you.`;
      }
    } else {
      const blocked = q!.sellBlocked ?? held?.sellBlocked;
      if (blocked) return `This sale would fail. ${blocked}`;
    }
  }
  const r = rulesFor(o.cls, d.s);
  const pos = d.a.positions[posKey(o.instrument, o.mode)];

  if (o.mode === 'lev') {
    if (o.cls === 'odds') return 'Prediction markets trade without leverage.';
    const lev = o.leverage ?? 1;
    if (!o.reduceOnly && (lev < 1 || lev > r.maxLeverage)) return `Leverage must be between 1× and ${r.maxLeverage}×.`;
    if (o.reduceOnly && (!pos || pos.dir === dirOf(o.side))) return 'There is no position to reduce.';
  } else if (o.side === 'sell') {
    if (!pos || pos.qty < o.qty - EPS * Math.max(1, o.qty)) return 'Spot cannot go short: you can only sell what you hold.';
    const locked = lockedQty(d.a, pos.key);
    if (locked > 0 && pos.qty - locked < o.qty - EPS * Math.max(1, o.qty)) return coveringMessage(o.instrument, locked);
    if (o.tp !== undefined || o.sl !== undefined) return 'Take-profit and stop-loss attach to a buy, not to a sale.';
  }

  if (q && o.type === 'stop' && o.stop !== undefined) {
    if (o.side === 'buy' && o.stop <= q.last) return 'A buy stop must be above the last price.';
    if (o.side === 'sell' && o.stop >= q.last) return 'A sell stop must be below the last price.';
  }

  const ref = o.limit ?? o.stop ?? (q ? (o.side === 'buy' ? q.ask : q.bid) : undefined);
  if (ref !== undefined) {
    const up = o.side === 'buy';
    if (o.sl !== undefined && (up ? o.sl >= ref : o.sl <= ref)) {
      return up ? 'The stop-loss must be below the entry price.' : 'The stop-loss must be above the entry price.';
    }
    if (o.tp !== undefined && (up ? o.tp <= ref : o.tp >= ref)) {
      return up ? 'The take-profit must be above the entry price.' : 'The take-profit must be below the entry price.';
    }
  }
  return null;
}

export function placeOrder(a: Account, input: OrderInput, q: Quote | undefined, s: EngineSettings, t: number): Result {
  const d = draft(a, s);
  d.ref = q?.underlying;
  if (q?.pool) d.pool = q.pool;
  if (q?.sellTax !== undefined) d.sellTax = q.sellTax;
  if (q?.sellBlocked !== undefined) d.sellBlocked = q.sellBlocked;
  let o: Order = { ...input, id: nextId(d, 'o'), status: 'working', role: 'entry', createdAt: t };
  if (o.cls === 'option') {
    // The ticket says buy or sell; the engine works out whether that opens or closes. An order that closes a
    // position (the drawer's Close button) need not repeat the contract: the position carries it.
    const long = d.a.positions[posKey(o.instrument, 'spot')];
    const short = d.a.positions[posKey(o.instrument, 'lev')];
    const { reduceOnly: _drop, ...rest } = o;
    const spec = o.option ?? long?.option ?? short?.option;
    o = { ...rest, mode: short || (o.side === 'sell' && !long) ? 'lev' : 'spot', ...(spec ? { option: spec } : {}) };
  }
  const problem = validate(d, o, q, t);
  if (problem) {
    reject(d, o, problem);
    return finish(d);
  }
  d.a.orders.push(o);
  d.dirty = true;
  const closed = q?.open === false;

  if (o.type === 'market') {
    if (!q) {
      reject(d, o, 'There is no live price to fill against.');
    } else if (closed && !s.fillAtLastClose) {
      const queued: Order = { ...o, queued: true };
      putOrder(d, queued);
      d.events.push({ type: 'rested', order: queued });
    } else {
      fillAtMarket(d, o, { ...q, t }, false);
    }
  } else if (o.type === 'limit' && q && !closed && (o.side === 'buy' ? o.limit! >= q.ask : o.limit! <= q.bid)) {
    // A limit that crosses the spread takes what the book offers at the limit or better.
    const mf = marketFill(q, o.side, o.qty, o.limit);
    if (mf.qty >= o.qty - EPS * Math.max(1, o.qty)) {
      fillOrder(d, o, o.qty, mf.price, 'taker', t);
    } else if (mf.qty > 0) {
      fillOrder(d, o, mf.qty, mf.price, 'taker', t, false, true);
      const rest = getOrder(d, o.id);
      if (rest && isWorking(rest)) d.events.push({ type: 'rested', order: rest });
    } else {
      d.events.push({ type: 'rested', order: o });
    }
  } else {
    d.events.push({ type: 'rested', order: o });
  }
  return finish(d);
}

export function cancelOrder(a: Account, id: string, s: EngineSettings): Result {
  const d = draft(a, s);
  const o = getOrder(d, id);
  if (o && isWorking(o)) cancel(d, o);
  return finish(d);
}

/**
 * Move a working order's price or change its size. With a quote, a move that
 * would make the order trigger on the very next price is refused: dragging a
 * stop through the market should not quietly turn into a market order.
 */
export function amendOrder(
  a: Account,
  id: string,
  patch: { limit?: number; stop?: number; qty?: number },
  s: EngineSettings,
  q?: Quote,
): Result {
  const d = draft(a, s);
  const o = getOrder(d, id);
  if (!o || !isWorking(o)) return finish(d);
  const next: Order = { ...o };
  if (patch.limit !== undefined && patch.limit > 0 && o.limit !== undefined) next.limit = patch.limit;
  if (patch.stop !== undefined && patch.stop > 0 && o.stop !== undefined) next.stop = patch.stop;
  if (patch.qty !== undefined && patch.qty > 0) next.qty = patch.qty;
  if (next.cls === 'option' && next.option && next.qty !== o.qty) {
    const steps = next.qty / (optionLot(next.option) * next.option.multiplier);
    if (steps < 1 - 1e-6 || Math.abs(steps - Math.round(steps)) > 1e-6) {
      d.events.push({ type: 'rejected', order: o, reason: optionLot(next.option) === 1 ? 'Options trade in whole contracts.' : `Size goes in steps of ${optionLot(next.option)} contracts.` });
      return finish(d);
    }
  }
  if (q && q.open !== false) {
    let problem: string | null = null;
    if (next.stop !== undefined && next.stop !== o.stop) {
      if (next.side === 'sell' && next.stop >= q.last) problem = 'A sell stop must stay below the last price, or it would trigger at once.';
      if (next.side === 'buy' && next.stop <= q.last) problem = 'A buy stop must stay above the last price, or it would trigger at once.';
    }
    if (next.limit !== undefined && next.limit !== o.limit) {
      if (next.side === 'buy' && next.limit >= q.ask) problem = 'A buy limit at or above the ask would fill at once. Use a market order for that.';
      if (next.side === 'sell' && next.limit <= q.bid) problem = 'A sell limit at or below the bid would fill at once. Use a market order for that.';
    }
    if (problem) {
      // The order stays exactly as it was.
      d.events.push({ type: 'rejected', order: o, reason: problem });
      return finish(d);
    }
  }
  putOrder(d, next);
  return finish(d);
}

/** Set, move or remove (null) the take-profit and stop-loss on an open position. */
export function setBrackets(
  a: Account,
  key: string,
  b: { tp?: number | null; sl?: number | null },
  s: EngineSettings,
  t: number,
): Result {
  const d = draft(a, s);
  upsertBrackets(d, key, b.tp, b.sl, t);
  return finish(d);
}

/** Evaluate one instrument against a new price: marks, liquidation, then working orders. */
export function evaluate(a: Account, instrument: string, q: Quote, s: EngineSettings, away?: boolean): Result {
  if (q.open === false) return { account: a, events: [] };
  const d = draft(a, s);
  d.ref = q.underlying;
  step(d, instrument, q, away);
  return finish(d);
}

/** True when a price for this instrument could change the account. */
export function isExposed(a: Account, instrument: string): boolean {
  return (
    a.positions[posKey(instrument, 'spot')] !== undefined ||
    a.positions[posKey(instrument, 'lev')] !== undefined ||
    a.orders.some((o) => isWorking(o) && o.instrument === instrument)
  );
}

function nearestTrigger(d: Draft, instrument: string, from: number, to: number, asOf?: number): number | null {
  const up = to > from;
  const candidates: number[] = [];
  for (const o of d.a.orders) {
    if (!isWorking(o) || o.instrument !== instrument) continue;
    if (!existedAt(d, o, asOf)) continue;
    if (o.type === 'stop' && o.stop !== undefined && (o.side === 'buy') === up) candidates.push(o.stop);
    if (o.type === 'limit' && o.limit !== undefined && (o.side === 'sell') === up) candidates.push(o.limit);
  }
  const lev = d.a.positions[posKey(instrument, 'lev')];
  if (lev && !(asOf !== undefined && lev.openedAt > asOf)) {
    const liq = positionLiquidationPrice(lev, rulesFor(lev.cls, d.s).mmr);
    if (liq !== null && liq > 0 && (lev.dir === 'short') === up) candidates.push(liq);
  }
  let best: number | null = null;
  for (const p of candidates) {
    const ahead = up ? p > from && p <= to : p < from && p >= to;
    if (ahead && (best === null || (up ? p < best : p > best))) best = p;
  }
  return best;
}

/**
 * Evaluate a whole candle. Price is walked along the bar's assumed path and
 * every order or liquidation fires at its own trigger price, in the order the
 * path reaches them. An order the bar opens beyond fills at the open.
 */
export function onBar(
  a: Account,
  instrument: string,
  bar: { t: number; o: number; h: number; l: number; c: number },
  s: EngineSettings,
  away?: boolean,
  /** For a catch-up: ignore orders placed and positions opened after this moment. */
  asOf?: number,
): Result {
  const d = draft(a, s);
  const path = barPath(bar);
  let tick = 0;
  const at = (p: number): Quote => ({ bid: p, ask: p, last: p, t: bar.t + tick++ });
  let cur = path[0]!;
  step(d, instrument, at(cur), away, asOf);
  for (const target of path.slice(1)) {
    for (let guard = 0; guard < 100; guard++) {
      const next = nearestTrigger(d, instrument, cur, target, asOf);
      if (next === null) break;
      step(d, instrument, at(next), away, asOf);
      cur = next;
    }
    step(d, instrument, at(target), away, asOf);
    cur = target;
  }
  return finish(d);
}

/** Perp funding: longs pay shorts when the rate is positive. */
export function applyFunding(a: Account, instrument: string, rate: number, mark: number, s: EngineSettings): Result {
  const d = draft(a, s);
  const pos = d.a.positions[posKey(instrument, 'lev')];
  if (pos && pos.cls === 'crypto' && rate !== 0) {
    const payment = pos.qty * mark * rate * (pos.dir === 'long' ? -1 : 1);
    d.a.cash += payment;
    const tr = getTrade(d, pos.tradeId);
    if (tr) putTrade(d, { ...tr, funding: tr.funding + payment, pnl: tr.pnl + payment });
  }
  return finish(d);
}

/** A resolved prediction market pays $1 or $0 a share. */
export function settle(a: Account, instrument: string, payout: number, s: EngineSettings, t: number): Result {
  const d = draft(a, s);
  const pos = d.a.positions[posKey(instrument, 'spot')];
  if (pos) {
    d.a.cash += pos.qty * payout;
    const tr = reducePosition(d, pos, pos.qty, payout, (payout - pos.entry) * pos.qty, 0, t, {});
    const order = { id: 'settlement', instrument, mode: 'spot' as const, side: 'sell' as const };
    attach(d, tr, recordFill(d, order, tr.id, pos.qty, payout, 0, 'settlement', t));
  }
  return finish(d);
}

export type OptionPreview =
  | { error: string }
  | {
      act: 'open-long' | 'close-long' | 'close-short' | 'open-short';
      /** What would stand behind a sale that opens a position. */
      cover?: Cover;
      /** Cash that would be set aside. */
      collateral: number;
      fee: number;
    };

/** What an option order would do if it filled at `price`, without placing it: for the ticket's preview and its refusals. */
export function previewOption(a: Account, input: OrderInput, price: number, q: Quote | undefined, s: EngineSettings, t: number): OptionPreview {
  const d = draft(a, s);
  const spec = input.option ?? a.positions[posKey(input.instrument, 'spot')]?.option ?? a.positions[posKey(input.instrument, 'lev')]?.option;
  const o: Order = { ...input, ...(spec ? { option: spec } : {}), id: 'preview', status: 'working', role: 'entry', createdAt: t };
  const problem = validateOption(d, { ...o, type: 'limit', limit: price }, q, t);
  if (problem) return { error: problem };
  const fee = optionFee(s, spec!, o.qty, price, q?.underlying);
  const plan = planOption(d, o, o.qty, price, fee);
  if ('error' in plan) return plan;
  return { act: plan.act, ...(plan.act === 'open-short' ? { cover: plan.cover, collateral: plan.collateral } : { collateral: 0 }), fee };
}

/**
 * Settle an option at expiry, in cash, at what it is worth with the underlying at this price: nothing if it
 * finished out of the money. Real stock options settle in shares and can be assigned early; Flame does neither.
 */
export function settleOption(a: Account, instrument: string, underlying: number, s: EngineSettings, t: number): Result {
  const d = draft(a, s);
  for (const mode of ['spot', 'lev'] as const) {
    const pos = d.a.positions[posKey(instrument, mode)];
    const spec = pos?.option;
    if (!pos || !spec) continue;
    const payout = optionPayout(spec, underlying);
    const fee = deliveryFee(d.s, spec, pos.qty, payout, underlying);
    let tr: TradeRec;
    if (mode === 'spot') {
      d.a.cash += pos.qty * payout - fee;
      tr = reducePosition(d, pos, pos.qty, payout, (payout - pos.entry) * pos.qty, fee, t, {});
    } else {
      // What was set aside comes back, less what the option is owed.
      d.a.cash += pos.margin - pos.qty * payout - fee;
      tr = reducePosition(d, pos, pos.qty, payout, (pos.entry - payout) * pos.qty, fee, t, {});
    }
    const order = { id: 'settlement', instrument, mode, side: closingSide(pos.dir) };
    attach(d, tr, recordFill(d, order, tr.id, pos.qty, payout, fee, 'settlement', t));

    // A covered call that finishes in the money is owed in cash. If the cash is not there, enough of the
    // covering shares are sold at the settlement price to pay it.
    if (mode === 'lev' && pos.cover?.kind === 'shares' && d.a.cash < -EPS && underlying > 0) {
      const shares = d.a.positions[pos.cover.key];
      if (shares) {
        // Never more than this call owed, and never more shares than stood behind this call.
        const short = Math.min(-d.a.cash, pos.qty * payout + fee);
        const sell = Math.min(shares.qty, pos.qty, short / underlying);
        d.a.cash += sell * underlying;
        const str = reducePosition(d, shares, sell, underlying, (underlying - shares.entry) * sell, 0, t, {});
        const sale = { id: 'settlement', instrument: shares.instrument, mode: 'spot' as const, side: 'sell' as const };
        attach(d, str, recordFill(d, sale, str.id, sell, underlying, 0, 'settlement', t));
      }
    }
  }
  for (const o of d.a.orders.filter((x) => isWorking(x) && x.instrument === instrument)) cancel(d, o, 'The option expired');
  return finish(d);
}

/** Option positions whose expiry has passed, with what each is on. The state layer finds the price and settles them. */
export function expiredOptions(a: Account, now: number): { instrument: string; spec: OptionSpec }[] {
  const seen = new Map<string, OptionSpec>();
  for (const p of Object.values(a.positions)) if (p.option && p.option.expiry <= now) seen.set(p.instrument, p.option);
  for (const o of a.orders) if (isWorking(o) && o.option && o.option.expiry <= now) seen.set(o.instrument, o.option);
  // Bought options first, so a spread's long leg has paid out before its short leg is charged.
  const rank = (id: string) => (a.positions[posKey(id, 'spot')] ? 0 : 1);
  return [...seen].map(([instrument, spec]) => ({ instrument, spec })).sort((x, y) => rank(x.instrument) - rank(y.instrument));
}

export function reviewTrade(a: Account, tradeId: string, review: Review): Account {
  return { ...a, trades: a.trades.map((t) => (t.id === tradeId ? { ...t, review } : t)) };
}

export function snapshotTrade(a: Account, tradeId: string, snapshot: number[]): Account {
  return { ...a, trades: a.trades.map((t) => (t.id === tradeId ? { ...t, snapshot } : t)) };
}

// ---------- Reading the account ----------

export interface Valuation {
  cash: number;
  /** Market value of what is held outright, less what it would cost to buy back options that were sold. */
  holdings: number;
  /** Margin held behind leveraged positions. */
  margin: number;
  /** Unrealised P&L on leveraged positions. */
  unrealisedLev: number;
  /** Unrealised P&L on everything. */
  unrealised: number;
  equity: number;
}

/** Equity = cash + market value of spot holdings + margin held + unrealised P&L on leveraged positions. */
export function valuation(a: Account, marks: Record<string, number | undefined>): Valuation {
  let holdings = 0;
  let margin = 0;
  let unrealisedLev = 0;
  let unreal = 0;
  for (const p of Object.values(a.positions)) {
    const mark = marks[p.instrument] ?? p.entry;
    const u = unrealised(p, mark);
    unreal += u;
    if (p.mode === 'spot') holdings += p.qty * mark;
    else if (p.cls === 'option') {
      // An option that was sold: the premium is already in cash, so what it would cost to buy back is owed.
      holdings -= p.qty * mark;
      margin += p.margin;
    } else {
      margin += p.margin;
      unrealisedLev += u;
    }
  }
  return { cash: a.cash, holdings, margin, unrealisedLev, unrealised: unreal, equity: a.cash + holdings + margin + unrealisedLev };
}

export const openTrades = (a: Account): TradeRec[] => a.trades.filter((t) => t.closedAt === undefined);
export const closedTrades = (a: Account): TradeRec[] => a.trades.filter((t) => t.closedAt !== undefined);
export const workingOrders = (a: Account): Order[] => a.orders.filter(isWorking);

export function bracketsFor(a: Account, p: Position): { tp?: Order; sl?: Order } {
  const mine = a.orders.filter((o) => isWorking(o) && o.instrument === p.instrument && o.mode === p.mode);
  return { tp: mine.find((o) => o.role === 'tp'), sl: mine.find((o) => o.role === 'sl') };
}
