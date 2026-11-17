import { route } from '../data/feed';
import { onFrame } from '../data/schedule';
import type { BookSnapshot, FeedStatus, Tick, Unsubscribe } from '../data/types';
import { isExposed } from '../engine/engine';
import type { Quote } from '../engine/types';
import { saveHeartbeat, useAccount } from './account';
import { MIN_GAP, catchUp } from './away';
import { lastPrice, notePrice } from './clock';
import { isStale, useMarket, type QuoteInfo } from './market';
import { activeItems, useWatchlists } from './watchlists';

// Connects the feeds to the stores and to the engine:
//  - a ticker for every instrument on a watchlist, on the desk or in the account
//  - the book and the tape for the instrument on the desk, so market orders
//    walk real depth and stops see every trade

const tickers = new Map<string, Unsubscribe>();
const statusSubs = new Map<string, Unsubscribe>();
const extraInterest = new Set<string>();
let pending: Record<string, QuoteInfo> = {};
let deskBook: BookSnapshot | null = null;
let deskFor: string | null = null;
let deskSubs: Unsubscribe[] = [];

let replaying = false;

/**
 * Hand a price to the engine. If prices have not been arriving for a while
 * (Flame was closed, the machine slept, the feed dropped), the candles that
 * were missed are replayed first, and live prices wait until that is done so
 * an old stop is not filled at today's price.
 */
function engineQuote(id: string, quote: Quote): void {
  if (replaying) return;
  const now = Date.now();
  const prev = lastPrice();
  if (prev > 0 && now - prev > MIN_GAP) {
    replaying = true;
    void catchUp(prev).finally(() => {
      replaying = false;
      notePrice(Date.now());
    });
    return;
  }
  notePrice(now);
  useAccount.getState().onQuote(id, quote);
}

/** 'book' when a market order on this instrument would walk live depth, 'last' when it would fill at the last price. */
export function fillBasis(id: string): 'book' | 'last' {
  return id === deskFor && deskBook !== null && Date.now() - deskBook.t < 5_000 ? 'book' : 'last';
}

function flushQuotes(): void {
  const batch = pending;
  pending = {};
  const m = useMarket.getState();
  useMarket.setState({ quotes: { ...m.quotes, ...batch } });
}

function pushQuote(id: string, info: QuoteInfo): void {
  pending[id] = info;
  onFrame(flushQuotes);
}

function watchStatus(venueId: string, adapter: { status(): FeedStatus; onStatus(cb: (s: FeedStatus) => void): Unsubscribe }): void {
  if (statusSubs.has(venueId)) return;
  const set = (s: FeedStatus) => useMarket.setState({ feeds: { ...useMarket.getState().feeds, [venueId]: s } });
  set(adapter.status());
  statusSubs.set(venueId, adapter.onStatus(set));
}

/** The price to fill an order against, right now. Undefined when there is no fresh price. */
export function quoteFor(id: string): Quote | undefined {
  const info = pending[id] ?? useMarket.getState().quotes[id];
  const now = Date.now();
  if (id === deskFor && deskBook && now - deskBook.t < 5_000) {
    const bid = deskBook.bids[0]?.[0];
    const ask = deskBook.asks[0]?.[0];
    if (bid !== undefined && ask !== undefined) {
      const last = info && !isStale(info, now) ? Math.min(ask, Math.max(bid, info.last)) : (bid + ask) / 2;
      return { bid, ask, last, t: now, book: { bids: deskBook.bids.slice(0, 500), asks: deskBook.asks.slice(0, 500) } };
    }
  }
  if (!info || isStale(info, now)) return undefined;
  return { bid: info.last, ask: info.last, last: info.last, t: now, ...(info.open !== undefined ? { open: info.open } : {}) };
}

function onDeskTrades(id: string, ticks: Tick[]): void {
  const lastTick = ticks[ticks.length - 1];
  if (!lastTick) return;
  const prev = pending[id] ?? useMarket.getState().quotes[id];
  const r = route(id);
  // Until the ticker has reported the day's change it is unknown, not zero.
  pushQuote(id, { last: lastTick.p, changePct: prev?.changePct ?? NaN, t: Date.now(), kind: r?.adapter.kind ?? 'live' });

  const account = useAccount.getState();
  if (!isExposed(account.live, id)) {
    notePrice(Date.now());
    return;
  }
  // Stops trigger on the last trade: show the engine the batch's extremes, then where it ended.
  let lo = lastTick.p;
  let hi = lastTick.p;
  for (const t of ticks) {
    if (t.p < lo) lo = t.p;
    if (t.p > hi) hi = t.p;
  }
  const base = quoteFor(id);
  if (!base) return;
  for (const p of new Set([lo, hi, lastTick.p])) engineQuote(id, { ...base, last: p });
}

function selectDesk(id: string): void {
  if (id === deskFor) return;
  for (const stop of deskSubs) stop();
  deskSubs = [];
  deskBook = null;
  deskFor = id;
  const r = route(id);
  if (!r) return;
  watchStatus(r.adapter.id, r.adapter);
  if (r.adapter.hasBook) {
    deskSubs.push(
      r.adapter.subscribeBook(r.symbol, (b) => {
        deskBook = b;
        // A resting limit fills when the opposite best quote reaches it, even with no trade.
        if (isExposed(useAccount.getState().live, id)) {
          const q = quoteFor(id);
          if (q) engineQuote(id, q);
        }
      }),
    );
    deskSubs.push(r.adapter.subscribeTrades(r.symbol, (ticks) => onDeskTrades(id, ticks)));
  }
}

function reconcile(): void {
  const market = useMarket.getState();
  const account = useAccount.getState().live;
  const want = new Set<string>([market.instrument, ...activeItems(useWatchlists.getState()), ...extraInterest]);
  for (const p of Object.values(account.positions)) want.add(p.instrument);
  for (const o of account.orders) if (o.status === 'working') want.add(o.instrument);

  for (const [id, stop] of tickers) {
    if (!want.has(id)) {
      stop();
      tickers.delete(id);
    }
  }
  for (const id of want) {
    if (tickers.has(id)) continue;
    const r = route(id);
    if (!r) continue;
    watchStatus(r.adapter.id, r.adapter);
    tickers.set(
      id,
      r.adapter.subscribeTicker(r.symbol, (t) => {
        pushQuote(id, { last: t.last, changePct: t.changePct, t: Date.now(), kind: r.adapter.kind, ...(t.open !== undefined ? { open: t.open } : {}) });
        // Instruments off the desk have no book here: the engine fills them at the last price.
        if (id !== deskFor || !r.adapter.hasBook) {
          engineQuote(id, { bid: t.last, ask: t.last, last: t.last, t: Date.now(), ...(t.open !== undefined ? { open: t.open } : {}) });
        }
      }),
    );
  }
  selectDesk(market.instrument);
}

/** Keep a ticker running for an instrument a view is showing (a Markets board, say). */
export function watch(ids: string[]): Unsubscribe {
  for (const id of ids) extraInterest.add(id);
  reconcile();
  return () => {
    for (const id of ids) extraInterest.delete(id);
    reconcile();
  };
}

let started = false;

export function startLive(): void {
  if (started) return;
  started = true;
  reconcile();
  let lastInstrument = useMarket.getState().instrument;
  useMarket.subscribe((s) => {
    if (s.instrument !== lastInstrument) {
      lastInstrument = s.instrument;
      reconcile();
    }
  });
  useWatchlists.subscribe(reconcile);
  let lastAccount = useAccount.getState().live;
  useAccount.subscribe((s) => {
    if (s.live.positions !== lastAccount.positions || s.live.orders !== lastAccount.orders) reconcile();
    lastAccount = s.live;
  });

  const setOnline = () => useMarket.setState({ online: navigator.onLine });
  window.addEventListener('online', setOnline);
  window.addEventListener('offline', setOnline);

  // The heartbeat stores the last moment a price arrived, so the next visit knows what it missed.
  let saved = 0;
  setInterval(() => {
    const seen = lastPrice();
    if (seen > saved && !replaying) {
      saved = seen;
      saveHeartbeat();
    }
  }, 5_000);
}
