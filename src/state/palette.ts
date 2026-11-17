import { create } from 'zustand';

interface PaletteStore {
  open: boolean;
  /** Text to start with ('' for everything, or a symbol typed before opening). */
  seed: string;
  /** When set, picking a symbol adds it to the watchlist instead of loading it. */
  purpose: 'go' | 'watch';
  show(seed?: string, purpose?: 'go' | 'watch'): void;
  hide(): void;
}

export const usePalette = create<PaletteStore>((set) => ({
  open: false,
  seed: '',
  purpose: 'go',
  show: (seed = '', purpose = 'go') => set({ open: true, seed, purpose }),
  hide: () => set({ open: false }),
}));
