import { afterEach, describe, expect, it } from 'vitest';
import { ProxyError } from './http.js';
import { DELAY_MINUTES, alpacaBars, alpacaSymbol, nyTime, quoteFrom, readBars, regularHours, sessionToday, window } from './alpaca.js';
import { rangeAndInterval, symbol, type Bar } from './quotes.js';

describe('proxy input validation', () => {
  it('accepts tickers and the index and futures notations', () => {
    for (const s of ['SPY', 'spy', 'BRK-B', '^GSPC', 'GC=F', 'EURUSD=X', 'RDS.A']) expect(symbol(s)).toBe(s.toUpperCase());
  });

  it('refuses anything that could change the upstream URL', () => {
    for (const s of ['', ' ', 'SPY/../x', 'SPY?x=1', 'SPY#', 'http://evil', 'a b', 'SPY%2F', '..', 'A'.repeat(20), 'SPY&range=max', '@evil.com', 'x:y']) {
      expect(() => symbol(s)).toThrow(ProxyError);
    }
    expect(() => symbol(undefined)).toThrow(ProxyError);
  });

  it('whitelists range and interval, and the combinations that are served', () => {
    expect(rangeAndInterval(undefined, undefined)).toEqual({ range: '1d', interval: '5m' });
    expect(rangeAndInterval('5y', '1d')).toEqual({ range: '5y', interval: '1d' });
    expect(() => rangeAndInterval('100y', '1d')).toThrow(ProxyError);
    expect(() => rangeAndInterval('1d', '7m')).toThrow(ProxyError);
    expect(() => rangeAndInterval('1y', '1m')).toThrow(/only available/);
  });

  it('passes only stock and ETF tickers on to the data feed', () => {
    expect(alpacaSymbol('SPY')).toBe('SPY');
    expect(alpacaSymbol('BRK-B')).toBe('BRK.B');
    for (const s of ['^GSPC', 'GC=F', 'EURUSD=X', 'TOOLONG', 'SP Y', 'A,B']) expect(() => alpacaSymbol(s)).toThrow(/stock and ETF prices only/);
  });
});

describe('the stock data feed', () => {
  // Tuesday 17 November 2026. New York is UTC−5, so 14:30 UTC is the 09:30 open.
  const open = Date.UTC(2026, 10, 17, 14, 30);
  const bar = (t: number, c: number): Bar => ({ t, o: c, h: c, l: c, c, v: 100 });

  it('never asks for the last 15 minutes, which the free plan does not allow', () => {
    const now = open + 3_600_000;
    const w = window('1d', now);
    expect(Date.parse(w.end)).toBe(now - DELAY_MINUTES * 60_000);
    expect(now - Date.parse(w.end)).toBeGreaterThan(15 * 60_000);
    // A one-day range still reaches back over a weekend.
    expect(now - Date.parse(w.start)).toBe(4 * 86_400_000);
  });

  it('reads New York time through the zone, including daylight saving', () => {
    expect(nyTime(open)).toEqual({ date: '2026-11-17', minutes: 570, weekday: 'Tue' });
    expect(nyTime(Date.UTC(2026, 6, 15, 13, 30)).minutes).toBe(570); // July: UTC−4
  });

  it('keeps regular-session bars only', () => {
    const bars = [bar(open - 60 * 60_000, 1), bar(open, 2), bar(open + 6.5 * 3_600_000 - 60_000, 3), bar(open + 6.5 * 3_600_000, 4)];
    expect(regularHours(bars, '1m').map((b) => b.c)).toEqual([2, 3]);
    // The hourly bar that starts at 09:00 holds the open, so it stays.
    expect(regularHours([bar(open - 30 * 60_000, 9), bar(open - 90 * 60_000, 8)], '60m').map((b) => b.c)).toEqual([9]);
    expect(regularHours(bars, '1d')).toHaveLength(4);
  });

  it('works out the quote from the bars: last close, previous session close, open or not', () => {
    const now = open + 2 * 3_600_000;
    const daily = [bar(open - 2 * 86_400_000, 580), bar(open - 86_400_000, 588), bar(open, 591)];
    const intraday = [bar(open, 589), bar(now - 20 * 60_000, 590.5)];
    const q = quoteFrom('SPY', intraday, daily, now);
    expect(q).toMatchObject({ last: 590.5, prevClose: 588, open: true, delayMinutes: DELAY_MINUTES });
    expect(q.session).toEqual({ start: open, end: open + 6.5 * 3_600_000 });
    // A holiday: the clock says trading hours, but no bar has arrived, so the market is closed.
    expect(quoteFrom('SPY', [bar(open - 86_400_000, 588)], daily.slice(0, 2), now).open).toBe(false);
    // After the close.
    expect(quoteFrom('SPY', intraday, daily, open + 7 * 3_600_000).open).toBe(false);
    expect(sessionToday(Date.UTC(2026, 10, 21, 15, 0))).toBeNull(); // Saturday
  });

  it('skips bars it cannot read', () => {
    expect(readBars([{ t: '2026-11-17T14:30:00Z', o: 1, h: 2, l: 0.5, c: 1.5, v: 10 }, { t: 'nonsense', o: 1, h: 1, l: 1, c: 1 }, { t: '2026-11-17T14:31:00Z', o: 1 }])).toEqual([
      { t: open, o: 1, h: 2, l: 0.5, c: 1.5, v: 10 },
    ]);
    expect(readBars(undefined)).toEqual([]);
  });
});

describe('without a data key', () => {
  const saved = { id: process.env.ALPACA_KEY_ID, secret: process.env.ALPACA_SECRET_KEY };
  afterEach(() => {
    process.env.ALPACA_KEY_ID = saved.id;
    process.env.ALPACA_SECRET_KEY = saved.secret;
  });

  it('says prices are not switched on, and calls nothing', async () => {
    delete process.env.ALPACA_KEY_ID;
    delete process.env.ALPACA_SECRET_KEY;
    await expect(alpacaBars(['SPY'], '1d', '1mo', Date.now())).rejects.toMatchObject({ status: 503, code: 'no_source' });
  });
});
