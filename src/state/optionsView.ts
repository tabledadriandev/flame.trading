import { create } from 'zustand';
import { coinOf, type Coin } from '../data/deribit';

// Which underlying the Options view is showing. The desk ticket sets it
// before it opens the view, so "Options" on ETH opens ETH's chain.

interface OptionsViewStore {
  coin: Coin;
  setCoin(coin: Coin): void;
}

export const useOptionsView = create<OptionsViewStore>((set) => ({
  coin: 'BTC',
  setCoin(coin) {
    set({ coin });
  },
}));

/** Open the option chain for an instrument, if it has one. Returns false when it does not. */
export function openChain(underlying: string): boolean {
  const coin = coinOf(underlying);
  if (!coin) return false;
  useOptionsView.getState().setCoin(coin);
  window.location.hash = 'options';
  return true;
}
