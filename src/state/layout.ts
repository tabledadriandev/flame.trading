import { create } from 'zustand';
import { layoutDoc, registerLayoutDoc } from './market';
import { save } from './persist';

// Pane sizes for the desk, kept between visits.

export interface Sizes {
  /** Widths in pixels. The chart takes what is left. */
  watch: number;
  book: number;
  ticket: number;
  /** Height of the positions drawer. */
  drawer: number;
  /** Share of the book column given to the ladder (the tape gets the rest). */
  ladder: number;
}

export const DEFAULT_SIZES: Sizes = { watch: 240, book: 272, ticket: 300, drawer: 220, ladder: 0.62 };

export const LIMITS: Record<keyof Sizes, [number, number]> = {
  watch: [160, 360],
  book: [200, 420],
  ticket: [260, 400],
  drawer: [34, 520],
  ladder: [0.25, 0.85],
};

/** The chart never gets less than this, or less than this share of the desk. */
export const MIN_CHART = 320;
export const CHART_SHARE = 0.36;
/** The desk stacks into one pane at a time below this width: under it the minimum columns and a usable chart do not fit. */
export const STACK_BELOW = 1000;

const COLUMNS = ['watch', 'book', 'ticket'] as const;

/**
 * The column widths to draw at this desk width. The stored sizes are what the
 * trader chose on a wide screen; on a narrower one the three side columns
 * give way, in proportion and never below their minimums, so the chart keeps
 * a usable share. The stored sizes are not changed.
 */
export function fitSizes(s: Sizes, width: number): Sizes {
  if (!(width > 0)) return s;
  const side = s.watch + s.book + s.ticket;
  const room = width - Math.max(MIN_CHART, Math.round(width * CHART_SHARE)) - COLUMNS.length;
  if (side <= room) return s;
  const minSide = COLUMNS.reduce((sum, k) => sum + LIMITS[k][0], 0);
  const spare = Math.max(0, room - minSide);
  const over = side - minSide;
  const out = { ...s };
  for (const k of COLUMNS) {
    const min = LIMITS[k][0];
    out[k] = Math.floor(min + (over > 0 ? ((s[k] - min) * spare) / over : 0));
  }
  return out;
}

export type PaneId = 'watch' | 'chart' | 'book' | 'tape' | 'ticket' | 'drawer';

export interface LayoutDoc {
  instrument?: string;
  tf?: import("../data/types").Timeframe;
  sizes?: Partial<Sizes>;
  indicators?: unknown;
  chartType?: string;
}

interface LayoutStore {
  sizes: Sizes;
  maximised: PaneId | null;
  zen: boolean;
  setSize(key: keyof Sizes, value: number): void;
  toggleMax(p: PaneId): void;
  setZen(z: boolean): void;
  reset(): void;
  hydrate(d: LayoutDoc | undefined): void;
}

const clamp = (key: keyof Sizes, v: number): number => Math.min(LIMITS[key][1], Math.max(LIMITS[key][0], v));

export const useLayout = create<LayoutStore>((set, get) => ({
  sizes: DEFAULT_SIZES,
  maximised: null,
  zen: false,
  setSize(key, value) {
    set({ sizes: { ...get().sizes, [key]: clamp(key, value) } });
    save('layout', layoutDoc());
  },
  toggleMax(p) {
    set({ maximised: get().maximised === p ? null : p });
  },
  setZen(zen) {
    set({ zen });
  },
  reset() {
    set({ sizes: DEFAULT_SIZES, maximised: null, zen: false });
    save('layout', layoutDoc());
  },
  hydrate(d) {
    if (!d?.sizes) return;
    const next = { ...DEFAULT_SIZES };
    for (const key of Object.keys(DEFAULT_SIZES) as (keyof Sizes)[]) {
      const v = d.sizes[key];
      if (typeof v === 'number' && Number.isFinite(v)) next[key] = clamp(key, v);
    }
    set({ sizes: next });
  },
}));

const extras: Record<string, () => unknown> = {};
/** Other stores (chart indicators, say) add their own keys to the layout document. */
export function registerLayoutPart(key: string, read: () => unknown): void {
  extras[key] = read;
}

registerLayoutDoc(() => {
  const out: Record<string, unknown> = { sizes: useLayout.getState().sizes };
  for (const [key, read] of Object.entries(extras)) out[key] = read();
  return out;
});
