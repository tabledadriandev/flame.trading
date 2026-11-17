import type { OptionSpec, Quote } from '../engine/types';
import { optionId, parseOptionId } from '../options/contract';
import { ManagedSocket } from './socket';
import { FeedError, type BookSnapshot, type Candle, type FeedStatus, type Ticker, type Unsubscribe, type VenueAdapter } from './types';

// BTC and ETH options from Deribit's public API. No key: the browser calls it
// directly (verified 17 November 2026: REST answers with CORS for any origin,
// and the WebSocket accepts public subscriptions).
//
// Deribit quotes these options in the coin itself (0.0375 BTC). Flame's paper
// account is in dollars, so every price here is converted at Deribit's index
// price for the coin, which is also what the option settles against.

const REST = 'https://www.deribit.com/api/v2/public';
const WS = 'wss://www.deribit.com/ws/api/v2';
const TIMEOUT = 12_000;

export type Coin = 'BTC' | 'ETH';
export const OPTION_COINS: readonly Coin[] = ['BTC', 'ETH'];
export const coinOf = (underlying: string): Coin | null => (underlying === 'crypto:BTC' ? 'BTC' : underlying === 'crypto:ETH' ? 'ETH' : null);

export interface ChainRow {
  id: string;
  spec: OptionSpec;
  /** Dollars per coin. Null when nobody is quoting that side. */
  bid: number | null;
  ask: number | null;
  /** Deribit's own fair value, in dollars. */
  mark: number;
  /** Implied volatility as a decimal (0.4 = 40%). */
  iv: number | null;
  /** Contracts open, and contracts traded in 24 hours. */
  oi: number;
  volume: number;
  /** The forward price Deribit prices this expiry from. */
  forward: number;
}

export interface Chain {
  coin: Coin;
  /** The coin's index price in dollars. */
  index: number;
  t: number;
  rows: ChainRow[];
}

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/** Turn Deribit's book summary into a chain in dollars. Rows that cannot be read are left out, not guessed. */
export function chainFromSummary(coin: Coin, raw: unknown, now: number): Chain {
  const rows: ChainRow[] = [];
  let index = 0;
  if (Array.isArray(raw)) {
    for (const r of raw as Record<string, unknown>[]) {
      const name = typeof r.instrument_name === 'string' ? r.instrument_name : '';
      const id = optionId('deribit', name);
      const spec = parseOptionId(id);
      const idx = num(r.estimated_delivery_price);
      const mark = num(r.mark_price);
      if (!spec || idx === null || !(idx > 0) || mark === null) continue;
      index = idx;
      const bid = num(r.bid_price);
      const ask = num(r.ask_price);
      const iv = num(r.mark_iv);
      rows.push({
        id,
        spec,
        bid: bid !== null && bid > 0 ? bid * idx : null,
        ask: ask !== null && ask > 0 ? ask * idx : null,
        mark: mark * idx,
        iv: iv !== null && iv > 0 ? iv / 100 : null,
        oi: num(r.open_interest) ?? 0,
        volume: num(r.volume) ?? 0,
        forward: num(r.underlying_price) ?? idx,
      });
    }
  }
  rows.sort((a, b) => a.spec.expiry - b.spec.expiry || a.spec.strike - b.spec.strike || (a.spec.kind === 'call' ? -1 : 1));
  return { coin, index, t: now, rows };
}

async function call<T>(method: string, params: Record<string, string>): Promise<T> {
  const url = `${REST}/${method}?${new URLSearchParams(params).toString()}`;
  let r: Response;
  try {
    r = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT) });
  } catch (err) {
    const timedOut = err instanceof Error && (err.name === 'TimeoutError' || err.name === 'AbortError');
    throw new FeedError(timedOut ? 'Deribit took too long to answer.' : 'Deribit could not be reached.', 'Deribit');
  }
  if (r.status === 429) throw new FeedError('Deribit is asking Flame to slow down. Try again in a minute.', 'Deribit', 429);
  if (!r.ok) throw new FeedError(`Deribit answered with an error (${r.status}).`, 'Deribit', r.status);
  const body = (await r.json().catch(() => null)) as { result?: T } | null;
  if (!body || body.result === undefined) throw new FeedError('Deribit sent an answer Flame could not read.', 'Deribit');
  return body.result;
}

/** Every option on a coin, in one call. Deribit asks clients not to poll this hard: the view refreshes it slowly. */
export async function fetchChain(coin: Coin): Promise<Chain> {
  const raw = await call<unknown>('get_book_summary_by_currency', { currency: coin, kind: 'option' });
  const chain = chainFromSummary(coin, raw, Date.now());
  if (chain.rows.length === 0) throw new FeedError('Deribit sent an option chain with nothing Flame could read in it.', 'Deribit');
  indexPrice[coin] = { price: chain.index, t: chain.t };
  return chain;
}

/**
 * The price an expiry settled at: Deribit's delivery price for that day (the
 * index averaged over the half hour before 08:00 UTC). Null until Deribit has
 * published it.
 */
export async function deliveryPrice(coin: Coin, expiry: number): Promise<number | null> {
  const day = new Date(expiry).toISOString().slice(0, 10);
  const age = Math.floor((Date.now() - expiry) / 86_400_000);
  const res = await call<{ data?: { date?: string; delivery_price?: number }[] }>('get_delivery_prices', {
    index_name: `${coin.toLowerCase()}_usd`,
    offset: String(Math.max(0, age - 2)),
    count: '10',
  });
  const hit = res.data?.find((d) => d.date === day);
  return hit && typeof hit.delivery_price === 'number' && hit.delivery_price > 0 ? hit.delivery_price : null;
}

// ---------- Live quotes over the WebSocket ----------

export interface OptionTick {
  /** Dollars per coin. Null when nobody is quoting that side. */
  bid: number | null;
  ask: number | null;
  mark: number;
  iv: number | null;
  index: number;
  forward: number;
  t: number;
}

const indexPrice: Partial<Record<Coin, { price: number; t: number }>> = {};
const ticks = new Map<string, OptionTick>();
const subs = new Map<string, Set<(t: OptionTick) => void>>();
let rpcId = 0;

const channel = (name: string): string => `ticker.${name}.100ms`;
const indexChannel = (coin: Coin): string => `deribit_price_index.${coin.toLowerCase()}_usd`;
const coinOfName = (name: string): Coin | null => (name.startsWith('BTC-') ? 'BTC' : name.startsWith('ETH-') ? 'ETH' : null);

function wantedChannels(): string[] {
  const out = new Set<string>();
  for (const name of subs.keys()) {
    out.add(channel(name));
    const coin = coinOfName(name);
    // The index ticks every second: it prices the conversion to dollars and shows the connection is alive.
    if (coin) out.add(indexChannel(coin));
  }
  return [...out];
}

/** Read one ticker message into dollars. Exported for the test. */
export function tickFromTicker(d: Record<string, unknown>, now: number): OptionTick | null {
  const index = num(d.index_price);
  const mark = num(d.mark_price);
  if (index === null || !(index > 0) || mark === null) return null;
  const bid = num(d.best_bid_price);
  const ask = num(d.best_ask_price);
  const iv = num(d.mark_iv);
  return {
    bid: bid !== null && bid > 0 ? bid * index : null,
    ask: ask !== null && ask > 0 ? ask * index : null,
    mark: mark * index,
    iv: iv !== null && iv > 0 ? iv / 100 : null,
    index,
    forward: num(d.underlying_price) ?? index,
    t: now,
  };
}

function onMessage(text: string): void {
  let msg: { method?: string; params?: { channel?: string; data?: Record<string, unknown> } };
  try {
    msg = JSON.parse(text) as typeof msg;
  } catch {
    console.warn('[flame] Deribit sent a message that is not JSON');
    return;
  }
  const ch = msg.params?.channel;
  const data = msg.params?.data;
  if (msg.method !== 'subscription' || !ch || !data) return;
  const now = Date.now();
  if (ch.startsWith('deribit_price_index.')) {
    const coin = ch.endsWith('btc_usd') ? 'BTC' : ch.endsWith('eth_usd') ? 'ETH' : null;
    const p = num(data.price);
    if (coin && p !== null && p > 0) indexPrice[coin] = { price: p, t: now };
    return;
  }
  if (ch.startsWith('ticker.')) {
    const name = typeof data.instrument_name === 'string' ? data.instrument_name : '';
    const tick = tickFromTicker(data, now);
    if (!tick) return;
    ticks.set(name, tick);
    for (const cb of subs.get(name) ?? []) cb(tick);
  }
}

const socket = new ManagedSocket({
  urls: [WS],
  onOpen: (send) => {
    // Whatever was known before the connection dropped is old now: wait for the fresh snapshot of each contract.
    ticks.clear();
    const channels = wantedChannels();
    if (channels.length > 0) send({ jsonrpc: '2.0', id: ++rpcId, method: 'public/subscribe', params: { channels } });
  },
  onMessage,
  silenceMs: 30_000,
});

/** Live quotes for one contract, by Deribit's name for it (BTC-25JUN27-88000-C). */
export function subscribeOption(name: string, on: (t: OptionTick) => void): Unsubscribe {
  let set = subs.get(name);
  const fresh = !set;
  if (!set) {
    set = new Set();
    subs.set(name, set);
  }
  set.add(on);
  if (subs.size === 1 && fresh) socket.start();
  if (fresh) socket.send({ jsonrpc: '2.0', id: ++rpcId, method: 'public/subscribe', params: { channels: wantedChannels() } });
  const known = ticks.get(name);
  if (known) on(known);
  return () => {
    const s = subs.get(name);
    if (!s) return;
    s.delete(on);
    if (s.size > 0) return;
    subs.delete(name);
    ticks.delete(name);
    socket.send({ jsonrpc: '2.0', id: ++rpcId, method: 'public/unsubscribe', params: { channels: [channel(name)] } });
    if (subs.size === 0) socket.stop();
  };
}

/** How old a quote may be and still be traded against. A quiet contract's ticker only speaks when it changes, so the index's age is the test. */
const FRESH = 20_000;

/** The last tick for a contract, if the connection is alive. */
export function optionTick(name: string): OptionTick | undefined {
  const tick = ticks.get(name);
  const coin = coinOfName(name);
  const idx = coin ? indexPrice[coin] : undefined;
  if (!tick || !idx || socket.status() !== 'live' || Date.now() - idx.t > FRESH) return undefined;
  return tick;
}

/** What an order on this contract fills against: buys at the ask, sells at the bid, marked at the mid. */
export function optionQuote(name: string): Quote | undefined {
  const tick = optionTick(name);
  if (!tick) return undefined;
  return quoteFromTick(tick, Date.now());
}

export function quoteFromTick(tick: OptionTick, now: number): Quote {
  const mid = tick.bid !== null && tick.ask !== null ? (tick.bid + tick.ask) / 2 : tick.mark;
  // With nobody on a side, a buy can never fill (the ask is out of reach) and a sale gets nothing.
  return { bid: tick.bid ?? 0, ask: tick.ask ?? Infinity, last: mid, t: now, underlying: tick.index };
}

export const deribitIndex = (coin: Coin): number | undefined => indexPrice[coin]?.price;

class DeribitOptions implements VenueAdapter {
  readonly id = 'deribit';
  readonly kind = 'live' as const;
  readonly hasBook = false;

  status(): FeedStatus {
    return socket.status();
  }

  onStatus(cb: (s: FeedStatus) => void): Unsubscribe {
    return socket.onStatus(cb);
  }

  quote(symbol: string): Quote | undefined {
    return optionQuote(symbol);
  }

  candles(): Promise<Candle[]> {
    return Promise.reject(new FeedError('Options have no price history in Flame: open the chain to trade them.', 'Deribit'));
  }

  subscribeCandles(): Unsubscribe {
    return () => {};
  }

  subscribeTrades(): Unsubscribe {
    return () => {};
  }

  subscribeBook(_s: string, _on: (b: BookSnapshot) => void, onProblem?: (m: string | null) => void): Unsubscribe {
    onProblem?.('Open the option chain to see this contract.');
    return () => {};
  }

  subscribeTicker(symbol: string, on: (t: Ticker) => void): Unsubscribe {
    return subscribeOption(symbol, (tick) => {
      on({ last: tick.bid !== null && tick.ask !== null ? (tick.bid + tick.ask) / 2 : tick.mark, changePct: NaN, t: tick.t });
    });
  }
}

export const deribitOptions = new DeribitOptions();
