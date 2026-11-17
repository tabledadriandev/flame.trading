import { useEffect, useLayoutEffect, useRef, useSyncExternalStore } from 'react';
import {
  CandlestickSeries,
  ColorType,
  CrosshairMode,
  HistogramSeries,
  LineSeries,
  LineStyle,
  TickMarkType,
  createChart,
  createSeriesMarkers,
  type IChartApi,
  type ISeriesApi,
  type ISeriesMarkersPluginApi,
  type SeriesMarker,
  type SeriesType,
  type Time,
  type UTCTimestamp,
} from 'lightweight-charts';
import type { Candle } from '../data/types';
import { priceDecimals } from '../data/instruments';
import { alpha, onThemeChange, themeColors, type ThemeColors } from '../lib/theme';
import { price as fmtPrice } from '../lib/format';

// One chart component for the desk, Replay and the Lab. It draws candles (or
// a line), volume, any number of indicator series in ink, markers for fills,
// and horizontal lines for orders and levels that can be dragged.

export type ChartType = 'candles' | 'line' | 'heikin';

export interface ChartLine {
  id: string;
  price: number;
  label: string;
  /** Only the tag's fill carries hot or cold; the line itself is ink. */
  side?: 'buy' | 'sell';
  dashed?: boolean;
  /** Present when the line can be dragged; called with the new price on release. */
  onMove?: (price: number) => void;
  onRemove?: () => void;
  removeLabel?: string;
}

export interface SeriesPoint {
  t: number;
  v: number;
  side?: 'buy' | 'sell';
}

export interface ChartSeries {
  id: string;
  /** 'price' draws over the candles; any other key gets its own pane under them. */
  pane: string;
  kind: 'line' | 'histogram';
  points: SeriesPoint[];
  label?: string;
  dash?: 'solid' | 'dashed' | 'dotted';
  width?: 1 | 2;
  tone?: 'ink' | 'ink2' | 'ink3';
}

export interface ChartMarker {
  t: number;
  side: 'buy' | 'sell';
  text?: string;
}

export interface ChartProps {
  /** Changes when the chart shows something else entirely; resets the view. */
  dataKey: string;
  candles: Candle[];
  type?: ChartType;
  volume?: boolean;
  lines?: ChartLine[];
  series?: ChartSeries[];
  markers?: ChartMarker[];
  /** Intraday charts show the time of day on the axis. */
  intraday?: boolean;
  onHover?: (c: Candle | null) => void;
  onHoverPrice?: (price: number | null) => void;
  onAxisClick?: (price: number, alt: boolean) => void;
  onContext?: (t: number, x: number, y: number) => void;
  onNeedOlder?: () => void;
  /** A plain click on a bar (used to pick an anchor). */
  onBarClick?: (t: number) => void;
  label: string;
}

// Bar times go to the chart as plain UTC seconds, and the axis labels are
// formatted in local time. (Shifting the timestamps by the local offset, the
// usual trick, gives two bars the same time on the night the clocks go back.)
const toChartTime = (ms: number): UTCTimestamp => Math.floor(ms / 1000) as UTCTimestamp;

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const two = (n: number): string => String(n).padStart(2, '0');

/**
 * Axis and crosshair labels. Intraday bars read in local time. Daily and
 * weekly bars open at midnight UTC and are named by their UTC date, so a
 * daily candle is never labelled with the day before.
 */
export function timeLabel(sec: number, kind: 'year' | 'month' | 'day' | 'time' | 'full', intraday: boolean): string {
  const d = new Date(sec * 1000);
  const Y = intraday ? d.getFullYear() : d.getUTCFullYear();
  const M = intraday ? d.getMonth() : d.getUTCMonth();
  const D = intraday ? d.getDate() : d.getUTCDate();
  if (kind === 'year') return String(Y);
  if (kind === 'month') return MONTHS[M]!;
  if (kind === 'day') return String(D);
  const hm = `${two(d.getHours())}:${two(d.getMinutes())}`;
  if (kind === 'time') return hm;
  return intraday ? `${D} ${MONTHS[M]} ${hm}` : `${D} ${MONTHS[M]} ${Y}`;
}

function heikin(candles: Candle[]): Candle[] {
  const out: Candle[] = [];
  let prev: Candle | undefined;
  for (const c of candles) {
    const close = (c.o + c.h + c.l + c.c) / 4;
    const open = prev ? (prev.o + prev.c) / 2 : (c.o + c.c) / 2;
    const ha: Candle = { ...c, o: open, c: close, h: Math.max(c.h, open, close), l: Math.min(c.l, open, close) };
    out.push(ha);
    prev = ha;
  }
  return out;
}

/**
 * Pane heights: price takes most of the room, volume a strip, each oscillator
 * a band. Set every time panes are created, because a pane the library
 * recycles keeps the height of whatever lived there before.
 */
function sizePanes(chart: IChartApi, volume: boolean): void {
  chart.panes().forEach((pane, n) => pane.setStretchFactor(n === 0 ? 1 : volume && n === 1 ? 0.16 : 0.26));
}

const DASH = { solid: LineStyle.Solid, dashed: LineStyle.Dashed, dotted: LineStyle.Dotted } as const;

interface Live {
  chart: IChartApi;
  main: ISeriesApi<SeriesType> | null;
  mainType: ChartType | null;
  vol: ISeriesApi<'Histogram'> | null;
  extra: Map<string, ISeriesApi<SeriesType>>;
  panesKey: string;
  markers: ISeriesMarkersPluginApi<Time> | null;
  colors: ThemeColors;
  drawn: { key: string; first: number; last: number; len: number; type: ChartType } | null;
  byTime: Map<number, Candle>;
}

export function Chart(props: ChartProps) {
  const { dataKey, candles, type = 'candles', volume = true, lines, series, markers, intraday = true, label } = props;
  const host = useRef<HTMLDivElement>(null);
  const overlay = useRef<HTMLDivElement>(null);
  const live = useRef<Live | null>(null);
  const cb = useRef(props);
  cb.current = props;
  const drag = useRef<{ id: string; price: number } | null>(null);

  // ----- Create once -----
  useLayoutEffect(() => {
    const el = host.current!;
    const colors = themeColors();
    const chart = createChart(el, {
      autoSize: true,
      layout: {
        background: { type: ColorType.Solid, color: 'transparent' },
        textColor: colors.ink2,
        fontFamily: getComputedStyle(document.body).fontFamily,
        fontSize: 11,
        panes: { separatorColor: colors.line, separatorHoverColor: alpha(colors.ink, 0.08), enableResize: true },
      },
      grid: { vertLines: { color: alpha(colors.line, 0.5) }, horzLines: { color: alpha(colors.line, 0.5) } },
      crosshair: {
        mode: CrosshairMode.Normal,
        vertLine: { color: colors.ink2, labelBackgroundColor: colors.ink, width: 1, style: LineStyle.Dashed },
        horzLine: { color: colors.ink2, labelBackgroundColor: colors.ink, width: 1, style: LineStyle.Dashed },
      },
      rightPriceScale: { borderColor: colors.line },
      localization: {
        // Prices on the axis read like prices everywhere else: 64,210.50, not 64210.50.
        priceFormatter: (p: number) => fmtPrice(p),
        timeFormatter: (t: Time) => (typeof t === 'number' ? timeLabel(t, 'full', cb.current.intraday ?? true) : String(t)),
      },
      timeScale: {
        borderColor: colors.line,
        timeVisible: true,
        secondsVisible: false,
        rightOffset: 6,
        minBarSpacing: 1.5,
        tickMarkFormatter: (t: Time, type: TickMarkType) => {
          if (typeof t !== 'number') return null;
          const intra = cb.current.intraday ?? true;
          if (type === TickMarkType.Year) return timeLabel(t, 'year', intra);
          if (type === TickMarkType.Month) return timeLabel(t, 'month', intra);
          if (type === TickMarkType.DayOfMonth) return timeLabel(t, 'day', intra);
          return timeLabel(t, 'time', intra);
        },
      },
    });
    const state: Live = { chart, main: null, mainType: null, vol: null, extra: new Map(), panesKey: '', markers: null, colors, drawn: null, byTime: new Map() };
    live.current = state;

    chart.subscribeCrosshairMove((p) => {
      const t = typeof p.time === 'number' ? p.time : null;
      cb.current.onHover?.(t !== null ? (state.byTime.get(t) ?? null) : null);
      if (cb.current.onHoverPrice) {
        const y = p.point?.y;
        const inPrice = p.paneIndex === undefined || p.paneIndex === 0;
        const px = y !== undefined && inPrice && state.main ? state.main.coordinateToPrice(y) : null;
        cb.current.onHoverPrice(px ?? null);
      }
    });
    chart.subscribeClick((p) => {
      const t = typeof p.time === 'number' ? state.byTime.get(p.time) : undefined;
      if (t) cb.current.onBarClick?.(t.t);
    });
    chart.timeScale().subscribeVisibleLogicalRangeChange((r) => {
      if (r && r.from < 5) cb.current.onNeedOlder?.();
    });

    const retheme = () => {
      const c = themeColors();
      state.colors = c;
      chart.applyOptions({
        layout: { textColor: c.ink2, panes: { separatorColor: c.line, separatorHoverColor: alpha(c.ink, 0.08) } },
        grid: { vertLines: { color: alpha(c.line, 0.5) }, horzLines: { color: alpha(c.line, 0.5) } },
        crosshair: {
          vertLine: { color: c.ink2, labelBackgroundColor: c.ink },
          horzLine: { color: c.ink2, labelBackgroundColor: c.ink },
        },
        rightPriceScale: { borderColor: c.line },
        timeScale: { borderColor: c.line },
      });
      // Force every series to be rebuilt with the new colours.
      state.drawn = null;
      state.panesKey = '';
      for (const s of state.extra.values()) chart.removeSeries(s);
      state.extra.clear();
      if (state.main) chart.removeSeries(state.main);
      if (state.vol) chart.removeSeries(state.vol);
      state.main = state.vol = null;
      state.mainType = null;
      state.markers = null;
      window.dispatchEvent(new Event('flame:chart-redraw'));
    };
    const off = onThemeChange(retheme);

    return () => {
      off();
      chart.remove();
      live.current = null;
    };
  }, []);

  // A theme change bumps this so the data effects below run again.
  const redraw = useRedrawTick();

  // ----- Candles and volume -----
  useEffect(() => {
    const s = live.current;
    if (!s) return;
    const { chart, colors } = s;
    const data = type === 'heikin' ? heikin(candles) : candles;
    const lastPrice = data[data.length - 1]?.c ?? 1;
    const precision = priceDecimals(lastPrice);
    const priceFormat = { type: 'price' as const, precision, minMove: 1 / 10 ** precision };

    if (s.mainType !== type || !s.main) {
      if (s.main) chart.removeSeries(s.main);
      s.markers = null;
      s.main =
        type === 'line'
          ? chart.addSeries(LineSeries, { color: colors.ink, lineWidth: 2, priceLineColor: colors.ink2, priceFormat }, 0)
          : chart.addSeries(
              CandlestickSeries,
              {
                upColor: colors.hot,
                downColor: colors.cold,
                wickUpColor: colors.hot,
                wickDownColor: colors.cold,
                borderVisible: false,
                priceLineColor: colors.ink2,
                priceFormat,
              },
              0,
            );
      s.mainType = type;
      s.drawn = null;
    }
    if (volume && !s.vol) {
      s.vol = chart.addSeries(HistogramSeries, { priceFormat: { type: 'volume' }, priceLineVisible: false, lastValueVisible: false }, 1);
      s.drawn = null;
    } else if (!volume && s.vol) {
      chart.removeSeries(s.vol);
      s.vol = null;
    }

    sizePanes(chart, volume);

    const first = data[0];
    const last = data[data.length - 1];
    if (!first || !last) {
      s.main.setData([]);
      s.vol?.setData([]);
      s.byTime.clear();
      s.drawn = null;
      return;
    }

    const bar = (c: Candle) =>
      type === 'line' ? { time: toChartTime(c.t), value: c.c } : { time: toChartTime(c.t), open: c.o, high: c.h, low: c.l, close: c.c };
    const volBar = (c: Candle) => ({ time: toChartTime(c.t), value: c.v, color: alpha(c.c >= c.o ? colors.hot : colors.cold, 0.4) });

    const d = s.drawn;
    const sameSeries = d && d.key === dataKey && d.type === type && d.first === first.t;
    if (sameSeries && d.len === data.length && d.last === last.t) {
      // Only the bar in progress moved.
      s.main.update(bar(last) as never);
      s.vol?.update(volBar(last));
      s.byTime.set(toChartTime(last.t), candles[candles.length - 1]!);
    } else {
      const prepended = d && d.key === dataKey && d.type === type && d.last === last.t && d.first > first.t ? data.length - d.len : 0;
      const range = prepended > 0 ? chart.timeScale().getVisibleLogicalRange() : null;
      s.main.applyOptions({ priceFormat });
      s.main.setData(data.map(bar) as never);
      s.vol?.setData(data.map(volBar));
      s.byTime = new Map(candles.map((c) => [toChartTime(c.t) as number, c]));
      if (range) {
        // Older bars were added on the left: keep the same bars on screen.
        chart.timeScale().setVisibleLogicalRange({ from: range.from + prepended, to: range.to + prepended });
      } else if (!d || d.key !== dataKey) {
        const show = Math.min(data.length, 160);
        chart.timeScale().setVisibleLogicalRange({ from: data.length - show, to: data.length + 6 });
      }
    }
    s.drawn = { key: dataKey, first: first.t, last: last.t, len: data.length, type };
  }, [candles, type, volume, dataKey, redraw]);

  useEffect(() => {
    live.current?.chart.applyOptions({ timeScale: { timeVisible: intraday } });
  }, [intraday]);

  // ----- Indicator series -----
  useEffect(() => {
    const s = live.current;
    if (!s) return;
    const { chart, colors } = s;
    const list = series ?? [];
    const keys = [...new Set(list.map((x) => x.pane).filter((p) => p !== 'price'))];
    const panesKey = `${volume ? 'v' : ''}|${keys.join(',')}`;
    if (panesKey !== s.panesKey) {
      // The set of panes changed: rebuild so pane indexes stay in order.
      for (const old of s.extra.values()) chart.removeSeries(old);
      s.extra.clear();
      s.panesKey = panesKey;
    }
    const base = volume ? 2 : 1;
    const paneIndex = (p: string) => (p === 'price' ? 0 : base + keys.indexOf(p));
    const want = new Set(list.map((x) => x.id));
    for (const [id, old] of s.extra) {
      if (!want.has(id)) {
        chart.removeSeries(old);
        s.extra.delete(id);
      }
    }
    for (const spec of list) {
      const color = colors[spec.tone ?? 'ink2'];
      let api = s.extra.get(spec.id);
      if (!api) {
        api =
          spec.kind === 'histogram'
            ? chart.addSeries(HistogramSeries, { priceLineVisible: false, lastValueVisible: false }, paneIndex(spec.pane))
            : chart.addSeries(
                LineSeries,
                { priceLineVisible: false, lastValueVisible: spec.pane !== 'price', crosshairMarkerVisible: false },
                paneIndex(spec.pane),
              );
        s.extra.set(spec.id, api);
      }
      if (spec.kind === 'histogram') {
        api.applyOptions({ color, title: spec.label ?? '' });
        api.setData(
          spec.points.map((p) => ({
            time: toChartTime(p.t),
            value: p.v,
            color: p.side ? alpha(p.side === 'buy' ? colors.hot : colors.cold, 0.7) : alpha(color, 0.6),
          })) as never,
        );
      } else {
        api.applyOptions({ color, lineWidth: spec.width ?? 1, lineStyle: DASH[spec.dash ?? 'solid'], title: spec.label ?? '' } as never);
        api.setData(spec.points.map((p) => ({ time: toChartTime(p.t), value: p.v })) as never);
      }
    }
    sizePanes(chart, volume);
  }, [series, volume, redraw]);

  // ----- Fill markers -----
  useEffect(() => {
    const s = live.current;
    if (!s || !s.main) return;
    const list: SeriesMarker<Time>[] = (markers ?? [])
      .slice()
      .sort((a, b) => a.t - b.t)
      .map((m) => ({
        time: toChartTime(m.t),
        position: m.side === 'buy' ? 'belowBar' : 'aboveBar',
        shape: m.side === 'buy' ? 'arrowUp' : 'arrowDown',
        color: m.side === 'buy' ? s.colors.hot : s.colors.cold,
        ...(m.text ? { text: m.text } : {}),
      }));
    if (!s.markers) s.markers = createSeriesMarkers(s.main, list);
    else s.markers.setMarkers(list);
  }, [markers, type, redraw, candles.length === 0]);

  // ----- Order and level lines: positioned every frame from the price scale -----
  useEffect(() => {
    let raf = 0;
    const place = () => {
      raf = requestAnimationFrame(place);
      const s = live.current;
      const box = overlay.current;
      if (!s || !s.main || !box) return;
      const axis = s.chart.priceScale('right').width();
      const paneH = s.chart.paneSize(0).height;
      box.style.right = `${axis}px`;
      box.style.height = `${paneH}px`;
      for (const el of Array.from(box.children) as HTMLElement[]) {
        const id = el.dataset.id!;
        const dragging = drag.current?.id === id ? drag.current.price : null;
        const p = dragging ?? Number(el.dataset.price);
        const y = s.main.priceToCoordinate(p);
        if (y === null || y < 0 || y > paneH) {
          el.style.visibility = 'hidden';
          continue;
        }
        el.style.visibility = 'visible';
        el.style.transform = `translateY(${Math.round(y)}px)`;
        if (dragging !== null) {
          const out = el.querySelector<HTMLElement>('[data-live]');
          if (out) out.textContent = fmtPrice(dragging);
        }
      }
    };
    raf = requestAnimationFrame(place);
    return () => cancelAnimationFrame(raf);
  }, []);

  // ----- Clicks on the price axis drop a level -----
  useEffect(() => {
    const el = host.current!;
    let down: { x: number; y: number } | null = null;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const onDown = (e: PointerEvent) => {
      down = { x: e.clientX, y: e.clientY };
    };
    const onUp = (e: PointerEvent) => {
      const s = live.current;
      const start = down;
      down = null;
      if (!s || !s.main || !start || !cb.current.onAxisClick) return;
      if (Math.abs(e.clientX - start.x) > 3 || Math.abs(e.clientY - start.y) > 3) return; // a drag scales the axis
      const r = el.getBoundingClientRect();
      const axis = s.chart.priceScale('right').width();
      const y = e.clientY - r.top;
      if (e.clientX < r.right - axis || y > s.chart.paneSize(0).height) return;
      const px = s.main.coordinateToPrice(y);
      if (px === null) return;
      const alt = e.altKey;
      // Wait a moment: a double-click resets the axis and must not drop two levels.
      if (timer) {
        clearTimeout(timer);
        timer = null;
        return;
      }
      timer = setTimeout(() => {
        timer = null;
        cb.current.onAxisClick?.(px, alt);
      }, 260);
    };
    const onContext = (e: MouseEvent) => {
      const s = live.current;
      if (!s || !cb.current.onContext) return;
      const r = el.getBoundingClientRect();
      const t = s.chart.timeScale().coordinateToTime(e.clientX - r.left);
      if (typeof t !== 'number') return;
      const c = s.byTime.get(t);
      if (!c) return;
      e.preventDefault();
      cb.current.onContext(c.t, e.clientX, e.clientY);
    };
    el.addEventListener('pointerdown', onDown);
    el.addEventListener('pointerup', onUp);
    el.addEventListener('contextmenu', onContext);
    return () => {
      el.removeEventListener('pointerdown', onDown);
      el.removeEventListener('pointerup', onUp);
      el.removeEventListener('contextmenu', onContext);
      if (timer) clearTimeout(timer);
    };
  }, []);

  const startDrag = (line: ChartLine, e: React.PointerEvent<HTMLElement>) => {
    if (!line.onMove || e.button !== 0) return;
    const s = live.current;
    if (!s || !s.main) return;
    e.preventDefault();
    e.stopPropagation();
    const top = host.current!.getBoundingClientRect().top;
    const id = e.pointerId;
    drag.current = { id: line.id, price: line.price };
    // Listen on the window, so the drag keeps tracking when the pointer leaves the small tag.
    const move = (ev: PointerEvent) => {
      if (ev.pointerId !== id) return;
      const px = s.main?.coordinateToPrice(ev.clientY - top);
      if (px !== null && px !== undefined && px > 0 && drag.current) drag.current.price = px;
    };
    const end = (ev: PointerEvent) => {
      if (ev.pointerId !== id) return;
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', end);
      window.removeEventListener('pointercancel', end);
      if (ev.type === 'pointerup') move(ev);
      const d = drag.current;
      drag.current = null;
      if (ev.type === 'pointerup' && d && d.price !== line.price) line.onMove?.(d.price);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', end);
    window.addEventListener('pointercancel', end);
  };

  return (
    <div className="chart" role="group" aria-label={`${label}. The bar under the crosshair is read out above the chart; order lines can be moved with the arrow keys.`}>
      <div className="chart-host" ref={host} />
      <div className="chart-lines" ref={overlay}>
        {(lines ?? []).map((line) => (
          <div key={line.id} className="chart-line" data-id={line.id} data-price={line.price} data-dashed={line.dashed ? 'true' : undefined}>
            <span
              className="chart-tag"
              data-side={line.side}
              data-drag={line.onMove ? 'true' : undefined}
              onPointerDown={(e) => startDrag(line, e)}
              role={line.onMove ? 'slider' : undefined}
              tabIndex={line.onMove ? 0 : undefined}
              aria-label={line.onMove ? `${line.label}. Arrow keys move it.` : undefined}
              aria-valuenow={line.onMove ? line.price : undefined}
              aria-valuetext={line.onMove ? fmtPrice(line.price) : undefined}
              onKeyDown={(e) => {
                if (!line.onMove) return;
                const step = line.price * (e.shiftKey ? 0.005 : 0.0005);
                if (e.key === 'ArrowUp') {
                  e.preventDefault();
                  line.onMove(line.price + step);
                } else if (e.key === 'ArrowDown') {
                  e.preventDefault();
                  line.onMove(line.price - step);
                } else if ((e.key === 'Delete' || e.key === 'Backspace') && line.onRemove) {
                  e.preventDefault();
                  line.onRemove();
                }
              }}
            >
              <span className="chart-tag-text">{line.label}</span>
              <span className="chart-tag-price num" data-live>
                {fmtPrice(line.price)}
              </span>
              {line.onRemove ? (
                <button
                  type="button"
                  className="chart-tag-x"
                  aria-label={line.removeLabel ?? `Remove ${line.label}`}
                  onPointerDown={(e) => e.stopPropagation()}
                  onClick={line.onRemove}
                >
                  ×
                </button>
              ) : null}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}


let redrawTick = 0;
function subscribeRedraw(cb: () => void): () => void {
  const on = () => {
    redrawTick += 1;
    cb();
  };
  window.addEventListener('flame:chart-redraw', on);
  return () => window.removeEventListener('flame:chart-redraw', on);
}
function useRedrawTick(): number {
  return useSyncExternalStore(subscribeRedraw, () => redrawTick);
}
