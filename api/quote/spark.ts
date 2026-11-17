import { cache, param, proxy, ProxyError } from '../_lib/http.js';
import { alpacaBars, alpacaSymbol, nyTime, quoteFrom, regularHours } from '../_lib/alpaca.js';
import { symbol } from '../_lib/quotes.js';

// GET /api/quote/spark?symbols=SPY,QQQ,AAPL
// Last price, previous close and the latest session's sparkline for up to 20 symbols, in two upstream calls.

const MAX = 20;

export default proxy(async (req, res) => {
  const raw = param(req, 'symbols') ?? '';
  const asked = [...new Set(raw.split(',').filter(Boolean).map((s) => symbol(s)))];
  if (asked.length === 0) throw new ProxyError(400, 'bad_request', 'Send at least one symbol.');
  if (asked.length > MAX) throw new ProxyError(400, 'bad_request', `Send at most ${MAX} symbols.`);
  // Symbols the feed cannot cover are reported as missing, not as a failure of the whole request.
  const known = new Map<string, string>();
  for (const s of asked) {
    try {
      known.set(s, alpacaSymbol(s));
    } catch {
      // an index, future or currency
    }
  }
  const now = Date.now();
  const list = [...new Set(known.values())];
  const [minutes, days] = list.length ? await Promise.all([alpacaBars(list, '5m', '1d', now), alpacaBars(list, '1d', '1mo', now)]) : [new Map(), new Map()];

  const quotes = asked.map((s) => {
    const sym = known.get(s);
    const bars = sym ? regularHours(minutes.get(sym) ?? [], '5m') : [];
    const daily = sym ? (days.get(sym) ?? []) : [];
    if (!sym || (bars.length === 0 && daily.length === 0)) return { symbol: s, missing: true as const };
    const lastDay = bars.length ? nyTime(bars[bars.length - 1]!.t).date : null;
    const session = lastDay ? bars.filter((b) => nyTime(b.t).date === lastDay) : [];
    return { ...quoteFrom(s, session, daily, now), spark: session.map((b) => b.c) };
  });
  cache(res, 15, 60);
  res.status(200).json({ quotes });
});
