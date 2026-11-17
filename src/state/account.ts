import { create } from 'zustand';
import { instrument } from '../data/instruments';
import {
  amendOrder,
  cancelOrder,
  createAccount,
  evaluate,
  isExposed,
  onBar,
  placeOrder,
  reviewTrade,
  setBrackets,
  settle,
  settleOption,
  snapshotTrade,
  applyFunding,
} from '../engine/engine';
import {
  posKey,
  type Account,
  type EngineEvent,
  type OrderInput,
  type Quote,
  type Result,
  type Review,
} from '../engine/types';
import { dollars, money, qty, rr } from '../lib/format';
import { parseOptionId } from '../options/contract';
import { lastPrice } from './clock';
import { save } from './persist';
import { engineSettings, useSettings } from './settings';
import { toast } from './toasts';

// Two paper accounts: the live one, which persists, and a practice one that
// Replay uses so its results never mix with the live account.

export type Book = 'live' | 'practice';

interface AccountStore {
  ready: boolean;
  /** Set when the stored account could not be read; the app refuses to overwrite it. */
  loadError: string | null;
  /** True when another tab or window owns the account; this one stands down. */
  elsewhere: boolean;
  live: Account;
  practice: Account;
  place(input: OrderInput, quote: Quote | undefined, book?: Book, t?: number): EngineEvent[];
  cancel(id: string, book?: Book): void;
  amend(id: string, patch: { limit?: number; stop?: number; qty?: number }, book?: Book, quote?: Quote): void;
  brackets(key: string, b: { tp?: number | null; sl?: number | null }, book?: Book, t?: number): void;
  onQuote(instrumentId: string, quote: Quote, book?: Book): void;
  onBar(instrumentId: string, bar: { t: number; o: number; h: number; l: number; c: number }, book?: Book, away?: boolean, asOf?: number): EngineEvent[];
  funding(instrumentId: string, rate: number, mark: number): void;
  settle(instrumentId: string, payout: number): void;
  /** Settle an expired option against the underlying's price at expiry. */
  settleOption(instrumentId: string, underlying: number, t: number): EngineEvent[];
  review(tradeId: string, review: Review, book?: Book): void;
  snapshot(tradeId: string, closes: number[], book?: Book): void;
  reset(book?: Book): void;
  hydrate(a: Account | undefined): void;
  replace(a: Account): void;
}

// The chart registers how to read the bars it has loaded, for the entry snapshot.
let snapshotOf: ((instrumentId: string) => number[] | undefined) | null = null;
export function registerSnapshot(fn: (instrumentId: string) => number[] | undefined): void {
  snapshotOf = fn;
}

let audio: AudioContext | null = null;
/** A short, quiet tick when an order fills. Off unless switched on in settings. */
function tick(): void {
  try {
    audio ??= new AudioContext();
    const osc = audio.createOscillator();
    const gain = audio.createGain();
    osc.frequency.value = 880;
    gain.gain.setValueAtTime(0.05, audio.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.0001, audio.currentTime + 0.12);
    osc.connect(gain).connect(audio.destination);
    osc.start();
    osc.stop(audio.currentTime + 0.12);
  } catch (err) {
    console.warn('[flame] could not play the fill sound', err);
  }
}

// live.ts registers how to read the current price, so this file does not import it (it imports this one).
let liveQuote: ((instrumentId: string) => Quote | undefined) | null = null;
export function registerLiveQuote(fn: (instrumentId: string) => Quote | undefined): void {
  liveQuote = fn;
}

function persist(a: Account): void {
  // Never write over a stored account that could not be read.
  if (useAccount.getState().loadError || useAccount.getState().elsewhere) return;
  // lastSeen is the last moment a price was actually watched, not the wall clock:
  // an edit made while the feed is down must not hide the gap from the catch-up.
  save('account', { ...a, lastSeen: lastPrice() || a.lastSeen });
}

export const useAccount = create<AccountStore>((set, get) => {
  const commit = (book: Book, r: Result, quiet = false): EngineEvent[] => {
    let account = r.account;
    // A trade's first fill keeps a small picture of the chart as it looked then, for the journal.
    for (const e of r.events) {
      if (e.type !== 'fill') continue;
      const tr = account.trades.find((t) => t.id === e.fill.tradeId);
      if (!tr || tr.snapshot || tr.fillIds.length !== 1) continue;
      const closes = snapshotOf?.(e.fill.instrument);
      if (closes && closes.length > 1) account = snapshotTrade(account, tr.id, closes);
    }
    if (account !== get()[book]) {
      set({ [book]: account } as Pick<AccountStore, Book>);
      if (book === 'live') persist(account);
    }
    if (!quiet && useSettings.getState().sounds && r.events.some((e) => e.type === 'fill')) tick();
    if (!quiet) announce(r.events, book);
    return r.events;
  };

  return {
    ready: false,
    loadError: null,
    elsewhere: false,
    live: createAccount(),
    practice: createAccount(),

    place(input, quote, book = 'live', t = Date.now()) {
      return commit(book, placeOrder(get()[book], input, quote, engineSettings(), t));
    },
    cancel(id, book = 'live') {
      commit(book, cancelOrder(get()[book], id, engineSettings()));
    },
    amend(id, patch, book = 'live', quote) {
      const a = get()[book];
      const o = a.orders.find((x) => x.id === id);
      // The live book checks the move against the market; Replay passes its own price.
      const q = quote ?? (book === 'live' && o ? liveQuote?.(o.instrument) : undefined);
      commit(book, amendOrder(a, id, patch, engineSettings(), q));
    },
    brackets(key, b, book = 'live', t = Date.now()) {
      commit(book, setBrackets(get()[book], key, b, engineSettings(), t));
    },
    onQuote(id, quote, book = 'live') {
      const a = get()[book];
      if (!isExposed(a, id)) return;
      commit(book, evaluate(a, id, quote, engineSettings()));
    },
    onBar(id, bar, book = 'live', away = false, asOf) {
      const a = get()[book];
      if (!isExposed(a, id)) return [];
      return commit(book, onBar(a, id, bar, engineSettings(), away, asOf), away);
    },
    funding(id, rate, mark) {
      commit('live', applyFunding(get().live, id, rate, mark, engineSettings()));
    },
    settle(id, payout) {
      commit('live', settle(get().live, id, payout, engineSettings(), Date.now()));
    },
    settleOption(id, underlying, t) {
      return commit('live', settleOption(get().live, id, underlying, engineSettings(), t), true);
    },
    review(tradeId, review, book = 'live') {
      const next = reviewTrade(get()[book], tradeId, review);
      set({ [book]: next } as Pick<AccountStore, Book>);
      if (book === 'live') persist(next);
    },
    snapshot(tradeId, closes, book = 'live') {
      const next = snapshotTrade(get()[book], tradeId, closes);
      set({ [book]: next } as Pick<AccountStore, Book>);
      if (book === 'live') persist(next);
    },
    reset(book = 'live') {
      const fresh = createAccount(undefined, Date.now());
      set({ [book]: fresh } as Pick<AccountStore, Book>);
      if (book === 'live') persist(fresh);
    },
    hydrate(a) {
      set({ live: a ?? createAccount(undefined, Date.now()), ready: true });
    },
    replace(a) {
      set({ live: a });
      persist(a);
    },
  };
});

/** Save the heartbeat: the engine replays candles after this moment on the next visit. */
export function saveHeartbeat(): void {
  const s = useAccount.getState();
  if (s.ready && !s.loadError && !s.elsewhere) persist(s.live);
}

function describe(e: EngineEvent & { type: 'fill' }): string {
  const i = instrument(e.fill.instrument);
  const verb = e.fill.side === 'buy' ? 'Bought' : 'Sold';
  // A prediction-market share is priced in cents; everything else in dollars.
  const at = i.cls === 'odds' ? `${(e.fill.price * 100).toFixed(1)}¢` : dollars(e.fill.price);
  // An option is counted in contracts, not in the shares or coins it covers.
  const spec = i.cls === 'option' ? parseOptionId(i.id) : null;
  const size = spec ? `${Math.round((e.fill.qty / spec.multiplier) * 1000) / 1000} ×` : qty(e.fill.qty, e.fill.price);
  const what = `${size} ${i.symbol} at ${at}`;
  return e.fill.away ? `Filled while away: ${verb.toLowerCase()} ${what}` : `${verb} ${what}`;
}

function announce(events: EngineEvent[], book: Book): void {
  const tag = book === 'practice' ? 'Practice: ' : '';
  for (const e of events) {
    if (e.type === 'fill') {
      toast(tag + describe(e), { side: e.fill.side });
    } else if (e.type === 'rested') {
      const i = instrument(e.order.instrument);
      const at = e.order.queued ? 'waits for the open' : `at ${dollars(e.order.limit ?? e.order.stop)} is working`;
      const kind = e.order.queued ? 'Market' : e.order.type === 'limit' ? 'Limit' : 'Stop';
      toast(`${tag}${kind} ${e.order.side} ${qty(e.order.qty, e.order.limit ?? e.order.stop ?? 1)} ${i.symbol} ${at}`);
    } else if (e.type === 'rejected') {
      toast(`${tag}${e.order.status === 'working' ? 'Order not changed' : 'Order rejected'}. ${e.reason}`);
    } else if (e.type === 'liquidated') {
      const i = instrument(e.trade.instrument);
      toast(`${tag}${i.symbol} ${e.trade.dir} liquidated at ${dollars(e.trade.exitAvg)}. The margin is lost: ${money(e.trade.pnl)}.`, { sticky: true });
    } else if (e.type === 'closed') {
      const i = instrument(e.trade.instrument);
      const r = e.trade.r !== undefined ? ` (${rr(e.trade.r)})` : '';
      toast(`${tag}${i.symbol} ${e.trade.dir} closed: ${money(e.trade.pnl, { signed: true })}${r}`);
    }
  }
}

/** The order that closes a position at market. */
export function closeInput(a: Account, key: string, fraction = 1): OrderInput | null {
  const p = a.positions[key];
  if (!p) return null;
  return {
    instrument: p.instrument,
    cls: p.cls,
    mode: p.mode,
    side: p.dir === 'long' ? 'sell' : 'buy',
    type: 'market',
    qty: p.qty * fraction,
    ...(p.mode === 'lev' ? { reduceOnly: true } : {}),
  };
}

/** The order that reverses a leveraged position: close it and open the same size the other way. */
export function reverseInput(a: Account, key: string, leverage: number): OrderInput | null {
  const p = a.positions[key];
  if (!p || p.mode !== 'lev') return null;
  return { instrument: p.instrument, cls: p.cls, mode: 'lev', side: p.dir === 'long' ? 'sell' : 'buy', type: 'market', qty: p.qty * 2, leverage };
}

export { posKey };
