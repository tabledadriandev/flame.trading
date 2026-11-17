import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { OPTION_COINS, fetchChain, optionRefused, optionTick, type Chain, type ChainRow, type Coin, type OptionTick } from '../data/deribit';
import { instrument } from '../data/instruments';
import { previewOption } from '../engine/engine';
import { optionLot, unrealised } from '../engine/rules';
import { posKey, type OptionSpec, type OrderInput, type Position } from '../engine/types';
import { SIM } from '../lib/env';
import { clock, dollars, money, parseNumber, pct } from '../lib/format';
import { useMedia, useNow } from '../lib/hooks';
import { greeks } from '../options/bs';
import { expiryText, optionName, optionSymbol, venueName, yearsTo } from '../options/contract';
import { Payoff } from '../options/PayoffChart';
import { STRATEGIES, type StrategyId } from '../options/strategies';
import { OptionStrategy } from './OptionStrategy';
import { chanceOfProfit, positionGreeks, summarise, type Leg } from '../options/payoff';
import { closeInput, useAccount } from '../state/account';
import { quoteFor, watch } from '../state/live';
import { useMarket } from '../state/market';
import { useOptionsView } from '../state/optionsView';
import { engineSettings } from '../state/settings';
import { Help, NumField, PaneState, Segmented, SideTag, Tabs } from '../ui/controls';

// Options: the chain for one underlying, a ticket for one contract at a time,
// its payoff, and what the open option positions are exposed to. Prices come
// from Deribit, converted from coin to dollars at its index price.

const REFRESH = 20_000;
const STRIKES_EACH_SIDE = 9;

const COLUMNS: { key: string; name: string; means: string }[] = [
  { key: 'bid', name: 'Bid', means: 'The most anyone is offering to pay. If you sell, this is the price you get.' },
  { key: 'ask', name: 'Ask', means: 'The least anyone will sell for. If you buy, this is the price you pay.' },
  { key: 'mid', name: 'Mid', means: 'Halfway between bid and ask: a fair guess at what the option is worth. Positions are marked here.' },
  { key: 'iv', name: 'IV', means: 'Implied volatility: how much yearly movement in the underlying the price assumes. Higher means dearer options.' },
  { key: 'delta', name: 'Delta', means: 'How much the option moves when the underlying moves $1. Also, roughly, the chance it finishes in the money.' },
  { key: 'oi', name: 'Open', means: 'Open interest: contracts that exist and have not been closed. More means an easier market to trade.' },
  { key: 'vol', name: 'Volume', means: 'Contracts traded in the last 24 hours.' },
];

const px = (v: number | null): string => (v === null ? '—' : dollars(v, v >= 100 ? 0 : 2));
const ivText = (v: number | null): string => (v === null ? '—' : `${(v * 100).toFixed(1)}%`);
const count = (v: number): string => (v >= 1000 ? `${(v / 1000).toFixed(1)}K` : v >= 10 ? v.toFixed(0) : v > 0 ? v.toFixed(1) : '—');
const contractsText = (n: number): string => `${Math.round(n * 1000) / 1000} ${Math.round(n * 1000) / 1000 === 1 ? 'contract' : 'contracts'}`;
const small = (v: number): string => (Math.abs(v) >= 0.01 || v === 0 ? v.toFixed(2) : v.toPrecision(2));

interface Pick {
  id: string;
  side: 'buy' | 'sell';
}

function rowDelta(r: ChainRow, now: number): number | null {
  if (r.iv === null) return null;
  return greeks({ kind: r.spec.kind, s: r.forward, k: r.spec.strike, t: yearsTo(r.spec.expiry, now), iv: r.iv }).delta;
}

function QuoteCell({ row, side, pick, onPick }: { row: ChainRow; side: 'buy' | 'sell'; pick: Pick | null; onPick: (p: Pick) => void }) {
  const value = side === 'buy' ? row.ask : row.bid;
  if (value === null) return <span className="sub">—</span>;
  const on = pick?.id === row.id && pick.side === side;
  return (
    <button
      type="button"
      className="chain-quote"
      aria-pressed={on}
      aria-label={`${side === 'buy' ? 'Buy' : 'Sell'} the ${row.spec.strike.toLocaleString('en-US')} ${row.spec.kind} at ${px(value)}`}
      onClick={() => onPick({ id: row.id, side })}
    >
      {px(value)}
    </button>
  );
}

function Half({ row, kind, now, pick, onPick, itm }: { row: ChainRow | undefined; kind: 'call' | 'put'; now: number; pick: Pick | null; onPick: (p: Pick) => void; itm: boolean }) {
  const cells: Record<string, React.ReactNode> = row
    ? {
        bid: <QuoteCell row={row} side="sell" pick={pick} onPick={onPick} />,
        ask: <QuoteCell row={row} side="buy" pick={pick} onPick={onPick} />,
        mid: px(row.bid !== null && row.ask !== null ? (row.bid + row.ask) / 2 : null),
        iv: ivText(row.iv),
        delta: rowDelta(row, now)?.toFixed(2) ?? '—',
        oi: count(row.oi),
        vol: count(row.volume),
      }
    : {};
  // Calls read outward from the strike, puts the same: the prices sit next to the strike on both sides.
  const order = kind === 'call' ? ['vol', 'oi', 'iv', 'delta', 'mid', 'bid', 'ask'] : ['bid', 'ask', 'mid', 'delta', 'iv', 'oi', 'vol'];
  return (
    <>
      {order.map((key) => (
        <td key={key} className={`chain-${key}`} data-itm={itm ? 'true' : undefined}>
          {row ? cells[key] : <span className="sub">—</span>}
        </td>
      ))}
    </>
  );
}

function ChainTable({ rows, now, pick, onPick, all, only }: { rows: ChainRow[]; now: number; pick: Pick | null; onPick: (p: Pick) => void; all: boolean; only: 'call' | 'put' | null }) {
  const forward = rows[0]?.forward ?? 0;
  const strikes = useMemo(() => {
    const by = new Map<number, { call?: ChainRow; put?: ChainRow }>();
    for (const r of rows) {
      const at = by.get(r.spec.strike) ?? {};
      at[r.spec.kind] = r;
      by.set(r.spec.strike, at);
    }
    return [...by].sort((a, b) => a[0] - b[0]);
  }, [rows]);
  let atm = 0;
  for (let i = 1; i < strikes.length; i++) if (Math.abs(strikes[i]![0] - forward) < Math.abs(strikes[atm]![0] - forward)) atm = i;
  const shown = all ? strikes : strikes.slice(Math.max(0, atm - STRIKES_EACH_SIDE), atm + STRIKES_EACH_SIDE + 1);
  const head = (kind: 'call' | 'put') => {
    const order = kind === 'call' ? ['vol', 'oi', 'iv', 'delta', 'mid', 'bid', 'ask'] : ['bid', 'ask', 'mid', 'delta', 'iv', 'oi', 'vol'];
    return order.map((key) => {
      const c = COLUMNS.find((x) => x.key === key)!;
      return (
        <th key={key} className={`chain-${key}`} title={c.means} scope="col">
          {c.name}
        </th>
      );
    });
  };

  return (
    <table className="table chain" data-only={only ?? undefined}>
      <thead>
        <tr className="chain-sides">
          {only !== 'put' ? (
            <th colSpan={7} className="chain-side" scope="colgroup">
              Calls <span className="sub">the right to buy</span>
            </th>
          ) : null}
          <th className="chain-strike" scope="col">
            Strike
          </th>
          {only !== 'call' ? (
            <th colSpan={7} className="chain-side" scope="colgroup">
              Puts <span className="sub">the right to sell</span>
            </th>
          ) : null}
        </tr>
        <tr>
          {only !== 'put' ? head('call') : null}
          <th className="chain-strike">
            <span className="sr-only">Strike price</span>
          </th>
          {only !== 'call' ? head('put') : null}
        </tr>
      </thead>
      <tbody>
        {shown.map(([strike, pair], n) => {
          const isAtm = strikes[atm]?.[0] === strike;
          return (
            <tr key={strike} data-atm={isAtm ? 'true' : undefined} data-first={n === 0 ? 'true' : undefined}>
              {only !== 'put' ? <Half row={pair.call} kind="call" now={now} pick={pick} onPick={onPick} itm={strike < forward} /> : null}
              <th className="chain-strike num" scope="row">
                {strike.toLocaleString('en-US')}
                {isAtm ? <span className="chain-atm">At the money</span> : null}
              </th>
              {only !== 'call' ? <Half row={pair.put} kind="put" now={now} pick={pick} onPick={onPick} itm={strike > forward} /> : null}
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function sentences(args: {
  spec: OptionSpec;
  side: 'buy' | 'sell';
  qty: number;
  price: number;
  preview: Exclude<ReturnType<typeof previewOption>, { error: string }>;
  held: Position | undefined;
  leg: Leg;
  spot: number;
  now: number;
}): { lines: string[]; chance: number | null } {
  const { spec, side, qty, price, preview, held, leg, spot, now } = args;
  const what = instrument(spec.underlying).symbol;
  const n = contractsText(qty / spec.multiplier);
  const premium = qty * price;
  const fee = preview.fee > 0 ? ` and ${dollars(preview.fee, 2)} in fees` : '';
  const sum = summarise([leg]);
  const be = sum.breakevens[0];
  const lines: string[] = [];

  if (preview.act === 'close-long' && held) {
    lines.push(`Sell the ${n} you hold for ${dollars(premium)}${preview.fee > 0 ? `, less ${dollars(preview.fee, 2)} in fees` : ''}.`);
    lines.push(`Result on this trade: ${money((price - held.entry) * qty - preview.fee, { signed: true })}.`);
    return { lines, chance: null };
  }
  if (preview.act === 'close-short' && held) {
    lines.push(`Buy back the ${n} you sold for ${dollars(premium)}${fee}.`);
    if (held.margin > 0) lines.push(`${dollars(held.margin * Math.min(1, qty / held.qty))} that was set aside is released.`);
    lines.push(`Result on this trade: ${money((held.entry - price) * qty - preview.fee, { signed: true })}.`);
    return { lines, chance: null };
  }

  if (side === 'buy') {
    lines.push(`Buy ${n} for ${dollars(premium)}${fee}.`);
    lines.push(`The most you can lose is ${dollars(premium + preview.fee)}: what you pay.`);
    lines.push(sum.maxGain === Infinity ? 'The most you can make has no limit.' : `The most you can make is ${dollars(sum.maxGain)}, if ${what} falls to zero.`);
    if (be !== undefined) lines.push(`You break even with ${what} ${spec.kind === 'call' ? 'above' : 'below'} ${dollars(be)} at expiry.`);
  } else {
    lines.push(`Sell ${n} and receive ${dollars(premium)}${preview.fee > 0 ? `, less ${dollars(preview.fee, 2)} in fees` : ''}.`);
    const cover = preview.cover;
    if (cover?.kind === 'shares') {
      lines.push(`The ${qty} ${what} you hold cover it and cannot be sold until it is closed or expires.`);
      lines.push(`The most you can make on the option is the premium. If ${what} finishes above ${dollars(spec.strike)} you owe the difference in cash; your ${what} gains as much, so your profit above that price is capped.`);
    } else if (cover?.kind === 'cash') {
      lines.push(`${dollars(preview.collateral)} is set aside until it is closed or expires: the strike price for every unit.`);
      lines.push(`The most you can make is the premium. The most you can lose is ${dollars(sum.maxLoss)}, if ${what} falls to zero.`);
    } else if (cover?.kind === 'spread') {
      const other = instrument(cover.key.split('|')[0] ?? '').symbol;
      lines.push(`The ${other} you hold caps the loss and cannot be sold until this is closed.`);
      lines.push(preview.collateral > 0 ? `${dollars(preview.collateral)} is set aside: the most the pair can lose at expiry.` : 'Nothing more is set aside: the pair cannot lose more than you already paid.');
    }
    if (be !== undefined) lines.push(`On the option alone you break even with ${what} ${spec.kind === 'call' ? 'below' : 'above'} ${dollars(be)} at expiry.`);
  }
  return { lines, chance: chanceOfProfit([leg], spot, now) };
}

function Ticket({ row, side, onSide, chainIndex, chainAt }: { row: ChainRow; side: 'buy' | 'sell'; onSide: (s: 'buy' | 'sell') => void; chainIndex: number; chainAt: number }) {
  const feed = useMarket((s) => s.feeds.deribit);
  const account = useAccount((s) => s.live);
  const now = useNow(500);
  const name = venueName(row.id);
  const tick: OptionTick | undefined = optionTick(name);
  const spec = row.spec;
  const what = instrument(spec.underlying).symbol;
  const lot = optionLot(spec);

  const bid = tick ? tick.bid : row.bid;
  const ask = tick ? tick.ask : row.ask;
  const mark = tick?.mark ?? row.mark;
  const mid = bid !== null && ask !== null ? (bid + ask) / 2 : mark;
  const iv = tick?.iv ?? row.iv;
  const index = tick?.index ?? chainIndex;
  const forward = tick?.forward ?? row.forward;

  const [contracts, setContracts] = useState('1');
  const [type, setType] = useState<'limit' | 'market'>('limit');
  const [limitText, setLimitText] = useState<string | null>(null);
  // A new contract starts from its own mid, not from the last one's price.
  useEffect(() => {
    setLimitText(null);
  }, [row.id]);

  const n = parseNumber(contracts);
  const qty = n * spec.multiplier;
  const touch = side === 'buy' ? ask : bid;
  const limit = limitText === null ? Number(mid.toFixed(mid >= 100 ? 0 : 2)) : parseNumber(limitText);
  const price = type === 'limit' ? limit : (touch ?? NaN);
  const q = quoteFor(row.id);
  const gone = optionRefused(name);
  // Before a live quote arrives the preview still needs the underlying's price, or the fee would show as its cap.
  const ref = q ?? { bid: bid ?? 0, ask: ask ?? Infinity, last: mid, t: now, underlying: index };
  const input: OrderInput = { instrument: row.id, cls: 'option', mode: 'spot', side, type, qty, option: spec, ...(type === 'limit' ? { limit } : {}) };

  const long = account.positions[posKey(row.id, 'spot')];
  const short = account.positions[posKey(row.id, 'lev')];
  const held = side === 'sell' ? long : short;

  let problem: string | null = null;
  let preview: ReturnType<typeof previewOption> | null = null;
  if (!(n > 0)) problem = 'Enter how many contracts.';
  else if (!(price > 0) || !Number.isFinite(price)) problem = type === 'limit' ? 'Enter a limit price.' : side === 'buy' ? 'Nobody is offering this option right now. Use a limit order.' : 'Nobody is bidding for this option right now. Use a limit order.';
  else {
    preview = previewOption(account, input, price, ref, engineSettings(), now);
    if ('error' in preview) problem = preview.error;
  }
  if (gone) problem = 'Deribit is not quoting this contract any more: it may have expired since the chain was read. Refresh the chain and pick another.';
  const waiting = !q && !problem;

  const leg: Leg = { spec, side, qty, price: Number.isFinite(price) ? price : mid, iv, carry: index > 0 ? forward / index : 1 };
  const text = preview && !('error' in preview) ? sentences({ spec, side, qty, price, preview, held, leg, spot: index, now }) : null;
  const rests = type === 'limit' && touch !== null && (side === 'buy' ? limit < touch : limit > touch);

  function submit() {
    // The price is read at the moment of the click, not when the ticket was last drawn.
    const at = quoteFor(row.id);
    if (problem || !at) return;
    useAccount.getState().place(input, at);
  }

  return (
    <section className="opt-ticket" aria-label="Option ticket">
      <header className="opt-ticket-head">
        <h2 className="opt-contract">{optionSymbol(spec)}</h2>
        <p className="sub">{optionName(spec)}.</p>
      </header>

      <Segmented<'buy' | 'sell'>
        label="Side"
        block
        tall
        value={side}
        onChange={onSide}
        options={[
          {
            value: 'buy',
            label: (
              <>
                <span className="side-glyph hot" aria-hidden="true">▲</span> Buy
              </>
            ),
          },
          {
            value: 'sell',
            label: (
              <>
                <span className="side-glyph cold" aria-hidden="true">▼</span> Sell
              </>
            ),
          },
        ]}
      />

      {!tick && !gone ? (
        <p className="opt-stale opt-stale-inline" role="status">
          {feed === 'down' ? 'Live prices from Deribit cannot be reached.' : feed === 'reconnecting' ? 'Live prices from Deribit dropped; Flame is reconnecting.' : 'Waiting for a live price from Deribit.'} The numbers below are from the chain read at {clock(chainAt)} and cannot be traded against.
        </p>
      ) : null}

      <dl className="opt-quote num">
        <div>
          <dt>Bid</dt>
          <dd>{px(bid)}</dd>
        </div>
        <div>
          <dt>Ask</dt>
          <dd>{px(ask)}</dd>
        </div>
        <div>
          <dt>Mid</dt>
          <dd>{px(mid)}</dd>
        </div>
        <div>
          <dt>IV</dt>
          <dd>{ivText(iv)}</dd>
        </div>
      </dl>

      <div className="opt-fields">
        <NumField
          label="Contracts"
          value={contracts}
          onChange={(t) => setContracts(t)}
          note={spec.multiplier === 1 ? `One contract is 1 ${what}. Steps of ${lot}.` : `One contract is ${spec.multiplier} shares.`}
          invalid={!(n > 0)}
        />
        <div className="field">
          <span className="field-label">Order</span>
          <Segmented<'limit' | 'market'>
            label="Order type"
            tall
            value={type}
            onChange={setType}
            options={[
              { value: 'limit', label: 'Limit', title: 'Fills only at your price or better. Starts at the mid.' },
              { value: 'market', label: 'Market', title: 'Fills now: a buy pays the ask, a sale gets the bid.' },
            ]}
          />
        </div>
        {type === 'limit' ? (
          <NumField
            label="Limit price"
            prefix="$"
            value={limitText ?? String(limit)}
            onChange={(t) => setLimitText(t)}
            action={{ label: 'Mid', onClick: () => setLimitText(null), title: 'Set the limit back to the mid price' }}
            note={`Per ${spec.multiplier === 1 ? what : 'share'}.`}
          />
        ) : null}
      </div>

      <div className="ticket-preview" aria-live="polite">
        {problem ? (
          <p className="ticket-problem">{problem}</p>
        ) : text ? (
          <>
            {text.lines.map((l) => (
              <p key={l}>{l}</p>
            ))}
            {text.chance !== null ? (
              <p>
                The option market prices the chance of this finishing in profit at about {Math.round(text.chance * 100)}%.{' '}
                <Help>
                  The chance that {what} ends beyond your breakeven at expiry, read from the spread of prices that the option&rsquo;s implied volatility describes (a lognormal distribution). It is what the market is pricing, not a forecast, and it says nothing about how big the profit or loss would be.
                </Help>
              </p>
            ) : null}
            {rests ? <p className="ticket-hint">This limit is inside the spread, so it waits until the {side === 'buy' ? 'ask comes down' : 'bid comes up'} to it.</p> : null}
          </>
        ) : null}
      </div>

      <button type="button" className="btn btn-primary ticket-go" data-side={side} disabled={Boolean(problem) || !q} onClick={submit}>
        <span className="ticket-go-text">{waiting ? 'Waiting for a live price' : `${side === 'buy' ? 'Buy' : 'Sell'} ${n > 0 ? contractsText(n) : ''}`}</span>
      </button>

      <p className="opt-note">
        Deribit quotes this option in {what}: {index > 0 ? (mid / index).toFixed(4) : '—'} {what}. Flame converts at Deribit&rsquo;s index price ({dollars(index)}) and your paper account pays in dollars. It settles in cash at 08:00 UTC on {expiryText(spec.expiry)} at what it is worth then: nothing, if it finishes out of the money.
      </p>

      <h3 className="opt-sub">Payoff</h3>
      <Payoff legs={[leg]} spot={index} now={now - (now % 60_000)} symbol={what} />
    </section>
  );
}

function Positions() {
  const account = useAccount((s) => s.live);
  const now = useNow(1_000);
  const list = Object.values(account.positions).filter((p) => p.option);
  if (list.length === 0) return null;

  const rows = list.map((p) => {
    const spec = p.option!;
    const tick = optionTick(venueName(p.instrument));
    const q = quoteFor(p.instrument);
    const mark = q?.last ?? tick?.mark ?? null;
    const g = tick && tick.iv !== null ? positionGreeks(spec, p.dir, p.qty, tick.forward, tick.iv, now) : null;
    return { p, spec, mark, g, u: mark !== null ? unrealised(p, mark) : null };
  });
  const underlyings = new Set(rows.map((r) => r.spec.underlying));
  const one = underlyings.size === 1 ? instrument([...underlyings][0]!).symbol : null;
  const known = rows.filter((r) => r.g);
  const total = known.reduce((t, r) => ({ delta: t.delta + r.g!.delta, gamma: t.gamma + r.g!.gamma, theta: t.theta + r.g!.theta, vega: t.vega + r.g!.vega }), { delta: 0, gamma: 0, theta: 0, vega: 0 });
  const complete = known.length === rows.length && rows.length > 0;

  return (
    <section className="opt-positions" aria-label="Option positions">
      <header className="opt-positions-head">
        <h2 className="pane-title">Your option positions</h2>
        <span className="sub">Each greek is for the whole position, in dollars or units of the underlying.</span>
      </header>
      <div className="opt-scroll">
        <table className="table">
          <thead>
            <tr>
              <th className="l">Contract</th>
              <th className="l">Side</th>
              <th>Size</th>
              <th>Entry</th>
              <th>Mark</th>
              <th>P&amp;L</th>
              <th title="How much the position gains when the underlying rises $1">Delta</th>
              <th title="How much delta itself changes when the underlying moves $1">Gamma</th>
              <th title="How much the position gains or loses as one day passes">Theta</th>
              <th title="How much the position gains when implied volatility rises one point">Vega</th>
              <th>
                <span className="sr-only">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ p, spec, mark, g, u }) => (
              <tr key={p.key}>
                <td className="l">
                  <strong>{optionSymbol(spec)}</strong>
                </td>
                <td className="l">
                  <SideTag side={p.dir === 'long' ? 'buy' : 'sell'}>{p.dir === 'long' ? 'Bought' : 'Sold'}</SideTag>
                </td>
                <td>{Math.round((p.qty / spec.multiplier) * 1000) / 1000}</td>
                <td>{px(p.entry)}</td>
                <td>{px(mark)}</td>
                <td className={u === null ? 'sub' : u >= 0 ? 'hot' : 'cold'}>
                  {u === null ? '—' : money(u, { signed: true })} {u !== null && p.entry > 0 ? <span className="sub">{pct((u / (p.entry * p.qty)) * 100)}</span> : null}
                </td>
                <td>{g ? small(g.delta) : '—'}</td>
                <td>{g ? small(g.gamma) : '—'}</td>
                <td>{g ? money(g.theta, { signed: true }) : '—'}</td>
                <td>{g ? money(g.vega, { signed: true }) : '—'}</td>
                <td>
                  <button
                    type="button"
                    className="btn btn-sm"
                    onClick={() => {
                      const input = closeInput(account, p.key);
                      if (input) useAccount.getState().place(input, quoteFor(p.instrument));
                    }}
                  >
                    Close
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
          {complete ? (
            <tfoot>
              <tr>
                <th className="l" colSpan={6} scope="row">
                  All option positions
                </th>
                <td>{one ? small(total.delta) : '—'}</td>
                <td>{one ? small(total.gamma) : '—'}</td>
                <td>{money(total.theta, { signed: true })}</td>
                <td>{money(total.vega, { signed: true })}</td>
                <td />
              </tr>
            </tfoot>
          ) : null}
        </table>
      </div>
      {complete ? (
        <ul className="opt-meaning">
          {one ? (
            <li>
              Delta {small(total.delta)}: these positions {total.delta >= 0 ? 'gain' : 'lose'} about {dollars(Math.abs(total.delta), 2)} for each $1 {one} rises, and the reverse when it falls.
            </li>
          ) : (
            <li>Delta and gamma are per underlying, so they are not added across different ones.</li>
          )}
          {one ? <li>Gamma {small(total.gamma)}: that delta itself changes by this much for each $1 {one} moves.</li> : null}
          <li>
            Theta {money(total.theta, { signed: true })}: they {total.theta <= 0 ? 'lose' : 'gain'} about {dollars(Math.abs(total.theta))} a day if nothing else changes.
          </li>
          <li>
            Vega {money(total.vega, { signed: true })}: they {total.vega >= 0 ? 'gain' : 'lose'} about {dollars(Math.abs(total.vega))} if implied volatility rises one point.
          </li>
        </ul>
      ) : (
        <p className="sub opt-wait">Greeks appear once a live price has arrived for every position.</p>
      )}
    </section>
  );
}

export function Options() {
  const coin = useOptionsView((s) => s.coin);
  const setCoin = useOptionsView((s) => s.setCoin);
  const [chain, setChain] = useState<Chain | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [expiry, setExpiry] = useState<number | null>(null);
  const [pick, setPick] = useState<Pick | null>(null);
  const [all, setAll] = useState(false);
  const [kind, setKind] = useState<'call' | 'put'>('call');
  const [busy, setBusy] = useState(false);
  const [mode, setMode] = useState<'single' | StrategyId>('single');
  const narrow = useMedia('(max-width: 760px)');
  const now = useNow(30_000);
  const ticket = useRef<HTMLDivElement>(null);

  const showing = useRef(coin);
  showing.current = coin;
  const load = useCallback(() => {
    if (SIM) return;
    setBusy(true);
    fetchChain(coin)
      .then((c) => {
        if (showing.current !== coin) return;
        setChain(c);
        setError(null);
      })
      .catch((err: unknown) => {
        console.warn('[flame] option chain failed', err);
        if (showing.current === coin) setError(err instanceof Error ? err.message : 'The option chain could not be loaded.');
      })
      .finally(() => setBusy(false));
  }, [coin]);

  useEffect(() => {
    setChain(null);
    setError(null);
    setPick(null);
    setExpiry(null);
    load();
    // Deribit asks clients not to poll the whole chain hard: refresh slowly, and not at all while hidden.
    const timer = setInterval(() => {
      if (!document.hidden) load();
    }, REFRESH);
    return () => clearInterval(timer);
  }, [load]);

  // The contract in the ticket gets live quotes for as long as it is there.
  useEffect(() => (pick ? watch([pick.id]) : undefined), [pick?.id]);

  const expiries = useMemo(() => (chain ? [...new Set(chain.rows.map((r) => r.spec.expiry))].filter((e) => e > Date.now()).sort((a, b) => a - b) : []), [chain]);
  const current = expiry !== null && expiries.includes(expiry) ? expiry : (expiries.find((e) => e - now > 6 * 86_400_000) ?? expiries[0] ?? null);
  const rows = useMemo(() => (chain && current !== null ? chain.rows.filter((r) => r.spec.expiry === current) : []), [chain, current]);
  const picked = pick && chain ? chain.rows.find((r) => r.id === pick.id) : undefined;

  function choose(p: Pick) {
    setPick(p);
    // Picking a price in the chain is always about one contract.
    setMode('single');
    if (narrow) requestAnimationFrame(() => ticket.current?.scrollIntoView({ behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' }));
  }

  const head = (
    <header className="jtop">
      <h1 className="page-title" aria-hidden="true">
        Options
      </h1>
      <p className="lab-lede">A call is the right to buy at the strike price; a put is the right to sell. Buy one and the premium is all you can lose. Prices are live from Deribit, in dollars.</p>
    </header>
  );

  if (SIM) {
    return (
      <div className="options">
        {head}
        <PaneState title="Options are not shown with the simulated feed">The simulated feed makes up prices for coins and stocks, but it has no option chain to go with them. Open Flame without ?sim=1 to see real option prices.</PaneState>
      </div>
    );
  }

  return (
    <div className="options">
      {head}

      <div className="opt-bar">
        <Segmented<Coin> label="Underlying" value={coin} onChange={setCoin} options={OPTION_COINS.map((c) => ({ value: c, label: c }))} />
        {chain ? (
          <span className="opt-index num">
            {coin} index <strong>{dollars(chain.index)}</strong>
          </span>
        ) : null}
        <span className="opt-asof sub">{chain ? `Chain read at ${clock(chain.t)}; it refreshes every 20 seconds. The contract in the ticket streams live.` : ''}</span>
        <button type="button" className="btn btn-sm" onClick={load} disabled={busy}>
          <RefreshCw size={12} aria-hidden="true" /> Refresh
        </button>
      </div>

      {error && !chain ? (
        <PaneState title="The option chain could not be loaded" action={<button type="button" className="btn" onClick={load}>Try again</button>}>
          {error}
        </PaneState>
      ) : !chain ? (
        <PaneState title="Loading the option chain" />
      ) : (
        <div className="opt-body">
          <section className="opt-chain" aria-label={`${coin} option chain`}>
            {error ? <p className="opt-stale">The chain could not be refreshed ({error}) These prices are from {clock(chain.t)}.</p> : null}
            <Tabs<string>
              label="Expiry"
              value={String(current)}
              onChange={(id) => setExpiry(Number(id))}
              tabs={expiries.map((e) => {
                const days = Math.max(0, Math.round((e - now) / 86_400_000));
                return { id: String(e), label: `${expiryText(e, e - now > 300 * 86_400_000)} (${days}d)` };
              })}
            />
            {narrow ? (
              <Segmented<'call' | 'put'> label="Calls or puts" block value={kind} onChange={setKind} options={[{ value: 'call', label: 'Calls' }, { value: 'put', label: 'Puts' }]} />
            ) : null}
            <div className="opt-scroll">
              <ChainTable rows={rows} now={now} pick={pick} onPick={choose} all={all} only={narrow ? kind : null} />
            </div>
            <div className="opt-foot">
              <button type="button" className="btn btn-sm" onClick={() => setAll(!all)} aria-pressed={all}>
                {all ? 'Show strikes near the money' : 'Show every strike'}
              </button>
              <span className="sub">Tinted cells are in the money: worth something if the option expired now. Click an ask to buy or a bid to sell.</span>
            </div>
            <details className="opt-columns">
              <summary>What the columns mean</summary>
              <dl>
                {COLUMNS.map((c) => (
                  <div key={c.key}>
                    <dt>{c.name}</dt>
                    <dd>{c.means}</dd>
                  </div>
                ))}
              </dl>
            </details>
            <p className="sub opt-credit">Option data from Deribit. Positions settle in cash at expiry; real exchanges can also deliver the asset, and stock options can be assigned early. Flame does neither.</p>
          </section>

          <div className="opt-side" ref={ticket}>
            <label className="field opt-mode">
              <span className="field-label">What to trade</span>
              <span className="field-box">
                <select value={mode} onChange={(e) => setMode(e.target.value as 'single' | StrategyId)}>
                  <option value="single">One contract, picked from the chain</option>
                  {STRATEGIES.map((x) => (
                    <option key={x.id} value={x.id}>
                      {x.name}
                    </option>
                  ))}
                </select>
              </span>
            </label>
            {mode !== 'single' ? (
              <OptionStrategy key={mode} id={mode} rows={rows} chainIndex={chain.index} chainAt={chain.t} />
            ) : picked && pick ? (
              <Ticket key={picked.id} row={picked} side={pick.side} onSide={(side) => setPick({ id: picked.id, side })} chainIndex={chain.index} chainAt={chain.t} />
            ) : (
              <PaneState title="Pick a contract">Click an ask price in the chain to buy that option, or a bid to sell it. The ticket shows what it costs, the most you can lose and make, and the payoff.</PaneState>
            )}
          </div>
        </div>
      )}

      <Positions />
    </div>
  );
}
