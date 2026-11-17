import { useEffect, useRef, useState } from 'react';
import { Activity, Plus, X } from 'lucide-react';
import { CATALOG, SHELF, shortName, type IndicatorType } from '../chart/indicators';
import { useIndicators } from '../state/indicators';

/** Indicator settings: a small popover, not a modal. Each study says what it tells you. */
export function IndicatorMenu({ canDelta, intraday, onAnchor }: { canDelta: boolean; intraday: boolean; onAnchor?: () => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const { active, volume, add, remove, setParam, setVolume } = useIndicators();

  useEffect(() => {
    if (!open) return;
    const close = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('pointerdown', close);
    document.addEventListener('keydown', key);
    return () => {
      document.removeEventListener('pointerdown', close);
      document.removeEventListener('keydown', key);
    };
  }, [open]);

  const unavailable = (type: IndicatorType): string | null => {
    const def = CATALOG[type];
    if (def.needsDelta && !canDelta) return 'Needs buy and sell volume, which only the crypto feed reports.';
    if (def.intradayOnly && !intraday) return 'Shown on intraday timeframes.';
    return null;
  };

  return (
    <div className="menu-anchor" ref={ref}>
      <button type="button" className="btn btn-sm" aria-expanded={open} aria-haspopup="dialog" onClick={() => setOpen(!open)}>
        <Activity size={13} aria-hidden="true" />
        Indicators
        {active.length ? <span className="count">{active.length}</span> : null}
      </button>
      {open ? (
        <div className="pop ind-pop" role="dialog" aria-label="Indicators">
          {active.length ? (
            <>
              <div className="pop-label">On the chart</div>
              {active.map((a) => {
                const def = CATALOG[a.type];
                const why = unavailable(a.type);
                return (
                  <div key={a.id} className="ind-active">
                    <div className="ind-active-head">
                      <strong>{shortName(a)}</strong>
                      <button type="button" className="btn btn-quiet btn-icon btn-sm" onClick={() => remove(a.id)} aria-label={`Remove ${shortName(a)}`}>
                        <X size={13} aria-hidden="true" />
                      </button>
                    </div>
                    {why ? <p className="ind-note">{why}</p> : null}
                    {a.type === 'avwap' ? (
                      <p className="ind-note">
                        {a.params.anchor ? 'Anchored. ' : 'Not anchored yet. '}
                        {onAnchor ? (
                          <button type="button" className="link" onClick={() => { onAnchor(); setOpen(false); }}>
                            Pick the anchor bar
                          </button>
                        ) : null}
                      </p>
                    ) : null}
                    {def.params.length ? (
                      <div className="ind-params">
                        {def.params.map((p) => (
                          <label key={p.key}>
                            <span>{p.label}</span>
                            <input
                              type="number"
                              className="num"
                              min={p.min}
                              max={p.max}
                              step={p.key === 'k' ? 0.5 : 1}
                              value={a.params[p.key] ?? p.value}
                              onChange={(e) => {
                                const v = Number(e.target.value);
                                if (Number.isFinite(v) && v >= p.min && v <= p.max) setParam(a.id, p.key, v);
                              }}
                            />
                          </label>
                        ))}
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </>
          ) : null}
          <div className="pop-label">Add</div>
          <label className="check ind-volume">
            <input type="checkbox" checked={volume} onChange={(e) => setVolume(e.target.checked)} />
            Volume
          </label>
          {SHELF.map((type) => {
            const def = CATALOG[type];
            const on = active.some((a) => a.type === type);
            if (on && !def.many) return null;
            const why = unavailable(type);
            return (
              <button key={type} type="button" className="pop-item ind-add" disabled={why !== null} onClick={() => add(type)}>
                <Plus size={13} aria-hidden="true" />
                <span>
                  <strong>{def.name}</strong>
                  <em>{why ?? def.tells}</em>
                </span>
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
