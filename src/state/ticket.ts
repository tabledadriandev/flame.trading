import { create } from 'zustand';
import type { Mode, OrderType, Side } from '../engine/types';

// The parts of the ticket other panes can set: a click on the ladder loads a
// limit price, B and S pick a side, the palette fills in a whole order.

export type SizeMode = 'units' | 'dollars' | 'risk';

interface TicketStore {
  side: Side;
  mode: Mode;
  type: OrderType;
  price: string;
  size: string;
  sizeMode: SizeMode;
  tp: string;
  sl: string;
  leverage: number;
  /** Bumps when something outside asks for the ticket's attention. */
  focus: number;
  /** The chart price under the pointer, for the L shortcut. */
  hoverPrice: number | null;
  set(p: Partial<Omit<TicketStore, 'set' | 'prefill'>>): void;
  prefill(p: Partial<Pick<TicketStore, 'side' | 'mode' | 'type' | 'price' | 'size' | 'sizeMode' | 'tp' | 'sl'>>): void;
}

export const useTicket = create<TicketStore>((set, get) => ({
  side: 'buy',
  mode: 'spot',
  type: 'market',
  price: '',
  size: '',
  sizeMode: 'units',
  tp: '',
  sl: '',
  leverage: 5,
  focus: 0,
  hoverPrice: null,
  set: (p) => set(p),
  prefill: (p) => set({ ...p, focus: get().focus + 1 }),
}));
