import type { Candle } from '../data/types';
import { anchoredVwap, atr, bollinger, cumulativeDelta, ema, macd, rsi, sessionVwap, sma, type Series } from '../indicators/math';
import type { ChartSeries, SeriesPoint } from './Chart';

// The indicator shelf: what each study is, what it tells you in one line, its
// defaults, and how it is drawn. Indicators are ink at different weights and
// dash patterns, never new colours (docs/design-system.md, "Charts").

export type IndicatorType = 'sma' | 'ema' | 'bb' | 'vwap' | 'avwap' | 'rsi' | 'macd' | 'atr' | 'prevday' | 'cvd' | 'vrvp';

export interface IndicatorConfig {
  id: string;
  type: IndicatorType;
  params: Record<string, number>;
}

export interface ParamDef {
  key: string;
  label: string;
  value: number;
  min: number;
  max: number;
}

export interface IndicatorDef {
  name: string;
  /** What this tells you, in one line. */
  tells: string;
  params: ParamDef[];
  /** Several of these can be on the chart at once (two averages, say). */
  many?: boolean;
  /** Needs taker-buy volume, which only the crypto venue reports. */
  needsDelta?: boolean;
  /** Only meaningful on intraday bars. */
  intradayOnly?: boolean;
}

export const CATALOG: Record<IndicatorType, IndicatorDef> = {
  sma: {
    name: 'Simple moving average',
    tells: 'The average close over the last N bars. Price above a rising average is an uptrend; the average often acts as support.',
    params: [{ key: 'n', label: 'Bars', value: 20, min: 2, max: 500 }],
    many: true,
  },
  ema: {
    name: 'Exponential moving average',
    tells: 'An average that weights recent bars more, so it turns sooner than the simple one, at the cost of more false turns.',
    params: [{ key: 'n', label: 'Bars', value: 50, min: 2, max: 500 }],
    many: true,
  },
  bb: {
    name: 'Bollinger bands',
    tells: 'A 20-bar average with bands two standard deviations away. Narrow bands mean a quiet market; a close outside a band is an unusually large move.',
    params: [
      { key: 'n', label: 'Bars', value: 20, min: 5, max: 200 },
      { key: 'k', label: 'Deviations', value: 2, min: 1, max: 4 },
    ],
  },
  vwap: {
    name: 'Session VWAP',
    tells: 'The average price paid today, weighted by volume. Above it, the day’s buyers are in profit; the bands show one and two standard deviations.',
    params: [],
    intradayOnly: true,
  },
  avwap: {
    name: 'Anchored VWAP',
    tells: 'The volume-weighted average price since a bar you choose: what everyone who traded since that moment paid on average.',
    params: [],
  },
  rsi: {
    name: 'RSI',
    tells: 'How one-sided recent closes have been, from 0 to 100. Above 70 the move is stretched upward, below 30 downward; neither is a signal on its own.',
    params: [{ key: 'n', label: 'Bars', value: 14, min: 2, max: 100 }],
  },
  macd: {
    name: 'MACD',
    tells: 'The gap between a fast and a slow average. The bars show whether that gap is growing (momentum building) or shrinking.',
    params: [
      { key: 'fast', label: 'Fast', value: 12, min: 2, max: 100 },
      { key: 'slow', label: 'Slow', value: 26, min: 3, max: 200 },
      { key: 'signal', label: 'Signal', value: 9, min: 2, max: 50 },
    ],
  },
  atr: {
    name: 'ATR',
    tells: 'The average size of a bar, gaps included, in price units. Use it to place stops beyond normal noise and to size positions.',
    params: [{ key: 'n', label: 'Bars', value: 14, min: 2, max: 100 }],
  },
  prevday: {
    name: 'Previous-day levels',
    tells: 'Yesterday’s high, low and close. Many traders watch them, so price often reacts there.',
    params: [],
    intradayOnly: true,
  },
  cvd: {
    name: 'Cumulative delta',
    tells: 'Running total of volume bought at the ask minus volume sold at the bid. Price rising while delta falls means the rally lacks aggressive buyers.',
    params: [],
    needsDelta: true,
  },
  vrvp: {
    name: 'Volume profile (visible bars)',
    tells: 'Volume traded at each price across the bars loaded. The longest row is the point of control: the price the market accepted most.',
    params: [{ key: 'rows', label: 'Rows', value: 40, min: 10, max: 120 }],
  },
};

export const SHELF: IndicatorType[] = ['sma', 'ema', 'bb', 'vwap', 'avwap', 'vrvp', 'prevday', 'rsi', 'macd', 'atr', 'cvd'];

export function defaults(type: IndicatorType): Record<string, number> {
  return Object.fromEntries(CATALOG[type].params.map((p) => [p.key, p.value]));
}

export function shortName(c: IndicatorConfig): string {
  const p = c.params;
  switch (c.type) {
    case 'sma':
      return `SMA ${p.n}`;
    case 'ema':
      return `EMA ${p.n}`;
    case 'bb':
      return `Bollinger ${p.n}, ${p.k}`;
    case 'vwap':
      return 'VWAP';
    case 'avwap':
      return 'Anchored VWAP';
    case 'rsi':
      return `RSI ${p.n}`;
    case 'macd':
      return `MACD ${p.fast}, ${p.slow}, ${p.signal}`;
    case 'atr':
      return `ATR ${p.n}`;
    case 'prevday':
      return 'Previous day';
    case 'cvd':
      return 'Cumulative delta';
    case 'vrvp':
      return 'Volume profile';
  }
}

const points = (candles: Candle[], s: Series): SeriesPoint[] => {
  const out: SeriesPoint[] = [];
  for (let i = 0; i < candles.length; i++) {
    const v = s[i];
    if (v !== null && v !== undefined && Number.isFinite(v)) out.push({ t: candles[i]!.t, v });
  }
  return out;
};

/** A short average is solid, a medium one dashed, a long one dotted. */
const dashFor = (n: number): 'solid' | 'dashed' | 'dotted' => (n <= 30 ? 'solid' : n <= 100 ? 'dashed' : 'dotted');

/** Turn the active indicators into series for the chart. */
export function indicatorSeries(configs: IndicatorConfig[], candles: Candle[], intraday: boolean): ChartSeries[] {
  if (candles.length === 0) return [];
  const closes = candles.map((c) => c.c);
  const out: ChartSeries[] = [];
  const line = (id: string, pane: string, s: Series, extra: Partial<ChartSeries> = {}) =>
    out.push({ id, pane, kind: 'line', points: points(candles, s), ...extra });

  for (const c of configs) {
    const p = c.params;
    const def = CATALOG[c.type];
    if (def.intradayOnly && !intraday) continue;
    switch (c.type) {
      case 'sma':
        line(c.id, 'price', sma(closes, p.n ?? 20), { label: shortName(c), dash: dashFor(p.n ?? 20), width: 2 });
        break;
      case 'ema':
        line(c.id, 'price', ema(closes, p.n ?? 50), { label: shortName(c), dash: dashFor(p.n ?? 50), width: 2 });
        break;
      case 'bb': {
        const b = bollinger(closes, p.n ?? 20, p.k ?? 2);
        line(`${c.id}-mid`, 'price', b.mid, { label: 'BB mid', tone: 'ink2' });
        line(`${c.id}-up`, 'price', b.upper, { label: 'BB upper', tone: 'ink3', dash: 'dashed' });
        line(`${c.id}-lo`, 'price', b.lower, { label: 'BB lower', tone: 'ink3', dash: 'dashed' });
        break;
      }
      case 'vwap':
      case 'avwap': {
        const anchor = p.anchor;
        if (c.type === 'avwap' && !(anchor !== undefined && anchor > 0)) break;
        const v = c.type === 'vwap' ? sessionVwap(candles) : anchoredVwap(candles, anchor!);
        const name = c.type === 'vwap' ? 'VWAP' : 'AVWAP';
        line(`${c.id}`, 'price', v.vwap, { label: name, tone: 'ink', width: 2 });
        line(`${c.id}-u1`, 'price', v.upper1, { label: '+1σ', tone: 'ink3', dash: 'dashed' });
        line(`${c.id}-l1`, 'price', v.lower1, { label: '−1σ', tone: 'ink3', dash: 'dashed' });
        line(`${c.id}-u2`, 'price', v.upper2, { label: '+2σ', tone: 'ink3', dash: 'dotted' });
        line(`${c.id}-l2`, 'price', v.lower2, { label: '−2σ', tone: 'ink3', dash: 'dotted' });
        break;
      }
      case 'rsi': {
        const r = rsi(closes, p.n ?? 14);
        line(c.id, c.id, r, { label: shortName(c), tone: 'ink', width: 2 });
        line(`${c.id}-70`, c.id, r.map((v) => (v === null ? null : 70)), { tone: 'ink3', dash: 'dotted', label: '70' });
        line(`${c.id}-30`, c.id, r.map((v) => (v === null ? null : 30)), { tone: 'ink3', dash: 'dotted', label: '30' });
        break;
      }
      case 'macd': {
        const m = macd(closes, p.fast ?? 12, p.slow ?? 26, p.signal ?? 9);
        out.push({ id: `${c.id}-hist`, pane: c.id, kind: 'histogram', points: points(candles, m.hist), tone: 'ink3' });
        line(c.id, c.id, m.macd, { label: 'MACD', tone: 'ink', width: 2 });
        line(`${c.id}-sig`, c.id, m.signal, { label: 'Signal', tone: 'ink2', dash: 'dashed' });
        break;
      }
      case 'atr':
        line(c.id, c.id, atr(candles, p.n ?? 14), { label: shortName(c), tone: 'ink', width: 2 });
        break;
      case 'cvd':
        line(c.id, c.id, cumulativeDelta(candles), { label: 'Cum. delta', tone: 'ink', width: 2 });
        break;
      case 'prevday':
      case 'vrvp':
        break; // drawn as lines and as an overlay by the chart pane
    }
  }
  return out;
}
