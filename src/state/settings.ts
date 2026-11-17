import { create } from 'zustand';
import { DEFAULT_SETTINGS, type EngineSettings, type Fees } from '../engine/types';
import { save } from './persist';

export type Convention = 'thermal' | 'classic';

export interface Settings {
  fees: Fees;
  fillAtLastClose: boolean;
  /** Default risk per trade, as a percent of equity. */
  riskPct: number;
  confirmOrders: boolean;
  sounds: boolean;
  convention: Convention;
  /** The user's own setup tags for the journal. */
  setups: string[];
  introSeen: boolean;
}

export const DEFAULTS: Settings = {
  fees: DEFAULT_SETTINGS.fees,
  fillAtLastClose: false,
  riskPct: 1,
  confirmOrders: false,
  sounds: false,
  convention: 'thermal',
  setups: ['Breakout', 'Pullback', 'Range fade', 'Trend follow', 'News'],
  introSeen: false,
};

interface SettingsStore extends Settings {
  patch(p: Partial<Settings>): void;
  hydrate(s: Partial<Settings> | undefined): void;
}

const pick = (s: SettingsStore): Settings => ({
  fees: s.fees,
  fillAtLastClose: s.fillAtLastClose,
  riskPct: s.riskPct,
  confirmOrders: s.confirmOrders,
  sounds: s.sounds,
  convention: s.convention,
  setups: s.setups,
  introSeen: s.introSeen,
});

export const useSettings = create<SettingsStore>((set, get) => ({
  ...DEFAULTS,
  patch(p) {
    set(p);
    save('settings', pick(get()));
    applyConvention(get().convention);
  },
  hydrate(s) {
    if (s) set({ ...DEFAULTS, ...s, fees: { ...DEFAULTS.fees, ...(s.fees ?? {}) } });
    applyConvention(get().convention);
  },
}));

export function engineSettings(): EngineSettings {
  const s = useSettings.getState();
  return { fees: s.fees, fillAtLastClose: s.fillAtLastClose };
}

/** The colour convention is an attribute on <html>; tokens.css does the rest. */
export function applyConvention(c: Convention): void {
  if (typeof document === 'undefined') return;
  if (c === 'classic') document.documentElement.setAttribute('data-convention', 'classic');
  else document.documentElement.removeAttribute('data-convention');
  window.dispatchEvent(new Event('flame:theme'));
}
