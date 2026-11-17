// The outcome cone ("If you hold"). It block-bootstraps the instrument's own
// daily returns: runs of consecutive real days are drawn at random and
// chained, so the fat tails and the day-to-day clustering of the real series
// survive. It describes the past two years of behaviour, not a forecast.

export interface ConeInput {
  /** Daily closes, oldest first (about two years). */
  closes: number[];
  /** Days to hold: 1, 5 (a week) or 21 (a month) trading days. */
  horizon: number;
  entry: number;
  side: 'buy' | 'sell';
  qty: number;
  /** Fee per side as a fraction of notional. */
  feeRate: number;
  stop?: number;
  target?: number;
  paths?: number;
  block?: number;
  seed?: number;
}

export interface Cone {
  /** Price percentiles for day 0..horizon. */
  p10: number[];
  p50: number[];
  p90: number[];
  /** Share of paths that end in profit after fees, 0–1. */
  profitShare: number;
  /** A typical good and bad result in dollars after fees: the 75th and 25th percentile. */
  good: number;
  bad: number;
  /** With a stop and/or target: the share of paths that touch each first (checked at each day's close). */
  stopFirst: number | null;
  targetFirst: number | null;
  paths: number;
  days: number;
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const quantile = (sorted: number[], q: number): number => {
  if (sorted.length === 0) return NaN;
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return sorted[lo]! + (sorted[hi]! - sorted[lo]!) * (pos - lo);
};

/** Null when there is too little history to say anything. */
export function outcomeCone(input: ConeInput): Cone | null {
  const { closes, horizon, entry, side, qty, feeRate, stop, target } = input;
  const paths = input.paths ?? 2_000;
  const block = input.block ?? 5;
  const returns: number[] = [];
  for (let i = 1; i < closes.length; i++) {
    const a = closes[i - 1]!;
    const b = closes[i]!;
    if (a > 0 && b > 0) returns.push(Math.log(b / a));
  }
  if (returns.length < 60 || !(entry > 0) || !(qty > 0) || horizon < 1) return null;

  const rand = mulberry32(input.seed ?? 20_261_117);
  const dir = side === 'buy' ? 1 : -1;
  const byDay: number[][] = Array.from({ length: horizon + 1 }, () => []);
  const pnl: number[] = [];
  let stopFirst = 0;
  let targetFirst = 0;
  const watching = stop !== undefined || target !== undefined;

  for (let p = 0; p < paths; p++) {
    let price = entry;
    let day = 0;
    let exit: number | null = null;
    byDay[0]!.push(price);
    while (day < horizon) {
      const start = Math.floor(rand() * returns.length);
      for (let k = 0; k < block && day < horizon; k++) {
        price *= Math.exp(returns[(start + k) % returns.length]!);
        day += 1;
        byDay[day]!.push(price);
        if (exit === null && watching) {
          const hitStop = stop !== undefined && (dir === 1 ? price <= stop : price >= stop);
          const hitTarget = target !== undefined && (dir === 1 ? price >= target : price <= target);
          if (hitStop) {
            stopFirst += 1;
            exit = stop!;
          } else if (hitTarget) {
            targetFirst += 1;
            exit = target!;
          }
        }
      }
    }
    const out = exit ?? price;
    pnl.push((out - entry) * qty * dir - (entry + out) * qty * feeRate);
  }

  const line = (q: number) => byDay.map((d) => quantile([...d].sort((a, b) => a - b), q));
  const sorted = [...pnl].sort((a, b) => a - b);
  return {
    p10: line(0.1),
    p50: line(0.5),
    p90: line(0.9),
    profitShare: pnl.filter((x) => x > 0).length / paths,
    good: quantile(sorted, 0.75),
    bad: quantile(sorted, 0.25),
    stopFirst: stop !== undefined ? stopFirst / paths : null,
    targetFirst: target !== undefined ? targetFirst / paths : null,
    paths,
    days: returns.length,
  };
}
