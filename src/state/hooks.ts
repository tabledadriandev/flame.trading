import { useEffect, useRef, useState } from 'react';
import { valuation, type Valuation } from '../engine/engine';
import type { Account } from '../engine/types';
import { lastPool } from '../data/dex';
import { positionValue } from '../engine/pool';
import { useAccount, type Book } from './account';
import { useMarket, type QuoteInfo } from './market';

function marksFor(a: Account): Record<string, number | undefined> {
  const quotes = useMarket.getState().quotes;
  const marks: Record<string, number | undefined> = {};
  for (const p of Object.values(a.positions)) {
    marks[p.instrument] = quotes[p.instrument]?.last;
    // A token is worth what its pool would pay for the whole position now, not the last price times the size.
    if (p.cls === 'meme') {
      // From the last reading of the pool, whatever its age, and never from the price on the screen: equity
      // must not jump when a reading goes stale. With no reading at all the position stays at cost.
      const reading = lastPool(p.instrument);
      marks[p.instrument] = reading ? positionValue(reading.pool, p.qty, p.sellTax, p.sellBlocked !== undefined) / p.qty : undefined;
    }
  }
  return marks;
}

/** The account valued at the latest prices, refreshed a few times a second. */
export function useValuation(book: Book = 'live', marks?: Record<string, number | undefined>): Valuation {
  const account = useAccount((s) => s[book]);
  const [v, setV] = useState(() => valuation(account, marks ?? marksFor(account)));
  const given = useRef(marks);
  given.current = marks;
  useEffect(() => {
    const tick = () => setV(valuation(account, given.current ?? marksFor(account)));
    tick();
    const timer = setInterval(tick, 400);
    return () => clearInterval(timer);
  }, [account]);
  return v;
}

/** A quote that re-renders its reader at most every `ms`, for panes that do not need every tick. */
export function useQuoteSlow(id: string, ms = 250): QuoteInfo | undefined {
  const [q, setQ] = useState(() => useMarket.getState().quotes[id]);
  useEffect(() => {
    setQ(useMarket.getState().quotes[id]);
    let last = 0;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const read = () => {
      timer = null;
      last = Date.now();
      setQ(useMarket.getState().quotes[id]);
    };
    const off = useMarket.subscribe((s, prev) => {
      if (s.quotes[id] === prev.quotes[id] || timer) return;
      const wait = ms - (Date.now() - last);
      if (wait <= 0) read();
      else timer = setTimeout(read, wait);
    });
    return () => {
      off();
      if (timer) clearTimeout(timer);
    };
  }, [id, ms]);
  return q;
}
