import { useEffect, useRef, useState } from 'react';
import { ToReview } from './Review';
import { dexQuote } from '../data/dex';
import { instrument } from '../data/instruments';
import { exitValue } from '../engine/pool';
import { bracketsFor, workingOrders } from '../engine/engine';
import { effectiveLeverage, positionLiquidationPrice, rulesFor, unrealised } from '../engine/rules';
import type { Fill, Order, Position } from '../engine/types';
import { clock, day, dollars, money, parseNumber, pct, price, qty, rr } from '../lib/format';
import { closeInput, reverseInput, useAccount, type Book } from '../state/account';
import { useQuoteSlow } from '../state/hooks';
import { quoteFor } from '../state/live';
import { useMarket } from '../state/market';
import { engineSettings } from '../state/settings';
import { toast } from '../state/toasts';
import { Help, PaneState, SideTag, Tabs, type TabDef } from '../ui/controls';

export type DrawerTab = 'positions' | 'orders' | 'fills' | 'journal';

const COVER_NAME = { shares: 'covered call', cash: 'cash-secured', spread: 'spread' } as const;

function modeName(p: { cls: string; mode: string; cover?: Position['cover'] }): string {
  if (p.cls === 'option') return p.mode === 'spot' ? 'Bought' : p.cover ? `Sold, ${COVER_NAME[p.cover.kind]}` : 'Sold';
  return p.mode === 'spot' ? 'Spot' : p.cls === 'crypto' ? 'Perp' : 'Margin';
}

/** An option is counted in contracts, not in the shares or coins it covers. */
function sizeText(p: { qty: number; option?: Position['option'] }, ref: number): string {
  if (!p.option) return qty(p.qty, ref);
  const n = Math.round((p.qty / p.option.multiplier) * 1000) / 1000;
  return `${n} ${n === 1 ? 'contract' : 'contracts'}`;
}

function PositionRow({ p, book, quote, replay }: { p: Position; book: Book; quote: (id: string) => ReturnType<typeof quoteFor>; replay: boolean }) {
  const account = useAccount((s) => s[book]);
  const place = useAccount((s) => s.place);
  const brackets = useAccount((s) => s.brackets);
  const select = useMarket((s) => s.select);
  const liveQuote = useQuoteSlow(p.instrument, 400);
  // In Replay the mark is the bar being replayed, never the live price.
  const q = replay ? quote(p.instrument) : liveQuote;
  const i = instrument(p.instrument);
  const option = p.cls === 'option';
  // A token is marked at what its pool would pay for the whole position now, not at the price on the screen.
  const pool = p.cls === 'meme' ? dexQuote(p.instrument)?.pool : undefined;
  const mark = pool ? exitValue(pool, p.qty) / p.qty : (q?.last ?? p.entry);
  const u = unrealised(p, mark);
  const basis = p.mode === 'lev' && !option ? p.margin : p.entry * p.qty;
  const trade = account.trades.find((t) => t.id === p.tradeId);
  const r = trade?.initialRisk ? u / trade.initialRisk : undefined;
  // A sold option is fully covered: nothing liquidates it.
  const liq = option ? null : positionLiquidationPrice(p, rulesFor(p.cls, engineSettings()).mmr);
  const { sl, tp } = bracketsFor(account, p);
  const tone = u >= 0 ? 'hot' : 'cold';
  const atBreakeven = sl?.stop !== undefined && Math.abs(sl.stop - p.entry) < p.entry * 1e-6;

  return (
    <tr>
      <td className="l">
        {replay ? (
          <strong>{i.symbol}</strong>
        ) : option ? (
          <a className="link" href="#options" title="Open the option chain">
            {i.symbol}
          </a>
        ) : (
          <button type="button" className="link" onClick={() => select(p.instrument)} title={`Show ${i.symbol} on the desk`}>
            {i.symbol}
          </button>
        )}{' '}
        <span className="sub">
          {modeName(p)}
          {p.mode === 'lev' && !option ? ` ${effectiveLeverage(p).toFixed(effectiveLeverage(p) % 1 ? 1 : 0)}×` : ''}
        </span>
      </td>
      <td className="l">
        <SideTag side={p.dir === 'long' ? 'buy' : 'sell'}>{p.dir === 'long' ? 'Long' : 'Short'}</SideTag>
      </td>
      <td>{sizeText(p, p.entry)}</td>
      <td>{price(p.entry)}</td>
      <td>{q ? price(mark) : '—'}</td>
      <td className={tone}>{money(u, { signed: true })}</td>
      <td className={tone}>{pct(basis > 0 ? (u / basis) * 100 : 0)}</td>
      <td className={r !== undefined ? tone : 'sub'}>{rr(r)}</td>
      <td>{sl?.stop !== undefined ? price(sl.stop) : <span className="sub">—</span>}</td>
      <td>{tp?.limit !== undefined ? price(tp.limit) : <span className="sub">—</span>}</td>
      <td>{liq !== null && liq > 0 ? price(liq) : <span className="sub">—</span>}</td>
      <td>
        <span className="row-actions">
          <button
            type="button"
            className="btn btn-sm"
            onClick={() => {
              const input = closeInput(account, p.key);
              const at = quote(p.instrument);
              if (input) place(input, at, book, replay ? at?.t : undefined);
            }}
          >
            Close
          </button>
          {p.mode === 'lev' && !option ? (
            <button
              type="button"
              className="btn btn-sm"
              title="Close this position and open the same size the other way"
              onClick={() => {
                const input = reverseInput(account, p.key, effectiveLeverage(p));
                const at = quote(p.instrument);
                if (input) place(input, at, book, replay ? at?.t : undefined);
              }}
            >
              Reverse
            </button>
          ) : null}
          {option || p.cls === 'meme' ? null : (
          <button
            type="button"
            className="btn btn-sm"
            disabled={atBreakeven}
            title="Move the stop-loss to your entry price, so the worst case is about break-even"
            onClick={() => {
              // Only possible while the price is on the profitable side of the entry.
              const ok = p.dir === 'long' ? mark > p.entry : mark < p.entry;
              if (ok) brackets(p.key, { sl: p.entry }, book, replay ? q?.t : undefined);
              else toast('The stop can move to your entry only once the trade is in profit; right now it would trigger at once.');
            }}
          >
            Stop to entry
          </button>
          )}
        </span>
      </td>
    </tr>
  );
}

function OrderRow({ o, book, quote, replay }: { o: Order; book: Book; quote: (id: string) => ReturnType<typeof quoteFor>; replay: boolean }) {
  const cancel = useAccount((s) => s.cancel);
  const amend = useAccount((s) => s.amend);
  const [editing, setEditing] = useState<string | null>(null);
  const i = instrument(o.instrument);
  const at = o.limit ?? o.stop;
  const kind = o.role === 'tp' ? 'Take-profit' : o.role === 'sl' ? 'Stop-loss' : o.type === 'limit' ? 'Limit' : o.type === 'stop' ? 'Stop' : 'Market';
  const save = () => {
    const n = parseNumber(editing ?? '');
    if (n > 0) amend(o.id, o.limit !== undefined ? { limit: n } : { stop: n }, book, replay ? quote(o.instrument) : undefined);
    setEditing(null);
  };
  return (
    <tr>
      <td className="l">
        {i.symbol} <span className="sub">{o.cls === 'option' ? '' : modeName(o)}</span>
      </td>
      <td className="l">
        <SideTag side={o.side}>{o.side === 'buy' ? 'Buy' : 'Sell'}</SideTag>
      </td>
      <td className="l">{kind}</td>
      <td>{o.role === 'entry' ? sizeText(o, at ?? 1) : 'Whole position'}</td>
      <td>
        {editing !== null ? (
          <input
            className="cell-input num"
            value={editing}
            autoFocus
            inputMode="decimal"
            aria-label={`New price for the ${kind.toLowerCase()} order`}
            onChange={(e) => setEditing(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') save();
              if (e.key === 'Escape') setEditing(null);
            }}
            onBlur={save}
          />
        ) : at !== undefined ? (
          price(at)
        ) : (
          <span className="sub">—</span>
        )}
      </td>
      <td className="l">{o.queued ? 'Waits for the open' : 'Working'}</td>
      <td className="sub">{clock(o.createdAt, false)}</td>
      <td>
        <span className="row-actions">
          {at !== undefined && editing === null ? (
            <button type="button" className="btn btn-sm" onClick={() => setEditing(String(at))}>
              Edit
            </button>
          ) : null}
          <button type="button" className="btn btn-sm" onClick={() => cancel(o.id, book)}>
            Cancel order
          </button>
        </span>
      </td>
    </tr>
  );
}

const LIQUIDITY: Record<Fill['liquidity'], string> = {
  taker: 'Taker',
  maker: 'Maker',
  liquidation: 'Liquidation',
  settlement: 'Settlement',
};

function FillRow({ f }: { f: Fill }) {
  const i = instrument(f.instrument);
  const today = new Date(f.t).toDateString() === new Date().toDateString();
  return (
    <tr>
      <td className="l sub">{today ? clock(f.t) : `${day(f.t)} ${clock(f.t, false)}`}</td>
      <td className="l">{i.symbol}</td>
      <td className="l">
        <SideTag side={f.side}>{f.side === 'buy' ? 'Bought' : 'Sold'}</SideTag>
      </td>
      <td>{qty(f.qty, f.price)}</td>
      <td>{price(f.price)}</td>
      <td>{money(f.qty * f.price)}</td>
      <td>{f.fee > 0 ? dollars(f.fee, 2) : <span className="sub">None</span>}</td>
      <td className="l sub">
        {LIQUIDITY[f.liquidity]}
        {f.away ? ', filled while away' : ''}
      </td>
    </tr>
  );
}

export function DrawerBody({ tab, book = 'live', quote = quoteFor, journal, replay = false }: { tab: DrawerTab; book?: Book; quote?: (id: string) => ReturnType<typeof quoteFor>; journal?: React.ReactNode; replay?: boolean }) {
  const account = useAccount((s) => s[book]);
  const positions = Object.values(account.positions);
  const orders = workingOrders(account);

  if (tab === 'positions') {
    if (positions.length === 0) return <PaneState title="No open positions">Place an order from the ticket.</PaneState>;
    return (
      <table className="table">
        <thead>
          <tr>
            <th className="l">Instrument</th>
            <th className="l">Side</th>
            <th>Size</th>
            <th>Entry</th>
            <th>Mark</th>
            <th>P&amp;L</th>
            <th>%</th>
            <th>
              R{' '}
              <Help align="right">
                P&amp;L in multiples of the risk you took at entry (the distance to your first stop). +2R means you made twice what you risked. Shown only when the trade had a stop at entry.
              </Help>
            </th>
            <th>Stop</th>
            <th>Target</th>
            <th>
              Liq.{' '}
              <Help align="right">The price at which a leveraged position is closed for you and its margin is lost.</Help>
            </th>
            <th>
              <span className="sr-only">Actions</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {positions.map((p) => (
            <PositionRow key={p.key} p={p} book={book} quote={quote} replay={replay} />
          ))}
        </tbody>
      </table>
    );
  }

  if (tab === 'orders') {
    if (orders.length === 0) return <PaneState title="No working orders">Limit and stop orders wait here until they fill.</PaneState>;
    return (
      <table className="table">
        <thead>
          <tr>
            <th className="l">Instrument</th>
            <th className="l">Side</th>
            <th className="l">Type</th>
            <th>Size</th>
            <th>Price</th>
            <th className="l">State</th>
            <th>Placed</th>
            <th>
              <span className="sr-only">Actions</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {orders.map((o) => (
            <OrderRow key={o.id} o={o} book={book} quote={quote} replay={replay} />
          ))}
        </tbody>
      </table>
    );
  }

  if (tab === 'fills') {
    if (account.fills.length === 0) return <PaneState title="No fills yet">Every execution is listed here, with its price and fee.</PaneState>;
    return (
      <table className="table">
        <thead>
          <tr>
            <th className="l">Time</th>
            <th className="l">Instrument</th>
            <th className="l">Side</th>
            <th>Size</th>
            <th>Price</th>
            <th>Value</th>
            <th>Fee</th>
            <th className="l">Note</th>
          </tr>
        </thead>
        <tbody>
          {account.fills
            .slice(-200)
            .reverse()
            .map((f) => (
              <FillRow key={f.id} f={f} />
            ))}
        </tbody>
      </table>
    );
  }

  return <>{journal ?? <PaneState title="Nothing to review">Closed trades wait here for a note.</PaneState>}</>;
}

export function drawerTabs(positions: number, orders: number, toReview: number): TabDef<DrawerTab>[] {
  return [
    { id: 'positions', label: 'Positions', count: positions },
    { id: 'orders', label: 'Orders', count: orders },
    { id: 'fills', label: 'Fills' },
    { id: 'journal', label: 'Journal', count: toReview, strong: true },
  ];
}

export function Drawer({ book = 'live', quote }: { book?: Book; quote?: (id: string) => ReturnType<typeof quoteFor> }) {
  const [tab, setTab] = useState<DrawerTab>('positions');
  const account = useAccount((s) => s[book]);
  const positions = Object.keys(account.positions).length;
  const orders = workingOrders(account).length;
  const waiting = account.trades.filter((t) => t.closedAt !== undefined && !t.review).length;
  const seen = useRef(waiting);

  // A trade is not finished when it closes; it is finished when it is journaled. Bring the form up.
  useEffect(() => {
    if (waiting > seen.current) setTab('journal');
    seen.current = waiting;
  }, [waiting]);

  return (
    <section className="pane pane-drawer" aria-label="Positions, orders, fills and journal">
      <header className="pane-head">
        <Tabs label="Account" tabs={drawerTabs(positions, orders, waiting)} value={tab} onChange={setTab} />
      </header>
      <div className="pane-body" role="tabpanel">
        <DrawerBody tab={tab} book={book} {...(quote ? { quote, replay: true } : {})} journal={<ToReview book={book} />} />
      </div>
    </section>
  );
}
