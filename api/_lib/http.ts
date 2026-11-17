// The two shapes Vercel hands a Node function. Declared here so the project
// does not carry the whole @vercel/node package for the sake of its types.
export interface VercelRequest {
  method?: string;
  query: Record<string, string | string[] | undefined>;
  headers: Record<string, string | string[] | undefined>;
}

export interface VercelResponse {
  setHeader(name: string, value: string): void;
  status(code: number): VercelResponse;
  json(body: unknown): void;
}

// Shared plumbing for the data proxies. Every proxy:
//  - answers GET only
//  - builds its upstream URL from a fixed host and validated, encoded parameters
//    (a caller can never choose the host, so the proxy cannot be used to reach
//    anything else)
//  - refuses parameters it does not define, so the edge cache cannot be
//    sidestepped by adding a made-up one
//  - limits how often one address may call it, and how often it may call its
//    upstream, so the proxy cannot be used to burn a data key's quota
//  - gives up after a timeout, and stops reading a response that is too large
//  - returns failures as small JSON objects, never a stack trace

export class ProxyError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    /** The status the upstream source answered with, when it answered. */
    readonly upstreamStatus?: number,
  ) {
    super(message);
  }
}

export function fail(res: VercelResponse, status: number, code: string, message: string): void {
  res.setHeader('Cache-Control', 'no-store');
  res.status(status).json({ error: code, message });
}

/** One string query parameter, or undefined. Repeated parameters are refused rather than guessed at. */
export function param(req: VercelRequest, name: string): string | undefined {
  const v = req.query[name];
  if (v === undefined) return undefined;
  if (Array.isArray(v)) throw new ProxyError(400, 'bad_request', `Send "${name}" once.`);
  return v;
}

/** A plain, honest client name. Sources that insist on a browser string get one from their own module. */
const UA = 'Mozilla/5.0 (compatible; MarketDataProxy/1.0)';

export interface Upstream {
  /** Shown in error messages: "Yahoo Finance". */
  name: string;
  url: string;
  timeoutMs?: number;
  accept?: string;
  userAgent?: string;
  /** Extra request headers, such as a data key. Never logged. */
  headers?: Record<string, string>;
  /** Upstream calls allowed per minute from this instance. */
  perMinute?: number;
  /** Largest response to accept, in bytes. */
  maxBytes?: number;
}

/** Counts events in a sliding minute. One per function instance: a floor under abuse, not a global guarantee. */
export class Limiter {
  private hits = new Map<string, number[]>();

  constructor(private readonly windowMs = 60_000) {}

  /** Record one event for `key`. False when that would exceed `max` in the window. */
  take(key: string, max: number, now: number = Date.now()): boolean {
    const since = now - this.windowMs;
    const list = (this.hits.get(key) ?? []).filter((t) => t > since);
    if (list.length >= max) {
      this.hits.set(key, list);
      return false;
    }
    list.push(now);
    this.hits.set(key, list);
    // Keep the table from growing without bound under a flood of distinct keys.
    if (this.hits.size > 5_000) for (const [k, v] of this.hits) if (!v.some((t) => t > since)) this.hits.delete(k);
    return true;
  }
}

const upstreamBudget = new Limiter();
const clientBudget = new Limiter();
/** Requests one address may make to one function per minute. A browser using Flame makes about ten. */
export const CLIENT_PER_MINUTE = 90;

/** Read a response body, giving up once it passes `max` bytes. */
async function readCapped(r: Response, max: number, name: string): Promise<string> {
  const declared = Number(r.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > max) throw new ProxyError(502, 'upstream_too_large', `${name} sent more than Flame will read.`);
  if (!r.body) return r.text();
  const reader = r.body.getReader();
  const decoder = new TextDecoder();
  let out = '';
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > max) {
      await reader.cancel();
      throw new ProxyError(502, 'upstream_too_large', `${name} sent more than Flame will read.`);
    }
    out += decoder.decode(value, { stream: true });
  }
  return out + decoder.decode();
}

/** GET an upstream URL and return its body as text. Throws ProxyError with a status fit to pass on. */
export async function fetchText(up: Upstream): Promise<string> {
  if (!upstreamBudget.take(up.name, up.perMinute ?? 120)) {
    throw new ProxyError(503, 'busy', `Flame is asking ${up.name} for a lot right now. Try again in a minute.`);
  }
  let r: Response;
  try {
    r = await fetch(up.url, {
      headers: { 'User-Agent': up.userAgent ?? UA, Accept: up.accept ?? 'application/json', 'Accept-Language': 'en-US,en;q=0.9', ...(up.headers ?? {}) },
      signal: AbortSignal.timeout(up.timeoutMs ?? 8_000),
      redirect: 'error',
    });
  } catch (err) {
    const timedOut = err instanceof Error && (err.name === 'TimeoutError' || err.name === 'AbortError');
    console.error(`[proxy] ${up.name} ${timedOut ? 'timed out' : 'could not be reached'}`, err);
    throw new ProxyError(timedOut ? 504 : 502, timedOut ? 'upstream_timeout' : 'upstream_unreachable', `${up.name} ${timedOut ? 'took too long to answer' : 'could not be reached'}.`);
  }
  if (r.status === 404) throw new ProxyError(404, 'not_found', `${up.name} does not know that symbol.`, 404);
  if (r.status === 429) throw new ProxyError(503, 'upstream_rate_limited', `${up.name} is refusing requests from Flame's server right now.`, 429);
  if (r.status === 401) {
    console.error(`[proxy] ${up.name} refused the data key (401)`);
    throw new ProxyError(502, 'upstream_auth', `${up.name} did not accept Flame's data key.`, 401);
  }
  if (!r.ok) {
    console.error(`[proxy] ${up.name} answered ${r.status}`);
    throw new ProxyError(502, 'upstream_error', `${up.name} answered with an error (${r.status}).`, r.status);
  }
  return readCapped(r, up.maxBytes ?? 4_000_000, up.name);
}

export async function fetchJson<T>(up: Upstream): Promise<T> {
  const text = await fetchText(up);
  try {
    return JSON.parse(text) as T;
  } catch {
    console.error(`[proxy] ${up.name} sent something that is not JSON`);
    throw new ProxyError(502, 'upstream_unreadable', `${up.name} sent an answer Flame could not read.`);
  }
}

type Handler = (req: VercelRequest, res: VercelResponse) => Promise<void>;

const header = (req: VercelRequest, name: string): string | undefined => {
  const v = req.headers[name];
  return Array.isArray(v) ? v[0] : v;
};

/** Why a request is refused before the handler runs, or null if it may proceed. */
export function gate(req: VercelRequest, allowed: readonly string[], limiter: Limiter = clientBudget, now: number = Date.now()): ProxyError | null {
  if (req.method !== 'GET' && req.method !== 'HEAD') return new ProxyError(405, 'method_not_allowed', 'This endpoint answers GET only.');
  // A made-up parameter would give the same answer under a new cache key, and so reach the upstream every time.
  const extra = Object.keys(req.query).filter((k) => !allowed.includes(k));
  if (extra.length) return new ProxyError(400, 'unknown_parameter', `This endpoint does not take "${extra[0]!.slice(0, 30)}".`);
  // Browsers say where a request comes from. Another site's page may not use Flame's proxies.
  if (header(req, 'sec-fetch-site') === 'cross-site') return new ProxyError(403, 'cross_site', 'Flame\'s data service is for flame.trading only.');
  const who = (header(req, 'x-real-ip') ?? header(req, 'x-forwarded-for') ?? 'unknown').split(',')[0]!.trim();
  if (!limiter.take(who, CLIENT_PER_MINUTE, now)) return new ProxyError(429, 'slow_down', 'Too many requests. Wait a minute and try again.');
  return null;
}

/** Wrap a proxy: GET only, known parameters only, rate-limited, and every failure becomes a clean JSON error. */
export function proxy(allowed: readonly string[], handler: Handler) {
  return async (req: VercelRequest, res: VercelResponse): Promise<void> => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    const refused = gate(req, allowed);
    if (refused) {
      if (refused.status === 405) res.setHeader('Allow', 'GET, HEAD');
      if (refused.status === 429) res.setHeader('Retry-After', '60');
      fail(res, refused.status, refused.code, refused.message);
      return;
    }
    try {
      await handler(req, res);
    } catch (err) {
      if (err instanceof ProxyError) {
        if (err.status === 503 || err.status === 429) res.setHeader('Retry-After', '60');
        fail(res, err.status, err.code, err.message);
      }
      else {
        console.error('[proxy] unexpected failure', err);
        fail(res, 500, 'internal', 'Something went wrong on Flame\'s server.');
      }
    }
  };
}

export function cache(res: VercelResponse, seconds: number, stale: number): void {
  res.setHeader('Cache-Control', `public, max-age=0, s-maxage=${seconds}, stale-while-revalidate=${stale}`);
}
