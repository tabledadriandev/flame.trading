import { FeedError } from './types';

// Funding and open interest for perps, from Hyperliquid's public info API.
// Verified 17 November 2026: POST /info {"type":"metaAndAssetCtxs"} answers
// with CORS open, a list of 235 assets and one context each.

export interface PerpContext {
  coin: string;
  /** Funding paid by longs to shorts for one hour, as a fraction of notional (negative: shorts pay longs). */
  funding: number;
  /** Open interest in coins. */
  openInterest: number;
  markPx: number;
  oraclePx: number;
  dayVolumeUsd: number;
}

let cache: { at: number; byCoin: Map<string, PerpContext> } | null = null;
let inflight: Promise<Map<string, PerpContext>> | null = null;
const TTL = 30_000;

async function load(): Promise<Map<string, PerpContext>> {
  let res: Response;
  try {
    res = await fetch('https://api.hyperliquid.xyz/info', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'metaAndAssetCtxs' }),
      signal: AbortSignal.timeout(12_000),
    });
  } catch (err) {
    console.warn('[flame] Hyperliquid did not answer', err);
    throw new FeedError('Could not reach Hyperliquid for funding and open interest.', 'hyperliquid');
  }
  if (!res.ok) throw new FeedError(`Hyperliquid answered ${res.status}.`, 'hyperliquid', res.status);
  const data = (await res.json()) as [{ universe?: { name?: string }[] }, Record<string, string | undefined>[]];
  const universe = data?.[0]?.universe;
  const ctxs = data?.[1];
  if (!Array.isArray(universe) || !Array.isArray(ctxs)) throw new FeedError('Hyperliquid sent an answer Flame could not read.', 'hyperliquid');
  const byCoin = new Map<string, PerpContext>();
  universe.forEach((u, i) => {
    const c = ctxs[i];
    const funding = Number(c?.funding);
    if (!u.name || !c || !Number.isFinite(funding)) return;
    byCoin.set(u.name, { coin: u.name, funding, openInterest: Number(c.openInterest), markPx: Number(c.markPx), oraclePx: Number(c.oraclePx), dayVolumeUsd: Number(c.dayNtlVlm) });
  });
  cache = { at: Date.now(), byCoin };
  return byCoin;
}

/** The perp's funding and open interest; null when Hyperliquid does not list the coin. Throws when it cannot be reached. */
export async function perpContext(coin: string): Promise<PerpContext | null> {
  if (cache && Date.now() - cache.at < TTL) return cache.byCoin.get(coin) ?? null;
  inflight ??= load().finally(() => {
    inflight = null;
  });
  return (await inflight).get(coin) ?? null;
}
