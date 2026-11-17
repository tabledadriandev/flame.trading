import { useEffect, useRef, useState } from 'react';
import { route } from '../data/feed';
import { instrument } from '../data/instruments';
import type { Tick } from '../data/types';
import { clock, compact, price } from '../lib/format';
import { useMarket } from '../state/market';
import { Help, Pane, PaneState } from '../ui/controls';

const KEEP = 200;
/** Trades worth at least this many dollars are set in a heavier weight. */
const LARGE = 50_000;
const FILTERS = [
  { value: 0, label: 'All sizes' },
  { value: 1_000, label: '$1K and up' },
  { value: 10_000, label: '$10K and up' },
  { value: 100_000, label: '$100K and up' },
];

export function Tape() {
  const id = useMarket((s) => s.instrument);
  const i = instrument(id);
  const r = route(id);
  const hasTape = r?.adapter.hasBook ?? false;
  const [min, setMin] = useState(0);
  const [rows, setRows] = useState<Tick[]>([]);
  const all = useRef<Tick[]>([]);
  const minRef = useRef(min);
  minRef.current = min;

  useEffect(() => {
    all.current = [];
    setRows([]);
    if (!r || !r.adapter.hasBook) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const show = () => {
      timer = null;
      const m = minRef.current;
      setRows(all.current.filter((t) => t.p * t.q >= m).slice(0, KEEP));
    };
    const stop = r.adapter.subscribeTrades(r.symbol, (ticks) => {
      // Newest first. Keep more than is shown so a size filter still has 200 to show.
      for (const t of ticks) all.current.unshift(t);
      if (all.current.length > KEEP * 20) all.current.length = KEEP * 20;
      if (!timer) timer = setTimeout(show, 200);
    });
    return () => {
      stop();
      if (timer) clearTimeout(timer);
    };
  }, [id]);

  useEffect(() => {
    setRows(all.current.filter((t) => t.p * t.q >= min).slice(0, KEEP));
  }, [min]);

  return (
    <Pane
      label="Trade tape"
      className="pane-tape"
      title="Tape"
      tools={
        hasTape ? (
          <>
            <select className="pane-select" value={min} onChange={(e) => setMin(Number(e.target.value))} aria-label="Hide trades smaller than">
              {FILTERS.map((f) => (
                <option key={f.value} value={f.value}>
                  {f.label}
                </option>
              ))}
            </select>
            <Help align="right" label="How to read the tape">
              Every trade as it prints, newest first. An up arrow is a buyer lifting the offer; a down arrow is a seller hitting the bid. Trades of $50K or more are set in bold.
            </Help>
          </>
        ) : null
      }
    >
      {!hasTape ? (
        <PaneState title={`No tape for ${i.symbol}`}>Trade-by-trade data is not available for this instrument.</PaneState>
      ) : rows.length === 0 ? (
        <PaneState title={min > 0 ? 'No trades this large yet' : 'Waiting for trades'}>
          {min > 0 ? 'Lower the size filter to see smaller prints.' : `${i.symbol} prints appear here as they happen.`}
        </PaneState>
      ) : (
        <div className="pane-body">
          <table className="table tape">
            <thead>
              <tr>
                <th className="l">Time</th>
                <th>Price</th>
                <th>Size</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((t, n) => (
                <tr key={`${t.t}-${n}-${t.p}-${t.q}`} data-large={t.p * t.q >= LARGE ? 'true' : undefined}>
                  <td className="l sub">{clock(t.t)}</td>
                  <td className={t.side === 'buy' ? 'hot' : 'cold'}>
                    <span className="side-glyph" aria-hidden="true">
                      {t.side === 'buy' ? '▲' : '▼'}
                    </span>{' '}
                    <span className="sr-only">{t.side === 'buy' ? 'Bought at' : 'Sold at'}</span>
                    {price(t.p)}
                  </td>
                  <td>{compact(t.q)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Pane>
  );
}
