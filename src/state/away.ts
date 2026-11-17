import { instrument } from '../data/instruments';
import { route } from '../data/feed';
import type { Timeframe } from '../data/types';
import { useAccount } from './account';
import { toast } from './toasts';

// Working orders and stops are only evaluated while Flame is open. On
// reopening, replay the candles that were missed and fill or liquidate what
// would have triggered, marked "filled while away".

const MIN_GAP = 90_000;

function timeframeFor(gap: number): Timeframe {
  const hour = 3_600_000;
  if (gap <= 16 * hour) return '1m';
  if (gap <= 80 * hour) return '5m';
  if (gap <= 40 * 24 * hour) return '1h';
  return '1d';
}

export async function catchUp(): Promise<void> {
  const start = useAccount.getState().live;
  const since = start.lastSeen;
  const gap = Date.now() - since;
  if (!(since > 0) || gap < MIN_GAP) return;

  const exposed = new Set<string>();
  for (const p of Object.values(start.positions)) exposed.add(p.instrument);
  for (const o of start.orders) if (o.status === 'working') exposed.add(o.instrument);
  if (exposed.size === 0) return;

  const tf = timeframeFor(gap);
  let fills = 0;
  const failed: string[] = [];
  for (const id of exposed) {
    const r = route(id);
    if (!r) {
      failed.push(instrument(id).symbol);
      continue;
    }
    try {
      const bars = await r.adapter.candles(r.symbol, tf, { from: since, limit: 1000 });
      for (const bar of bars) {
        const events = useAccount.getState().onBar(id, bar, 'live', true);
        fills += events.filter((e) => e.type === 'fill' || e.type === 'liquidated').length;
      }
    } catch (err) {
      console.error(`[flame] could not replay missed candles for ${id}`, err);
      failed.push(instrument(id).symbol);
    }
  }
  if (fills > 0) {
    toast(`While Flame was closed, ${fills} ${fills === 1 ? 'order' : 'orders'} filled. They are marked "filled while away" in Fills.`, { sticky: true });
  }
  if (failed.length > 0) {
    toast(`Could not check what happened to ${failed.join(', ')} while Flame was closed. Orders there are evaluated from now on.`, { sticky: true });
  }
}
