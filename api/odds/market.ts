import { cache, fetchJson, param, proxy, ProxyError } from '../_lib/http.js';
import { CLOB, GAMMA, bookOf, marketOf, tokenId } from '../_lib/poly.js';

// GET /api/odds/market?token=<clob token id>&history=1
// One outcome of one market: its order book, whether the market has resolved,
// and (with history=1) a week of hourly prices.

interface History {
  history?: { t?: number; p?: number }[];
}

export default proxy(['token', 'history'], async (req, res) => {
  const token = tokenId(param(req, 'token'));
  const wantHistory = param(req, 'history') === '1';
  const [book, markets, history] = await Promise.all([
    fetchJson<{ bids?: { price?: string; size?: string }[]; asks?: { price?: string; size?: string }[] }>({ name: 'Polymarket', url: `${CLOB}/book?token_id=${token}` }).catch((err: unknown) => {
      // A resolved market has no book; that is an answer, not a failure.
      if (err instanceof ProxyError && err.status === 404) return { bids: [], asks: [] };
      throw err;
    }),
    fetchJson<Parameters<typeof marketOf>[0][]>({ name: 'Polymarket', url: `${GAMMA}/markets?clob_token_ids=${token}` }),
    wantHistory ? fetchJson<History>({ name: 'Polymarket', url: `${CLOB}/prices-history?market=${token}&interval=1w&fidelity=60` }) : Promise.resolve<History>({}),
  ]);
  const market = Array.isArray(markets) && markets[0] ? marketOf(markets[0]) : null;
  if (!market) throw new ProxyError(404, 'not_found', 'Polymarket does not list that market.');
  const outcome = market.outcomes.find((o) => o.token === token);
  if (!outcome) throw new ProxyError(404, 'not_found', 'That outcome is not part of the market.');
  const points = (history.history ?? [])
    .filter((p): p is { t: number; p: number } => typeof p.t === 'number' && typeof p.p === 'number' && p.p >= 0 && p.p <= 1)
    .map((p) => ({ t: p.t * 1000, p: p.p }));
  cache(res, wantHistory ? 60 : 10, 60);
  res.status(200).json({ market, outcome: outcome.name, book: bookOf(book), history: points });
});
