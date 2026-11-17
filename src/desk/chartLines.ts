import type { ChartLine } from '../chart/Chart';
import { bracketsFor, workingOrders } from '../engine/engine';
import { positionLiquidationPrice, rulesFor } from '../engine/rules';
import type { Account, EngineSettings, Position } from '../engine/types';
import { qty, rr } from '../lib/format';

// Your world on the price axis: position entry, stop, target, liquidation
// price and working orders, as lines the chart can draw and drag.

export interface LineActions {
  amend(orderId: string, patch: { limit?: number; stop?: number }): void;
  cancel(orderId: string): void;
  brackets(key: string, b: { tp?: number | null; sl?: number | null }): void;
}

function rAt(a: Account, p: Position, price: number): number | null {
  const risk = a.trades.find((t) => t.id === p.tradeId)?.initialRisk;
  if (!risk) return null;
  return ((price - p.entry) * p.qty * (p.dir === 'long' ? 1 : -1)) / risk;
}

export function orderLines(a: Account, instrumentId: string, s: EngineSettings, act: LineActions, symbol: string): ChartLine[] {
  const lines: ChartLine[] = [];
  for (const p of Object.values(a.positions)) {
    if (p.instrument !== instrumentId) continue;
    const long = p.dir === 'long';
    lines.push({
      id: `entry-${p.key}`,
      price: p.entry,
      label: `${p.mode === 'spot' ? 'Holding' : long ? 'Long' : 'Short'} ${qty(p.qty, p.entry)} ${symbol}`,
      side: long ? 'buy' : 'sell',
    });
    const liq = positionLiquidationPrice(p, rulesFor(p.cls, s).mmr);
    if (liq !== null && liq > 0) lines.push({ id: `liq-${p.key}`, price: liq, label: 'Liquidation', dashed: true });

    const { tp, sl } = bracketsFor(a, p);
    if (sl?.stop !== undefined) {
      const r = rAt(a, p, sl.stop);
      lines.push({
        id: `o-${sl.id}`,
        price: sl.stop,
        label: r !== null ? `Stop ${rr(r)}` : 'Stop',
        side: sl.side,
        onMove: (price) => act.amend(sl.id, { stop: price }),
        onRemove: () => act.brackets(p.key, { sl: null }),
        removeLabel: 'Remove the stop-loss',
      });
    }
    if (tp?.limit !== undefined) {
      const r = rAt(a, p, tp.limit);
      lines.push({
        id: `o-${tp.id}`,
        price: tp.limit,
        label: r !== null ? `Target ${rr(r)}` : 'Target',
        side: tp.side,
        onMove: (price) => act.amend(tp.id, { limit: price }),
        onRemove: () => act.brackets(p.key, { tp: null }),
        removeLabel: 'Remove the take-profit',
      });
    }
  }
  for (const o of workingOrders(a)) {
    if (o.instrument !== instrumentId || o.role !== 'entry') continue;
    const at = o.limit ?? o.stop;
    if (at === undefined) continue;
    const isLimit = o.limit !== undefined;
    lines.push({
      id: `o-${o.id}`,
      price: at,
      label: `${isLimit ? 'Limit' : 'Stop'} ${o.side} ${qty(o.qty, at)}`,
      side: o.side,
      onMove: (price) => act.amend(o.id, isLimit ? { limit: price } : { stop: price }),
      onRemove: () => act.cancel(o.id),
      removeLabel: 'Cancel this order',
    });
    // The brackets an entry will bring with it, so the plan is visible before it fills.
    if (o.sl !== undefined) lines.push({ id: `osl-${o.id}`, price: o.sl, label: 'Stop when filled', dashed: true });
    if (o.tp !== undefined) lines.push({ id: `otp-${o.id}`, price: o.tp, label: 'Target when filled', dashed: true });
  }
  return lines;
}
