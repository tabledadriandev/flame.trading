import { useEffect, useRef, useState } from 'react';
import { valuation, type Valuation } from '../engine/engine';
import type { Account } from '../engine/types';
import { useAccount, type Book } from './account';
import { useMarket, type QuoteInfo } from './market';

function marksFor(a: Account): Record<string, number | undefined> {
  const quotes = useMarket.getState().quotes;
  const marks: Record<string, number | undefined> = {};
  for (const p of Object.values(a.positions)) marks[p.instrument] = quotes[p.instrument]?.last;
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
