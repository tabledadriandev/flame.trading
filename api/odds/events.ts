import { cache, fetchJson, param, proxy, ProxyError } from '../_lib/http.js';
import { GAMMA, TOPICS, eventOf, topic, type GammaEvent, type OddsEvent } from '../_lib/poly.js';

// GET /api/odds/events?topic=economy
// Open prediction markets for a topic, most traded in the last day first.

export default proxy(async (req, res) => {
  const t = topic(param(req, 'topic'));
  const tag = TOPICS[t];
  const url = `${GAMMA}/events?closed=false&active=true&order=volume24hr&ascending=false&limit=36${tag ? `&tag_slug=${encodeURIComponent(tag)}` : ''}`;
  const data = await fetchJson<GammaEvent[]>({ name: 'Polymarket', url, timeoutMs: 10_000 });
  if (!Array.isArray(data)) throw new ProxyError(502, 'upstream_unreadable', 'Polymarket sent an answer Flame could not read.');
  const events = data.map((e) => eventOf(e)).filter((e): e is OddsEvent => e !== null).slice(0, 30);
  cache(res, 30, 120);
  res.status(200).json({ topic: t, events });
});
