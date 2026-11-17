import { perpContext } from '../data/hyperliquid';
import { instrument } from '../data/instruments';
import { useAccount } from './account';
import { useMarket } from './market';
import { toast } from './toasts';

// Perp funding. Flame's perps are priced on the spot feed and have no funding
// of their own, so they borrow Hyperliquid's hourly rate for the same coin:
// once an hour, longs pay shorts when the rate is positive. Hours that pass
// while Flame is closed are not charged. If the rate cannot be fetched, or
// Hyperliquid does not list the coin, no funding is applied, and the Flow
// view says so.

const HOUR = 3_600_000;
const KEY = 'flame.funding';

/** The funding hour (hours since the epoch) to charge now, or null if this position has already paid it or was opened during it. */
export function fundingDue(openedAt: number, lastPaidHour: number | undefined, now: number): number | null {
  const hour = Math.floor(now / HOUR);
  if (openedAt >= hour * HOUR) return null; // opened after this hour's settlement
  if (lastPaidHour !== undefined && lastPaidHour >= hour) return null;
  return hour;
}

function readPaid(): Record<string, number> {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? '{}') as Record<string, number>;
  } catch {
    return {};
  }
}

function writePaid(paid: Record<string, number>): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(paid));
  } catch {
    // Without storage the hour is remembered only until the tab closes; funding may then repeat once after a reload.
  }
}

let memory: Record<string, number> | null = null;
let warned = false;

async function settle(): Promise<void> {
  const a = useAccount.getState();
  const positions = Object.values(a.live.positions).filter((p) => p.mode === 'lev' && p.cls === 'crypto');
  if (positions.length === 0) return;
  const paid = (memory ??= readPaid());
  const now = Date.now();
  for (const p of positions) {
    const hour = fundingDue(p.openedAt, paid[p.tradeId], now);
    if (hour === null) continue;
    const coin = p.instrument.slice('crypto:'.length);
    try {
      const ctx = await perpContext(coin);
      // Mark the hour as dealt with either way, so a coin with no funding feed is not asked about every minute.
      paid[p.tradeId] = hour;
      if (!ctx) continue;
      const mark = useMarket.getState().quotes[p.instrument]?.last ?? p.entry;
      useAccount.getState().funding(p.instrument, ctx.funding, mark);
      const amount = p.qty * mark * ctx.funding;
      const pays = (p.dir === 'long') === ctx.funding > 0;
      toast(`Funding on ${instrument(p.instrument).symbol}: your ${p.dir} ${pays ? 'paid' : 'received'} $${Math.abs(amount).toFixed(2)} for the hour.`);
    } catch (err) {
      console.warn(`[flame] funding for ${coin} could not be applied`, err);
      if (!warned) {
        warned = true;
        toast('Funding could not be fetched, so none was applied this hour. Flame will try again next hour.');
      }
    }
  }
  // Forget trades that are no longer open.
  const open = new Set(positions.map((p) => p.tradeId));
  for (const id of Object.keys(paid)) if (!open.has(id)) delete paid[id];
  writePaid(paid);
}

let timer: ReturnType<typeof setInterval> | null = null;

export function startFunding(): void {
  if (timer) return;
  timer = setInterval(() => void settle(), 60_000);
}

export function stopFunding(): void {
  if (timer) clearInterval(timer);
  timer = null;
}
