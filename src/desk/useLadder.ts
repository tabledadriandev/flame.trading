import { useEffect, useRef, useState } from 'react';
import { route } from '../data/feed';
import { buildLadder, type Ladder, type VenueBook } from '../data/ladder';
import { BOOK_VENUES } from '../data/venues';
import type { FeedStatus } from '../data/types';
import { SIM } from '../lib/env';

export interface VenueState {
  id: string;
  /** 'in' when its book is in the ladder; otherwise why not. */
  state: 'in' | 'waiting' | 'reconnecting' | 'down' | 'unlisted';
}

export interface LadderFeed {
  ladder: Ladder | null;
  venues: VenueState[];
  /** True once the primary venue has delivered a book. */
  ready: boolean;
  /** Why the primary book is not syncing, when it is not. */
  problem: string | null;
}

/** How long a venue may stay silent after subscribing before we call the coin unlisted there. */
const UNLISTED_AFTER = 12_000;

/**
 * The merged book for an instrument: the primary venue first, then every
 * other venue that lists the coin. Rebuilt about four times a second.
 */
export function useLadder(instrumentId: string, tick: number, range = 0.01): LadderFeed {
  const [feed, setFeed] = useState<LadderFeed>({ ladder: null, venues: [], ready: false, problem: null });
  const tickRef = useRef(tick);
  tickRef.current = tick;
  const rangeRef = useRef(range);
  rangeRef.current = range;

  useEffect(() => {
    const r = route(instrumentId);
    setFeed({ ladder: null, venues: [], ready: false, problem: null });
    if (!r || !r.adapter.hasBook) return;

    const books = new Map<string, VenueBook>();
    const stops: (() => void)[] = [];
    const started = Date.now();
    const order: { id: string; status: () => FeedStatus }[] = [{ id: r.adapter.id, status: () => r.adapter.status() }];

    let problem: string | null = null;
    stops.push(
      r.adapter.subscribeBook(
        r.symbol,
        (b) => books.set(r.adapter.id, { venue: r.adapter.id, bids: b.bids, asks: b.asks, t: b.t }),
        (message) => {
          problem = message;
        },
      ),
    );

    const base = instrumentId.startsWith('crypto:') ? instrumentId.slice('crypto:'.length) : null;
    if (base && !SIM) {
      for (const v of BOOK_VENUES) {
        order.push({ id: v.id, status: () => v.status() });
        stops.push(v.subscribeBook(base, (b) => books.set(v.id, { venue: v.id, bids: b.bids, asks: b.asks, t: b.t })));
      }
    }

    const build = () => {
      const now = Date.now();
      const list = order.map((o) => books.get(o.id)).filter((b): b is VenueBook => b !== undefined);
      const primary = books.get(r.adapter.id);
      // The primary venue anchors the ladder; without it there is no honest mid.
      const ladder = primary ? buildLadder([primary, ...list.filter((b) => b !== primary)], { tick: tickRef.current, range: rangeRef.current, now }) : null;
      const included = new Set(ladder?.venues ?? []);
      const venues: VenueState[] = order.map((o) => {
        if (included.has(o.id)) return { id: o.id, state: 'in' };
        const s = o.status();
        if (s === 'reconnecting' || s === 'down') return { id: o.id, state: s };
        if (!books.has(o.id) && s === 'live' && now - started > UNLISTED_AFTER) return { id: o.id, state: 'unlisted' };
        return { id: o.id, state: books.has(o.id) ? 'reconnecting' : 'waiting' };
      });
      setFeed({ ladder, venues, ready: primary !== undefined, problem });
    };
    const timer = setInterval(build, 250);

    return () => {
      clearInterval(timer);
      for (const stop of stops) stop();
    };
  }, [instrumentId]);

  return feed;
}
