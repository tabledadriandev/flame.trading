import { afterEach, describe, expect, it, vi } from 'vitest';
import { CLIENT_PER_MINUTE, Limiter, fetchText, gate, type VercelRequest } from './http.js';

const req = (over: Partial<VercelRequest> = {}): VercelRequest => ({ method: 'GET', query: {}, headers: { 'x-real-ip': '203.0.113.7' }, ...over });

describe('proxy gate', () => {
  it('lets an ordinary request through', () => {
    expect(gate(req({ query: { symbol: 'SPY' } }), ['symbol'], new Limiter())).toBeNull();
  });

  it('answers GET and HEAD only', () => {
    expect(gate(req({ method: 'POST' }), [], new Limiter())).toMatchObject({ status: 405 });
    expect(gate(req({ method: 'HEAD' }), [], new Limiter())).toBeNull();
  });

  it('refuses a parameter the endpoint does not define, so the cache cannot be sidestepped', () => {
    expect(gate(req({ query: { symbol: 'SPY', cachebust: '123' } }), ['symbol'], new Limiter())).toMatchObject({ status: 400, code: 'unknown_parameter' });
    expect(gate(req({ query: { zz: '1' } }), [], new Limiter())).toMatchObject({ status: 400 });
  });

  it("refuses another site's page, and allows Flame's own", () => {
    expect(gate(req({ headers: { 'sec-fetch-site': 'cross-site' } }), [], new Limiter())).toMatchObject({ status: 403, code: 'cross_site' });
    expect(gate(req({ headers: { 'sec-fetch-site': 'same-origin' } }), [], new Limiter())).toBeNull();
  });

  it('limits how often one address may call, and frees it after a minute', () => {
    const limiter = new Limiter();
    const t0 = 1_000_000;
    for (let i = 0; i < CLIENT_PER_MINUTE; i++) expect(gate(req(), [], limiter, t0 + i)).toBeNull();
    expect(gate(req(), [], limiter, t0 + 500)).toMatchObject({ status: 429, code: 'slow_down' });
    // Someone else is not affected.
    expect(gate(req({ headers: { 'x-real-ip': '198.51.100.9' } }), [], limiter, t0 + 500)).toBeNull();
    expect(gate(req(), [], limiter, t0 + 61_000)).toBeNull();
  });
});

describe('limiter', () => {
  it('counts within a sliding window per key', () => {
    const l = new Limiter(1_000);
    expect(l.take('a', 2, 0)).toBe(true);
    expect(l.take('a', 2, 10)).toBe(true);
    expect(l.take('a', 2, 20)).toBe(false);
    expect(l.take('b', 2, 20)).toBe(true);
    expect(l.take('a', 2, 1_011)).toBe(true);
  });
});

describe('upstream read', () => {
  const answer = (body: BodyInit, headers: Record<string, string> = {}) => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(body, { status: 200, headers })));
  };
  afterEach(() => vi.unstubAllGlobals());

  it('returns a body within the limit', async () => {
    answer('{"ok":true}');
    expect(await fetchText({ name: 'Test A', url: 'https://example.com/a', maxBytes: 64 })).toBe('{"ok":true}');
  });

  it('refuses a body that declares more than the limit', async () => {
    answer('x'.repeat(200), { 'content-length': '200' });
    await expect(fetchText({ name: 'Test B', url: 'https://example.com/b', maxBytes: 64 })).rejects.toMatchObject({ status: 502, code: 'upstream_too_large' });
  });

  it('stops reading a body that runs past the limit without declaring it', async () => {
    let pulled = 0;
    const stream = new ReadableStream<Uint8Array>({
      pull(c) {
        pulled += 1;
        c.enqueue(new Uint8Array(40));
      },
    });
    answer(stream);
    await expect(fetchText({ name: 'Test C', url: 'https://example.com/c', maxBytes: 100 })).rejects.toMatchObject({ code: 'upstream_too_large' });
    expect(pulled).toBeLessThan(10);
  });
});
