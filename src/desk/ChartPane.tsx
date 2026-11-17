import { useState } from 'react';
import { Maximize2, Minimize2 } from 'lucide-react';
import { Chart, type ChartType } from '../chart/Chart';
import { useCandles } from '../chart/useCandles';
import { instrument } from '../data/instruments';
import { TIMEFRAMES, type Candle, type Timeframe } from '../data/types';
import { compact, pct, price } from '../lib/format';
import { useFlash } from '../lib/hooks';
import { useLayout } from '../state/layout';
import { useMarket } from '../state/market';
import { useTicket } from '../state/ticket';
import { Pane, PaneState, Segmented } from '../ui/controls';
import { FeedBadge } from '../ui/FeedBadge';

const TYPES: { value: ChartType; label: string }[] = [
  { value: 'candles', label: 'Candles' },
  { value: 'line', label: 'Line' },
  { value: 'heikin', label: 'Heikin-Ashi' },
];

export function Readout({ c }: { c: Candle | null }) {
  if (!c) return <div className="readout" aria-hidden="true" />;
  const up = c.c >= c.o;
  const change = c.o > 0 ? ((c.c - c.o) / c.o) * 100 : 0;
  return (
    <div className="readout num" aria-label="Bar under the crosshair">
      <span>
        <i>O</i> {price(c.o)}
      </span>
      <span>
        <i>H</i> {price(c.h)}
      </span>
      <span>
        <i>L</i> {price(c.l)}
      </span>
      <span>
        <i>C</i> {price(c.c)}
      </span>
      <span className={up ? 'hot' : 'cold'}>{pct(change)}</span>
      <span>
        <i>Vol</i> {compact(c.v)}
      </span>
    </div>
  );
}

export function ChartPane() {
  const id = useMarket((s) => s.instrument);
  const tf = useMarket((s) => s.tf);
  const setTf = useMarket((s) => s.setTf);
  const q = useMarket((s) => s.quotes[id]);
  const maximised = useLayout((s) => s.maximised === 'chart');
  const toggleMax = useLayout((s) => s.toggleMax);
  const [type, setType] = useState<ChartType>('candles');
  const [hover, setHover] = useState<Candle | null>(null);
  const feed = useCandles(id, tf);
  const flash = useFlash(q?.last);
  const i = instrument(id);
  const last = feed.candles[feed.candles.length - 1] ?? null;
  const up = (q?.changePct ?? 0) >= 0;

  return (
    <Pane
      label="Chart"
      className="pane-chart"
      head={
        <>
          <span className="pane-title">{i.symbol}</span>
          <span className="chart-name">{i.name}</span>
          <span className="chart-last num" data-flash={flash ?? undefined}>
            {q ? price(q.last) : '—'}
          </span>
          <span className={`num ${q && Number.isFinite(q.changePct) ? (up ? 'hot' : 'cold') : ''}`} title={i.kind === 'crypto' ? 'Change over the last 24 hours' : 'Change since the previous close'}>
            {q && Number.isFinite(q.changePct) ? pct(q.changePct) : ''}
          </span>
          <FeedBadge instrumentId={id} />
          <div className="pane-tools">
            <Segmented<Timeframe>
              label="Timeframe"
              value={tf}
              onChange={setTf}
              options={TIMEFRAMES.map((t, n) => ({ value: t.id, label: t.label, title: `${t.label} bars (press ${n + 1})` }))}
            />
            <select className="pane-select" value={type} onChange={(e) => setType(e.target.value as ChartType)} aria-label="Chart type">
              {TYPES.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
            </select>
            <button
              type="button"
              className="btn btn-quiet btn-icon"
              onClick={() => toggleMax('chart')}
              aria-label={maximised ? 'Restore the desk' : 'Maximise the chart'}
              aria-pressed={maximised}
            >
              {maximised ? <Minimize2 size={14} aria-hidden="true" /> : <Maximize2 size={14} aria-hidden="true" />}
            </button>
          </div>
        </>
      }
    >
      <Readout c={hover ?? last} />
      <div className="chart-wrap">
        {feed.state === 'failed' ? (
          <PaneState
            title="The chart could not load"
            action={
              <button type="button" className="btn" onClick={feed.retry}>
                Try again
              </button>
            }
          >
            {feed.error}
          </PaneState>
        ) : feed.state === 'loading' ? (
          <PaneState title={`Loading ${i.symbol}`}>Fetching {TIMEFRAMES.find((t) => t.id === tf)?.label} bars.</PaneState>
        ) : (
          <Chart
            label={`${i.symbol} ${tf} chart`}
            dataKey={`${id}|${tf}`}
            candles={feed.candles}
            type={type}
            intraday={tf !== '1d' && tf !== '1w'}
            onHover={setHover}
            onHoverPrice={(p) => useTicket.setState({ hoverPrice: p })}
            onNeedOlder={feed.loadOlder}
          />
        )}
        {feed.state === 'ready' && feed.error ? <div className="chart-note">Live bars paused: {feed.error}</div> : null}
      </div>
    </Pane>
  );
}
