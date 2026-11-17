import { liquidationPrice, marketFill, rMultiple, rulesFor, sizeByRisk } from '../engine/rules';
import type { AssetClass, EngineSettings, Mode, OrderType, Quote, Side } from '../engine/types';
import { dollars, money, qty as fmtQty } from '../lib/format';

// Everything the ticket shows before you commit, worked out the same way the
// engine will fill it. Pure, so it can be tested.

export interface TicketInput {
  symbol: string;
  cls: AssetClass;
  side: Side;
  mode: Mode;
  type: OrderType;
  sizeMode: 'units' | 'dollars' | 'risk';
  /** Units, dollars, or percent of equity at risk, depending on sizeMode. */
  size: number;
  /** Limit or stop price for those order types. */
  price: number;
  leverage: number;
  tp: number;
  sl: number;
  quote: Quote | undefined;
  cash: number;
  equity: number;
  /** Spot units already held (what a spot sell can sell). */
  held: number;
  settings: EngineSettings;
}

export interface TicketPreview {
  qty: number;
  /** The price the order is worked out at: the limit or stop, or the touch for a market order. */
  ref: number;
  /** For market orders: the expected fill after walking the book. */
  est: number;
  notional: number;
  fee: number;
  /** Cash the order takes: cost for spot, margin for leverage. */
  uses: number;
  liq: number | null;
  /** Target and stop distances in R, when a stop is set. */
  tpR: number | null;
  risk: number | null;
  /** Why the order cannot be placed, in words. Null when it can. */
  problem: string | null;
  sentence: string;
  verb: string;
}

const finite = (n: number): boolean => Number.isFinite(n) && n > 0;

export function previewTicket(t: TicketInput): TicketPreview {
  const r = rulesFor(t.cls, t.settings);
  const lev = t.mode === 'lev' ? Math.min(r.maxLeverage, Math.max(1, t.leverage)) : 1;
  const q = t.quote;
  const touch = q ? (t.side === 'buy' ? q.ask : q.bid) : NaN;
  const ref = t.type === 'market' ? touch : t.price;
  const verb = t.mode === 'lev' ? (t.side === 'buy' ? 'Long' : 'Short') : t.side === 'buy' ? 'Buy' : 'Sell';
  const empty: TicketPreview = { qty: 0, ref, est: ref, notional: 0, fee: 0, uses: 0, liq: null, tpR: null, risk: null, problem: null, sentence: '', verb };

  if (t.type !== 'market' && !finite(t.price)) return { ...empty, problem: `Enter a ${t.type} price.` };
  if (t.type === 'market' && !q) return { ...empty, problem: 'Waiting for a live price.' };
  if (!finite(ref)) return { ...empty, problem: 'Waiting for a live price.' };

  let qty = 0;
  if (t.sizeMode === 'units') qty = t.size;
  else if (t.sizeMode === 'dollars') qty = t.size / ref;
  else {
    if (!finite(t.sl)) return { ...empty, problem: 'Sizing by risk needs a stop-loss price.' };
    qty = sizeByRisk((t.equity * t.size) / 100, ref, t.sl);
  }
  if (!finite(qty)) return { ...empty, problem: t.sizeMode === 'risk' ? 'Enter the risk as a percent of equity.' : 'Enter a size.' };

  const marketable = t.type === 'limit' && q !== undefined && (t.side === 'buy' ? t.price >= q.ask : t.price <= q.bid);
  const taker = t.type !== 'limit' || marketable;
  const est = t.type === 'market' && q ? marketFill(q, t.side, qty).price : ref;
  const notional = qty * est;
  const fee = notional * (taker ? r.taker : r.maker);
  const closing = t.mode === 'spot' && t.side === 'sell';
  const uses = closing ? 0 : t.mode === 'lev' ? notional / lev + fee : notional + fee;
  const liq = t.mode === 'lev' ? liquidationPrice(t.side === 'buy' ? 'long' : 'short', est, lev, r.mmr) : null;
  const tpR = finite(t.sl) && finite(t.tp) ? rMultiple(est, t.sl, t.tp) : null;
  const risk = finite(t.sl) ? Math.abs(est - t.sl) * qty : null;

  let problem: string | null = null;
  const up = t.side === 'buy';
  if (closing && qty > t.held * (1 + 1e-9)) {
    problem = t.held > 0 ? `You hold ${fmtQty(t.held, est)} ${t.symbol}. Spot cannot go short.` : `You hold no ${t.symbol}. Spot cannot go short; use ${t.cls === 'crypto' ? 'Perp' : 'Margin'} to sell first.`;
  } else if (uses > t.cash + 1e-9) {
    problem = `This needs ${money(uses)} and you have ${money(t.cash)} in cash.`;
  } else if (finite(t.sl) && (up ? t.sl >= est : t.sl <= est)) {
    problem = up ? 'The stop-loss must be below the entry price.' : 'The stop-loss must be above the entry price.';
  } else if (finite(t.tp) && (up ? t.tp <= est : t.tp >= est)) {
    problem = up ? 'The take-profit must be above the entry price.' : 'The take-profit must be below the entry price.';
  } else if (t.type === 'stop' && q && (up ? t.price <= q.last : t.price >= q.last)) {
    problem = up ? 'A buy stop must be above the last price.' : 'A sell stop must be below the last price.';
  } else if (closing && (finite(t.tp) || finite(t.sl))) {
    problem = 'Take-profit and stop-loss attach to a buy, not to a sale.';
  } else if (liq !== null && finite(t.sl) && (up ? t.sl <= liq : t.sl >= liq)) {
    problem = 'The stop-loss is beyond the liquidation price, so it would never trigger. Lower the leverage or tighten the stop.';
  }

  const amount = `${fmtQty(qty, est)} ${t.symbol}`;
  const closed = q?.open === false;
  let first: string;
  if (t.type === 'market') first = closed && !t.settings.fillAtLastClose ? `${verb} ${amount} at the open.` : `${verb} ${amount} at about ${dollars(est)}.`;
  else if (t.type === 'limit') first = marketable ? `${verb} ${amount} now, at ${dollars(t.price)} or better.` : `${verb} ${amount} when the price reaches ${dollars(t.price)}.`;
  else first = `${verb} ${amount} at market once the price trades at ${dollars(t.price)}.`;
  const feeText = fee > 0 ? ` Fee ${money(fee)}.` : ' No fee.';
  const usesText = closing ? ` Returns about ${money(notional - fee)} to cash.` : t.mode === 'lev' ? ` Holds ${money(notional / lev)} as margin.` : ` Uses ${money(uses)} of cash.`;
  return { qty, ref, est, notional, fee, uses, liq, tpR, risk, problem, sentence: first + feeText + usesText, verb };
}

/** The largest size the cash (or the holding, for a spot sale) allows. */
export function maxQty(t: Pick<TicketInput, 'cls' | 'side' | 'mode' | 'leverage' | 'cash' | 'held' | 'settings'>, price: number): number {
  if (!finite(price)) return 0;
  if (t.mode === 'spot' && t.side === 'sell') return t.held;
  const r = rulesFor(t.cls, t.settings);
  const lev = t.mode === 'lev' ? Math.min(r.maxLeverage, Math.max(1, t.leverage)) : 1;
  // cash = qty × price × (1/lev + fee), with a hair kept back for slippage.
  return (t.cash * 0.998) / (price * (1 / lev + r.taker));
}
