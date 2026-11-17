import { useMemo } from 'react';
import type { Candle } from '../data/types';
import { volumeProfile } from '../indicators/math';
import { compact, price } from '../lib/format';

/**
 * Volume by price for the bars loaded, as a compact table-like strip down the
 * left of the chart. It is its own small chart rather than a drawing on the
 * price pane, so it stays readable as the chart pans.
 */
export function VolumeProfile({ candles, rows }: { candles: Candle[]; rows: number }) {
  const p = useMemo(() => volumeProfile(candles.slice(-500), rows), [candles, rows]);
  if (!p) return null;
  let max = 0;
  for (const r of p.rows) max = Math.max(max, r.volume);
  return (
    <div className="vprofile" role="img" aria-label={`Volume profile of the last ${Math.min(500, candles.length)} bars. Point of control ${price(p.poc)}, value area ${price(p.valueLow)} to ${price(p.valueHigh)}.`}>
      <div className="vprofile-head">
        <strong>Volume by price</strong>
        <span className="num">POC {price(p.poc)}</span>
        <span className="num">
          Value {price(p.valueLow)} to {price(p.valueHigh)}
        </span>
      </div>
      <div className="vprofile-rows" aria-hidden="true">
        {p.rows
          .slice()
          .reverse()
          .map((r) => {
            const inValue = r.price >= p.valueLow - 1e-9 && r.price + p.step <= p.valueHigh + 1e-9;
            const isPoc = p.poc >= r.price && p.poc < r.price + p.step;
            return (
              <div key={r.price} className="vprofile-row" data-value={inValue ? 'true' : undefined} data-poc={isPoc ? 'true' : undefined} title={`${price(r.price)}: ${compact(r.volume)}`}>
                <i className="vp-buy" style={{ width: `${max > 0 ? (r.buy / max) * 100 : 0}%` }} />
                <i className="vp-sell" style={{ width: `${max > 0 ? (r.sell / max) * 100 : 0}%` }} />
              </div>
            );
          })}
      </div>
    </div>
  );
}
