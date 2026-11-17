import { SIM } from '../lib/env';
import { BinanceAdapter } from './binance';
import { SimAdapter } from './sim';
import { stocks } from './stocks';
import type { VenueAdapter } from './types';

// The one place that knows which venue serves which instrument.

const binance = new BinanceAdapter();
const sim = new SimAdapter();
const extra = new Map<string, VenueAdapter>([['yahoo', stocks]]);

/** Later phases register the stock and prediction-market adapters here. */
export function registerVenue(prefix: string, adapter: VenueAdapter): void {
  extra.set(prefix, adapter);
}

export interface Route {
  adapter: VenueAdapter;
  symbol: string;
}

export function route(instrumentId: string): Route | null {
  const [venue, rest = ''] = instrumentId.split(/:(.*)/s);
  if (SIM && venue !== 'poly') return { adapter: sim, symbol: rest.replace(/[^A-Za-z0-9]/g, '') || rest };
  if (venue === 'crypto') return { adapter: binance, symbol: `${rest}USDT` };
  const adapter = venue ? extra.get(venue) : undefined;
  return adapter ? { adapter, symbol: rest } : null;
}

export const primaryCrypto: VenueAdapter = SIM ? sim : binance;
