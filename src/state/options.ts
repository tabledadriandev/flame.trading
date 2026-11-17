import { coinOf, deliveryPrice } from '../data/deribit';
import { instrument } from '../data/instruments';
import { expiredOptions } from '../engine/engine';
import { optionPayout } from '../engine/rules';
import type { OptionSpec } from '../engine/types';
import { dollars, money } from '../lib/format';
import { useAccount } from './account';
import { toast } from './toasts';

// Options expire whether Flame is open or not. This looks, at start and once a
// minute, for option positions past their expiry and settles each in cash at
// the venue's own settlement price for that expiry: so an option that expired
// while Flame was closed is settled at the price of the moment it expired,
// not at today's.

/** The underlying's price an expiry settled at. Null when the venue has not published it yet. */
async function settlementPrice(spec: OptionSpec): Promise<number | null> {
  if (spec.venue === 'deribit') {
    const coin = coinOf(spec.underlying);
    if (!coin) throw new Error(`no settlement source for ${spec.underlying}`);
    return deliveryPrice(coin, spec.expiry);
  }
  // Stock options arrive with the stock data key; until then there is no price to settle against.
  throw new Error('stock option settlement is not connected yet');
}

let running = false;
const warned = new Set<string>();

export async function settleExpired(now = Date.now()): Promise<void> {
  if (running) return;
  const s = useAccount.getState();
  if (!s.ready || s.loadError || s.elsewhere) return;
  const due = expiredOptions(s.live, now);
  if (due.length === 0) return;
  running = true;
  try {
    // One lookup per underlying and expiry, however many strikes are held.
    const prices = new Map<string, number | null>();
    for (const { instrument: id, spec } of due) {
      const key = `${spec.venue}|${spec.underlying}|${spec.expiry}`;
      if (!prices.has(key)) {
        try {
          prices.set(key, await settlementPrice(spec));
        } catch (err) {
          console.error(`[flame] could not get the settlement price for ${id}`, err);
          prices.set(key, null);
          if (!warned.has(key)) {
            warned.add(key);
            toast(`${instrument(id).symbol} has expired, but its settlement price could not be fetched. Flame will keep trying; the position stays open until it can be settled correctly.`, { sticky: true });
          }
        }
      }
      const underlying = prices.get(key);
      // Not published yet (the first minutes after expiry): try again on the next pass. If it is still
      // missing an hour on, say so: a position that never settles must not sit there in silence.
      if (underlying === null || underlying === undefined) {
        if (underlying === null && now - spec.expiry > 3_600_000 && !warned.has(key)) {
          warned.add(key);
          toast(`${instrument(id).symbol} expired more than an hour ago, but its settlement price has not been published. Flame will keep checking; the position stays open until it can be settled correctly.`, { sticky: true });
        }
        continue;
      }
      const before = useAccount.getState().live;
      const held = Object.values(before.positions).filter((p) => p.instrument === id);
      const events = useAccount.getState().settleOption(id, underlying, spec.expiry);
      if (held.length === 0) continue;
      const trade = events.find((e) => e.type === 'closed');
      const payout = optionPayout(spec, underlying);
      const what = instrument(id).symbol;
      const where = `${instrument(spec.underlying).symbol} settled at ${dollars(underlying)}`;
      const result = trade && trade.type === 'closed' ? ` Result: ${money(trade.trade.pnl, { signed: true })}.` : '';
      toast(
        payout > 0
          ? `${what} expired in the money: ${where}, so each unit was worth ${dollars(payout)}, settled in cash.${result}`
          : `${what} expired worthless: ${where}.${result}`,
        { sticky: true },
      );
    }
  } finally {
    running = false;
  }
}

let timer: ReturnType<typeof setInterval> | null = null;

export function startExpiry(): void {
  if (timer) return;
  void settleExpired();
  timer = setInterval(() => void settleExpired(), 60_000);
}

export function stopExpiry(): void {
  if (timer) clearInterval(timer);
  timer = null;
}
