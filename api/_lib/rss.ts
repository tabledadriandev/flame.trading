// A small reader for the RSS and Atom feeds Flame's news view uses. The feeds
// come from four institutions' own press offices; this is not a general XML
// parser and does not try to be.

export interface FeedItem {
  title: string;
  link: string;
  /** Milliseconds; null when the feed gave no usable date. */
  time: number | null;
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

export function decode(text: string): string {
  return text
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&#x([0-9a-f]+);/gi, (_, h: string) => safeChar(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d: string) => safeChar(parseInt(d, 10)))
    .replace(/&([a-z]+);/gi, (m, name: string) => ENTITIES[name.toLowerCase()] ?? m)
    .replace(/\s+/g, ' ')
    .trim();
}

function safeChar(code: number): string {
  // Drop control characters and anything outside Unicode; keep ordinary text.
  if (!Number.isFinite(code) || code < 32 || code > 0x10ffff || (code >= 0xd800 && code <= 0xdfff)) return ' ';
  return String.fromCodePoint(code);
}

function tag(block: string, name: string): string | null {
  const m = new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, 'i').exec(block);
  return m ? m[1]! : null;
}

/** Read up to `limit` items. Links are kept only if they are https and on one of the allowed hosts. */
export function parseFeed(xml: string, allowedHosts: string[], limit = 25): FeedItem[] {
  const blocks = xml.match(/<(item|entry)(?:\s[^>]*)?>[\s\S]*?<\/\1>/gi) ?? [];
  const out: FeedItem[] = [];
  for (const block of blocks.slice(0, limit * 2)) {
    const title = decode(tag(block, 'title') ?? '');
    let href = decode(tag(block, 'link') ?? '');
    if (!href) href = /<link[^>]*\bhref="([^"]+)"/i.exec(block)?.[1] ?? '';
    const date = decode(tag(block, 'pubDate') ?? tag(block, 'updated') ?? tag(block, 'published') ?? tag(block, 'dc:date') ?? '');
    if (!title || !href) continue;
    let url: URL;
    try {
      url = new URL(href);
    } catch {
      continue;
    }
    if (url.protocol !== 'https:' || !allowedHosts.some((h) => url.hostname === h || url.hostname.endsWith(`.${h}`))) continue;
    const t = Date.parse(date);
    out.push({ title: title.slice(0, 300), link: url.toString(), time: Number.isFinite(t) ? t : null });
    if (out.length >= limit) break;
  }
  return out;
}

/** What a headline is about, as instrument ids the desk can open. */
const SUBJECTS: [RegExp, string][] = [
  [/\b(bitcoin|btc)\b/i, 'crypto:BTC'],
  [/\b(ether|ethereum|eth)\b/i, 'crypto:ETH'],
  [/\b(stablecoins?|crypto[- ]?assets?|digital assets?|cryptocurrenc(y|ies))\b/i, 'crypto:BTC'],
  [/\b(federal funds|fomc|monetary policy|interest rates?|rate (cut|hike|decision)|policy rate|bank rate|treasur(y|ies)|yields?|quantitative|balance sheet)\b/i, 'yahoo:^TNX'],
  [/\b(euro area|eurozone|euro\b|ecb)\b/i, 'yahoo:EURUSD=X'],
  [/\b(s&p 500|stock market|equity markets?|equities)\b/i, 'yahoo:^GSPC'],
  [/\b(gold)\b/i, 'yahoo:GC=F'],
  [/\b(crude|oil prices?)\b/i, 'yahoo:CL=F'],
  [/\b(apple)\b/i, 'yahoo:AAPL'],
  [/\b(nvidia)\b/i, 'yahoo:NVDA'],
  [/\b(microsoft)\b/i, 'yahoo:MSFT'],
  [/\b(tesla)\b/i, 'yahoo:TSLA'],
  [/\b(amazon)\b/i, 'yahoo:AMZN'],
  [/\b(alphabet|google)\b/i, 'yahoo:GOOGL'],
  [/\b(meta platforms|facebook)\b/i, 'yahoo:META'],
  [/\b(jpmorgan|jp morgan)\b/i, 'yahoo:JPM'],
];

export function subjects(title: string): string[] {
  const out: string[] = [];
  for (const [re, id] of SUBJECTS) if (re.test(title) && !out.includes(id)) out.push(id);
  return out.slice(0, 3);
}
