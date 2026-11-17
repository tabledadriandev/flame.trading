import { useMemo, useRef, useState } from 'react';
import { day, money, pct } from '../lib/format';
import { useSize } from '../lib/hooks';

export interface EquityPoint {
  t: number;
  equity: number;
}

/**
 * An equity curve with its drawdown shaded: the band between the highest
 * equity so far and where equity is now. One axis, ink only (equity is not
 * buying or selling pressure), a crosshair readout, and an optional dashed
 * comparison line.
 */
export function EquityChart({
  points,
  compare,
  compareLabel,
  height = 220,
  label,
}: {
  points: EquityPoint[];
  compare?: EquityPoint[];
  compareLabel?: string;
  height?: number;
  label: string;
}) {
  const [wrap, size] = useSize<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const svg = useRef<SVGSVGElement>(null);
  const W = Math.max(240, size.width);
  const H = height;
  const pad = { l: 8, r: 64, t: 10, b: 20 };

  const model = useMemo(() => {
    if (points.length < 2) return null;
    const all = [...points, ...(compare ?? [])];
    let lo = Infinity;
    let hi = -Infinity;
    for (const p of all) {
      lo = Math.min(lo, p.equity);
      hi = Math.max(hi, p.equity);
    }
    if (hi === lo) {
      hi += 1;
      lo -= 1;
    }
    const span = hi - lo;
    lo -= span * 0.06;
    hi += span * 0.06;
    const t0 = points[0]!.t;
    const t1 = points[points.length - 1]!.t;
    const x = (t: number) => pad.l + ((t - t0) / Math.max(1, t1 - t0)) * (W - pad.l - pad.r);
    const y = (v: number) => pad.t + (1 - (v - lo) / (hi - lo)) * (H - pad.t - pad.b);
    const line = (ps: EquityPoint[]) => ps.map((p, i) => `${i ? 'L' : 'M'}${x(p.t).toFixed(1)} ${y(p.equity).toFixed(1)}`).join(' ');
    let peak = -Infinity;
    const peaks = points.map((p) => (peak = Math.max(peak, p.equity)));
    // The drawdown band: along the running peak, then back along equity.
    const band = `${points.map((p, i) => `${i ? 'L' : 'M'}${x(p.t).toFixed(1)} ${y(peaks[i]!).toFixed(1)}`).join(' ')} ${[...points]
      .reverse()
      .map((p) => `L${x(p.t).toFixed(1)} ${y(p.equity).toFixed(1)}`)
      .join(' ')} Z`;
    const ticks = [0, 0.5, 1].map((f) => lo + (hi - lo) * (0.08 + f * 0.84));
    return { x, y, line, band, peaks, ticks, t0, t1 };
  }, [points, compare, W, H]);

  if (!model) {
    return (
      <div className="eq-empty" ref={wrap} style={{ height }}>
        Not enough closed trades to draw a curve yet.
      </div>
    );
  }

  const start = points[0]!.equity;
  const end = points[points.length - 1]!.equity;
  const hp = hover !== null ? points[hover] : null;
  const onMove = (clientX: number) => {
    const r = svg.current?.getBoundingClientRect();
    if (!r) return;
    const px = clientX - r.left;
    let best = 0;
    let dist = Infinity;
    for (let i = 0; i < points.length; i++) {
      const d = Math.abs(model.x(points[i]!.t) - px);
      if (d < dist) {
        dist = d;
        best = i;
      }
    }
    setHover(best);
  };

  return (
    <div className="eq" ref={wrap}>
      <svg
        ref={svg}
        width={W}
        height={H}
        role="img"
        aria-label={`${label}. From ${money(start)} to ${money(end)}, ${pct((end / start - 1) * 100)}. Largest drawdown ${money(Math.max(...points.map((p, i) => model.peaks[i]! - p.equity)))}.`}
        onMouseMove={(e) => onMove(e.clientX)}
        onMouseLeave={() => setHover(null)}
        onTouchStart={(e) => onMove(e.touches[0]!.clientX)}
        onTouchMove={(e) => onMove(e.touches[0]!.clientX)}
      >
        {model.ticks.map((v) => (
          <g key={v}>
            <line x1={pad.l} x2={W - pad.r} y1={model.y(v)} y2={model.y(v)} className="eq-grid" />
            <text x={W - pad.r + 6} y={model.y(v) + 4} className="eq-tick">
              {money(v, { decimals: 0 })}
            </text>
          </g>
        ))}
        <path d={model.band} className="eq-band" />
        {compare && compare.length > 1 ? <path d={model.line(compare)} className="eq-compare" /> : null}
        <path d={model.line(points)} className="eq-line" />
        <text x={pad.l} y={H - 5} className="eq-tick">
          {day(model.t0, true)}
        </text>
        <text x={W - pad.r} y={H - 5} className="eq-tick" textAnchor="end">
          {day(model.t1, true)}
        </text>
        {hp ? (
          <g>
            <line x1={model.x(hp.t)} x2={model.x(hp.t)} y1={pad.t} y2={H - pad.b} className="eq-cross" />
            <circle cx={model.x(hp.t)} cy={model.y(hp.equity)} r={4} className="eq-dot" />
          </g>
        ) : null}
      </svg>
      <div className="eq-legend num">
        <span>
          <i className="eq-key eq-key-line" /> Equity
        </span>
        <span>
          <i className="eq-key eq-key-band" /> Drawdown
        </span>
        {compare && compareLabel ? (
          <span>
            <i className="eq-key eq-key-compare" /> {compareLabel}
          </span>
        ) : null}
        <span className="eq-read">
          {hp
            ? `${day(hp.t, true)}: ${money(hp.equity)}, ${money(model.peaks[hover!]! - hp.equity)} below the peak`
            : `Ends at ${money(end)} (${pct((end / start - 1) * 100)})`}
        </span>
      </div>
    </div>
  );
}
