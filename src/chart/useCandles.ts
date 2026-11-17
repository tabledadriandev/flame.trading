import { useCallback, useEffect, useRef, useState } from 'react';
import { route } from '../data/feed';
import { onFrame } from '../data/schedule';
import { FeedError, type Candle, type Timeframe } from '../data/types';

// Candles for one instrument and timeframe: history over REST, the bar in
// progress over the stream. Cached in memory only, never stored.

const cache = new Map<string, Candle[]>();

export interface CandleFeed {
  candles: Candle[];
  state: 'loading' | 'ready' | 'failed';
  error: string | null;
  retry: () => void;
  loadOlder: () => void;
}

function merge(base: Candle[], incoming: Candle[]): Candle[] {
  if (incoming.length === 0) return base;
  const firstNew = incoming[0]!.t;
  const keep = base.filter((c) => c.t < firstNew);
  return [...keep, ...incoming];
}

export function useCandles(instrumentId: string, tf: Timeframe, limit = 1000): CandleFeed {
  const key = `${instrumentId}|${tf}`;
  const [candles, setCandles] = useState<Candle[]>(() => cache.get(key) ?? []);
  const [state, setState] = useState<CandleFeed['state']>(() => (cache.has(key) ? 'ready' : 'loading'));
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const data = useRef<Candle[]>(candles);
  const older = useRef<{ busy: boolean; done: boolean }>({ busy: false, done: false });
  const current = useRef(key);

  useEffect(() => {
    let alive = true;
    current.current = key;
    const r = route(instrumentId);
    const cached = cache.get(key);
    data.current = cached ?? [];
    setCandles(data.current);
    setState(cached ? 'ready' : 'loading');
    setError(null);
    older.current = { busy: false, done: false };
    if (!r) {
      setState('failed');
      setError('Flame has no data source for this instrument yet.');
      return;
    }

    const publish = () => {
      if (!alive) return;
      cache.set(key, data.current);
      setCandles(data.current);
    };

    const load = () =>
      r.adapter
        .candles(r.symbol, tf, { limit })
        .then((rows) => {
          if (!alive) return;
          // Keep older bars already paged in; replace everything the fresh page covers.
          data.current = merge(data.current, rows);
          publish();
          setState('ready');
          setError(null);
        })
        .catch((err: unknown) => {
          if (!alive) return;
          console.error(`[flame] candles for ${key} failed`, err);
          if (data.current.length === 0) setState('failed');
          setError(err instanceof FeedError ? err.message : 'The chart data could not be loaded.');
        });
    void load();

    const stop = r.adapter.subscribeCandles(r.symbol, tf, (c) => {
      const cur = data.current;
      const last = cur[cur.length - 1];
      if (!last) return; // history has not arrived; the stream alone is not a chart
      if (c.t === last.t) data.current = [...cur.slice(0, -1), c];
      else if (c.t > last.t) data.current = [...cur, c];
      else return;
      onFrame(publish);
    });

    // After a reconnect the stream has a hole in it: fetch the recent bars again.
    let wasLive = r.adapter.status() === 'live';
    const offStatus = r.adapter.onStatus((s) => {
      if (s === 'live' && !wasLive) void load();
      wasLive = s === 'live';
    });

    return () => {
      alive = false;
      stop();
      offStatus();
    };
  }, [instrumentId, tf, key, limit, attempt]);

  const retry = useCallback(() => setAttempt((n) => n + 1), []);

  const loadOlder = useCallback(() => {
    const r = route(instrumentId);
    const first = data.current[0];
    if (!r || !first || older.current.busy || older.current.done) return;
    older.current.busy = true;
    const forKey = key;
    r.adapter
      .candles(r.symbol, tf, { before: first.t, limit: 1000 })
      .then((rows) => {
        if (current.current !== forKey) return; // the chart moved on while this was loading
        const fresh = rows.filter((c) => c.t < first.t);
        if (fresh.length === 0) {
          older.current.done = true;
          return;
        }
        data.current = [...fresh, ...data.current];
        cache.set(forKey, data.current);
        setCandles(data.current);
      })
      .catch((err: unknown) => {
        console.warn(`[flame] older candles for ${forKey} failed`, err);
        older.current.done = true;
      })
      .finally(() => {
        older.current.busy = false;
      });
  }, [instrumentId, tf, key]);

  return { candles, state, error, retry, loadOlder };
}

/** Candles fetched once, for views that work on history (Lab, the outcome cone). */
export async function fetchCandles(instrumentId: string, tf: Timeframe, count: number): Promise<Candle[]> {
  const r = route(instrumentId);
  if (!r) throw new FeedError('Flame has no data source for this instrument yet.', 'none');
  let out: Candle[] = [];
  let before: number | undefined;
  while (out.length < count) {
    const page = await r.adapter.candles(r.symbol, tf, { limit: Math.min(1000, count - out.length), ...(before !== undefined ? { before } : {}) });
    const fresh = before === undefined ? page : page.filter((c) => c.t < before!);
    if (fresh.length === 0) break;
    out = [...fresh, ...out];
    before = fresh[0]!.t;
    if (page.length < 2) break;
  }
  return out;
}
