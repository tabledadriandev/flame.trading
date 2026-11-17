// Plain data for the paper-trading engine. No classes, no React, nothing that
// cannot be written to IndexedDB and read back unchanged.

export type AssetClass = 'crypto' | 'stock' | 'odds';
/** 'lev' is a perp for crypto and a margin position for stocks. */
export type Mode = 'spot' | 'lev';
export type Side = 'buy' | 'sell';
export type Dir = 'long' | 'short';
export type OrderType = 'market' | 'limit' | 'stop';

export interface Fees {
  cryptoTaker: number;
  cryptoMaker: number;
  stock: number;
  odds: number;
}

export interface EngineSettings {
  fees: Fees;
  /** Stocks only: fill an order placed outside market hours at the last close instead of resting it. */
  fillAtLastClose: boolean;
}

export const DEFAULT_SETTINGS: EngineSettings = {
  fees: { cryptoTaker: 0.0005, cryptoMaker: 0.0002, stock: 0, odds: 0 },
  fillAtLastClose: false,
};

/** One side of a book as [price, size] pairs, best price first. */
export type Levels = readonly (readonly [number, number])[];

export interface Quote {
  bid: number;
  ask: number;
  last: number;
  t: number;
  /** Present for venues with a live book; market orders walk it. */
  book?: { bids: Levels; asks: Levels };
  /** False while a stock's exchange is closed. Undefined means always open. */
  open?: boolean;
}

export interface OrderInput {
  instrument: string;
  cls: AssetClass;
  mode: Mode;
  side: Side;
  type: OrderType;
  qty: number;
  limit?: number;
  stop?: number;
  leverage?: number;
  /** Take-profit and stop-loss prices to attach to the position this order opens. */
  tp?: number;
  sl?: number;
  reduceOnly?: boolean;
}

export type OrderStatus = 'working' | 'filled' | 'cancelled' | 'rejected';

export interface Order extends OrderInput {
  id: string;
  status: OrderStatus;
  role: 'entry' | 'tp' | 'sl';
  createdAt: number;
  /** Take-profit and stop-loss on one position share a link and cancel each other. */
  link?: string;
  /** A stock market order waiting for the open. */
  queued?: boolean;
  reason?: string;
}

export type Liquidity = 'taker' | 'maker' | 'liquidation' | 'settlement';

export interface Fill {
  id: string;
  orderId: string;
  tradeId: string;
  instrument: string;
  mode: Mode;
  side: Side;
  qty: number;
  price: number;
  fee: number;
  t: number;
  liquidity: Liquidity;
  /** Filled by replaying the candles missed while Flame was closed. */
  away?: boolean;
}

export interface Position {
  key: string;
  instrument: string;
  cls: AssetClass;
  mode: Mode;
  dir: Dir;
  qty: number;
  entry: number;
  /** Isolated margin held out of cash. Zero for spot. */
  margin: number;
  tradeId: string;
  openedAt: number;
}

export interface Review {
  setup: string;
  emotion: string;
  followedPlan: boolean | null;
  note: string;
}

/** The life of a position from first fill to flat. */
export interface TradeRec {
  id: string;
  instrument: string;
  cls: AssetClass;
  mode: Mode;
  dir: Dir;
  openedAt: number;
  closedAt?: number;
  /** Largest size held. */
  qty: number;
  entryAvg: number;
  exitAvg: number;
  openedQty: number;
  closedQty: number;
  /** Price P&L before fees and funding. */
  gross: number;
  fees: number;
  funding: number;
  /** gross − fees + funding. */
  pnl: number;
  initialRisk?: number;
  r?: number;
  /** Worst and best unrealised P&L seen while open, in dollars. */
  mae: number;
  mfe: number;
  fillIds: string[];
  liquidated?: boolean;
  away?: boolean;
  review?: Review;
  /** Small chart snapshot at entry: closes of the bars before the entry. */
  snapshot?: number[];
}

export interface Account {
  cash: number;
  startCash: number;
  seq: number;
  positions: Record<string, Position>;
  orders: Order[];
  fills: Fill[];
  trades: TradeRec[];
  /** Last time the engine saw a live price; candles after this are replayed on reopening. */
  lastSeen: number;
}

export type EngineEvent =
  | { type: 'fill'; fill: Fill; order: Order }
  | { type: 'rested'; order: Order }
  | { type: 'rejected'; order: Order; reason: string }
  | { type: 'cancelled'; order: Order }
  | { type: 'closed'; trade: TradeRec }
  | { type: 'liquidated'; trade: TradeRec };

export interface Result {
  account: Account;
  events: EngineEvent[];
}

export const posKey = (instrument: string, mode: Mode): string => `${instrument}|${mode}`;
