import { create } from 'zustand';
import type { Timeframe } from '../data/types';

/** Where "Replay from here" on the desk chart wants the Replay view to start. */
interface ReplaySeed {
  seed: { instrument: string; tf: Timeframe; t: number } | null;
  set(seed: { instrument: string; tf: Timeframe; t: number }): void;
  take(): { instrument: string; tf: Timeframe; t: number } | null;
}

export const useReplaySeed = create<ReplaySeed>((set, get) => ({
  seed: null,
  set: (seed) => set({ seed }),
  take() {
    const s = get().seed;
    if (s) set({ seed: null });
    return s;
  },
}));
