import { useMemo, useState } from 'react';
import { useSize } from '../lib/hooks';
import { dollars, money } from '../lib/format';
import { expiryText } from './contract';
import { payoffAt, payoffAtExpiry, summarise, type Leg } from './payoff';

// Profit and loss against the price of the underlying: one line for expiry,
// one for a date you choose between now and then, so time decay can be seen
// happening. Profit is tinted hot and loss cold; the lines themselves are ink.

const H = 220;
const PAD = { l: 8, r: 8, t: 14, b: 34 };
const STEPS = 96;

interface Props {
  legs: Leg[];
  /** The underlying's price now. */
  spot: number;
  now: number;
  /** What the underlying is called on the axis: BTC, AAPL. */
  symbol: string;
}

function niceRange(legs: Leg[], spot: number): [number, number] {
  const marks = [spot, ...legs.map((l) => l.spec.strike), ...summarise(legs).breakevens];
  const lo = Math.min(...marks);
  const hi = Math.max(...marks);
  const pad = Math.max((hi - lo) * 0.35, spot * 0.12);
  return [Math.max(0, lo - pad), hi + pad];
}

export function Payoff({ legs, spot, now, symbol }: Props) {
  const [box, size] = useSize<HTMLDivElement>();
  const [share, setShare] = useState(0);
  const [probe, setProbe] = useState<number | null>(null);
  const expiry = Math.min(...legs.map((l) => l.spec.expiry));
  const at = now + (expiry - now) * (share / 100);
  const w = Math.max(240, size.width);

  const model = useMemo(() => {
    const [lo, hi] = niceRange(legs, spot);
    const xs = Array.from({ length: STEPS + 1 }, (_, i) => lo + ((hi - lo) * i) / STEPS);
    // Strikes and breakevens are where the expiry line bends or crosses zero: sample them exactly.
    const exact = [...legs.map((l) => l.spec.strike), ...summarise(legs).breakevens].filter((x) => x > lo && x < hi);
    const prices = [...new Set([...xs, ...exact])].sort((a, b) => a - b);
    const atExpiry = prices.map((s) => payoffAtExpiry(legs, s));
    const onDate = prices.map((s) => payoffAt(legs, s, at));
    const all = [...atExpiry, ...onDate, 0];
    let min = Math.min(...all);
    let max = Math.max(...all);
    const span = max - min || 1;
    min -= span * 0.08;
    max += span * 0.08;
    return { lo, hi, prices, atExpiry, onDate, min, max };
  }, [legs, spot, at]);

  const px = (s: number) => PAD.l + ((s - model.lo) / (model.hi - model.lo)) * (w - PAD.l - PAD.r);
  const py = (v: number) => PAD.t + ((model.max - v) / (model.max - model.min)) * (H - PAD.t - PAD.b);
  const line = (ys: number[]) => ys.map((v, i) => `${i === 0 ? 'M' : 'L'}${px(model.prices[i]!).toFixed(1)} ${py(v).toFixed(1)}`).join('');
  const zero = py(0);
  const area = `${line(model.atExpiry)}L${px(model.hi).toFixed(1)} ${zero.toFixed(1)}L${px(model.lo).toFixed(1)} ${zero.toFixed(1)}Z`;
  const { breakevens } = summarise(legs);
  const shown = breakevens.filter((b) => b > model.lo && b < model.hi);
  const probeAt = probe ?? spot;
  const probeExpiry = payoffAtExpiry(legs, probeAt);
  const probeDate = payoffAt(legs, probeAt, at);
  const daysLeft = Math.max(0, Math.round((expiry - at) / 86_400_000));
  const dateLabel = share >= 100 ? 'At expiry' : share <= 0 ? 'Today' : `${expiryText(at, false)}, ${daysLeft} ${daysLeft === 1 ? 'day' : 'days'} before expiry`;
  const step = (model.hi - model.lo) / 60;

  const moveTo = (clientX: number, el: Element) => {
    const r = el.getBoundingClientRect();
    const s = model.lo + ((clientX - r.left - PAD.l) / (r.width - PAD.l - PAD.r)) * (model.hi - model.lo);
    setProbe(Math.min(model.hi, Math.max(model.lo, s)));
  };

  const table = [0.8, 0.9, 1, 1.1, 1.2].map((k) => spot * k);

  return (
    <div className="payoff">
      <div
        className="payoff-plot"
        ref={box}
        tabIndex={0}
        role="group"
        aria-label={`Profit and loss against the price of ${symbol}. Use the left and right arrow keys to read values.`}
        onPointerMove={(e) => moveTo(e.clientX, e.currentTarget)}
        onPointerLeave={() => setProbe(null)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
            e.preventDefault();
            setProbe(Math.min(model.hi, Math.max(model.lo, probeAt + (e.key === 'ArrowRight' ? step : -step))));
          } else if (e.key === 'Escape') {
            setProbe(null);
          }
        }}
      >
        <svg width={w} height={H} viewBox={`0 0 ${w} ${H}`} aria-hidden="true">
          <defs>
            <clipPath id="payoff-above">
              <rect x="0" y="0" width={w} height={Math.max(0, zero)} />
            </clipPath>
            <clipPath id="payoff-below">
              <rect x="0" y={zero} width={w} height={Math.max(0, H - zero)} />
            </clipPath>
          </defs>
          <path d={area} fill="var(--hot-wash)" clipPath="url(#payoff-above)" />
          <path d={area} fill="var(--cold-wash)" clipPath="url(#payoff-below)" />
          <line x1={PAD.l} x2={w - PAD.r} y1={zero} y2={zero} stroke="var(--line-strong)" strokeWidth="1" />
          <line x1={px(spot)} x2={px(spot)} y1={PAD.t} y2={H - PAD.b} stroke="var(--ink-3)" strokeWidth="1" strokeDasharray="2 3" />
          <path d={line(model.onDate)} fill="none" stroke="var(--ink-2)" strokeWidth="2" strokeDasharray="5 4" strokeLinejoin="round" />
          <path d={line(model.atExpiry)} fill="none" stroke="var(--ink)" strokeWidth="2" strokeLinejoin="round" />
          {shown.map((b) => (
            <g key={b}>
              <line x1={px(b)} x2={px(b)} y1={zero - 5} y2={H - PAD.b + 4} stroke="var(--ink)" strokeWidth="1" />
              <text x={Math.min(w - 44, Math.max(44, px(b)))} y={H - PAD.b + 16} textAnchor="middle" className="payoff-tick payoff-tick-strong">
                {dollars(b, b >= 1000 ? 0 : 2)}
              </text>
            </g>
          ))}
          <text x={Math.min(w - 20, Math.max(20, px(spot)))} y={PAD.t - 3} textAnchor="middle" className="payoff-tick">
            Now
          </text>
          <text x={PAD.l} y={H - 4} className="payoff-tick">
            {dollars(model.lo, model.lo >= 1000 ? 0 : 2)}
          </text>
          <text x={w - PAD.r} y={H - 4} textAnchor="end" className="payoff-tick">
            {dollars(model.hi, model.hi >= 1000 ? 0 : 2)}
          </text>
          {probe !== null ? (
            <g>
              <line x1={px(probe)} x2={px(probe)} y1={PAD.t} y2={H - PAD.b} stroke="var(--ink)" strokeWidth="1" />
              <circle cx={px(probe)} cy={py(probeExpiry)} r="4" fill="var(--ink)" stroke="var(--surface)" strokeWidth="2" />
              <circle cx={px(probe)} cy={py(probeDate)} r="4" fill="var(--ink-2)" stroke="var(--surface)" strokeWidth="2" />
            </g>
          ) : null}
        </svg>
      </div>

      <p className="payoff-read num" aria-live="polite">
        With {symbol} at <strong>{dollars(probeAt, probeAt >= 1000 ? 0 : 2)}</strong>
        {probe === null ? ' (now)' : ''}: <span className={probeExpiry >= 0 ? 'hot' : 'cold'}>{money(probeExpiry, { signed: true })}</span> at expiry
        {share < 100 ? (
          <>
            , <span className={probeDate >= 0 ? 'hot' : 'cold'}>{money(probeDate, { signed: true })}</span> {share <= 0 ? 'today' : 'on the chosen date'}
          </>
        ) : null}
        .
      </p>

      <div className="payoff-legend" aria-hidden="true">
        <span>
          <i className="payoff-key" /> At expiry
        </span>
        <span>
          <i className="payoff-key payoff-key-dash" /> {share <= 0 ? 'Today' : share >= 100 ? 'At expiry' : 'On the chosen date'}
        </span>
        {shown.length > 0 ? <span>Marked on the axis: {shown.length === 1 ? 'the breakeven' : 'the breakevens'}</span> : null}
      </div>

      <label className="payoff-slider">
        <span className="field-label">
          Date <small>{dateLabel}</small>
        </span>
        <input type="range" min={0} max={100} step={1} value={share} onChange={(e) => setShare(Number(e.target.value))} aria-valuetext={dateLabel} />
      </label>

      <details className="payoff-table">
        <summary>The same as a table</summary>
        <table className="table">
          <thead>
            <tr>
              <th className="l">{symbol} at</th>
              <th>At expiry</th>
              <th>{share <= 0 ? 'Today' : 'On the chosen date'}</th>
            </tr>
          </thead>
          <tbody>
            {table.map((s) => {
              const e = payoffAtExpiry(legs, s);
              const d = payoffAt(legs, s, at);
              return (
                <tr key={s}>
                  <td className="l">{dollars(s, s >= 1000 ? 0 : 2)}</td>
                  <td className={e >= 0 ? 'hot' : 'cold'}>{money(e, { signed: true })}</td>
                  <td className={d >= 0 ? 'hot' : 'cold'}>{money(d, { signed: true })}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </details>
    </div>
  );
}
