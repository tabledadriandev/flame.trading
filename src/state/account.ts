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
import { save } from './persist';
import { engineSettings } from './settings';
import { toast } from './toasts';

// Two paper accounts: the live one, which persists, and a practice one that
// Replay uses so its results never mix with the live account.

export type Book = 'live' | 'practice';

interface AccountStore {
  ready: boolean;
  /** Set when the stored account could not be read; the app refuses to overwrite it. */
  loadError: string | null;
  live: Account;
  practice: Account;
  place(input: OrderInput, quote: Quote | undefined, book?: Book, t?: number): EngineEvent[];
  cancel(id: string, book?: Book): void;
  amend(id: string, patch: { limit?: number; stop?: number; qty?: number }, book?: Book): void;
  brackets(key: string, b: { tp?: number | null; sl?: number | null }, book?: Book, t?: number): void;
  onQuote(instrumentId: string, quote: Quote, book?: Book): void;
  onBar(instrumentId: string, bar: { t: number; o: number; h: number; l: number; c: number }, book?: Book, away?: boolean): EngineEvent[];
  funding(instrumentId: string, rate: number, mark: number): void;
  settle(instrumentId: string, payout: number): void;
  review(tradeId: string, review: Review, book?: Book): void;
  snapshot(tradeId: string, closes: number[], book?: Book): void;
  reset(book?: Book): void;
  hydrate(a: Account | undefined): void;
  replace(a: Account): void;
}

function persist(a: Account): void {
  // Never write over a stored account that could not be read.
  if (useAccount.getState().loadError) return;
  save('account', { ...a, lastSeen: Date.now() });
}

export const useAccount = create<AccountStore>((set, get) => {
  const commit = (book: Book, r: Result, quiet = false): EngineEvent[] => {
    if (r.account !== get()[book]) {
      set({ [book]: r.account } as Pick<AccountStore, Book>);
      if (book === 'live') persist(r.account);
    }
    if (!quiet) announce(r.events, book);
    return r.events;
  };

  return {
    ready: false,
    loadError: null,
    live: createAccount(),
    practice: createAccount(),

    place(input, quote, book = 'live', t = Date.now()) {
      return commit(book, placeOrder(get()[book], input, quote, engineSettings(), t));
    },
    cancel(id, book = 'live') {
      commit(book, cancelOrder(get()[book], id, engineSettings()));
    },
    amend(id, patch, book = 'live') {
      commit(book, amendOrder(get()[book], id, patch, engineSettings()));
    },
    brackets(key, b, book = 'live', t = Date.now()) {
      commit(book, setBrackets(get()[book], key, b, engineSettings(), t));
    },
    onQuote(id, quote, book = 'live') {
      const a = get()[book];
      if (!isExposed(a, id)) return;
      commit(book, evaluate(a, id, quote, engineSettings()));
    },
    onBar(id, bar, book = 'live', away = false) {
      const a = get()[book];
      if (!isExposed(a, id)) return [];
      return commit(book, onBar(a, id, bar, engineSettings(), away), away);
    },
    funding(id, rate, mark) {
      commit('live', applyFunding(get().live, id, rate, mark, engineSettings()));
    },
    settle(id, payout) {
      commit('live', settle(get().live, id, payout, engineSettings(), Date.now()));
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
  if (s.ready && !s.loadError) persist(s.live);
}

function describe(e: EngineEvent & { type: 'fill' }): string {
  const i = instrument(e.fill.instrument);
  const verb = e.fill.side === 'buy' ? 'Bought' : 'Sold';
  const what = `${qty(e.fill.qty, e.fill.price)} ${i.symbol} at ${dollars(e.fill.price)}`;
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
      toast(`${tag}Order rejected. ${e.reason}`);
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
