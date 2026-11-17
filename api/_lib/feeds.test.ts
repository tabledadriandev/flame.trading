import { describe, expect, it } from 'vitest';
import { ProxyError } from './http.js';
import { bookOf, eventOf, marketOf, tokenId, topic } from './poly.js';
import { decode, parseFeed, subjects } from './rss.js';

const TOKEN_A = '17640596861394454242836532536014033416733783473450136742726948856144855149507';
const TOKEN_B = '55808098075453524837789439456812606274280884849495887856986145370171079330177';

describe('prediction-market proxy', () => {
  it('accepts only known topics and numeric token ids', () => {
    expect(topic(undefined)).toBe('trending');
    expect(topic('Economy')).toBe('economy');
    expect(() => topic('../admin')).toThrow(ProxyError);
    expect(tokenId(TOKEN_A)).toBe(TOKEN_A);
    for (const bad of ['', 'abc', '12', `${TOKEN_A}&x=1`, '1'.repeat(120), '0x12ab']) expect(() => tokenId(bad)).toThrow(ProxyError);
  });

  it('reads a market whose lists arrive as JSON strings', () => {
    const m = marketOf({ id: '1', question: 'Will it rain?', outcomes: '["Yes","No"]', outcomePrices: '["0.35","0.65"]', clobTokenIds: `["${TOKEN_A}","${TOKEN_B}"]`, bestBid: 0.34, bestAsk: 0.36, oneWeekPriceChange: -0.05 })!;
    expect(m.outcomes).toEqual([
      { name: 'Yes', price: 0.35, token: TOKEN_A },
      { name: 'No', price: 0.65, token: TOKEN_B },
    ]);
    expect(m).toMatchObject({ bestBid: 0.34, weekChange: -0.05, closed: false, resolved: false });
  });

  it('drops markets it cannot read rather than guessing', () => {
    expect(marketOf({ id: '1', question: 'q', outcomes: 'not json', outcomePrices: '[]', clobTokenIds: '[]' })).toBeNull();
    expect(marketOf({ id: '1', question: 'q', outcomes: '["Yes","No"]', outcomePrices: '["0.5"]', clobTokenIds: `["${TOKEN_A}","${TOKEN_B}"]` })).toBeNull();
    expect(marketOf({ id: '1', question: 'q', outcomes: '["Yes","No"]', outcomePrices: '["1.5","-0.5"]', clobTokenIds: `["${TOKEN_A}","${TOKEN_B}"]` })).toBeNull();
    expect(marketOf({ id: '1', question: 'q', outcomes: '["Yes","No"]', outcomePrices: '["0.5","0.5"]', clobTokenIds: '["javascript:alert(1)","x"]' })).toBeNull();
  });

  it('keeps the leading open markets of an event and counts the rest', () => {
    const mk = (id: string, p: number, closed = false) => ({ id, question: `q${id}`, outcomes: '["Yes","No"]', outcomePrices: `["${p}","${1 - p}"]`, clobTokenIds: `["${TOKEN_A}","${TOKEN_B}"]`, closed });
    const e = eventOf({ id: '9', title: 'Fed decision', markets: [mk('1', 0.1), mk('2', 0.7), mk('3', 0.2), mk('4', 0.9, true)], tags: [{ label: 'Economy' }] }, 2)!;
    expect(e.markets.map((m) => m.id)).toEqual(['2', '3']);
    expect(e.marketCount).toBe(3);
    expect(e.topics).toEqual(['Economy']);
    expect(eventOf({ id: '9', title: 'Over', markets: [mk('4', 1, true)] })).toBeNull();
  });

  it('returns the book best price first on both sides', () => {
    const b = bookOf({ bids: [{ price: '0.001', size: '5' }, { price: '0.003', size: '2' }], asks: [{ price: '0.006', size: '7' }, { price: '0.004', size: '1' }, { price: 'x', size: '1' }] });
    expect(b.bids.map((r) => r.price)).toEqual([0.003, 0.001]);
    expect(b.asks.map((r) => r.price)).toEqual([0.004, 0.006]);
  });
});

describe('news feed reader', () => {
  const rss = `<rss><channel><title>Feed</title>
    <item><title><![CDATA[Federal Reserve issues FOMC statement]]></title><link>https://www.federalreserve.gov/newsevents/a.htm</link><pubDate>Tue, 17 Nov 2026 14:00:00 GMT</pubDate></item>
    <item><title>Phishing &amp; friends</title><link>https://evil.example/x</link><pubDate>Tue, 17 Nov 2026 13:00:00 GMT</pubDate></item>
    <item><title>Insecure</title><link>http://www.federalreserve.gov/b.htm</link></item>
    <item><title>Script</title><link>javascript:alert(1)</link></item>
    <item><title>&lt;b&gt;Bold&lt;/b&gt; move &#8212; rates</title><link>https://www.federalreserve.gov/c.htm</link></item>
  </channel></rss>`;

  it('reads titles, links and dates, and keeps only https links on the feed’s own site', () => {
    const items = parseFeed(rss, ['federalreserve.gov']);
    expect(items.map((i) => i.link)).toEqual(['https://www.federalreserve.gov/newsevents/a.htm', 'https://www.federalreserve.gov/c.htm']);
    expect(items[0]).toMatchObject({ title: 'Federal Reserve issues FOMC statement', time: Date.UTC(2026, 10, 17, 14) });
    expect(items[1]!.time).toBeNull();
  });

  it('strips markup and decodes entities, so a headline is always plain text', () => {
    expect(decode('&lt;b&gt;Bold&lt;/b&gt; move &#8212; rates')).toBe('<b>Bold</b> move — rates');
    expect(decode('<script>alert(1)</script>Hello &amp; goodbye')).toBe('alert(1) Hello & goodbye');
    expect(decode('a &#0; b &#x1F600;')).toBe('a b 😀');
  });

  it('reads Atom entries too', () => {
    const atom = `<feed><entry><title>ECB decision</title><link href="https://www.ecb.europa.eu/press/x.html"/><updated>2026-11-17T12:00:00Z</updated></entry></feed>`;
    expect(parseFeed(atom, ['ecb.europa.eu'])).toEqual([{ title: 'ECB decision', link: 'https://www.ecb.europa.eu/press/x.html', time: Date.UTC(2026, 10, 17, 12) }]);
  });

  it('tags a headline with what it is about', () => {
    expect(subjects('Federal Reserve issues FOMC statement on interest rates')).toEqual(['stock:TLT']);
    expect(subjects('SEC charges firm over Bitcoin fund and Nvidia disclosures')).toEqual(['crypto:BTC', 'stock:NVDA']);
    expect(subjects('Board appoints new member')).toEqual([]);
  });
});
