import type { VercelRequest, VercelResponse } from '@vercel/node';

// Shared plumbing for the data proxies. Every proxy:
//  - answers GET only
//  - builds its upstream URL from a fixed host and validated, encoded parameters
//    (a caller can never choose the host, so the proxy cannot be used to reach
//    anything else)
//  - gives up after a timeout
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
}

/** GET an upstream URL and return its body as text. Throws ProxyError with a status fit to pass on. */
export async function fetchText(up: Upstream): Promise<string> {
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
  return r.text();
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

/** Wrap a proxy: GET only, and every failure becomes a clean JSON error. */
export function proxy(handler: Handler) {
  return async (req: VercelRequest, res: VercelResponse): Promise<void> => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.setHeader('Allow', 'GET, HEAD');
      fail(res, 405, 'method_not_allowed', 'This endpoint answers GET only.');
      return;
    }
    try {
      await handler(req, res);
    } catch (err) {
      if (err instanceof ProxyError) fail(res, err.status, err.code, err.message);
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
