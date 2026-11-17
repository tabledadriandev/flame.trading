import { cache, param, proxy, ProxyError } from '../_lib/http.js';
import { alpacaBars, alpacaSymbol } from '../_lib/alpaca.js';

// GET /api/quote/search?q=nvda
// The data feed has no search by company name, so this confirms an exact
// ticker: if the feed has recent daily bars for it, it is returned as a match.
// Search by name works over Flame's built-in list, in the browser.

export default proxy(['q'], async (req, res) => {
  const q = (param(req, 'q') ?? '').trim().toUpperCase();
  if (q.length < 1 || q.length > 40 || !/^[\p{L}\p{N} .&'^=\-]+$/u.test(q)) throw new ProxyError(400, 'bad_query', 'Search for a ticker or a company name.');
  let sym: string;
  try {
    sym = alpacaSymbol(q);
  } catch {
    cache(res, 300, 3_600);
    res.status(200).json({ results: [] });
    return;
  }
  const bars = (await alpacaBars([sym], '1d', '1mo', Date.now())).get(sym) ?? [];
  cache(res, 300, 3_600);
  res.status(200).json({ results: bars.length ? [{ symbol: sym, name: sym, type: 'EQUITY', exchange: 'US' }] : [] });
});
