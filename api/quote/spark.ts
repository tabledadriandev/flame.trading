import { cache, fetchJson, param, proxy, ProxyError } from '../_lib/http';
import { YAHOO, barsOf, quoteOf, symbol, type YahooResult } from '../_lib/yahoo';

// GET /api/quote/spark?symbols=^GSPC,^IXIC,SPY
// Last price, previous close and today's sparkline for up to 20 symbols in one call.

const MAX = 20;

type SparkResponse = Record<string, YahooResult & { close?: (number | null)[]; chartPreviousClose?: number; previousClose?: number | null; symbol?: string }> & {
  spark?: { result?: { symbol?: string; response?: YahooResult[] }[] | null };
};

export default proxy(async (req, res) => {
  const raw = param(req, 'symbols') ?? '';
  const symbols = [...new Set(raw.split(',').filter(Boolean).map((s) => symbol(s)))];
  if (symbols.length === 0) throw new ProxyError(400, 'bad_request', 'Send at least one symbol.');
  if (symbols.length > MAX) throw new ProxyError(400, 'bad_request', `Send at most ${MAX} symbols.`);

  const url = `${YAHOO}/v8/finance/spark?symbols=${symbols.map(encodeURIComponent).join(',')}&range=1d&interval=5m`;
  const data = await fetchJson<SparkResponse>({ name: 'Yahoo Finance', url });
  const now = Date.now();

  // Yahoo has served this endpoint in two shapes; read whichever arrives.
  const bySymbol = new Map<string, YahooResult>();
  for (const r of data.spark?.result ?? []) {
    const first = r.response?.[0];
    if (r.symbol && first) bySymbol.set(r.symbol.toUpperCase(), first);
  }
  for (const sym of symbols) {
    const flat = (data as Record<string, unknown>)[sym] as (YahooResult & { close?: (number | null)[]; chartPreviousClose?: number; timestamp?: number[] }) | undefined;
    if (!bySymbol.has(sym) && flat && typeof flat === 'object' && Array.isArray(flat.timestamp)) {
      const close = flat.close ?? [];
      bySymbol.set(sym, {
        meta: flat.meta ?? { chartPreviousClose: flat.chartPreviousClose, regularMarketPrice: [...close].reverse().find((v): v is number => typeof v === 'number') },
        timestamp: flat.timestamp,
        indicators: flat.indicators ?? { quote: [{ open: close, high: close, low: close, close, volume: [] }] },
      });
    }
  }

  const quotes = symbols.map((sym) => {
    const r = bySymbol.get(sym);
    if (!r) return { symbol: sym, missing: true as const };
    return { ...quoteOf(sym, r.meta, now), spark: barsOf(r).map((b) => b.c) };
  });
  if (quotes.every((q) => 'missing' in q)) throw new ProxyError(502, 'upstream_unreadable', 'Yahoo Finance sent an answer without any quotes.');
  cache(res, 15, 60);
  res.status(200).json({ quotes });
});
