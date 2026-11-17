import { useEffect, useMemo, useState } from 'react';
import { Maximize2, Minimize2 } from 'lucide-react';
import { Chart, type ChartLine, type ChartType } from '../chart/Chart';
import { indicatorSeries } from '../chart/indicators';
import { fetchCandles, useCandles } from '../chart/useCandles';
import { instrument } from '../data/instruments';
import { TIMEFRAMES, type Candle, type Timeframe } from '../data/types';
import { compact, dollars, pct, price } from '../lib/format';
import { useFlash } from '../lib/hooks';
import { useAccount } from '../state/account';
import { useIndicators } from '../state/indicators';
import { useLayout } from '../state/layout';
import { useLevels } from '../state/levels';
import { useMarket } from '../state/market';
import { engineSettings } from '../state/settings';
import { useTicket } from '../state/ticket';
import { toast } from '../state/toasts';
import { Pane, PaneState, Segmented } from '../ui/controls';
import { FeedBadge } from '../ui/FeedBadge';
import { orderLines } from './chartLines';
import { IndicatorMenu } from './IndicatorMenu';
import { VolumeProfile } from './VolumeProfile';

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

/** Yesterday's high, low and close, from the daily bars (an intraday window may not reach back a full day). */
function usePreviousDay(id: string, on: boolean): { high: number; low: number; close: number } | null {
  const [levels, setLevels] = useState<{ high: number; low: number; close: number } | null>(null);
  useEffect(() => {
    setLevels(null);
    if (!on) return;
    let alive = true;
    const load = () =>
      fetchCandles(id, '1d', 3)
        .then((days) => {
          const prev = days[days.length - 2];
          if (alive && prev) setLevels({ high: prev.h, low: prev.l, close: prev.c });
        })
        .catch((err: unknown) => {
          console.warn(`[flame] previous-day levels for ${id} failed`, err);
          if (alive) toast('Previous-day levels could not be loaded. They will be retried.');
        });
    void load();
    const timer = setInterval(load, 10 * 60_000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [id, on]);
  return levels;
}

export function ChartPane({ onReplay }: { onReplay?: (t: number) => void }) {
  const id = useMarket((s) => s.instrument);
  const tf = useMarket((s) => s.tf);
  const setTf = useMarket((s) => s.setTf);
  const q = useMarket((s) => s.quotes[id]);
  const maximised = useLayout((s) => s.maximised === 'chart');
  const zen = useLayout((s) => s.zen);
  const toggleMax = useLayout((s) => s.toggleMax);
  const ind = useIndicators();
  const [hover, setHover] = useState<Candle | null>(null);
  const [menu, setMenu] = useState<{ t: number; x: number; y: number } | null>(null);
  const [anchoring, setAnchoring] = useState(false);
  const feed = useCandles(id, tf);
  const flash = useFlash(q?.last);
  const i = instrument(id);
  const last = feed.candles[feed.candles.length - 1] ?? null;
  const up = (q?.changePct ?? 0) >= 0;
  const intraday = tf !== '1d' && tf !== '1w';

  const account = useAccount((s) => s.live);
  const amend = useAccount((s) => s.amend);
  const cancel = useAccount((s) => s.cancel);
  const brackets = useAccount((s) => s.brackets);
  const levels = useLevels((s) => s.byInstrument[id]);
  const prevDay = usePreviousDay(id, intraday && ind.active.some((a) => a.type === 'prevday'));

  const lines = useMemo<ChartLine[]>(() => {
    const out = orderLines(account, id, engineSettings(), { amend: (o, p) => amend(o, p), cancel: (o) => cancel(o), brackets: (k, b) => brackets(k, b) }, i.symbol);
    for (const l of levels ?? []) {
      out.push({
        id: `lvl-${l.id}`,
        price: l.price,
        label: l.alert ? (l.firedAt ? 'Alert (fired)' : 'Alert') : 'Level',
        dashed: l.alert,
        onMove: (p) => useLevels.getState().move(id, l.id, p, useMarket.getState().quotes[id]?.last),
        onRemove: () => useLevels.getState().remove(id, l.id),
        removeLabel: l.alert ? 'Remove this alert' : 'Remove this level',
      });
    }
    if (prevDay) {
      out.push({ id: 'pd-h', price: prevDay.high, label: 'Prev. high', dashed: true });
      out.push({ id: 'pd-l', price: prevDay.low, label: 'Prev. low', dashed: true });
      out.push({ id: 'pd-c', price: prevDay.close, label: 'Prev. close', dashed: true });
    }
    return out;
  }, [account, id, levels, prevDay, i.symbol, amend, cancel, brackets]);

  const series = useMemo(() => indicatorSeries(ind.active, feed.candles, intraday), [ind.active, feed.candles, intraday]);
  const profile = ind.active.find((a) => a.type === 'vrvp');
  const markers = useMemo(
    () => account.fills.filter((f) => f.instrument === id).slice(-80).map((f) => ({ t: f.t, side: f.side })),
    [account.fills, id],
  );
  // Markers sit on bars: snap each fill to the bar it happened in.
  const barMarkers = useMemo(() => {
    const ms = TIMEFRAMES.find((t) => t.id === tf)!.ms;
    const first = feed.candles[0]?.t ?? Infinity;
    // One arrow per bar and side, however many fills landed in it.
    const seen = new Set<string>();
    const out: { t: number; side: 'buy' | 'sell' }[] = [];
    for (const m of markers) {
      if (m.t < first) continue;
      const t = Math.floor(m.t / ms) * ms;
      const key = `${t}${m.side}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ t, side: m.side });
    }
    return out;
  }, [markers, tf, feed.candles]);

  useEffect(() => {
    if (!menu) return;
    const close = () => setMenu(null);
    window.addEventListener('pointerdown', close);
    window.addEventListener('keydown', close);
    return () => {
      window.removeEventListener('pointerdown', close);
      window.removeEventListener('keydown', close);
    };
  }, [menu]);

  const anchorAt = (t: number) => {
    ind.add('avwap', { anchor: t });
    setAnchoring(false);
  };

  return (
    <Pane
      label="Chart"
      className="pane-chart"
      head={
        <>
          <h2 className="pane-title">{i.symbol}</h2>
          <span className="chart-name">{i.name}</span>
          <span className="chart-last num" data-flash={flash ?? undefined}>
            {q ? price(q.last) : '—'}
          </span>
          <span className={`num ${q && Number.isFinite(q.changePct) ? (up ? 'hot' : 'cold') : ''}`} title={i.kind === 'crypto' ? 'Change over the last 24 hours' : 'Change since the previous close'}>
            {q && Number.isFinite(q.changePct) ? pct(q.changePct) : ''}
          </span>
          <FeedBadge instrumentId={id} />
          <div className="pane-tools">
            <button
              type="button"
              className="btn btn-quiet btn-icon"
              onClick={() => (zen ? useLayout.getState().setZen(false) : toggleMax('chart'))}
              aria-label={maximised || zen ? 'Restore the desk' : 'Maximise the chart'}
              aria-pressed={maximised || zen}
              title={maximised || zen ? 'Restore the desk' : 'Maximise the chart (Z for zen)'}
            >
              {maximised || zen ? <Minimize2 size={14} aria-hidden="true" /> : <Maximize2 size={14} aria-hidden="true" />}
            </button>
          </div>
        </>
      }
    >
      <div className="chart-bar">
        <Segmented<Timeframe>
          label="Timeframe"
          value={tf}
          onChange={setTf}
          options={TIMEFRAMES.map((t, n) => ({ value: t.id, label: t.label, title: `${t.label} bars (press ${n + 1})` }))}
        />
        <select className="pane-select" value={ind.chartType} onChange={(e) => ind.setChartType(e.target.value as ChartType)} aria-label="Chart type">
          {TYPES.map((t) => (
            <option key={t.value} value={t.value}>
              {t.label}
            </option>
          ))}
        </select>
        <IndicatorMenu canDelta={i.cls === 'crypto'} intraday={intraday} onAnchor={() => setAnchoring(true)} />
        <Readout c={hover ?? last} />
      </div>
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
          <>
            <Chart
              label={`${i.symbol} ${tf} chart`}
              dataKey={`${id}|${tf}`}
              candles={feed.candles}
              type={ind.chartType}
              volume={ind.volume}
              intraday={intraday}
              lines={lines}
              series={series}
              markers={barMarkers}
              onHover={setHover}
              onHoverPrice={(p) => useTicket.setState({ hoverPrice: p })}
              onNeedOlder={feed.loadOlder}
              onAxisClick={(p, alt) => {
                useLevels.getState().add(id, p, alt, useMarket.getState().quotes[id]?.last);
                toast(alt ? `Alert set at ${dollars(p)}. Flame will tell you when ${i.symbol} crosses it.` : `Level added at ${dollars(p)}. Drag its tag to move it.`);
              }}
              onContext={(t, x, y) => (anchoring ? anchorAt(t) : setMenu({ t, x, y }))}
              onBarClick={anchoring ? anchorAt : undefined}
            />
            {profile ? <VolumeProfile candles={feed.candles} rows={profile.params.rows ?? 40} /> : null}
          </>
        )}
        {anchoring ? (
          <div className="chart-note">
            Click the bar to anchor the VWAP to.{' '}
            <button type="button" className="link" onClick={() => setAnchoring(false)}>
              Cancel
            </button>
          </div>
        ) : feed.state === 'ready' && feed.error ? (
          <div className="chart-note">Live bars paused: {feed.error}</div>
        ) : null}
        {menu ? (
          <div className="pop chart-menu" style={{ left: menu.x, top: menu.y }} role="menu" onPointerDown={(e) => e.stopPropagation()}>
            {onReplay ? (
              <button
                type="button"
                className="pop-item"
                role="menuitem"
                onClick={() => {
                  onReplay(menu.t);
                  setMenu(null);
                }}
              >
                Replay from here
              </button>
            ) : null}
            <button
              type="button"
              className="pop-item"
              role="menuitem"
              onClick={() => {
                anchorAt(menu.t);
                setMenu(null);
              }}
            >
              Anchor a VWAP here
            </button>
          </div>
        ) : null}
      </div>
    </Pane>
  );
}
