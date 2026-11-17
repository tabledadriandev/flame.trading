import type { Quote } from '../engine/types';
import { poolFrom, type Pool } from '../engine/pool';
import { FeedError, tfMs, type BookSnapshot, type Candle, type CandleQuery, type FeedStatus, type Ticker, type Timeframe, type Unsubscribe, type VenueAdapter } from './types';

// On-chain tokens: pools, their candles and trades from GeckoTerminal, both
// reserves from DexScreener, and a contract risk report from RugCheck (Solana
// only). None needs a key and all three answer a browser directly (verified
// 17 November 2026), so nothing here goes through /api: each visitor uses
// their own allowance, which is what the sources' limits are written for.

const GECKO = 'https://api.geckoterminal.com/api/v2';
const DEXSCREENER = 'https://api.dexscreener.com';
const RUGCHECK = 'https://api.rugcheck.xyz/v1';
const TIMEOUT = 12_000;

export type Chain = 'solana' | 'base' | 'bsc' | 'eth';

export const CHAINS: { id: Chain; name: string; dexscreener: string }[] = [
  { id: 'solana', name: 'Solana', dexscreener: 'solana' },
  { id: 'base', name: 'Base', dexscreener: 'base' },
  { id: 'bsc', name: 'BSC', dexscreener: 'bsc' },
  { id: 'eth', name: 'Ethereum', dexscreener: 'ethereum' },
];

export const chainName = (c: string): string => CHAINS.find((x) => x.id === c)?.name ?? c;
export const dexId = (chain: Chain, address: string): string => `dex:${chain}:${address}`;

export function parseDexId(id: string): { chain: Chain; address: string } | null {
  const m = /^dex:(solana|base|bsc|eth):([A-Za-z0-9]{20,80})$/.exec(id);
  return m ? { chain: m[1] as Chain, address: m[2]! } : null;
}

export interface PoolInfo {
  id: string;
  chain: Chain;
  address: string;
  symbol: string;
  name: string;
  quoteSymbol: string;
  /** The token's own address (its mint, on Solana). */
  token: string;
  dex: string;
  /** Dollars per token. */
  price: number;
  /** Both sides of the pool, in dollars. */
  liquidity: number;
  marketCap: number | null;
  createdAt: number | null;
  /** Percent. */
  change: { m5: number | null; h1: number | null; h24: number | null };
  trades24h: number;
  buys24h: number;
  sells24h: number;
  volume24h: number;
  /** The pool's fee as a share of each trade, where GeckoTerminal publishes it. */
  fee: number | null;
  /** Share of the liquidity that is locked, in percent, where known. */
  lockedPct: number | null;
  t: number;
}

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const n = (v: unknown): number | null => {
  const x = typeof v === 'string' && v !== '' ? Number(v) : typeof v === 'number' ? v : NaN;
  return Number.isFinite(x) ? x : null;
};

/** Read one GeckoTerminal pool. Null when it has no usable price: such a pool is left out, not guessed at. */
export function poolFromGecko(chain: Chain, data: unknown, included: unknown, now: number): PoolInfo | null {
  if (!isObj(data) || !isObj(data.attributes)) return null;
  const a = data.attributes;
  const address = typeof a.address === 'string' ? a.address : '';
  const price = n(a.base_token_price_usd);
  if (!parseDexId(`dex:${chain}:${address}`) || price === null || !(price > 0)) return null;
  const [base = '', quote = ''] = (typeof a.name === 'string' ? a.name : '').split(' / ');
  const rel = isObj(data.relationships) ? data.relationships : {};
  const ref = (key: string): string => {
    const r = rel[key];
    return isObj(r) && isObj(r.data) && typeof r.data.id === 'string' ? r.data.id : '';
  };
  const tokenRef = ref('base_token');
  const token = Array.isArray(included) ? included.find((i) => isObj(i) && i.id === tokenRef) : undefined;
  const tokenAttrs = isObj(token) && isObj(token.attributes) ? token.attributes : {};
  const change = isObj(a.price_change_percentage) ? a.price_change_percentage : {};
  const tx = isObj(a.transactions) && isObj(a.transactions.h24) ? a.transactions.h24 : {};
  const vol = isObj(a.volume_usd) ? a.volume_usd : {};
  const created = typeof a.pool_created_at === 'string' ? Date.parse(a.pool_created_at) : NaN;
  const fee = n(a.pool_fee_percentage);
  const buys = n(tx.buys) ?? 0;
  const sells = n(tx.sells) ?? 0;
  return {
    id: dexId(chain, address),
    chain,
    address,
    symbol: (typeof tokenAttrs.symbol === 'string' && tokenAttrs.symbol) || base.trim() || 'Token',
    name: (typeof tokenAttrs.name === 'string' && tokenAttrs.name) || base.trim() || 'Token',
    quoteSymbol: quote.trim().replace(/\s+\d.*$/, ''),
    token: tokenRef.slice(tokenRef.indexOf('_') + 1),
    dex: ref('dex'),
    price,
    liquidity: n(a.reserve_in_usd) ?? 0,
    marketCap: n(a.market_cap_usd) ?? n(a.fdv_usd),
    createdAt: Number.isFinite(created) ? created : null,
    change: { m5: n(change.m5), h1: n(change.h1), h24: n(change.h24) },
    trades24h: buys + sells,
    buys24h: buys,
    sells24h: sells,
    volume24h: n(vol.h24) ?? 0,
    fee: fee !== null && fee >= 0 && fee < 100 ? fee / 100 : null,
    lockedPct: n(a.locked_liquidity_percentage),
    t: now,
  };
}

// ---------- Requests: one allowance, shared and cached ----------

/** GeckoTerminal allows 30 calls a minute from one address. Flame keeps under it and says so when it cannot. */
const GECKO_PER_MINUTE = 24;
let geckoCalls: number[] = [];
const cache = new Map<string, { t: number; body: unknown }>();
const inflight = new Map<string, Promise<unknown>>();

async function getJson(url: string, source: string, maxAge: number): Promise<unknown> {
  const hit = cache.get(url);
  if (hit && Date.now() - hit.t < maxAge) return hit.body;
  const running = inflight.get(url);
  if (running) return running;
  if (source === 'GeckoTerminal') {
    const now = Date.now();
    geckoCalls = geckoCalls.filter((t) => now - t < 60_000);
    if (geckoCalls.length >= GECKO_PER_MINUTE) {
      // Rather than fail, show what was read last if there is anything.
      if (hit) return hit.body;
      throw new FeedError('GeckoTerminal allows 30 requests a minute and Flame has used them. Wait a moment and try again.', source, 429);
    }
    geckoCalls.push(now);
  }
  const run = (async () => {
    let r: Response;
    try {
      r = await fetch(url, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(TIMEOUT) });
    } catch (err) {
      const timedOut = err instanceof Error && (err.name === 'TimeoutError' || err.name === 'AbortError');
      throw new FeedError(`${source} ${timedOut ? 'took too long to answer' : 'could not be reached'}.`, source);
    }
    if (r.status === 429) throw new FeedError(`${source} is asking Flame to slow down. Try again in a minute.`, source, 429);
    if (r.status === 404) throw new FeedError(`${source} does not know that pool.`, source, 404);
    if (!r.ok) throw new FeedError(`${source} answered with an error (${r.status}).`, source, r.status);
    const body: unknown = await r.json().catch(() => {
      throw new FeedError(`${source} sent an answer Flame could not read.`, source);
    });
    cache.set(url, { t: Date.now(), body });
    if (cache.size > 200) cache.delete(cache.keys().next().value as string);
    return body;
  })();
  inflight.set(url, run);
  try {
    return await run;
  } finally {
    inflight.delete(url);
  }
}

export type PoolList = 'new' | 'trending' | 'volume';

const LIST_PATH: Record<PoolList, string> = {
  new: 'new_pools?page=1&include=base_token',
  trending: 'trending_pools?page=1&include=base_token',
  volume: 'pools?page=1&sort=h24_volume_usd_desc&include=base_token',
};

function poolsFrom(chain: Chain, body: unknown): PoolInfo[] {
  if (!isObj(body) || !Array.isArray(body.data)) throw new FeedError('GeckoTerminal sent a list Flame could not read.', 'GeckoTerminal');
  const now = Date.now();
  const out: PoolInfo[] = [];
  for (const d of body.data) {
    const p = poolFromGecko(chain, d, body.included, now);
    if (p) {
      out.push(p);
      remember(p);
    }
  }
  return out;
}

export async function listPools(chain: Chain, list: PoolList, page = 1): Promise<PoolInfo[]> {
  const path = LIST_PATH[list].replace('page=1', `page=${page}`);
  return poolsFrom(chain, await getJson(`${GECKO}/networks/${chain}/${path}`, 'GeckoTerminal', 30_000));
}

export async function fetchPool(chain: Chain, address: string): Promise<PoolInfo> {
  const body = await getJson(`${GECKO}/networks/${chain}/pools/${address}?include=base_token`, 'GeckoTerminal', 15_000);
  const p = isObj(body) ? poolFromGecko(chain, body.data, body.included, Date.now()) : null;
  if (!p) throw new FeedError('GeckoTerminal has no usable price for this pool.', 'GeckoTerminal');
  remember(p);
  return p;
}

const GECKO_TF: Record<Timeframe, { unit: 'minute' | 'hour' | 'day'; aggregate: number } | null> = {
  '1m': { unit: 'minute', aggregate: 1 },
  '5m': { unit: 'minute', aggregate: 5 },
  '15m': { unit: 'minute', aggregate: 15 },
  '1h': { unit: 'hour', aggregate: 1 },
  '4h': { unit: 'hour', aggregate: 4 },
  '1d': { unit: 'day', aggregate: 1 },
  '1w': null,
};

/** GeckoTerminal sends candles newest first as [seconds, open, high, low, close, volume in dollars]. */
export function candlesFromGecko(body: unknown): Candle[] {
  const list = isObj(body) && isObj(body.data) && isObj(body.data.attributes) ? body.data.attributes.ohlcv_list : null;
  if (!Array.isArray(list)) throw new FeedError('GeckoTerminal sent candles Flame could not read.', 'GeckoTerminal');
  const out: Candle[] = [];
  for (const row of list) {
    if (!Array.isArray(row) || row.length < 6) continue;
    const [t, o, h, l, c, v] = row.map((x) => n(x)) as (number | null)[];
    if (t == null || o == null || h == null || l == null || c == null || !(c > 0)) continue;
    out.push({ t: t * 1000, o, h, l, c, v: v ?? 0 });
  }
  return out.sort((a, b) => a.t - b.t);
}

export async function poolCandles(chain: Chain, address: string, tf: Timeframe, query: CandleQuery = {}): Promise<Candle[]> {
  const g = GECKO_TF[tf];
  if (!g) throw new FeedError('Pool charts go up to daily bars.', 'GeckoTerminal');
  const params = new URLSearchParams({ aggregate: String(g.aggregate), limit: String(Math.min(1000, query.limit ?? 300)), currency: 'usd' });
  if (query.before !== undefined) params.set('before_timestamp', String(Math.floor(query.before / 1000)));
  const bars = candlesFromGecko(await getJson(`${GECKO}/networks/${chain}/pools/${address}/ohlcv/${g.unit}?${params.toString()}`, 'GeckoTerminal', Math.min(20_000, tfMs(tf) / 2)));
  return query.from !== undefined ? bars.filter((b) => b.t >= query.from!) : bars;
}

export interface PoolTradeRow {
  t: number;
  side: 'buy' | 'sell';
  /** Dollars. */
  size: number;
  price: number;
}

/** The largest recent trades in a pool. */
export async function poolTrades(chain: Chain, address: string): Promise<PoolTradeRow[]> {
  const body = await getJson(`${GECKO}/networks/${chain}/pools/${address}/trades`, 'GeckoTerminal', 30_000);
  if (!isObj(body) || !Array.isArray(body.data)) throw new FeedError('GeckoTerminal sent trades Flame could not read.', 'GeckoTerminal');
  const rows: PoolTradeRow[] = [];
  for (const d of body.data) {
    const a = isObj(d) && isObj(d.attributes) ? d.attributes : null;
    if (!a || (a.kind !== 'buy' && a.kind !== 'sell')) continue;
    const size = n(a.volume_in_usd);
    const price = n(a.kind === 'buy' ? a.price_to_in_usd : a.price_from_in_usd);
    const t = typeof a.block_timestamp === 'string' ? Date.parse(a.block_timestamp) : NaN;
    if (size === null || price === null || !Number.isFinite(t)) continue;
    rows.push({ t, side: a.kind, size, price });
  }
  return rows.sort((x, y) => y.size - x.size).slice(0, 12);
}

export interface Reserves {
  /** Tokens in the pool. */
  base: number;
  /** The other asset in the pool, in its own units. */
  quote: number;
  usd: number;
  /** DexScreener's labels for the pool type (v2, v3, DLMM and so on). */
  labels: string[];
}

/** Both sides of the pool, from DexScreener. Null when it does not list the pair. */
export async function poolReserves(chain: Chain, address: string): Promise<Reserves | null> {
  const ds = CHAINS.find((c) => c.id === chain)!.dexscreener;
  const body = await getJson(`${DEXSCREENER}/latest/dex/pairs/${ds}/${address}`, 'DexScreener', 30_000);
  const pair = isObj(body) && isObj(body.pair) ? body.pair : null;
  const liq = pair && isObj(pair.liquidity) ? pair.liquidity : null;
  const base = liq ? n(liq.base) : null;
  const quote = liq ? n(liq.quote) : null;
  const usd = liq ? n(liq.usd) : null;
  if (base === null || quote === null || usd === null) return null;
  return { base, quote, usd, labels: Array.isArray(pair!.labels) ? pair!.labels.filter((l): l is string => typeof l === 'string') : [] };
}

export interface RiskItem {
  name: string;
  detail: string;
  level: 'warn' | 'danger';
}

export interface RiskReport {
  /** 0 to 100; higher is riskier. */
  score: number;
  items: RiskItem[];
  lockedPct: number | null;
  /** Set when the report says holders can be stopped from selling. */
  sellBlocked: string | null;
  /** A tax taken out of every transfer, as a share, when the report gives one. */
  sellTax: number | null;
}

/** Read RugCheck's summary for a Solana token. */
export function riskFromRugcheck(body: unknown): RiskReport | null {
  if (!isObj(body) || !Array.isArray(body.risks)) return null;
  const items: RiskItem[] = [];
  let sellBlocked: string | null = null;
  let sellTax: number | null = null;
  for (const r of body.risks) {
    if (!isObj(r) || typeof r.name !== 'string') continue;
    const detail = [typeof r.description === 'string' ? r.description : '', typeof r.value === 'string' && r.value ? `(${r.value})` : ''].filter(Boolean).join(' ');
    items.push({ name: r.name, detail, level: r.level === 'danger' ? 'danger' : 'warn' });
    if (/freez/i.test(r.name)) sellBlocked = 'RugCheck reports that this token can be frozen in holders’ accounts. A frozen account cannot sell.';
    if (/transfer fee|tax/i.test(r.name)) {
      const pct = typeof r.value === 'string' ? Number(r.value.replace(/[^0-9.]/g, '')) : NaN;
      if (Number.isFinite(pct) && pct > 0 && pct < 100) sellTax = pct / 100;
    }
  }
  return { score: n(body.score_normalised) ?? 0, items, lockedPct: n(body.lpLockedPct), sellBlocked, sellTax };
}

const risks = new Map<string, RiskReport | null>();

/** The contract risk report for a pool's token. Null where there is no source: every chain but Solana. */
export async function riskReport(pool: Pick<PoolInfo, 'chain' | 'token' | 'id'>): Promise<RiskReport | null> {
  if (pool.chain !== 'solana' || !pool.token) return null;
  const body = await getJson(`${RUGCHECK}/tokens/${pool.token}/report/summary`, 'RugCheck', 300_000);
  const report = riskFromRugcheck(body);
  risks.set(pool.id, report);
  return report;
}

export const knownRisk = (id: string): RiskReport | null | undefined => risks.get(id);

/** Flame's own read of a pool from its numbers alone. Not a contract audit: it says so wherever it is shown. */
export function poolRead(p: PoolInfo, now: number): { level: 'high' | 'medium' | 'lower'; reasons: string[] } {
  const reasons: string[] = [];
  let points = 0;
  const hours = p.createdAt !== null ? (now - p.createdAt) / 3_600_000 : null;
  if (p.liquidity < 5_000) {
    points += 3;
    reasons.push('almost nothing in the pool');
  } else if (p.liquidity < 50_000) {
    points += 1;
    reasons.push('a thin pool');
  }
  if (hours !== null && hours < 24) {
    points += 2;
    reasons.push(hours < 1 ? 'less than an hour old' : 'less than a day old');
  } else if (hours !== null && hours < 24 * 7) {
    points += 1;
    reasons.push('less than a week old');
  }
  if (p.marketCap !== null && p.liquidity > 0 && p.marketCap / p.liquidity > 100) {
    points += 1;
    reasons.push('valued at over 100 times what the pool holds');
  }
  if (p.change.h24 !== null && p.change.h24 <= -70) {
    points += 2;
    reasons.push('down 70% or more today');
  }
  if (p.trades24h > 20 && p.sells24h < p.buys24h * 0.1) {
    points += 2;
    reasons.push('almost nobody has sold: check that selling works');
  }
  if (reasons.length === 0) reasons.push('an older pool with real liquidity');
  return { level: points >= 3 ? 'high' : points >= 1 ? 'medium' : 'lower', reasons };
}

/** Why a pool belongs under "Drained", or null. */
export function drainedWhy(p: PoolInfo): string | null {
  if (p.liquidity < 1_000 && p.volume24h > 5_000) return 'The liquidity is gone';
  if (p.change.h24 !== null && p.change.h24 <= -90) return `Down ${Math.abs(Math.round(p.change.h24))}% today`;
  return null;
}

// ---------- The adapter: a pool as an instrument ----------

const pools = new Map<string, PoolInfo>();
const onKnown = new Set<(p: PoolInfo) => void>();

function remember(p: PoolInfo): void {
  pools.set(p.id, p);
  for (const cb of onKnown) cb(p);
}

/** Hear about every pool as it is read, so its name can be kept for the journal. */
export function onPool(cb: (p: PoolInfo) => void): Unsubscribe {
  onKnown.add(cb);
  return () => onKnown.delete(cb);
}

export const knownPool = (id: string): PoolInfo | undefined => pools.get(id);

/** How old a pool reading may be and still be traded against. */
const FRESH = 60_000;
/** Used only where GeckoTerminal does not publish the pool's fee; the pane says it is assumed. */
export const ASSUMED_FEE = 0.003;
const POLL = 20_000;

export function enginePool(p: PoolInfo): Pool | null {
  return poolFrom(p.liquidity, p.price, p.fee ?? ASSUMED_FEE);
}

/** What an order on a pool fills against. Undefined when the pool has not been read recently. */
export function dexQuote(id: string, now = Date.now()): Quote | undefined {
  const p = pools.get(id);
  if (!p || now - p.t > FRESH) return undefined;
  const pool = enginePool(p);
  const risk = risks.get(id);
  return {
    bid: p.price,
    ask: p.price,
    last: p.price,
    t: now,
    ...(pool ? { pool } : {}),
    ...(risk?.sellBlocked ? { sellBlocked: risk.sellBlocked } : {}),
    ...(risk?.sellTax ? { sellTax: risk.sellTax } : {}),
  };
}

class DexAdapter implements VenueAdapter {
  readonly id = 'dex';
  readonly kind = 'delayed' as const;
  readonly hasBook = false;
  private state: FeedStatus = 'connecting';
  private listeners = new Set<(s: FeedStatus) => void>();

  status(): FeedStatus {
    return this.state;
  }

  onStatus(cb: (s: FeedStatus) => void): Unsubscribe {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  private setState(s: FeedStatus): void {
    if (s === this.state) return;
    this.state = s;
    for (const cb of this.listeners) cb(s);
  }

  private where(symbol: string): { chain: Chain; address: string } {
    const at = parseDexId(`dex:${symbol}`);
    if (!at) throw new FeedError('That is not a pool Flame can read.', 'GeckoTerminal');
    return at;
  }

  quote(symbol: string): Quote | undefined {
    return dexQuote(`dex:${symbol}`);
  }

  async candles(symbol: string, tf: Timeframe, query?: CandleQuery): Promise<Candle[]> {
    const { chain, address } = this.where(symbol);
    return poolCandles(chain, address, tf, query);
  }

  subscribeCandles(symbol: string, tf: Timeframe, on: (c: Candle) => void): Unsubscribe {
    const { chain, address } = this.where(symbol);
    const poll = () =>
      poolCandles(chain, address, tf, { limit: 3 })
        .then((bars) => bars.forEach(on))
        .catch((err: unknown) => console.warn(`[flame] pool candles for ${symbol} could not be refreshed`, err));
    const timer = setInterval(() => void poll(), Math.max(POLL, Math.min(60_000, tfMs(tf) / 2)));
    return () => clearInterval(timer);
  }

  subscribeTrades(): Unsubscribe {
    return () => {};
  }

  subscribeBook(_s: string, _on: (b: BookSnapshot) => void, onProblem?: (m: string | null) => void): Unsubscribe {
    onProblem?.('A token has no order book: it trades against its pool.');
    return () => {};
  }

  subscribeTicker(symbol: string, on: (t: Ticker) => void): Unsubscribe {
    const { chain, address } = this.where(symbol);
    let failures = 0;
    const poll = () =>
      fetchPool(chain, address)
        .then((p) => {
          failures = 0;
          this.setState('live');
          on({ last: p.price, changePct: p.change.h24 ?? NaN, t: p.t });
        })
        .catch((err: unknown) => {
          failures += 1;
          console.warn(`[flame] pool ${symbol} could not be refreshed`, err);
          this.setState(failures >= 3 ? 'down' : 'reconnecting');
        });
    void poll();
    const timer = setInterval(() => void poll(), POLL);
    return () => clearInterval(timer);
  }
}

export const dex = new DexAdapter();
