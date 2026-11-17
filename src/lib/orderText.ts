import type { OrderType, Side } from '../engine/types';

// "buy 0.1 btc limit 63000" → an order the ticket can load. Pure, so the
// grammar is pinned by tests.

export interface TypedOrder {
  side: Side;
  /** 'lev' when the text says long or short. */
  mode: 'spot' | 'lev';
  symbol: string;
  type: OrderType;
  /** One of these is set. */
  qty?: number;
  dollars?: number;
  price?: number;
}

const SIDES: Record<string, { side: Side; mode: 'spot' | 'lev' }> = {
  buy: { side: 'buy', mode: 'spot' },
  sell: { side: 'sell', mode: 'spot' },
  long: { side: 'buy', mode: 'lev' },
  short: { side: 'sell', mode: 'lev' },
};

const num = (s: string): number => {
  const m = /^\$?(\d[\d,]*\.?\d*|\.\d+)([km]?)$/i.exec(s);
  if (!m) return NaN;
  const mult = m[2]?.toLowerCase() === 'k' ? 1e3 : m[2]?.toLowerCase() === 'm' ? 1e6 : 1;
  return parseFloat(m[1]!.replace(/,/g, '')) * mult;
};

/**
 * Grammar: <buy|sell|long|short> <size | $dollars> <symbol> [market | limit <price> | stop <price> | at <price>]
 * Returns null when the text is not an order.
 */
export function parseOrderText(text: string): TypedOrder | null {
  const words = text.trim().toLowerCase().split(/\s+/);
  const head = SIDES[words[0] ?? ''];
  if (!head || words.length < 3) return null;
  const sizeWord = words[1]!;
  const size = num(sizeWord);
  if (!(size > 0)) return null;
  const symbol = words[2]!.toUpperCase();
  if (!/^[A-Z][A-Z0-9.^=-]{0,11}$/.test(symbol)) return null;

  const out: TypedOrder = { ...head, symbol, type: 'market', ...(sizeWord.startsWith('$') ? { dollars: size } : { qty: size }) };
  const rest = words.slice(3);
  if (rest.length === 0 || (rest.length === 1 && rest[0] === 'market')) return out;
  const kind = rest[0];
  if ((kind === 'limit' || kind === 'stop' || kind === 'at') && rest.length === 2) {
    const price = num(rest[1]!);
    if (!(price > 0)) return null;
    return { ...out, type: kind === 'stop' ? 'stop' : 'limit', price };
  }
  return null;
}
