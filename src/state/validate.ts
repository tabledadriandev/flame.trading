// Shape checks for documents that come from outside the running app: a backup
// file someone chose, or whatever is in storage at start. A document that
// fails is refused with a sentence, never loaded half-right.

type Obj = Record<string, unknown>;

const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const num = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const str = (v: unknown): v is string => typeof v === 'string' && v.length < 2_000;
const optNum = (v: unknown): boolean => v === undefined || num(v);

const MODES = ['spot', 'lev'];
const CLASSES = ['crypto', 'stock', 'odds', 'option', 'meme'];
const SIDES = ['buy', 'sell'];
const DIRS = ['long', 'short'];

function optionSpec(o: unknown): boolean {
  return isObj(o) && str(o.underlying) && ['call', 'put'].includes(o.kind as string) && num(o.strike) && o.strike > 0 && num(o.expiry) && num(o.multiplier) && o.multiplier > 0 && ['deribit', 'alpaca'].includes(o.venue as string);
}

function cover(c: unknown): boolean {
  return isObj(c) && (c.kind === 'cash' || ((c.kind === 'shares' || c.kind === 'spread') && str(c.key)));
}

function position(p: unknown): boolean {
  // An option position must say which contract it is, and one that was sold must say what covers it.
  if (isObj(p) && p.cls === 'option' && !(optionSpec(p.option) && (p.mode === 'spot' || cover(p.cover)))) return false;
  return isObj(p) && str(p.key) && str(p.instrument) && CLASSES.includes(p.cls as string) && MODES.includes(p.mode as string) && DIRS.includes(p.dir as string) && num(p.qty) && p.qty > 0 && num(p.entry) && p.entry >= 0 && num(p.margin) && p.margin >= 0 && str(p.tradeId) && num(p.openedAt);
}

function order(o: unknown): boolean {
  return (
    isObj(o) && str(o.id) && str(o.instrument) && CLASSES.includes(o.cls as string) && MODES.includes(o.mode as string) && SIDES.includes(o.side as string) &&
    ['market', 'limit', 'stop'].includes(o.type as string) && num(o.qty) && o.qty > 0 && ['working', 'filled', 'cancelled', 'rejected'].includes(o.status as string) &&
    ['entry', 'tp', 'sl'].includes(o.role as string) && num(o.createdAt) && optNum(o.limit) && optNum(o.stop) && optNum(o.leverage) && optNum(o.tp) && optNum(o.sl)
  );
}

function fill(f: unknown): boolean {
  return isObj(f) && str(f.id) && str(f.orderId) && str(f.tradeId) && str(f.instrument) && MODES.includes(f.mode as string) && SIDES.includes(f.side as string) && num(f.qty) && num(f.price) && num(f.fee) && num(f.t);
}

function trade(t: unknown): boolean {
  if (!isObj(t)) return false;
  const review = t.review;
  const reviewOk = review === undefined || (isObj(review) && str(review.setup) && str(review.emotion) && str(review.note) && (review.followedPlan === null || typeof review.followedPlan === 'boolean'));
  const snapOk = t.snapshot === undefined || (Array.isArray(t.snapshot) && t.snapshot.length <= 500 && t.snapshot.every(num));
  return (
    str(t.id) && str(t.instrument) && CLASSES.includes(t.cls as string) && MODES.includes(t.mode as string) && DIRS.includes(t.dir as string) && num(t.openedAt) && optNum(t.closedAt) &&
    [t.qty, t.entryAvg, t.exitAvg, t.openedQty, t.closedQty, t.gross, t.fees, t.funding, t.pnl, t.mae, t.mfe].every(num) && optNum(t.initialRisk) && optNum(t.r) &&
    Array.isArray(t.fillIds) && t.fillIds.every(str) && reviewOk && snapOk
  );
}

/** Why this is not a usable paper account, or null if it is. */
export function accountProblem(a: unknown): string | null {
  if (!isObj(a)) return 'The account is missing.';
  if (!num(a.cash) || !num(a.startCash) || !num(a.seq) || !num(a.lastSeen)) return 'The account\'s cash figures are not numbers.';
  if (a.startCash <= 0 || a.seq < 0) return 'The account\'s starting cash is not valid.';
  if (!isObj(a.positions) || !Object.values(a.positions).every(position)) return 'A position in the account is not valid.';
  if (!Array.isArray(a.orders) || !a.orders.every(order)) return 'An order in the account is not valid.';
  if (!Array.isArray(a.fills) || !a.fills.every(fill)) return 'A fill in the account is not valid.';
  if (!Array.isArray(a.trades) || !a.trades.every(trade)) return 'A trade in the account is not valid.';
  // Every position must point at a trade that exists, or closing it would fail.
  const ids = new Set((a.trades as Obj[]).map((t) => t.id));
  if (!Object.values(a.positions).every((p) => ids.has((p as Obj).tradeId))) return 'A position refers to a trade that is not in the account.';
  return null;
}

function watchlistsProblem(d: unknown): string | null {
  if (!isObj(d) || !Array.isArray(d.lists) || d.lists.length === 0) return 'The watchlists are not valid.';
  const ok = d.lists.every((l) => isObj(l) && str(l.id) && str(l.name) && Array.isArray(l.items) && l.items.length <= 500 && l.items.every(str));
  return ok && (d.active === undefined || str(d.active)) ? null : 'A watchlist is not valid.';
}

function settingsProblem(d: unknown): string | null {
  if (!isObj(d)) return 'The settings are not valid.';
  // Most fees are rates; a stock option's is dollars a contract, and the crypto-option cap is a share of the premium.
  const feeLimit = (k: string): number => (k === 'optionContract' ? 10 : k === 'optionCryptoCap' ? 1 : 0.05);
  if (d.fees !== undefined && !(isObj(d.fees) && Object.entries(d.fees).every(([k, v]) => num(v) && v >= 0 && v <= feeLimit(k)))) return 'The fees in the settings are not valid.';
  if (d.riskPct !== undefined && !(num(d.riskPct) && d.riskPct > 0 && d.riskPct <= 100)) return 'The default risk in the settings is not valid.';
  if (d.setups !== undefined && !(Array.isArray(d.setups) && d.setups.length <= 200 && d.setups.every(str))) return 'The setup tags in the settings are not valid.';
  return null;
}

function levelsProblem(d: unknown): string | null {
  if (!isObj(d)) return 'The chart levels are not valid.';
  const ok = Object.values(d).every((list) => Array.isArray(list) && list.length <= 500 && list.every((l) => isObj(l) && str(l.id) && num(l.price) && l.price > 0 && typeof l.alert === 'boolean'));
  return ok ? null : 'A chart level is not valid.';
}

function oddsProblem(d: unknown): string | null {
  if (!isObj(d)) return 'The prediction-market notes are not valid.';
  const ok = Object.entries(d).every(([token, m]) => /^\d{10,90}$/.test(token) && isObj(m) && str(m.question) && str(m.outcome) && str(m.event) && (m.label === null || str(m.label)));
  return ok ? null : 'A prediction-market note is not valid.';
}

const CHECKS: Record<string, (d: unknown) => string | null> = {
  account: accountProblem,
  watchlists: watchlistsProblem,
  settings: settingsProblem,
  layout: (d) => (isObj(d) ? null : 'The layout is not valid.'),
  levels: levelsProblem,
  odds: oddsProblem,
};

/** Why a stored or imported document cannot be used, or null if it can. */
export function documentProblem(key: string, data: unknown): string | null {
  const check = CHECKS[key];
  return check ? check(data) : null;
}
