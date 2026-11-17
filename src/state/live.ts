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
import { crossed, useLevels } from './levels';
import { toast } from './toasts';
import { instrument } from '../data/instruments';
import { dollars } from '../lib/format';
import { registerLiveQuote } from './account';

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
 * Called for every price that arrives. Returns true when the engine may act on
 * it. If prices have not been arriving for a while (Flame was closed, the
 * machine slept, the feed dropped), the candles that were missed are replayed
 * first, and live prices wait until that is done, so an old stop is not
 * filled at today's price. Every price goes through here, whichever
 * instrument it is for: the gap must be noticed by the first one to arrive.
 */
function gate(): boolean {
  if (replaying) return false;
  const now = Date.now();
  const prev = lastPrice();
  if (prev > 0 && now - prev > MIN_GAP) {
    replaying = true;
    void catchUp(prev).finally(() => {
      replaying = false;
      notePrice(Date.now());
    });
    return false;
  }
  notePrice(now);
  return true;
}

function engineQuote(id: string, quote: Quote): void {
  if (gate()) useAccount.getState().onQuote(id, quote);
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
  checkAlerts(batch);
}

/** Fire any price alert the new prices cross. */
function checkAlerts(batch: Record<string, QuoteInfo>): void {
  const levels = useLevels.getState();
  for (const [id, q] of Object.entries(batch)) {
    const list = levels.byInstrument[id];
    if (!list || !list.some((l) => l.alert && l.firedAt === undefined)) continue;
    // An alert set before any price had arrived is armed by the first one.
    for (const l of list) if (l.alert && l.firedAt === undefined && l.from === undefined) levels.arm(id, l.id, q.last);
    for (const l of crossed(useLevels.getState().byInstrument[id] ?? [], q.last)) {
      levels.fire(id, l.id, Date.now());
      const text = `${instrument(id).symbol} crossed your alert at ${dollars(l.price)}. It is now ${dollars(q.last)}.`;
      toast(text, { sticky: true });
      notify('Flame price alert', text);
    }
  }
}

/** A system notification, when the user has allowed them. The in-app notice is always shown. */
function notify(title: string, body: string): void {
  try {
    if (typeof Notification !== 'undefined' && Notification.permission === 'granted') new Notification(title, { body, icon: '/icon-192.png' });
  } catch (err) {
    console.warn('[flame] system notification failed', err);
  }
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
  // A venue with its own two-sided price (a prediction market) fills against that.
  const r = route(id);
  const own = r?.adapter.quote?.(r.symbol);
  if (own) return own;
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
    gate();
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
  if (started) reconcile();
  return () => {
    for (const id of ids) extraInterest.delete(id);
    if (started) reconcile();
  };
}

let started = false;
const teardown: (() => void)[] = [];

/** Stop every feed and timer: this tab has handed the account to another one. */
export function stopLive(): void {
  for (const off of teardown.splice(0)) off();
  for (const stop of tickers.values()) stop();
  tickers.clear();
  for (const stop of deskSubs) stop();
  deskSubs = [];
  deskFor = null;
  deskBook = null;
  for (const stop of statusSubs.values()) stop();
  statusSubs.clear();
  extraInterest.clear();
  started = false;
}

export function startLive(): void {
  if (started) return;
  started = true;
  registerLiveQuote(quoteFor);
  reconcile();
  let lastInstrument = useMarket.getState().instrument;
  teardown.push(
    useMarket.subscribe((s) => {
      if (s.instrument !== lastInstrument) {
        lastInstrument = s.instrument;
        reconcile();
      }
    }),
  );
  teardown.push(useWatchlists.subscribe(reconcile));
  let lastAccount = useAccount.getState().live;
  teardown.push(
    useAccount.subscribe((s) => {
      if (s.live.positions !== lastAccount.positions || s.live.orders !== lastAccount.orders) reconcile();
      lastAccount = s.live;
    }),
  );

  const setOnline = () => useMarket.setState({ online: navigator.onLine });
  window.addEventListener('online', setOnline);
  window.addEventListener('offline', setOnline);
  teardown.push(() => {
    window.removeEventListener('online', setOnline);
    window.removeEventListener('offline', setOnline);
  });

  // The heartbeat stores the last moment a price arrived, so the next visit knows what it missed.
  let saved = 0;
  const beat = setInterval(() => {
    const seen = lastPrice();
    if (seen > saved && !replaying) {
      saved = seen;
      saveHeartbeat();
    }
  }, 5_000);
  teardown.push(() => clearInterval(beat));
}
