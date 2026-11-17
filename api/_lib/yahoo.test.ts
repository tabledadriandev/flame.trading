import { describe, expect, it } from 'vitest';
import { ProxyError } from './http.js';
import { barsOf, quoteOf, rangeAndInterval, symbol } from './yahoo.js';

describe('proxy input validation', () => {
  it('accepts tickers as Yahoo writes them', () => {
    for (const s of ['SPY', 'spy', 'BRK-B', '^GSPC', 'GC=F', 'EURUSD=X', 'BTC-USD', 'RDS.A']) expect(symbol(s)).toBe(s.toUpperCase());
  });

  it('refuses anything that could change the upstream URL', () => {
    for (const s of ['', ' ', 'SPY/../x', 'SPY?x=1', 'SPY#', 'http://evil', 'a b', 'SPY%2F', '..', 'A'.repeat(20), 'SPY&range=max', '@evil.com', 'x:y']) {
      expect(() => symbol(s)).toThrow(ProxyError);
    }
    expect(() => symbol(undefined)).toThrow(ProxyError);
  });

  it('whitelists range and interval, and the combinations Yahoo serves', () => {
    expect(rangeAndInterval(undefined, undefined)).toEqual({ range: '1d', interval: '5m' });
    expect(rangeAndInterval('5y', '1d')).toEqual({ range: '5y', interval: '1d' });
    expect(() => rangeAndInterval('100y', '1d')).toThrow(ProxyError);
    expect(() => rangeAndInterval('1d', '7m')).toThrow(ProxyError);
    expect(() => rangeAndInterval('1y', '1m')).toThrow(/only available/);
  });
});

describe('reading a Yahoo chart', () => {
  it('drops bars with missing prices and converts seconds to milliseconds', () => {
    const bars = barsOf({
      timestamp: [100, 200, 300],
      indicators: { quote: [{ open: [1, null, 3], high: [2, null, 4], low: [0.5, null, 2.5], close: [1.5, null, 3.5], volume: [10, null, null] }] },
    });
    expect(bars).toEqual([
      { t: 100_000, o: 1, h: 2, l: 0.5, c: 1.5, v: 10 },
      { t: 300_000, o: 3, h: 4, l: 2.5, c: 3.5, v: 0 },
    ]);
    expect(barsOf(undefined)).toEqual([]);
    expect(barsOf({ timestamp: [1] })).toEqual([]);
  });

  it('works out whether the regular session is open from the exchange clock', () => {
    const meta = { regularMarketPrice: 590.1, chartPreviousClose: 588, regularMarketTime: 1_000, currentTradingPeriod: { regular: { start: 900, end: 1_100 } }, longName: 'SPDR S&P 500' };
    expect(quoteOf('SPY', meta, 1_000_000)).toMatchObject({ last: 590.1, prevClose: 588, open: true, name: 'SPDR S&P 500', time: 1_000_000 });
    expect(quoteOf('SPY', meta, 1_200_000).open).toBe(false);
    expect(quoteOf('SPY', undefined, 0)).toMatchObject({ last: null, prevClose: null, open: false, session: null, name: 'SPY' });
  });
});
