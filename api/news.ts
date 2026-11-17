import { cache, fetchText, proxy, ProxyError } from './_lib/http.js';
import { parseFeed, subjects } from './_lib/rss.js';

// GET /api/news
// Headlines from four institutions' own press feeds, newest first. Every item
// links to the institution's own page; Flame shows the headline and nothing
// more of the text.

const FEEDS: { source: string; url: string; hosts: string[] }[] = [
  { source: 'Federal Reserve', url: 'https://www.federalreserve.gov/feeds/press_all.xml', hosts: ['federalreserve.gov'] },
  { source: 'European Central Bank', url: 'https://www.ecb.europa.eu/rss/press.html', hosts: ['ecb.europa.eu', 'bankingsupervision.europa.eu'] },
  { source: 'US Securities and Exchange Commission', url: 'https://www.sec.gov/news/pressreleases.rss', hosts: ['sec.gov'] },
  { source: 'Bank of England', url: 'https://www.bankofengland.co.uk/rss/news', hosts: ['bankofengland.co.uk'] },
];

export default proxy(async (_req, res) => {
  const results = await Promise.allSettled(
    FEEDS.map(async (f) => {
      const xml = await fetchText({ name: f.source, url: f.url, accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml', timeoutMs: 8_000 });
      return parseFeed(xml, f.hosts, 20).map((item) => ({ ...item, source: f.source, primary: true, about: subjects(item.title) }));
    }),
  );
  const items = results.flatMap((r) => (r.status === 'fulfilled' ? r.value : []));
  const failed = FEEDS.filter((_, i) => results[i]!.status === 'rejected').map((f) => f.source);
  if (items.length === 0) throw new ProxyError(502, 'upstream_unreachable', 'None of the news feeds could be read.');
  items.sort((a, b) => (b.time ?? 0) - (a.time ?? 0));
  cache(res, 120, 600);
  res.status(200).json({ items: items.slice(0, 60), sources: FEEDS.map((f) => f.source), failed });
});
