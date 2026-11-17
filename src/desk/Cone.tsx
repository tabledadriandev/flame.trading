import { useEffect, useMemo, useState } from 'react';
import { fetchCandles } from '../chart/useCandles';
import { instrument } from '../data/instruments';
import type { Side } from '../engine/types';
import { outcomeCone } from '../lab/cone';
import { dollars, money, pct } from '../lib/format';
import { Help, Segmented } from '../ui/controls';

// "If you hold": the range of outcomes for 1 day, 1 week or 1 month, drawn as
// a cone from now. See src/lab/cone.ts for the method.

const history = new Map<string, { at: number; closes: number[] }>();
const TTL = 30 * 60_000;

function useDailyCloses(id: string, on: boolean): { closes: number[] | null; error: string | null } {
  const [state, setState] = useState<{ closes: number[] | null; error: string | null }>(() => ({ closes: history.get(id)?.closes ?? null, error: null }));
  useEffect(() => {
    if (!on) return;
    const hit = history.get(id);
    if (hit && Date.now() - hit.at < TTL) {
      setState({ closes: hit.closes, error: null });
      return;
    }
    let alive = true;
    setState({ closes: null, error: null });
    fetchCandles(id, '1d', 730)
      .then((bars) => {
        const closes = bars.map((b) => b.c);
        history.set(id, { at: Date.now(), closes });
        if (alive) setState({ closes, error: null });
      })
      .catch((err: unknown) => {
        console.warn(`[flame] daily history for ${id} failed`, err);
        if (alive) setState({ closes: null, error: err instanceof Error ? err.message : 'The daily history could not be loaded.' });
      });
    return () => {
      alive = false;
    };
  }, [id, on]);
  return state;
}

type Horizon = '1' | '5' | '21';
const NAMES: Record<Horizon, string> = { '1': '1 day', '5': '1 week', '21': '1 month' };

export function ConePanel({ instrumentId, side, qty, entry, feeRate, stop, target }: { instrumentId: string; side: Side; qty: number; entry: number; feeRate: number; stop: number; target: number }) {
  const [open, setOpen] = useState(false);
  const [horizon, setHorizon] = useState<Horizon>('5');
  const { closes, error } = useDailyCloses(instrumentId, open);
  const ready = qty > 0 && entry > 0;
  // Round the entry so the cone does not redraw on every tick.
  const steady = ready ? Number(entry.toPrecision(4)) : 0;
  const cone = useMemo(
    () =>
      open && closes && ready
        ? outcomeCone({ closes, horizon: Number(horizon), entry: steady, side, qty, feeRate, ...(stop > 0 ? { stop } : {}), ...(target > 0 ? { target } : {}) })
        : null,
    [open, closes, ready, horizon, steady, side, qty, feeRate, stop, target],
  );
  const i = instrument(instrumentId);

  return (
    <section className="cone" aria-label="If you hold">
      <div className="cone-head">
        <button type="button" className="link" aria-expanded={open} onClick={() => setOpen(!open)}>
          If you hold
        </button>
        <Help align="right" label="How this is worked out">
          Flame takes {i.symbol}'s daily returns from the last two years, draws runs of five consecutive real days at random, and chains them into 2,000 possible paths (a block bootstrap). The
          cone covers the middle 80% of those paths. It describes how {i.symbol} has behaved, not what it will do. Stops and targets are checked at each day's close.
        </Help>
        {open ? (
          <Segmented<Horizon>
            label="Holding period"
            value={horizon}
            onChange={setHorizon}
            options={[
              { value: '1', label: '1D' },
              { value: '5', label: '1W' },
              { value: '21', label: '1M' },
            ]}
          />
        ) : null}
      </div>
      {!open ? null : error ? (
        <p className="cone-note">The outcome cone needs {i.symbol}'s daily history, which could not be loaded. {error}</p>
      ) : !ready ? (
        <p className="cone-note">Enter a size to see the range of outcomes.</p>
      ) : !closes ? (
        <p className="cone-note">Loading two years of daily prices.</p>
      ) : !cone ? (
        <p className="cone-note">There is not enough daily history for {i.symbol} to draw a cone.</p>
      ) : (
        <ConeChart cone={cone} side={side} horizon={NAMES[horizon]} stop={stop} target={target} />
      )}
    </section>
  );
}

function ConeChart({ cone, side, horizon, stop, target }: { cone: NonNullable<ReturnType<typeof outcomeCone>>; side: Side; horizon: string; stop: number; target: number }) {
  const W = 268;
  const H = 96;
  const pad = { l: 4, r: 58, t: 8, b: 8 };
  const n = cone.p50.length - 1;
  const lo = Math.min(...cone.p10);
  const hi = Math.max(...cone.p90);
  const span = hi - lo || 1;
  const x = (d: number) => pad.l + (d / n) * (W - pad.l - pad.r);
  const y = (v: number) => pad.t + (1 - (v - lo) / span) * (H - pad.t - pad.b);
  const band = `${cone.p90.map((v, d) => `${d ? 'L' : 'M'}${x(d).toFixed(1)} ${y(v).toFixed(1)}`).join(' ')} ${[...cone.p10]
    .map((v, d) => [v, d] as const)
    .reverse()
    .map(([v, d]) => `L${x(d).toFixed(1)} ${y(v).toFixed(1)}`)
    .join(' ')} Z`;
  const median = cone.p50.map((v, d) => `${d ? 'L' : 'M'}${x(d).toFixed(1)} ${y(v).toFixed(1)}`).join(' ');
  const end = { p10: cone.p10[n]!, p50: cone.p50[n]!, p90: cone.p90[n]! };
  const neither = cone.stopFirst !== null || cone.targetFirst !== null ? 1 - (cone.stopFirst ?? 0) - (cone.targetFirst ?? 0) : null;
  return (
    <div className="cone-body">
      <svg
        width="100%"
        viewBox={`0 0 ${W} ${H}`}
        role="img"
        aria-label={`Over ${horizon}, eight paths in ten end between ${dollars(end.p10)} and ${dollars(end.p90)}; the middle path ends at ${dollars(end.p50)}.`}
      >
        <path d={band} className="cone-band" />
        <path d={median} className="cone-median" />
        <line x1={pad.l} x2={W - pad.r} y1={y(cone.p50[0]!)} y2={y(cone.p50[0]!)} className="cone-now" />
        <text x={W - pad.r + 4} y={y(end.p90) + 4} className="eq-tick">
          {dollars(end.p90)}
        </text>
        <text x={W - pad.r + 4} y={y(end.p50) + 4} className="eq-tick cone-mid">
          {dollars(end.p50)}
        </text>
        <text x={W - pad.r + 4} y={y(end.p10) + 4} className="eq-tick">
          {dollars(end.p10)}
        </text>
      </svg>
      <dl className="cone-facts num">
        <div>
          <dt>Ends in profit, after fees</dt>
          <dd>{pct(cone.profitShare * 100, false, 0)} of paths</dd>
        </div>
        <div>
          <dt>A typical good result</dt>
          <dd className={cone.good >= 0 ? 'hot' : 'cold'}>{money(cone.good, { signed: true })}</dd>
        </div>
        <div>
          <dt>A typical bad result</dt>
          <dd className={cone.bad >= 0 ? 'hot' : 'cold'}>{money(cone.bad, { signed: true })}</dd>
        </div>
        {cone.stopFirst !== null ? (
          <div>
            <dt>Hits the stop first</dt>
            <dd>{pct(cone.stopFirst * 100, false, 0)}</dd>
          </div>
        ) : null}
        {cone.targetFirst !== null ? (
          <div>
            <dt>Hits the target first</dt>
            <dd>{pct(cone.targetFirst * 100, false, 0)}</dd>
          </div>
        ) : null}
        {neither !== null ? (
          <div>
            <dt>Hits neither in {horizon}</dt>
            <dd>{pct(Math.max(0, neither) * 100, false, 0)}</dd>
          </div>
        ) : null}
      </dl>
      <p className="cone-note">
        From {cone.days} days of history, for a {side === 'buy' ? 'long' : 'short'} held {horizon}.{stop > 0 || target > 0 ? '' : ' Set a stop or a target to see how often each is reached.'}
      </p>
    </div>
  );
}
