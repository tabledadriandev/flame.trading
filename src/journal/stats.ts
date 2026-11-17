import type { TradeRec } from '../engine/types';

// What the journal can say about a set of closed trades. Pure, so every
// number on the Journal view is pinned by a test.

export interface Stats {
  trades: number;
  wins: number;
  losses: number;
  /** Share of trades that made money, 0–1. */
  winRate: number;
  avgWin: number;
  /** A positive number: the average size of a losing trade. */
  avgLoss: number;
  /** Average P&L per trade, in dollars. */
  expectancy: number;
  /** Average R per trade, over the trades that had a stop at entry. Null when none did. */
  expectancyR: number | null;
  /** Dollars won for every dollar lost. Infinity with no losses; null with no trades. */
  profitFactor: number | null;
  /** Largest fall from a peak in the running total of closed P&L, in dollars (a positive number). */
  maxDrawdown: number;
  longestLosingStreak: number;
  net: number;
  fees: number;
  /** Trades with a stop at entry. */
  withR: number;
}

const closed = (trades: TradeRec[]): TradeRec[] => trades.filter((t) => t.closedAt !== undefined).sort((a, b) => a.closedAt! - b.closedAt!);

export function stats(all: TradeRec[]): Stats {
  const trades = closed(all);
  let wins = 0;
  let losses = 0;
  let won = 0;
  let lost = 0;
  let net = 0;
  let fees = 0;
  let rSum = 0;
  let withR = 0;
  let streak = 0;
  let longest = 0;
  let peak = 0;
  let maxDrawdown = 0;
  for (const t of trades) {
    net += t.pnl;
    fees += t.fees;
    if (t.pnl > 0) {
      wins += 1;
      won += t.pnl;
      streak = 0;
    } else if (t.pnl < 0) {
      losses += 1;
      lost -= t.pnl;
      streak += 1;
      longest = Math.max(longest, streak);
    }
    if (t.r !== undefined) {
      rSum += t.r;
      withR += 1;
    }
    peak = Math.max(peak, net);
    maxDrawdown = Math.max(maxDrawdown, peak - net);
  }
  const n = trades.length;
  return {
    trades: n,
    wins,
    losses,
    winRate: n > 0 ? wins / n : 0,
    avgWin: wins > 0 ? won / wins : 0,
    avgLoss: losses > 0 ? lost / losses : 0,
    expectancy: n > 0 ? net / n : 0,
    expectancyR: withR > 0 ? rSum / withR : null,
    profitFactor: n === 0 ? null : lost > 0 ? won / lost : won > 0 ? Infinity : null,
    maxDrawdown,
    longestLosingStreak: longest,
    net,
    fees,
    withR,
  };
}

export interface CurvePoint {
  t: number;
  equity: number;
  /** How far below the highest point so far, in dollars. */
  drawdown: number;
}

/** Equity after each closed trade, starting from the account's opening cash. */
export function equityCurve(all: TradeRec[], startCash: number, startT?: number): CurvePoint[] {
  const trades = closed(all);
  const first = trades[0];
  const points: CurvePoint[] = [{ t: startT ?? (first ? first.openedAt : 0), equity: startCash, drawdown: 0 }];
  let equity = startCash;
  let peak = startCash;
  for (const t of trades) {
    equity += t.pnl;
    peak = Math.max(peak, equity);
    points.push({ t: t.closedAt!, equity, drawdown: peak - equity });
  }
  return points;
}

export type SliceKey = 'setup' | 'emotion' | 'instrument' | 'weekday' | 'hour' | 'plan';

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

function keyOf(t: TradeRec, by: SliceKey, symbolOf: (id: string) => string): string {
  switch (by) {
    case 'setup':
      return t.review?.setup || 'Not tagged';
    case 'emotion':
      return t.review?.emotion || 'Not tagged';
    case 'instrument':
      return symbolOf(t.instrument);
    case 'weekday':
      return DAYS[new Date(t.openedAt).getDay()]!;
    case 'hour': {
      const h = new Date(t.openedAt).getHours();
      return `${String(h).padStart(2, '0')}:00`;
    }
    case 'plan':
      return t.review?.followedPlan === true ? 'Followed the plan' : t.review?.followedPlan === false ? 'Broke the plan' : 'No plan recorded';
  }
}

export interface Slice {
  key: string;
  stats: Stats;
}

/** The same statistics, split by a tag or by time. Ordered by net P&L, best first (weekdays and hours stay in order). */
export function slice(all: TradeRec[], by: SliceKey, symbolOf: (id: string) => string = (id) => id): Slice[] {
  const groups = new Map<string, TradeRec[]>();
  for (const t of closed(all)) {
    const k = keyOf(t, by, symbolOf);
    const g = groups.get(k);
    if (g) g.push(t);
    else groups.set(k, [t]);
  }
  const out = [...groups].map(([key, trades]) => ({ key, stats: stats(trades) }));
  if (by === 'weekday') return out.sort((a, b) => DAYS.indexOf(a.key) - DAYS.indexOf(b.key));
  if (by === 'hour') return out.sort((a, b) => a.key.localeCompare(b.key));
  return out.sort((a, b) => b.stats.net - a.stats.net);
}

export interface RBucket {
  /** Lower edge in R; the bucket covers [from, from + 1). The first and last are open-ended. */
  from: number;
  label: string;
  count: number;
}

/** How results spread, in whole R: from "−3R or worse" to "+5R or better". */
export function rDistribution(all: TradeRec[]): RBucket[] {
  const edges = [-3, -2, -1, 0, 1, 2, 3, 4, 5];
  const buckets: RBucket[] = [
    { from: -Infinity, label: '−3R or worse', count: 0 },
    ...edges.slice(0, -1).map((e) => ({ from: e, label: `${e < 0 ? '−' : e > 0 ? '+' : ''}${Math.abs(e)}R to ${e + 1 < 0 ? '−' : e + 1 > 0 ? '+' : ''}${Math.abs(e + 1)}R`, count: 0 })),
    { from: 5, label: '+5R or better', count: 0 },
  ];
  for (const t of closed(all)) {
    if (t.r === undefined) continue;
    const i = t.r < -3 ? 0 : t.r >= 5 ? buckets.length - 1 : Math.floor(t.r) + 4;
    buckets[i]!.count += 1;
  }
  return buckets;
}

export interface WeeklyChange {
  name: string;
  before: number;
  after: number;
  /** How to print the values. */
  unit: 'money' | 'percent' | 'ratio' | 'count' | 'r';
  sentence: string;
}

const WEEK = 7 * 86_400_000;

/**
 * The weekly review card: the three numbers that changed most between the
 * previous seven days and the last seven, with one sentence on each. Null
 * when either week has no closed trades to compare.
 */
export function weeklyReview(all: TradeRec[], now: number): WeeklyChange[] | null {
  const trades = closed(all);
  const thisWeek = trades.filter((t) => t.closedAt! > now - WEEK);
  const lastWeek = trades.filter((t) => t.closedAt! > now - 2 * WEEK && t.closedAt! <= now - WEEK);
  if (thisWeek.length === 0 || lastWeek.length === 0) return null;
  const a = stats(lastWeek);
  const b = stats(thisWeek);
  const pf = (s: Stats) => (s.profitFactor === null ? 0 : Math.min(s.profitFactor, 10));
  const candidates: (WeeklyChange & { weight: number })[] = [
    {
      name: 'Net P&L',
      before: a.net,
      after: b.net,
      unit: 'money',
      weight: Math.abs(b.net - a.net) / Math.max(1, Math.abs(a.net), Math.abs(b.net)),
      sentence: b.net >= a.net ? 'You kept more this week than last.' : 'This week gave back more than last week did.',
    },
    {
      name: 'Win rate',
      before: a.winRate * 100,
      after: b.winRate * 100,
      unit: 'percent',
      weight: Math.abs(b.winRate - a.winRate),
      sentence: b.winRate >= a.winRate ? 'More of your trades worked. Check that the winners were not smaller.' : 'Fewer trades worked. Look at whether the setups or the entries changed.',
    },
    {
      name: 'Profit factor',
      before: pf(a),
      after: pf(b),
      unit: 'ratio',
      weight: Math.abs(pf(b) - pf(a)) / Math.max(1, pf(a), pf(b)),
      sentence: pf(b) >= pf(a) ? 'Each dollar lost bought more dollars won.' : 'Losses grew faster than wins. Size or stops are the usual cause.',
    },
    {
      name: 'Trades taken',
      before: a.trades,
      after: b.trades,
      unit: 'count',
      weight: Math.abs(b.trades - a.trades) / Math.max(a.trades, b.trades),
      sentence: b.trades > a.trades ? 'You traded more often. More trades is not more edge.' : 'You traded less often. If that was patience, the win rate should show it.',
    },
    {
      name: 'Average loss',
      before: a.avgLoss,
      after: b.avgLoss,
      unit: 'money',
      weight: Math.abs(b.avgLoss - a.avgLoss) / Math.max(1, a.avgLoss, b.avgLoss),
      sentence: b.avgLoss <= a.avgLoss ? 'Losers were cut smaller.' : 'Losers ran further before you closed them.',
    },
  ];
  return candidates
    .filter((c) => c.weight > 0)
    .sort((x, y) => y.weight - x.weight)
    .slice(0, 3)
    .map(({ weight: _w, ...rest }) => rest);
}

const esc = (v: string | number | undefined | null): string => {
  if (v === undefined || v === null) return '';
  const s = String(v);
  // Quote anything a spreadsheet could misread, and never let a cell start a formula.
  const safe = /^[=+\-@\t\r]/.test(s) && typeof v === 'string' ? `'${s}` : s;
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
};

/** Every closed trade as CSV, one row each. */
export function tradesCsv(all: TradeRec[], symbolOf: (id: string) => string = (id) => id): string {
  const head = ['id', 'instrument', 'mode', 'side', 'opened', 'closed', 'duration_seconds', 'size', 'entry', 'exit', 'gross', 'fees', 'funding', 'pnl', 'initial_risk', 'r', 'mae', 'mfe', 'liquidated', 'rugged', 'filled_while_away', 'setup', 'emotion', 'followed_plan', 'note'];
  const rows = closed(all).map((t) =>
    [
      t.id,
      symbolOf(t.instrument),
      t.mode === 'spot' ? 'spot' : t.cls === 'crypto' ? 'perp' : 'margin',
      t.dir,
      new Date(t.openedAt).toISOString(),
      new Date(t.closedAt!).toISOString(),
      Math.round((t.closedAt! - t.openedAt) / 1000),
      t.qty,
      t.entryAvg,
      t.exitAvg,
      t.gross.toFixed(2),
      t.fees.toFixed(2),
      t.funding.toFixed(2),
      t.pnl.toFixed(2),
      t.initialRisk !== undefined ? t.initialRisk.toFixed(2) : '',
      t.r !== undefined ? t.r.toFixed(2) : '',
      t.mae.toFixed(2),
      t.mfe.toFixed(2),
      t.liquidated ? 'yes' : 'no',
      t.rugged ? 'yes' : 'no',
      t.away ? 'yes' : 'no',
      t.review?.setup ?? '',
      t.review?.emotion ?? '',
      t.review?.followedPlan === true ? 'yes' : t.review?.followedPlan === false ? 'no' : '',
      t.review?.note ?? '',
    ]
      .map(esc)
      .join(','),
  );
  return [head.join(','), ...rows].join('\r\n') + '\r\n';
}
