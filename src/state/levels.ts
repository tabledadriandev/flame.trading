import { create } from 'zustand';
import { save } from './persist';

// Horizontal levels dropped on the chart's price axis. A level can also be an
// alert: Flame tells you when the price crosses it.

export interface Level {
  id: string;
  price: number;
  alert: boolean;
  /** For alerts: which side of the level the price was on when it was set. */
  from?: 'above' | 'below';
  /** Set when the alert has fired. */
  firedAt?: number;
}

interface LevelStore {
  byInstrument: Record<string, Level[]>;
  add(instrument: string, price: number, alert: boolean, last?: number): void;
  move(instrument: string, id: string, price: number, last?: number): void;
  remove(instrument: string, id: string): void;
  fire(instrument: string, id: string, t: number): void;
  hydrate(d: Record<string, Level[]> | undefined): void;
}

const side = (price: number, last?: number): 'above' | 'below' | undefined => (last === undefined ? undefined : last >= price ? 'above' : 'below');

export const useLevels = create<LevelStore>((set, get) => {
  const commit = (instrument: string, next: Level[]) => {
    const all = { ...get().byInstrument, [instrument]: next };
    if (next.length === 0) delete all[instrument];
    set({ byInstrument: all });
    save('levels', all);
  };
  const list = (instrument: string): Level[] => get().byInstrument[instrument] ?? [];
  return {
    byInstrument: {},
    add(instrument, price, alert, last) {
      const from = side(price, last);
      commit(instrument, [...list(instrument), { id: `v${Date.now().toString(36)}${Math.round(Math.random() * 1e4).toString(36)}`, price, alert, ...(from ? { from } : {}) }]);
    },
    move(instrument, id, price, last) {
      commit(
        instrument,
        list(instrument).map((l) => {
          if (l.id !== id) return l;
          // A moved alert is armed again from wherever the price is now.
          const { firedAt: _fired, from: _from, ...rest } = l;
          const from = side(price, last);
          return { ...rest, price, ...(from ? { from } : {}) };
        }),
      );
    },
    remove: (instrument, id) => commit(instrument, list(instrument).filter((l) => l.id !== id)),
    fire: (instrument, id, t) => commit(instrument, list(instrument).map((l) => (l.id === id ? { ...l, firedAt: t } : l))),
    hydrate(d) {
      if (d && typeof d === 'object') set({ byInstrument: d });
    },
  };
});

/** Alerts that this price crosses: armed, and the price has reached the level from the side it was set on. */
export function crossed(levels: Level[], last: number): Level[] {
  return levels.filter((l) => l.alert && l.firedAt === undefined && l.from !== undefined && (l.from === 'below' ? last >= l.price : last <= l.price));
}
