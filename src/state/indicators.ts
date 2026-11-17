import { create } from 'zustand';
import { CATALOG, defaults, type IndicatorConfig, type IndicatorType } from '../chart/indicators';
import type { ChartType } from '../chart/Chart';
import { registerLayoutPart } from './layout';
import { layoutDoc } from './market';
import { save } from './persist';

interface IndicatorStore {
  active: IndicatorConfig[];
  volume: boolean;
  chartType: ChartType;
  add(type: IndicatorType, params?: Record<string, number>): void;
  remove(id: string): void;
  setParam(id: string, key: string, value: number): void;
  setVolume(on: boolean): void;
  setChartType(t: ChartType): void;
  hydrate(d: { indicators?: unknown; volume?: unknown; chartType?: unknown } | undefined): void;
}

const commit = () => save('layout', layoutDoc());

export const useIndicators = create<IndicatorStore>((set, get) => ({
  active: [],
  volume: true,
  chartType: 'candles',
  add(type, params) {
    const def = CATALOG[type];
    const existing = get().active.find((a) => a.type === type);
    if (existing && !def.many) {
      if (params) set({ active: get().active.map((a) => (a.id === existing.id ? { ...a, params: { ...a.params, ...params } } : a)) });
    } else {
      set({ active: [...get().active, { id: `${type}-${Date.now().toString(36)}`, type, params: { ...defaults(type), ...params } }] });
    }
    commit();
  },
  remove(id) {
    set({ active: get().active.filter((a) => a.id !== id) });
    commit();
  },
  setParam(id, key, value) {
    set({ active: get().active.map((a) => (a.id === id ? { ...a, params: { ...a.params, [key]: value } } : a)) });
    commit();
  },
  setVolume(volume) {
    set({ volume });
    commit();
  },
  setChartType(chartType) {
    set({ chartType });
    commit();
  },
  hydrate(d) {
    if (!d) return;
    const next: Partial<IndicatorStore> = {};
    if (Array.isArray(d.indicators)) {
      next.active = (d.indicators as IndicatorConfig[]).filter((a) => a && typeof a.id === 'string' && a.type in CATALOG && typeof a.params === 'object');
    }
    if (typeof d.volume === 'boolean') next.volume = d.volume;
    if (d.chartType === 'candles' || d.chartType === 'line' || d.chartType === 'heikin') next.chartType = d.chartType;
    set(next);
  },
}));

registerLayoutPart('indicators', () => useIndicators.getState().active);
registerLayoutPart('volume', () => useIndicators.getState().volume);
registerLayoutPart('chartType', () => useIndicators.getState().chartType);
