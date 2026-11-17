import { cache, fetchJson, param, proxy, ProxyError } from '../_lib/http.js';
import { YAHOO, YAHOO_UA, barsOf, quoteOf, rangeAndInterval, symbol, type YahooResult } from '../_lib/yahoo.js';

// GET /api/quote/chart?symbol=SPY&range=1d&interval=5m
// Candles plus the quote (last price, previous close, session) for one symbol.

interface ChartResponse {
  chart?: { result?: YahooResult[] | null; error?: { code?: string; description?: string } | null };
}

export default proxy(async (req, res) => {
  const sym = symbol(param(req, 'symbol'));
  const { range, interval } = rangeAndInterval(param(req, 'range'), param(req, 'interval'));
  const url = `${YAHOO}/v8/finance/chart/${encodeURIComponent(sym)}?range=${range}&interval=${interval}&includePrePost=false`;
  const data = await fetchJson<ChartResponse>({ name: 'Yahoo Finance', url, userAgent: YAHOO_UA });
  const result = data.chart?.result?.[0];
  if (!result) {
    const code = data.chart?.error?.code;
    if (code === 'Not Found') throw new ProxyError(404, 'not_found', 'Yahoo Finance does not know that symbol.');
    throw new ProxyError(502, 'upstream_unreadable', 'Yahoo Finance sent an answer without any data.');
  }
  const intraday = interval !== '1d' && interval !== '1wk' && interval !== '1mo';
  cache(res, intraday ? 15 : 3_600, intraday ? 60 : 3_600);
  res.status(200).json({ quote: quoteOf(sym, result.meta, Date.now()), interval, range, candles: barsOf(result) });
});
