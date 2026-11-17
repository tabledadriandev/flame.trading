import type { AssetClass } from '../engine/types';
import { optionName, optionSymbol, parseOptionId } from '../options/contract';

// An instrument has one id (crypto:BTC, stock:SPY, poly:<market-id>). Panes
// take the id and never care where the data comes from.

export type InstrumentKind = 'crypto' | 'stock' | 'etf' | 'index' | 'rate' | 'commodity' | 'fx' | 'odds' | 'option' | 'token';

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
  id: `stock:${ySymbol}`,
  symbol,
  name,
  kind,
  cls: 'stock',
  tradable: kind === 'stock' || kind === 'etf',
  ...(tradeInstead ? { tradeInstead } : {}),
});

export const STOCKS: Instrument[] = [
  Y('SPY', 'SPY', 'S&P 500 (SPDR ETF)', 'etf'),
  Y('QQQ', 'QQQ', 'Nasdaq 100 (Invesco ETF)', 'etf'),
  Y('DIA', 'DIA', 'Dow Jones (SPDR ETF)', 'etf'),
  Y('IWM', 'IWM', 'Russell 2000 (iShares ETF)', 'etf'),
  Y('VIXY', 'VIXY', 'VIX futures (ProShares ETF)', 'etf'),
  Y('TLT', 'TLT', 'Long US Treasuries (iShares ETF)', 'etf'),
  Y('GLD', 'GLD', 'Gold (SPDR ETF)', 'etf'),
  Y('USO', 'USO', 'Crude oil (US Oil Fund ETF)', 'etf'),
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

/**
 * The Markets boards. Flame's stock feed covers US-listed stocks and ETFs, not
 * indices, futures or currencies, so each market is shown through the ETF that
 * tracks it: the thing you would actually trade.
 */
export const BOARD_INDICES = ['stock:SPY', 'stock:QQQ', 'stock:DIA', 'stock:IWM', 'stock:VIXY'];
export const BOARD_MACRO = ['stock:TLT', 'stock:GLD', 'stock:USO'];

const known = new Map<string, Instrument>();
for (const i of [...CRYPTO, ...STOCKS]) known.set(i.id, i);

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
  // A pool is named when it is first read (state/tokens.ts); until then it is only an address.
  if (venue === 'dex') return { id, symbol: 'Token', name: 'On-chain token', kind: 'token', cls: 'meme', tradable: true };
  if (venue === 'opt') {
    // An option's id is the whole contract, so its name can always be read back from it.
    const spec = parseOptionId(id);
    return { id, symbol: spec ? optionSymbol(spec) : rest, name: spec ? optionName(spec) : 'Option', kind: 'option', cls: 'option', tradable: spec !== null };
  }
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
  if (p >= 0.000001) return 8;
  // A token can cost a millionth of a cent: keep four significant digits.
  return Math.min(18, Math.ceil(-Math.log10(p)) + 3);
}

/** Decimals to show for a size, so that a dollar of the asset is still visible. */
export function qtyDecimals(price: number): number {
  const p = Math.abs(price);
  if (p >= 10_000) return 5;
  if (p >= 100) return 4;
  if (p >= 1) return 2;
  return 0;
}
