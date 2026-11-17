import type { Tick } from '../data/types';

// The footprint: inside each bar, how much traded at each price by sellers
// hitting the bid and by buyers lifting the ask. Pure, so it can be tested.

export interface FootCell {
  /** Volume sold into the bid at this price. */
  sell: number;
  /** Volume bought at the ask at this price. */
  buy: number;
}

export interface FootBar {
  t: number;
  /** Price bucket (its lower edge) → volume on each side. */
  cells: Map<number, FootCell>;
  buy: number;
  sell: number;
  /** Buy volume minus sell volume. */
  delta: number;
  open: number;
  close: number;
  high: number;
  low: number;
  /** The price bucket with the most volume. */
  poc: number;
}

const bucket = (price: number, step: number): number => {
  const decimals = Math.max(0, Math.ceil(-Math.log10(step)) + 2);
  return Number((Math.floor(price / step + 1e-9) * step).toFixed(decimals));
};

/** Group trades into bars of `barMs` and price rows of `step`. Trades may arrive in any order. */
export function buildFootprint(ticks: Tick[], barMs: number, step: number): FootBar[] {
  const bars = new Map<number, FootBar>();
  const sorted = [...ticks].sort((a, b) => a.t - b.t);
  for (const tk of sorted) {
    const t = Math.floor(tk.t / barMs) * barMs;
    let bar = bars.get(t);
    if (!bar) {
      bar = { t, cells: new Map(), buy: 0, sell: 0, delta: 0, open: tk.p, close: tk.p, high: tk.p, low: tk.p, poc: bucket(tk.p, step) };
      bars.set(t, bar);
    }
    const key = bucket(tk.p, step);
    let cell = bar.cells.get(key);
    if (!cell) {
      cell = { sell: 0, buy: 0 };
      bar.cells.set(key, cell);
    }
    if (tk.side === 'buy') {
      cell.buy += tk.q;
      bar.buy += tk.q;
    } else {
      cell.sell += tk.q;
      bar.sell += tk.q;
    }
    bar.close = tk.p;
    bar.high = Math.max(bar.high, tk.p);
    bar.low = Math.min(bar.low, tk.p);
  }
  const out = [...bars.values()].sort((a, b) => a.t - b.t);
  for (const bar of out) {
    bar.delta = bar.buy - bar.sell;
    let best = -1;
    for (const [price, c] of bar.cells) {
      if (c.buy + c.sell > best) {
        best = c.buy + c.sell;
        bar.poc = price;
      }
    }
  }
  return out;
}

/** One side at least three times the other, with enough size to matter: an imbalance worth marking. */
export function imbalance(c: FootCell, minSize: number): 'buy' | 'sell' | null {
  if (c.buy + c.sell < minSize) return null;
  if (c.buy >= c.sell * 3 && c.buy > 0) return 'buy';
  if (c.sell >= c.buy * 3 && c.sell > 0) return 'sell';
  return null;
}

/** A plain read of the last few bars: who has been the aggressor. */
export function footprintRead(bars: FootBar[]): string {
  const recent = bars.slice(-3);
  const buy = recent.reduce((s, b) => s + b.buy, 0);
  const sell = recent.reduce((s, b) => s + b.sell, 0);
  const total = buy + sell;
  if (recent.length === 0 || total === 0) return 'Waiting for trades.';
  const share = buy / total;
  const last = recent[recent.length - 1]!;
  const first = recent[0]!;
  const rising = last.close > first.open;
  if (share >= 0.58) return rising ? 'Buyers in control: they are lifting offers and price is rising.' : 'Buyers are aggressive but price is not rising: sellers are absorbing them.';
  if (share <= 0.42) return rising ? 'Sellers are aggressive but price is not falling: buyers are absorbing them.' : 'Sellers in control: they are hitting bids and price is falling.';
  return 'Balanced: neither side is pressing.';
}

/** A row height that shows about `rows` price rows across the range the bars cover, snapped to 1, 2 or 5 times a power of ten. */
export function footStep(bars: { high: number; low: number }[], rows = 18): number {
  if (bars.length === 0) return 1;
  const hi = Math.max(...bars.map((b) => b.high));
  const lo = Math.min(...bars.map((b) => b.low));
  const raw = Math.max(hi - lo, hi * 0.0002) / rows;
  const pow = 10 ** Math.floor(Math.log10(raw));
  const m = raw / pow;
  return Number(((m <= 1 ? 1 : m <= 2 ? 2 : m <= 5 ? 5 : 10) * pow).toPrecision(6));
}
