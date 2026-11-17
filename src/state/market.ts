import { create } from 'zustand';
import type { FeedStatus, Timeframe } from '../data/types';
import { save } from './persist';

export interface QuoteInfo {
  last: number;
  changePct: number;
  /** When this price arrived here. */
  t: number;
  /** False while a stock's exchange is closed. */
  open?: boolean;
  kind: 'live' | 'delayed' | 'simulated';
}

interface MarketStore {
  instrument: string;
  tf: Timeframe;
  quotes: Record<string, QuoteInfo>;
  /** Connection state per venue id. */
  feeds: Record<string, FeedStatus>;
  online: boolean;
  select(id: string): void;
  setTf(tf: Timeframe): void;
  hydrate(d: { instrument?: string; tf?: Timeframe } | undefined): void;
}

export const useMarket = create<MarketStore>((set, get) => ({
  instrument: 'crypto:BTC',
  tf: '15m',
  quotes: {},
  feeds: {},
  online: typeof navigator === 'undefined' ? true : navigator.onLine,
  select(id) {
    if (id === get().instrument) return;
    set({ instrument: id });
    save('layout', { ...layoutDoc(), instrument: id });
  },
  setTf(tf) {
    set({ tf });
    save('layout', { ...layoutDoc(), tf });
  },
  hydrate(d) {
    if (!d) return;
    set({ instrument: d.instrument ?? get().instrument, tf: d.tf ?? get().tf });
  },
}));

// The layout document holds the desk's selection and its pane sizes; the
// layout store owns the sizes and registers how to read them here.
let extraLayout: () => Record<string, unknown> = () => ({});
export function registerLayoutDoc(fn: () => Record<string, unknown>): void {
  extraLayout = fn;
}
export function layoutDoc(): Record<string, unknown> {
  const m = useMarket.getState();
  return { ...extraLayout(), instrument: m.instrument, tf: m.tf };
}

/** A price is stale when nothing has arrived for five seconds (two minutes for delayed quotes). */
export function isStale(q: QuoteInfo | undefined, now: number): boolean {
  if (!q) return true;
  return now - q.t > (q.kind === 'delayed' ? 120_000 : 5_000);
}
