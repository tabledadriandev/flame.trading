import { CATALOG, SHELF } from '../chart/indicators';
import { allInstruments, instrument, type Instrument } from '../data/instruments';
import { TIMEFRAMES } from '../data/types';
import { VIEWS, type ViewId } from '../lib/route';
import type { TypedOrder } from '../lib/orderText';
import { dollars, qty } from '../lib/format';
import { closeInput, useAccount } from '../state/account';
import { useIndicators } from '../state/indicators';
import { useLayout } from '../state/layout';
import { quoteFor } from '../state/live';
import { useMarket } from '../state/market';
import { useTicket } from '../state/ticket';
import { toast } from '../state/toasts';

// Every action the palette offers, with its shortcut. The same functions are
// bound to the keys in keys.ts, so the palette can never show a shortcut that
// does something else.

export interface Command {
  id: string;
  label: string;
  group: 'Order' | 'Symbols' | 'Timeframe' | 'Go to' | 'Chart' | 'Desk';
  keys?: string;
  run: () => void;
}

export const VIEW_KEYS: Record<ViewId, string> = { desk: 'D', markets: 'M', flow: 'F', odds: 'O', options: 'P', replay: 'R', lab: 'L', journal: 'J', news: 'N' };
const VIEW_NAMES: Record<ViewId, string> = { desk: 'Desk', markets: 'Markets', flow: 'Flow', odds: 'Odds', options: 'Options', replay: 'Replay', lab: 'Lab', journal: 'Journal', news: 'News' };

export function goView(v: ViewId): void {
  window.location.hash = v;
}

export function openOnDesk(id: string): void {
  useMarket.getState().select(id);
  goView('desk');
}

export function ticketSide(side: 'buy' | 'sell'): void {
  goView('desk');
  useTicket.getState().prefill({ side });
}

export function limitAtHover(): void {
  const p = useTicket.getState().hoverPrice;
  if (p === null) {
    toast('Point at a price on the chart first, then press L.');
    return;
  }
  const id = useMarket.getState().instrument;
  const last = useMarket.getState().quotes[id]?.last ?? p;
  const decimals = last >= 100 ? 2 : last >= 1 ? 4 : 6;
  useTicket.getState().prefill({ type: 'limit', price: p.toFixed(decimals) });
}

/** Close the position on the desk instrument: the leveraged one first, then spot. */
export function closeSelected(): void {
  const id = useMarket.getState().instrument;
  const a = useAccount.getState().live;
  const key = [`${id}|lev`, `${id}|spot`].find((k) => a.positions[k]);
  const input = key ? closeInput(a, key) : null;
  if (!input) {
    toast(`There is no ${instrument(id).symbol} position to close.`);
    return;
  }
  useAccount.getState().place(input, quoteFor(id));
}

export function toggleZen(): void {
  const l = useLayout.getState();
  goView('desk');
  l.setZen(!l.zen);
}

/** The instrument a typed symbol means: crypto first, then stocks. */
export function resolveSymbol(symbol: string): Instrument | null {
  const all = allInstruments();
  const s = symbol.toUpperCase();
  return all.find((i) => i.symbol.toUpperCase() === s && i.kind === 'crypto') ?? all.find((i) => i.symbol.toUpperCase() === s && i.tradable) ?? null;
}

export function describeOrder(o: TypedOrder): string {
  const verb = o.mode === 'lev' ? (o.side === 'buy' ? 'Long' : 'Short') : o.side === 'buy' ? 'Buy' : 'Sell';
  const size = o.dollars !== undefined ? `${dollars(o.dollars, 0)} of` : qty(o.qty ?? 0, o.price ?? 1);
  const how = o.type === 'market' ? 'at market' : `${o.type} at ${dollars(o.price)}`;
  return `${verb} ${size} ${o.symbol}, ${how}`;
}

/** Load a typed order into the ticket, ready to confirm with Enter. */
export function loadOrder(o: TypedOrder): void {
  const i = resolveSymbol(o.symbol);
  if (!i) {
    toast(`Flame does not know a tradable instrument called ${o.symbol}. Search for it first.`);
    return;
  }
  openOnDesk(i.id);
  useTicket.getState().prefill({
    side: o.side,
    mode: o.mode,
    type: o.type,
    price: o.price !== undefined ? String(o.price) : '',
    size: String(o.dollars ?? o.qty ?? ''),
    sizeMode: o.dollars !== undefined ? 'dollars' : 'units',
  });
}

export function commands(): Command[] {
  const list: Command[] = [];
  TIMEFRAMES.forEach((t, n) =>
    list.push({ id: `tf-${t.id}`, group: 'Timeframe', label: `${t.label} bars`, keys: String(n + 1), run: () => useMarket.getState().setTf(t.id) }),
  );
  for (const v of VIEWS) list.push({ id: `go-${v}`, group: 'Go to', label: VIEW_NAMES[v], keys: `G ${VIEW_KEYS[v]}`, run: () => goView(v) });
  list.push({ id: 'buy', group: 'Order', label: 'Buy ticket', keys: 'B', run: () => ticketSide('buy') });
  list.push({ id: 'sell', group: 'Order', label: 'Sell ticket', keys: 'S', run: () => ticketSide('sell') });
  list.push({ id: 'limit', group: 'Order', label: 'Limit at the hovered chart price', keys: 'L', run: limitAtHover });
  list.push({ id: 'close', group: 'Order', label: 'Close the position on the desk', keys: 'X', run: closeSelected });
  for (const type of SHELF) {
    list.push({ id: `ind-${type}`, group: 'Chart', label: `Add ${CATALOG[type].name}`, run: () => { goView('desk'); useIndicators.getState().add(type); } });
  }
  list.push({ id: 'zen', group: 'Chart', label: 'Zen chart', keys: 'Z', run: toggleZen });
  list.push({
    id: 'reset-layout',
    group: 'Desk',
    label: 'Reset layout',
    run: () => {
      useLayout.getState().reset();
      toast('Pane sizes are back to their defaults.');
    },
  });
  return list;
}
