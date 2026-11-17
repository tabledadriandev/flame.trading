import { priceDecimals, qtyDecimals } from '../data/instruments';

// Numbers as the design system writes them: $64,210.50, −$120.40 with a true
// minus, percentages to two decimals, R to one.

const MINUS = '−';

function group(n: number, decimals: number): string {
  return Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

const sign = (n: number, signed: boolean): string => (n < 0 ? MINUS : signed && n > 0 ? '+' : '');

export function money(n: number, opts: { signed?: boolean; decimals?: number } = {}): string {
  if (!Number.isFinite(n)) return '—';
  const decimals = opts.decimals ?? 2;
  const zero = Math.abs(n) < 0.5 / 10 ** decimals;
  return `${zero ? '' : sign(n, opts.signed ?? false)}$${group(zero ? 0 : n, decimals)}`;
}

/** Dollars without cents once they stop mattering: $1.2M, $64,210, $12.40. */
export function moneyShort(n: number): string {
  if (!Number.isFinite(n)) return '—';
  const a = Math.abs(n);
  if (a >= 1e9) return `${sign(n, false)}$${(a / 1e9).toFixed(a >= 1e10 ? 1 : 2)}B`;
  if (a >= 1e6) return `${sign(n, false)}$${(a / 1e6).toFixed(a >= 1e7 ? 1 : 2)}M`;
  if (a >= 1e4) return `${sign(n, false)}$${(a / 1e3).toFixed(a >= 1e5 ? 0 : 1)}K`;
  return money(n, { decimals: a >= 100 ? 0 : 2 });
}

export function pct(n: number, signed = true, decimals = 2): string {
  if (!Number.isFinite(n)) return '—';
  const zero = Math.abs(n) < 0.5 / 10 ** decimals;
  return `${zero ? '' : sign(n, signed)}${group(zero ? 0 : n, decimals)}%`;
}

export function rr(n: number | undefined | null): string {
  if (n === undefined || n === null || !Number.isFinite(n)) return '—';
  const zero = Math.abs(n) < 0.05;
  return `${zero ? '' : sign(n, true)}${Math.abs(zero ? 0 : n).toFixed(1)}R`;
}

export function price(n: number | undefined | null, decimals?: number): string {
  if (n === undefined || n === null || !Number.isFinite(n)) return '—';
  return `${n < 0 ? MINUS : ''}${group(n, decimals ?? priceDecimals(n))}`;
}

export function dollars(n: number | undefined | null, decimals?: number): string {
  if (n === undefined || n === null || !Number.isFinite(n)) return '—';
  return `${n < 0 ? MINUS : ''}$${group(n, decimals ?? priceDecimals(n))}`;
}

/** A size, trimmed of trailing zeros: 0.156, 10, 1,250. */
export function qty(n: number, refPrice = 1): string {
  if (!Number.isFinite(n)) return '—';
  const d = qtyDecimals(refPrice);
  const s = Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: Math.max(d, 2) });
  return `${n < 0 ? MINUS : ''}${s}`;
}

export function compact(n: number): string {
  if (!Number.isFinite(n)) return '—';
  const a = Math.abs(n);
  if (a >= 1e9) return `${(n / 1e9).toFixed(2)}B`;
  if (a >= 1e6) return `${(n / 1e6).toFixed(2)}M`;
  if (a >= 1e3) return `${(n / 1e3).toFixed(a >= 1e4 ? 1 : 2)}K`;
  if (a >= 100) return n.toFixed(0);
  if (a >= 1) return n.toFixed(2);
  return n.toFixed(a >= 0.01 ? 3 : 5);
}

const two = (n: number): string => String(n).padStart(2, '0');

export function clock(t: number, seconds = true): string {
  const d = new Date(t);
  return `${two(d.getHours())}:${two(d.getMinutes())}${seconds ? `:${two(d.getSeconds())}` : ''}`;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function day(t: number, year = false): string {
  const d = new Date(t);
  return `${d.getDate()} ${MONTHS[d.getMonth()]}${year ? ` ${d.getFullYear()}` : ''}`;
}

export function stamp(t: number): string {
  const d = new Date(t);
  const sameYear = d.getFullYear() === new Date().getFullYear();
  return `${day(t, !sameYear)}, ${clock(t, false)}`;
}

export function duration(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${s % 60}s`;
  const h = Math.floor(m / 60);
  if (h < 48) return `${h}h ${m % 60}m`;
  return `${Math.floor(h / 24)}d ${h % 24}h`;
}

/** Parse what a person types into a number field: "1,250.5", "64k", ".5". */
export function parseNumber(text: string): number {
  const clean = text.trim().replace(/[$,\s]/g, '').replace(MINUS, '-');
  if (clean === '') return NaN;
  const m = /^(-?\d*\.?\d+)([kKmM]?)$/.exec(clean);
  if (!m) return NaN;
  const mult = m[2] === 'k' || m[2] === 'K' ? 1e3 : m[2] === 'm' || m[2] === 'M' ? 1e6 : 1;
  return parseFloat(m[1]!) * mult;
}

const SUBSCRIPT = '₀₁₂₃₄₅₆₇₈₉';

/**
 * A token price, which can be a millionth of a cent. Small prices keep four
 * significant digits; very small ones count the zeros after the point as a
 * subscript ($0.0₅4821 is five zeros, then 4821), the way pool screens do.
 */
export function tokenPrice(n: number | undefined | null): string {
  if (n === undefined || n === null || !Number.isFinite(n) || n <= 0) return '—';
  if (n >= 1) return '$' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: n >= 100 ? 2 : 4 });
  let zeros = Math.max(0, -Math.floor(Math.log10(n)) - 1);
  let digits = Math.round(n * 10 ** (zeros + 4));
  // Rounding can carry into the zeros: 0.00099996 is 0.001000.
  if (digits >= 10_000) {
    digits = 1_000;
    zeros -= 1;
  }
  if (zeros < 0) return '$1.00';
  const tail = String(digits).padStart(4, '0').replace(/0+$/, '') || '0';
  if (zeros < 4) return '$0.' + '0'.repeat(zeros) + tail;
  const count = String(zeros)
    .split('')
    .map((d) => SUBSCRIPT[Number(d)])
    .join('');
  return '$0.0' + count + tail;
}

/** How long ago, in one unit: 20m, 3h, 5d, 8mo, 2y. */
export function age(ms: number): string {
  const m = Math.max(0, ms) / 60_000;
  if (m < 1) return 'now';
  if (m < 60) return Math.floor(m) + 'm';
  const h = m / 60;
  if (h < 48) return Math.floor(h) + 'h';
  const d = h / 24;
  if (d < 60) return Math.floor(d) + 'd';
  if (d < 730) return Math.floor(d / 30.44) + 'mo';
  return Math.floor(d / 365.25) + 'y';
}
