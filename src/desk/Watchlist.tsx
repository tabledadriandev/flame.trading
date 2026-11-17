import { useEffect, useRef, useState } from 'react';
import { Ellipsis, Plus, X } from 'lucide-react';
import { usePalette } from '../state/palette';
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

function ListMenu() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const { lists, active, createList, renameList, deleteList } = useWatchlists();
  const current = lists.find((l) => l.id === active);
  useEffect(() => {
    if (!open) return;
    const close = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', close);
    return () => document.removeEventListener('pointerdown', close);
  }, [open]);
  return (
    <div className="menu-anchor" ref={ref}>
      <button type="button" className="btn btn-quiet btn-icon btn-sm" aria-expanded={open} aria-haspopup="menu" aria-label="Watchlist options" onClick={() => setOpen(!open)}>
        <Ellipsis size={14} aria-hidden="true" />
      </button>
      {open ? (
        <div className="pop watch-menu" role="menu">
          <button
            type="button"
            className="pop-item"
            role="menuitem"
            onClick={() => {
              const name = window.prompt('Name the new list');
              if (name) createList(name);
              setOpen(false);
            }}
          >
            New list
          </button>
          <button
            type="button"
            className="pop-item"
            role="menuitem"
            onClick={() => {
              const name = window.prompt('Rename this list', current?.name ?? '');
              if (name) renameList(active, name);
              setOpen(false);
            }}
          >
            Rename “{current?.name}”
          </button>
          <button
            type="button"
            className="pop-item"
            role="menuitem"
            disabled={lists.length < 2}
            onClick={() => {
              if (window.confirm(`Delete the list “${current?.name}”? The symbols in it are not affected anywhere else.`)) deleteList(active);
              setOpen(false);
            }}
          >
            Delete this list
          </button>
        </div>
      ) : null}
    </div>
  );
}

function Row({ id, index, selected, now }: { id: string; index: number; selected: boolean; now: number }) {
  const q = useMarket((s) => s.quotes[id]);
  const select = useMarket((s) => s.select);
  const flash = useFlash(q?.last);
  const spark = useSpark(id);
  const i = instrument(id);
  const known = q !== undefined && Number.isFinite(q.changePct);
  const up = (q?.changePct ?? 0) >= 0;
  const stale = q !== undefined && isStale(q, now);
  return (
    <div
      className="watch-item"
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData('text/flame-watch', String(index));
        e.dataTransfer.effectAllowed = 'move';
      }}
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes('text/flame-watch')) e.preventDefault();
      }}
      onDrop={(e) => {
        const from = Number(e.dataTransfer.getData('text/flame-watch'));
        if (Number.isInteger(from) && from !== index) useWatchlists.getState().move(from, index);
      }}
    >
    <button
      type="button"
      className="watch-row"
      aria-current={selected ? 'true' : undefined}
      data-stale={stale ? 'true' : undefined}
      onClick={() => select(id)}
      onKeyDown={(e) => {
        // Alt with the arrows reorders; Delete removes.
        if (e.altKey && e.key === 'ArrowUp') {
          e.preventDefault();
          useWatchlists.getState().move(index, index - 1);
        } else if (e.altKey && e.key === 'ArrowDown') {
          e.preventDefault();
          useWatchlists.getState().move(index, index + 1);
        } else if (e.key === 'Delete' || e.key === 'Backspace') {
          useWatchlists.getState().remove(id);
        }
      }}
      title={stale ? `${i.name}. This price is old: nothing has arrived for a while.` : `${i.name}. Drag to reorder (or Alt with the arrow keys); Delete removes it.`}
    >
      <span className="watch-sym">{i.symbol}</span>
      <Spark points={spark} up={up} />
      <span className="watch-last num" data-flash={flash ?? undefined}>
        {q ? price(q.last) : '—'}
      </span>
      <span className={`watch-chg num ${known && !stale ? (up ? 'hot' : 'cold') : ''}`}>{stale ? 'Old' : q ? pct(q.changePct) : '—'}</span>
    </button>
      <button type="button" className="watch-x" onClick={() => useWatchlists.getState().remove(id)} aria-label={`Remove ${i.symbol} from this list`} title="Remove">
        <X size={12} aria-hidden="true" />
      </button>
    </div>
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
      tools={
        <>
          {first ? <FeedBadge instrumentId={first} /> : null}
          <button type="button" className="btn btn-quiet btn-icon btn-sm" onClick={() => usePalette.getState().show('', 'watch')} aria-label="Add a symbol to this list" title="Add a symbol">
            <Plus size={14} aria-hidden="true" />
          </button>
          <ListMenu />
        </>
      }
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
            {items.map((id, n) => (
              <Row key={id} id={id} index={n} selected={id === selected} now={now} />
            ))}
          </div>
        )}
      </div>
    </Pane>
  );
}
