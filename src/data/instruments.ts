import type { AssetClass } from '../engine/types';

// An instrument has one id (crypto:BTC, yahoo:SPY, poly:<market-id>). Panes
// take the id and never care where the data comes from.

export type InstrumentKind = 'crypto' | 'stock' | 'etf' | 'index' | 'rate' | 'commodity' | 'fx' | 'odds';

export interface Instrument {
  id: string;
  /** What a trader calls it: BTC, SPY, S&P 500. */
  symbol: string;
  name: string;
  kind: InstrumentKind;
  /** The engine's class, for instruments that can be traded. */
  cls: AssetClass;
  tradable: boolean;
  /** For chart-only instruments: the ETF or future to trade instead. */
  tradeInstead?: string;
}

const C = (symbol: string, name: string): Instrument => ({
  id: `crypto:${symbol}`,
  symbol,
  name,
  kind: 'crypto',
  cls: 'crypto',
  tradable: true,
});

export const CRYPTO: Instrument[] = [
  C('BTC', 'Bitcoin'),
  C('ETH', 'Ether'),
  C('SOL', 'Solana'),
  C('BNB', 'BNB'),
  C('XRP', 'XRP'),
  C('DOGE', 'Dogecoin'),
  C('ADA', 'Cardano'),
  C('AVAX', 'Avalanche'),
  C('LINK', 'Chainlink'),
  C('SUI', 'Sui'),
  C('LTC', 'Litecoin'),
  C('DOT', 'Polkadot'),
  C('TRX', 'Tron'),
  C('NEAR', 'Near'),
  C('UNI', 'Uniswap'),
  C('AAVE', 'Aave'),
  C('BCH', 'Bitcoin Cash'),
  C('HBAR', 'Hedera'),
  C('TON', 'Toncoin'),
  C('ARB', 'Arbitrum'),
  C('OP', 'Optimism'),
  C('APT', 'Aptos'),
  C('ATOM', 'Cosmos'),
  C('FIL', 'Filecoin'),
  C('INJ', 'Injective'),
  C('PEPE', 'Pepe'),
  C('SHIB', 'Shiba Inu'),
  C('XLM', 'Stellar'),
  C('ETC', 'Ethereum Classic'),
  C('ICP', 'Internet Computer'),
];

const Y = (
  ySymbol: string,
  symbol: string,
  name: string,
  kind: InstrumentKind,
  tradeInstead?: string,
): Instrument => ({
  id: `yahoo:${ySymbol}`,
  symbol,
  name,
  kind,
  cls: 'stock',
  tradable: kind === 'stock' || kind === 'etf',
  ...(tradeInstead ? { tradeInstead } : {}),
});

export const STOCKS: Instrument[] = [
  Y('SPY', 'SPY', 'SPDR S&P 500 ETF', 'etf'),
  Y('QQQ', 'QQQ', 'Invesco QQQ (Nasdaq 100)', 'etf'),
  Y('IWM', 'IWM', 'iShares Russell 2000 ETF', 'etf'),
  Y('DIA', 'DIA', 'SPDR Dow Jones ETF', 'etf'),
  Y('GLD', 'GLD', 'SPDR Gold Shares', 'etf'),
  Y('USO', 'USO', 'United States Oil Fund', 'etf'),
  Y('TLT', 'TLT', 'iShares 20+ Year Treasury ETF', 'etf'),
  Y('VIXY', 'VIXY', 'ProShares VIX Short-Term Futures ETF', 'etf'),
  Y('AAPL', 'AAPL', 'Apple', 'stock'),
  Y('NVDA', 'NVDA', 'Nvidia', 'stock'),
  Y('MSFT', 'MSFT', 'Microsoft', 'stock'),
  Y('AMZN', 'AMZN', 'Amazon', 'stock'),
  Y('GOOGL', 'GOOGL', 'Alphabet', 'stock'),
  Y('META', 'META', 'Meta Platforms', 'stock'),
  Y('TSLA', 'TSLA', 'Tesla', 'stock'),
  Y('AMD', 'AMD', 'Advanced Micro Devices', 'stock'),
  Y('NFLX', 'NFLX', 'Netflix', 'stock'),
  Y('JPM', 'JPM', 'JPMorgan Chase', 'stock'),
];

export const BOARDS: Instrument[] = [
  Y('^GSPC', 'S&P 500', 'S&P 500 index', 'index', 'yahoo:SPY'),
  Y('^IXIC', 'Nasdaq', 'Nasdaq Composite index', 'index', 'yahoo:QQQ'),
  Y('^DJI', 'Dow', 'Dow Jones Industrial Average', 'index', 'yahoo:DIA'),
  Y('^RUT', 'Russell 2000', 'Russell 2000 index', 'index', 'yahoo:IWM'),
  Y('^VIX', 'VIX', 'CBOE Volatility Index', 'index', 'yahoo:VIXY'),
  Y('^TNX', '10-year yield', 'US 10-year Treasury yield', 'rate', 'yahoo:TLT'),
  Y('GC=F', 'Gold', 'Gold futures', 'commodity', 'yahoo:GLD'),
  Y('CL=F', 'Crude', 'WTI crude oil futures', 'commodity', 'yahoo:USO'),
  Y('EURUSD=X', 'EUR/USD', 'Euro against the US dollar', 'fx'),
];

const known = new Map<string, Instrument>();
for (const i of [...CRYPTO, ...STOCKS, ...BOARDS]) known.set(i.id, i);

/** Remember an instrument found by search so it resolves after a reload. */
export function registerInstrument(i: Instrument): void {
  known.set(i.id, i);
}

export function allInstruments(): Instrument[] {
  return [...known.values()];
}

/** Resolve an id. Unknown ids still get a usable instrument built from the id itself. */
export function instrument(id: string): Instrument {
  const hit = known.get(id);
  if (hit) return hit;
  const [venue, rest = ''] = id.split(/:(.*)/s);
  if (venue === 'crypto') return C(rest, rest);
  if (venue === 'poly') return { id, symbol: 'Market', name: 'Prediction market', kind: 'odds', cls: 'odds', tradable: true };
  const kind: InstrumentKind = rest.startsWith('^') ? 'index' : rest.endsWith('=F') ? 'commodity' : rest.endsWith('=X') ? 'fx' : 'stock';
  return Y(rest, rest.replace(/^\^/, ''), rest, kind);
}

/** Decimals to show for a price of this size. */
export function priceDecimals(price: number): number {
  const p = Math.abs(price);
  if (p === 0) return 2;
  if (p >= 100) return 2;
  if (p >= 1) return p >= 10 ? 2 : 3;
  if (p >= 0.01) return 5;
  return 8;
}

/** Decimals to show for a size, so that a dollar of the asset is still visible. */
export function qtyDecimals(price: number): number {
  const p = Math.abs(price);
  if (p >= 10_000) return 5;
  if (p >= 100) return 4;
  if (p >= 1) return 2;
  return 0;
}
