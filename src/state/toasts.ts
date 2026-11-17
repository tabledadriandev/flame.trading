import { create } from 'zustand';

export interface Toast {
  id: number;
  text: string;
  /** Buying or selling pressure, when the message is about a fill. Shown as a glyph and an edge, never colour alone. */
  side?: 'buy' | 'sell';
  sticky?: boolean;
  /** One thing the reader can do about it. */
  action?: { label: string; run: () => void };
}

interface ToastStore {
  toasts: Toast[];
  push(text: string, opts?: { side?: 'buy' | 'sell'; sticky?: boolean; action?: { label: string; run: () => void } }): void;
  dismiss(id: number): void;
}

let seq = 0;

export const useToasts = create<ToastStore>((set, get) => ({
  toasts: [],
  push(text, opts = {}) {
    const now = get().toasts;
    // The same message twice is noise; a warning already on screen stays where it is.
    if (now.some((t) => t.text === text)) return;
    const id = ++seq;
    // Passing notices give way to new ones; warnings that need reading are kept.
    const sticky = now.filter((t) => t.sticky).slice(-4);
    const passing = now.filter((t) => !t.sticky).slice(-3);
    const kept = now.filter((t) => sticky.includes(t) || passing.includes(t));
    set({ toasts: [...kept, { id, text, ...opts }] });
    if (!opts.sticky) setTimeout(() => get().dismiss(id), 5_000);
  },
  dismiss(id) {
    set({ toasts: get().toasts.filter((t) => t.id !== id) });
  },
}));

export const toast = (text: string, opts?: { side?: 'buy' | 'sell'; sticky?: boolean; action?: { label: string; run: () => void } }): void =>
  useToasts.getState().push(text, opts);
