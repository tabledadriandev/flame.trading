import { cache, param, proxy, ProxyError } from '../_lib/http.js';
import { alpacaBars, alpacaSymbol, isIntraday, quoteFrom, regularHours } from '../_lib/alpaca.js';
import { rangeAndInterval, symbol } from '../_lib/quotes.js';

// GET /api/quote/chart?symbol=SPY&range=1d&interval=5m
// Candles plus the quote (last price, previous close, session) for one symbol.

export default proxy(['symbol', 'range', 'interval'], async (req, res) => {
  const sym = alpacaSymbol(symbol(param(req, 'symbol')));
  const { range, interval } = rangeAndInterval(param(req, 'range'), param(req, 'interval'));
  const now = Date.now();
  const intraday = isIntraday(interval);
  const [main, days] = await Promise.all([alpacaBars([sym], interval, range, now), intraday ? alpacaBars([sym], '1d', '1mo', now) : Promise.resolve(null)]);
  const candles = regularHours(main.get(sym) ?? [], interval);
  if (candles.length === 0) throw new ProxyError(404, 'not_found', `There are no prices for ${sym}. Check the ticker: Flame covers US-listed stocks and ETFs.`);
  const daily = days ? (days.get(sym) ?? []) : interval === '1d' ? candles : [];
  cache(res, intraday ? 15 : 3_600, intraday ? 60 : 3_600);
  res.status(200).json({ quote: quoteFrom(sym, intraday ? candles : [], daily, now), interval, range, candles });
});
