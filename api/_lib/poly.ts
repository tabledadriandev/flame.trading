import { ProxyError } from './http.js';

// Polymarket's public APIs. Verified 17 November 2026 (docs/data-sources.md).
// Gamma is the catalogue; CLOB has books and price history. Neither sends
// CORS headers, so the browser reaches them through these functions.

export const GAMMA = 'https://gamma-api.polymarket.com';
export const CLOB = 'https://clob.polymarket.com';

/** Topic tabs and the Gamma tag each one maps to. 'trending' is every topic, ranked by 24-hour volume. */
export const TOPICS: Record<string, string | null> = {
  trending: null,
  politics: 'politics',
  economy: 'economy',
  fed: 'fed',
  stocks: 'stocks',
  earnings: 'earnings',
  crypto: 'crypto',
  tech: 'tech',
  finance: 'finance',
  world: 'world',
  sports: 'sports',
};

export function topic(raw: string | undefined): string {
  const t = (raw ?? 'trending').toLowerCase();
  if (!(t in TOPICS)) throw new ProxyError(400, 'bad_topic', `topic must be one of ${Object.keys(TOPICS).join(', ')}.`);
  return t;
}

/** A CLOB token id is a long decimal number and nothing else. */
export function tokenId(raw: string | undefined): string {
  const t = (raw ?? '').trim();
  if (!/^\d{10,90}$/.test(t)) throw new ProxyError(400, 'bad_token', 'That is not a market Flame can look up.');
  return t;
}

interface GammaMarket {
  id?: string;
  question?: string;
  groupItemTitle?: string | null;
  outcomes?: string;
  outcomePrices?: string;
  clobTokenIds?: string;
  bestBid?: number;
  bestAsk?: number;
  lastTradePrice?: number;
  oneWeekPriceChange?: number;
  oneDayPriceChange?: number;
  volume24hr?: number;
  endDate?: string;
  closed?: boolean;
  acceptingOrders?: boolean;
  umaResolutionStatus?: string | null;
}

export interface GammaEvent {
  id?: string;
  slug?: string;
  title?: string;
  endDate?: string;
  volume24hr?: number;
  volume?: number;
  markets?: GammaMarket[];
  tags?: { label?: string; slug?: string }[];
}

export interface OddsOutcome {
  name: string;
  /** Probability, 0–1. */
  price: number;
  token: string;
}

export interface OddsMarket {
  id: string;
  question: string;
  /** For events with many markets: the short name of this one ("25 bps cut"). */
  label: string | null;
  outcomes: OddsOutcome[];
  bestBid: number | null;
  bestAsk: number | null;
  weekChange: number | null;
  dayChange: number | null;
  volume24h: number;
  endDate: string | null;
  closed: boolean;
  /** True once the market has paid out: the outcome priced at 1 won. */
  resolved: boolean;
}

export interface OddsEvent {
  id: string;
  slug: string;
  title: string;
  endDate: string | null;
  volume24h: number;
  volume: number;
  topics: string[];
  markets: OddsMarket[];
  /** How many markets the event has in all; only the leading ones are sent. */
  marketCount: number;
}

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

function list(raw: string | undefined): string[] {
  if (typeof raw !== 'string') return [];
  try {
    const v: unknown = JSON.parse(raw);
    return Array.isArray(v) ? v.map((x) => String(x)) : [];
  } catch {
    return [];
  }
}

export function marketOf(m: GammaMarket): OddsMarket | null {
  const names = list(m.outcomes);
  const prices = list(m.outcomePrices).map(Number);
  const tokens = list(m.clobTokenIds);
  if (!m.id || !m.question || names.length < 2 || names.length !== prices.length || names.length !== tokens.length) return null;
  if (prices.some((p) => !Number.isFinite(p) || p < 0 || p > 1) || tokens.some((t) => !/^\d{10,90}$/.test(t))) return null;
  const closed = m.closed === true;
  return {
    id: String(m.id),
    question: m.question,
    label: m.groupItemTitle ? String(m.groupItemTitle) : null,
    outcomes: names.map((name, i) => ({ name, price: prices[i]!, token: tokens[i]! })),
    bestBid: num(m.bestBid),
    bestAsk: num(m.bestAsk),
    weekChange: num(m.oneWeekPriceChange),
    dayChange: num(m.oneDayPriceChange),
    volume24h: num(m.volume24hr) ?? 0,
    endDate: m.endDate ?? null,
    closed,
    resolved: closed && m.umaResolutionStatus === 'resolved',
  };
}

/** Keep an event's leading open markets: the ones the first outcome is most likely in, which is how a card reads. */
export function eventOf(e: GammaEvent, keep = 6): OddsEvent | null {
  if (!e.id || !e.title) return null;
  const all = (e.markets ?? []).map(marketOf).filter((m): m is OddsMarket => m !== null);
  const open = all.filter((m) => !m.closed);
  if (open.length === 0) return null;
  open.sort((a, b) => b.outcomes[0]!.price - a.outcomes[0]!.price || b.volume24h - a.volume24h);
  return {
    id: String(e.id),
    slug: e.slug ?? '',
    title: e.title,
    endDate: e.endDate ?? null,
    volume24h: num(e.volume24hr) ?? 0,
    volume: num(e.volume) ?? 0,
    topics: (e.tags ?? []).map((t) => t.label).filter((l): l is string => typeof l === 'string').slice(0, 4),
    markets: open.slice(0, keep),
    marketCount: open.length,
  };
}

export interface BookSide {
  price: number;
  size: number;
}

/** The CLOB lists bids lowest first and asks highest first; return both best first. */
export function bookOf(raw: { bids?: { price?: string; size?: string }[]; asks?: { price?: string; size?: string }[] }): { bids: BookSide[]; asks: BookSide[] } {
  const side = (rows: { price?: string; size?: string }[] | undefined, desc: boolean): BookSide[] =>
    (rows ?? [])
      .map((r) => ({ price: Number(r.price), size: Number(r.size) }))
      .filter((r) => Number.isFinite(r.price) && Number.isFinite(r.size) && r.size > 0 && r.price > 0 && r.price < 1)
      .sort((a, b) => (desc ? b.price - a.price : a.price - b.price));
  return { bids: side(raw.bids, true).slice(0, 15), asks: side(raw.asks, false).slice(0, 15) };
}
