import { cache, fetchJson, param, proxy, ProxyError } from '../_lib/http';
import { YAHOO } from '../_lib/yahoo';

// GET /api/quote/search?q=nvid
// Symbol matches: stocks, ETFs, indices, futures and currencies.

interface SearchResponse {
  quotes?: { symbol?: string; shortname?: string; longname?: string; quoteType?: string; exchDisp?: string }[];
}

const TYPES = new Set(['EQUITY', 'ETF', 'INDEX', 'FUTURE', 'CURRENCY', 'MUTUALFUND']);

export default proxy(async (req, res) => {
  const q = (param(req, 'q') ?? '').trim();
  // Letters, digits and the few marks that appear in tickers and company names.
  if (q.length < 1 || q.length > 40 || !/^[\p{L}\p{N} .&'^=\-]+$/u.test(q)) throw new ProxyError(400, 'bad_query', 'Search for a ticker or a company name.');
  const url = `${YAHOO}/v1/finance/search?q=${encodeURIComponent(q)}&quotesCount=8&newsCount=0&listsCount=0&enableFuzzyQuery=false`;
  const data = await fetchJson<SearchResponse>({ name: 'Yahoo Finance', url });
  const results = (data.quotes ?? [])
    .filter((x) => typeof x.symbol === 'string' && TYPES.has(x.quoteType ?? ''))
    .slice(0, 8)
    .map((x) => ({ symbol: x.symbol!, name: x.longname ?? x.shortname ?? x.symbol!, type: x.quoteType!, exchange: x.exchDisp ?? '' }));
  cache(res, 300, 3_600);
  res.status(200).json({ results });
});
