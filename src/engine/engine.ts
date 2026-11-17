import {
  START_CASH,
  barPath,
  effectiveLeverage,
  marketFill,
  positionLiquidationPrice,
  rulesFor,
  unrealised,
} from './rules';
import {
  posKey,
  type Account,
  type Dir,
  type EngineEvent,
  type EngineSettings,
  type Fill,
  type Liquidity,
  type Mode,
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
function execute(
  d: Draft,
  o: Order,
  qty: number,
  price: number,
  liquidity: Liquidity,
  t: number,
  away?: boolean,
): { fill: Fill } | { error: string } {
  const r = rulesFor(o.cls, d.s);
  const rate = liquidity === 'maker' ? r.maker : liquidity === 'taker' ? r.taker : 0;
  const key = posKey(o.instrument, o.mode);
  const pos = d.a.positions[key];
  const notional = qty * price;
  const fee = notional * rate;

  if (o.mode === 'spot') {
    if (o.side === 'buy') {
      if (notional + fee > d.a.cash + EPS) return { error: 'Not enough cash for this order.' };
      d.a.cash -= notional + fee;
      const tr = pos ? addToPosition(d, pos, o, qty, price, 0, fee) : openPosition(d, o, qty, price, 0, fee, t);
      return { fill: attach(d, tr, recordFill(d, o, tr.id, qty, price, fee, liquidity, t, away)) };
    }
    if (!pos || pos.qty < qty - EPS * Math.max(1, qty)) {
      return { error: 'Spot cannot go short: you can only sell what you hold.' };
    }
    const sell = Math.min(qty, pos.qty);
    const sellFee = sell * price * rate;
    d.a.cash += sell * price - sellFee;
    const tr = reducePosition(d, pos, sell, price, (price - pos.entry) * sell, sellFee, t, { away });
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
  if (!pos) return;
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
  const mf = marketFill(q, o.side, qty);
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
      const qty = o.role !== 'entry' && pos ? pos.qty : o.reduceOnly && pos ? Math.min(o.qty, pos.qty) : o.qty;
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

    if (mode === 'lev') {
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

function validate(d: Draft, o: Order, q: Quote | undefined): string | null {
  if (!(o.qty > 0) || !Number.isFinite(o.qty)) return 'Enter a size greater than zero.';
  if (o.type === 'limit' && !(o.limit !== undefined && o.limit > 0)) return 'Enter a limit price.';
  if (o.type === 'stop' && !(o.stop !== undefined && o.stop > 0)) return 'Enter a stop price.';
  const r = rulesFor(o.cls, d.s);
  const pos = d.a.positions[posKey(o.instrument, o.mode)];

  if (o.mode === 'lev') {
    if (o.cls === 'odds') return 'Prediction markets trade without leverage.';
    const lev = o.leverage ?? 1;
    if (!o.reduceOnly && (lev < 1 || lev > r.maxLeverage)) return `Leverage must be between 1× and ${r.maxLeverage}×.`;
    if (o.reduceOnly && (!pos || pos.dir === dirOf(o.side))) return 'There is no position to reduce.';
  } else if (o.side === 'sell') {
    if (!pos || pos.qty < o.qty - EPS * Math.max(1, o.qty)) return 'Spot cannot go short: you can only sell what you hold.';
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
  const o: Order = { ...input, id: nextId(d, 'o'), status: 'working', role: 'entry', createdAt: t };
  const problem = validate(d, o, q);
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

export function amendOrder(
  a: Account,
  id: string,
  patch: { limit?: number; stop?: number; qty?: number },
  s: EngineSettings,
): Result {
  const d = draft(a, s);
  const o = getOrder(d, id);
  if (!o || !isWorking(o)) return finish(d);
  const next: Order = { ...o };
  if (patch.limit !== undefined && patch.limit > 0 && o.limit !== undefined) next.limit = patch.limit;
  if (patch.stop !== undefined && patch.stop > 0 && o.stop !== undefined) next.stop = patch.stop;
  if (patch.qty !== undefined && patch.qty > 0) next.qty = patch.qty;
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

export function reviewTrade(a: Account, tradeId: string, review: Review): Account {
  return { ...a, trades: a.trades.map((t) => (t.id === tradeId ? { ...t, review } : t)) };
}

export function snapshotTrade(a: Account, tradeId: string, snapshot: number[]): Account {
  return { ...a, trades: a.trades.map((t) => (t.id === tradeId ? { ...t, snapshot } : t)) };
}

// ---------- Reading the account ----------

export interface Valuation {
  cash: number;
  /** Market value of spot holdings. */
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
    else {
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
