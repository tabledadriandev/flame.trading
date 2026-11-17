// Plain data for the paper-trading engine. No classes, no React, nothing that
// cannot be written to IndexedDB and read back unchanged.

/** 'meme' is an on-chain token that trades against a liquidity pool. */
export type AssetClass = 'crypto' | 'stock' | 'odds' | 'option' | 'meme';
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
  /** Stock options: dollars per contract. */
  optionContract: number;
  /** Crypto options (Deribit's schedule): a share of the underlying's value... */
  optionCryptoRate: number;
  /** ...never more than this share of the premium. */
  optionCryptoCap: number;
  /** Crypto options: the fee at expiry, as a share of the underlying. Daily options are exempt. */
  optionCryptoDelivery: number;
}

/** One option contract. Everything about it follows from its id, so it is never stored apart from the id. */
export interface OptionSpec {
  /** The instrument the option is on: crypto:BTC, stock:AAPL. */
  underlying: string;
  kind: 'call' | 'put';
  strike: number;
  /** Expiry, milliseconds. */
  expiry: number;
  /** Units of the underlying one contract covers: 100 shares for a stock option, 1 coin on Deribit. */
  multiplier: number;
  venue: 'deribit' | 'alpaca';
  /** A Deribit daily expiry: no fee at settlement. */
  daily?: boolean;
}

/** What stands behind an option that was sold. Flame never allows an uncovered one. */
export type Cover =
  /** A covered call: the shares or coins themselves, which cannot be sold while they cover it. */
  | { kind: 'shares'; key: string }
  /** A cash-secured put: the strike price for every unit, set aside as the position's margin. */
  | { kind: 'cash' }
  /** The short leg of a spread: a bought option caps the loss; the gap between the strikes is set aside. */
  | { kind: 'spread'; key: string };

export interface EngineSettings {
  fees: Fees;
  /** Stocks only: fill an order placed outside market hours at the last close instead of resting it. */
  fillAtLastClose: boolean;
}

export const DEFAULT_SETTINGS: EngineSettings = {
  // Option fees: Deribit's standard tier is 3 basis points of the underlying, capped at 12.5% of the premium,
  // and 1.5 basis points at expiry (its fee page, read 17 November 2026). The stock-option fee is set when
  // stock options are built, from the venue's fee page.
  fees: { cryptoTaker: 0.0005, cryptoMaker: 0.0002, stock: 0, odds: 0, optionContract: 0, optionCryptoRate: 0.0003, optionCryptoCap: 0.125, optionCryptoDelivery: 0.00015 },
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
  /** For an option: the price of what it is on, in dollars. Crypto option fees are a share of it. */
  underlying?: number;
  /** For an on-chain token: the pool every order fills against. */
  pool?: import('./pool').Pool;
  /** For an on-chain token: why holders cannot sell, when the risk source says they can be stopped. */
  sellBlocked?: string;
  /** For an on-chain token: the share of every sale the token's contract keeps. */
  sellTax?: number;
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
  /** Required when `cls` is 'option', unless the order closes a position that already carries it. */
  option?: OptionSpec;
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
  /** Isolated margin held out of cash. Zero for spot. For an option that was sold: the cash set aside. */
  margin: number;
  /** Present on option positions. A bought option is held 'spot'; a sold one is held 'lev' with its cover. */
  option?: OptionSpec;
  cover?: Cover;
  /** For an on-chain token: the pool's liquidity when the position was bought (weighted by size across buys), to tell later if it was drained. */
  liquidity0?: number;
  /** For an on-chain token: what the risk source said when it was bought. Kept with the position so a sale obeys it even when the report cannot be read again. */
  sellBlocked?: string;
  sellTax?: number;
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
  /** An on-chain token sold, in whole or in part, into a pool that had lost nine tenths of the liquidity it had when bought. */
  rugged?: boolean;
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
