import { useEffect, useState } from 'react';
import { route } from '../data/feed';
import { instrument } from '../data/instruments';
import { useFlash, useNow } from '../lib/hooks';
import { pct, price } from '../lib/format';
import { isStale, useMarket } from '../state/market';
import { activeItems, useWatchlists } from '../state/watchlists';
import { Pane, PaneState } from '../ui/controls';
import { FeedBadge } from '../ui/FeedBadge';

// ---------- 24-hour sparklines ----------

const sparks = new Map<string, { at: number; points: number[] }>();
const SPARK_TTL = 10 * 60_000;

export function useSpark(id: string): number[] | null {
  const [points, setPoints] = useState<number[] | null>(() => sparks.get(id)?.points ?? null);
  useEffect(() => {
    let alive = true;
    const load = () => {
      const hit = sparks.get(id);
      if (hit && Date.now() - hit.at < SPARK_TTL) {
        setPoints(hit.points);
        return;
      }
      const r = route(id);
      if (!r) return;
      r.adapter
        .candles(r.symbol, '1h', { limit: 24 })
        .then((cs) => {
          const pts = cs.map((c) => c.c);
          sparks.set(id, { at: Date.now(), points: pts });
          if (alive) setPoints(pts);
        })
        .catch((err: unknown) => {
          // The row still shows its live price; only the small chart is missing.
          console.warn(`[flame] sparkline for ${id} failed`, err);
          // A day's sparkline that is over half an hour old no longer describes the day.
          const old = sparks.get(id);
          if (old && Date.now() - old.at > 3 * SPARK_TTL) {
            sparks.delete(id);
            if (alive) setPoints(null);
          }
        });
    };
    load();
    const timer = setInterval(load, SPARK_TTL);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [id]);
  return points;
}

export function Spark({ points, up, width = 44, height = 18 }: { points: number[] | null; up: boolean; width?: number; height?: number }) {
  if (!points || points.length < 2) return <svg className="spark" width={width} height={height} aria-hidden="true" />;
  const min = Math.min(...points);
  const max = Math.max(...points);
  const span = max - min || 1;
  const d = points
    .map((p, i) => `${i === 0 ? 'M' : 'L'}${((i / (points.length - 1)) * (width - 2) + 1).toFixed(1)} ${(height - 2 - ((p - min) / span) * (height - 4)).toFixed(1)}`)
    .join(' ');
  return (
    <svg className="spark" width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden="true">
      <path d={d} fill="none" stroke={up ? 'var(--hot)' : 'var(--cold)'} strokeWidth="1.25" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

function Row({ id, selected, now }: { id: string; selected: boolean; now: number }) {
  const q = useMarket((s) => s.quotes[id]);
  const select = useMarket((s) => s.select);
  const flash = useFlash(q?.last);
  const spark = useSpark(id);
  const i = instrument(id);
  const known = q !== undefined && Number.isFinite(q.changePct);
  const up = (q?.changePct ?? 0) >= 0;
  const stale = q !== undefined && isStale(q, now);
  return (
    <button
      type="button"
      className="watch-row"
      aria-current={selected ? 'true' : undefined}
      data-stale={stale ? 'true' : undefined}
      onClick={() => select(id)}
      title={stale ? `${i.name}. This price is old: nothing has arrived for a while.` : i.name}
    >
      <span className="watch-sym">{i.symbol}</span>
      <Spark points={spark} up={up} />
      <span className="watch-last num" data-flash={flash ?? undefined}>
        {q ? price(q.last) : '—'}
      </span>
      <span className={`watch-chg num ${known && !stale ? (up ? 'hot' : 'cold') : ''}`}>{stale ? 'Old' : q ? pct(q.changePct) : '—'}</span>
    </button>
  );
}

export function Watchlist() {
  const items = useWatchlists(activeItems);
  const lists = useWatchlists((s) => s.lists);
  const active = useWatchlists((s) => s.active);
  const setActive = useWatchlists((s) => s.setActive);
  const selected = useMarket((s) => s.instrument);
  const first = items[0];
  const now = useNow(2_000);
  return (
    <Pane
      label="Watchlist"
      className="pane-watch"
      title={
        lists.length > 1 ? (
          <select className="pane-select" value={active} onChange={(e) => setActive(e.target.value)} aria-label="Watchlist">
            {lists.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </select>
        ) : (
          'Watchlist'
        )
      }
      tools={first ? <FeedBadge instrumentId={first} /> : null}
    >
      <div className="pane-body">
        {items.length === 0 ? (
          <PaneState title="This list is empty">Find a symbol with search (press /) and add it here.</PaneState>
        ) : (
          <div className="watch">
            <div className="watch-head" aria-hidden="true">
              <span>Symbol</span>
              <span>24h</span>
              <span>Last</span>
              <span>Change</span>
            </div>
            {items.map((id) => (
              <Row key={id} id={id} selected={id === selected} now={now} />
            ))}
          </div>
        )}
      </div>
    </Pane>
  );
}
