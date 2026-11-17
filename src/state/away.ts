import { instrument } from '../data/instruments';
import { route } from '../data/feed';
import { tfMs, type Candle, type Timeframe } from '../data/types';
import { useAccount } from './account';
import { toast } from './toasts';

// Working orders and stops are only evaluated while prices are arriving. After
// any gap (Flame was closed, the laptop slept, the connection dropped) the
// candles that were missed are replayed, and whatever would have triggered is
// filled or liquidated at its trigger price, marked "filled while away".

/** Shorter gaps than this are ordinary reconnects; the live feed picks straight up. */
export const MIN_GAP = 90_000;
const FETCH_TIMEOUT = 20_000;

function timeframeFor(gap: number): Timeframe {
  const hour = 3_600_000;
  if (gap <= 16 * hour) return '1m';
  if (gap <= 80 * hour) return '5m';
  if (gap <= 40 * 24 * hour) return '1h';
  return '1d';
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timed out')), ms);
    p.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e: unknown) => {
        clearTimeout(timer);
        reject(e instanceof Error ? e : new Error(String(e)));
      },
    );
  });
}

/** Replay everything since `since` against the orders and positions that existed then. */
export async function catchUp(since: number): Promise<void> {
  const start = useAccount.getState().live;
  const gap = Date.now() - since;
  if (!(since > 0) || gap < MIN_GAP) return;

  const exposed = new Set<string>();
  for (const p of Object.values(start.positions)) if (p.openedAt <= since) exposed.add(p.instrument);
  for (const o of start.orders) if (o.status === 'working' && o.createdAt <= since) exposed.add(o.instrument);
  if (exposed.size === 0) return;

  const tf = timeframeFor(gap);
  let fills = 0;
  const failed: string[] = [];
  for (const id of exposed) {
    // Options have no candles to replay. What matters for them is expiry, which is settled separately
    // (state/options.ts) at the venue's own settlement price, however long Flame was closed.
    if (instrument(id).cls === 'option') continue;
    const r = route(id);
    if (!r) {
      failed.push(instrument(id).symbol);
      continue;
    }
    try {
      // Start one bar early: the bar in progress when prices stopped is part of the gap.
      const bars: Candle[] = await withTimeout(r.adapter.candles(r.symbol, tf, { from: since - tfMs(tf), limit: 1000 }), FETCH_TIMEOUT);
      for (const bar of bars) {
        const events = useAccount.getState().onBar(id, bar, 'live', true, since);
        fills += events.filter((e) => e.type === 'fill' || e.type === 'liquidated').length;
      }
    } catch (err) {
      console.error(`[flame] could not replay missed candles for ${id}`, err);
      failed.push(instrument(id).symbol);
    }
  }
  if (fills > 0) {
    toast(`While prices were not being watched, ${fills} ${fills === 1 ? 'order' : 'orders'} filled. They are marked "filled while away" in Fills.`, { sticky: true });
  }
  if (failed.length > 0) {
    toast(`Could not check what happened to ${failed.join(', ')} while prices were not being watched. Orders there are evaluated from now on.`, { sticky: true });
  }
}
