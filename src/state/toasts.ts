import { create } from 'zustand';

export interface Toast {
  id: number;
  text: string;
  /** Buying or selling pressure, when the message is about a fill. Shown as a glyph and an edge, never colour alone. */
  side?: 'buy' | 'sell';
  sticky?: boolean;
}

interface ToastStore {
  toasts: Toast[];
  push(text: string, opts?: { side?: 'buy' | 'sell'; sticky?: boolean }): void;
  dismiss(id: number): void;
}

let seq = 0;

export const useToasts = create<ToastStore>((set, get) => ({
  toasts: [],
  push(text, opts = {}) {
    const id = ++seq;
    set({ toasts: [...get().toasts.slice(-4), { id, text, ...opts }] });
    if (!opts.sticky) setTimeout(() => get().dismiss(id), 5_000);
  },
  dismiss(id) {
    set({ toasts: get().toasts.filter((t) => t.id !== id) });
  },
}));

export const toast = (text: string, opts?: { side?: 'buy' | 'sell'; sticky?: boolean }): void =>
  useToasts.getState().push(text, opts);
