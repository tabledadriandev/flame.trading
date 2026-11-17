// Black-Scholes for European options: price, greeks and the implied
// volatility that explains a price. Pure maths, no dates and no venues.
//
// `s` is the underlying price, `k` the strike, `t` the time to expiry in
// years, `iv` the volatility as a decimal (0.4 = 40%) and `r` the yearly
// interest rate. Deribit prices its options off the forward for each expiry,
// so for those pass the forward as `s` and leave `r` at zero.

export type OptionKind = 'call' | 'put';

export interface BsInput {
  kind: OptionKind;
  s: number;
  k: number;
  t: number;
  iv: number;
  r?: number;
}

export interface Greeks {
  price: number;
  /** Change in price for a $1 move in the underlying. */
  delta: number;
  /** Change in delta for a $1 move in the underlying. */
  gamma: number;
  /** Change in price for one more calendar day passing. */
  theta: number;
  /** Change in price for one more point of volatility (40% to 41%). */
  vega: number;
  /** Change in price for one more point of interest rate. */
  rho: number;
}

export const YEAR_MS = 365 * 86_400_000;

export const normPdf = (x: number): number => Math.exp(-0.5 * x * x) / Math.sqrt(2 * Math.PI);

/** The standard normal distribution function (Hart's algorithm as given by West, accurate to about 1e-15). */
export function normCdf(x: number): number {
  const a = Math.abs(x);
  let c: number;
  if (a > 37) {
    c = 0;
  } else {
    const e = Math.exp((-a * a) / 2);
    if (a < 7.07106781186547) {
      let n = 3.52624965998911e-2 * a + 0.700383064443688;
      n = n * a + 6.37396220353165;
      n = n * a + 33.912866078383;
      n = n * a + 112.079291497871;
      n = n * a + 221.213596169931;
      n = n * a + 220.206867912376;
      let m = 8.83883476483184e-2 * a + 1.75566716318264;
      m = m * a + 16.064177579207;
      m = m * a + 86.7807322029461;
      m = m * a + 296.564248779674;
      m = m * a + 637.333633378831;
      m = m * a + 793.826512519948;
      m = m * a + 440.413735824752;
      c = (e * n) / m;
    } else {
      let b = a + 0.65;
      b = a + 4 / b;
      b = a + 3 / b;
      b = a + 2 / b;
      b = a + 1 / b;
      c = e / b / 2.506628274631;
    }
  }
  return x > 0 ? 1 - c : c;
}

/** What the option is worth if it expired now. */
export function intrinsic(kind: OptionKind, s: number, k: number): number {
  return Math.max(0, kind === 'call' ? s - k : k - s);
}

function d1d2(s: number, k: number, t: number, iv: number, r: number): [number, number] {
  const vt = iv * Math.sqrt(t);
  const d1 = (Math.log(s / k) + (r + 0.5 * iv * iv) * t) / vt;
  return [d1, d1 - vt];
}

export function greeks(i: BsInput): Greeks {
  const { kind, s, k } = i;
  const r = i.r ?? 0;
  const call = kind === 'call';
  // At or past expiry, or with no volatility, the option is its intrinsic value.
  if (!(i.t > 0) || !(i.iv > 0) || !(s > 0) || !(k > 0)) {
    const itm = call ? s > k : s < k;
    return { price: intrinsic(kind, s, k), delta: itm ? (call ? 1 : -1) : 0, gamma: 0, theta: 0, vega: 0, rho: 0 };
  }
  const { t, iv } = i;
  const [d1, d2] = d1d2(s, k, t, iv, r);
  const disc = Math.exp(-r * t);
  const pdf = normPdf(d1);
  const price = call ? s * normCdf(d1) - k * disc * normCdf(d2) : k * disc * normCdf(-d2) - s * normCdf(-d1);
  const decay = (-s * pdf * iv) / (2 * Math.sqrt(t));
  const carry = call ? -r * k * disc * normCdf(d2) : r * k * disc * normCdf(-d2);
  return {
    price,
    delta: call ? normCdf(d1) : normCdf(d1) - 1,
    gamma: pdf / (s * iv * Math.sqrt(t)),
    theta: (decay + carry) / 365,
    vega: (s * pdf * Math.sqrt(t)) / 100,
    rho: ((call ? 1 : -1) * k * t * disc * normCdf(call ? d2 : -d2)) / 100,
  };
}

export const price = (i: BsInput): number => greeks(i).price;

/**
 * The volatility at which Black-Scholes gives this price. Null when no
 * volatility can: the price is below what the option is worth today, or above
 * what it could ever be worth.
 */
export function impliedVol(kind: OptionKind, s: number, k: number, t: number, target: number, r = 0): number | null {
  if (!(t > 0) || !(s > 0) || !(k > 0) || !(target > 0)) return null;
  let lo = 1e-4;
  let hi = 8;
  const at = (iv: number) => price({ kind, s, k, t, iv, r });
  if (target < at(lo) - 1e-12 || target > at(hi)) return null;
  for (let n = 0; n < 100; n++) {
    const mid = (lo + hi) / 2;
    if (at(mid) < target) lo = mid;
    else hi = mid;
    if (hi - lo < 1e-9) break;
  }
  return (lo + hi) / 2;
}

/**
 * The chance the underlying finishes above `level` at expiry, read off the
 * lognormal distribution that the implied volatility describes. It is what the
 * option market is pricing, not a forecast.
 */
export function chanceAbove(s: number, level: number, t: number, iv: number, r = 0): number {
  if (!(level > 0)) return 1;
  if (!(t > 0) || !(iv > 0)) return s > level ? 1 : 0;
  return normCdf(d1d2(s, level, t, iv, r)[1]);
}
