import { useEffect, useMemo, useState } from 'react';
import { optionTick, type ChainRow } from '../data/deribit';
import { instrument } from '../data/instruments';
import { placeOrder } from '../engine/engine';
import { optionLot } from '../engine/rules';
import type { Account, OrderInput, Quote } from '../engine/types';
import { clock, dollars, parseNumber } from '../lib/format';
import { useNow } from '../lib/hooks';
import { optionSymbol, venueName } from '../options/contract';
import { Payoff } from '../options/PayoffChart';
import { chanceOfProfit, summarise, type Leg } from '../options/payoff';
import { STRATEGIES, defaultStrikes, strategyLegs, type StrategyId } from '../options/strategies';
import { useAccount } from '../state/account';
import { quoteFor, watch } from '../state/live';
import { engineSettings } from '../state/settings';
import { toast } from '../state/toasts';
import { Help, NumField, SideTag } from '../ui/controls';

// A strategy is two orders (or one, against something already held) placed
// together: the bought leg first, so that the sold leg finds its cover. The
// preview runs the real engine on a copy of the account, so what it says is
// exactly what placing it would do.

const px = (v: number | null): string => (v === null ? '—' : dollars(v, v >= 100 ? 0 : 2));

interface PricedLeg {
  row: ChainRow;
  side: 'buy' | 'sell';
  /** What an order fills against: live when there is a live quote, else built from the chain for the preview only. */
  quote: Quote;
  live: boolean;
  price: number | null;
}

export function OptionStrategy({ id, rows, chainIndex, chainAt }: { id: StrategyId; rows: ChainRow[]; chainIndex: number; chainAt: number }) {
  const account = useAccount((s) => s.live);
  const now = useNow(500);
  const strategy = STRATEGIES.find((s) => s.id === id)!;
  const strikes = useMemo(() => [...new Set(rows.map((r) => r.spec.strike))].sort((a, b) => a - b), [rows]);
  const forward = rows[0]?.forward ?? chainIndex;
  const atm = useMemo(() => {
    let best = 0;
    for (let i = 1; i < strikes.length; i++) if (Math.abs(strikes[i]! - forward) < Math.abs(strikes[best]! - forward)) best = i;
    return best;
  }, [strikes, forward]);
  const expiry = rows[0]?.spec.expiry;

  const [chosen, setChosen] = useState<number[]>(() => defaultStrikes(id, strikes, atm));
  const [contracts, setContracts] = useState('1');
  // A different strategy or expiry starts again from strikes around the money.
  useEffect(() => {
    setChosen(defaultStrikes(id, strikes, atm));
  }, [id, expiry]);

  const built = strategyLegs(id, chosen);
  const wanted = Array.isArray(built)
    ? built.map((l) => ({ leg: l, row: rows.find((r) => r.spec.kind === l.kind && r.spec.strike === l.strike) })).filter((x): x is { leg: (typeof built)[number]; row: ChainRow } => x.row !== undefined)
    : [];
  const ids = wanted.map((w) => w.row.id).join(',');
  useEffect(() => (ids ? watch(ids.split(',')) : undefined), [ids]);

  const sample = rows[0]?.spec;
  if (!sample) return null;
  const what = instrument(sample.underlying).symbol;
  const lot = optionLot(sample);
  const n = parseNumber(contracts);
  const qty = n * sample.multiplier;

  const legs: PricedLeg[] = wanted.map(({ leg, row }) => {
    const live = quoteFor(row.id);
    const tick = optionTick(venueName(row.id));
    const bid = tick ? tick.bid : row.bid;
    const ask = tick ? tick.ask : row.ask;
    const mid = bid !== null && ask !== null ? (bid + ask) / 2 : row.mark;
    const quote: Quote = live ?? { bid: bid ?? 0, ask: ask ?? Infinity, last: mid, t: now, underlying: tick?.index ?? chainIndex };
    return { row, side: leg.side, quote, live: live !== undefined, price: leg.side === 'buy' ? ask : bid };
  });
  const allLive = legs.length > 0 && legs.every((l) => l.live);

  // Run the engine on a copy: the same rules, the same refusals, nothing committed.
  let problem: string | null = Array.isArray(built) ? null : built.error;
  if (!problem && wanted.length !== (built as unknown[]).length) problem = 'Deribit does not list one of these strikes for this expiry.';
  if (!problem && !(n > 0)) problem = 'Enter how many contracts.';
  let sim: Account = account;
  let fees = 0;
  let setAside = 0;
  let cover: string | null = null;
  if (!problem) {
    for (const l of legs) {
      const input: OrderInput = { instrument: l.row.id, cls: 'option', mode: 'spot', side: l.side, type: 'market', qty, option: l.row.spec };
      const r = placeOrder(sim, input, l.quote, engineSettings(), now);
      const refused = r.events.find((e) => e.type === 'rejected');
      if (refused && refused.type === 'rejected') {
        problem = legs.length > 1 ? `The ${l.side === 'buy' ? 'bought' : 'sold'} leg would be refused. ${refused.reason}` : refused.reason;
        break;
      }
      for (const e of r.events) if (e.type === 'fill') fees += e.fill.fee;
      sim = r.account;
    }
    if (!problem) {
      for (const l of legs.filter((x) => x.side === 'sell')) {
        const pos = sim.positions[`${l.row.id}|lev`];
        const was = account.positions[`${l.row.id}|lev`];
        if (pos) {
          setAside += pos.margin - (was?.margin ?? 0);
          cover = pos.cover?.kind ?? null;
        }
      }
      // A covered call is the one against the asset itself. Sold against a bought call it is a spread, which
      // is a different trade with different limits: say so instead of describing the wrong one.
      if (id === 'covered-call' && cover !== 'shares') {
        problem = `A covered call needs ${qty} ${what} held on the desk, bought spot. You do not hold that much free. Buy it first, or use a call spread.`;
      }
      if (id === 'cash-put' && cover === 'spread') {
        problem = 'You hold a put on the same expiry, so selling this one would make a put spread, not a cash-secured put. Use the put spread template, or sell it from the chain.';
      }
    }
  }

  const priced: Leg[] = legs.map((l) => ({ spec: l.row.spec, side: l.side, qty, price: l.price ?? l.row.mark, iv: l.row.iv, carry: chainIndex > 0 ? l.row.forward / chainIndex : 1 }));
  const net = priced.reduce((sum, l) => sum + (l.side === 'buy' ? -1 : 1) * l.price * l.qty, 0);
  const sum = priced.length > 0 ? summarise(priced) : null;
  const chance = priced.length > 0 ? chanceOfProfit(priced, chainIndex, now) : null;

  function place() {
    if (problem || !allLive) return;
    let filled = 0;
    for (const l of legs) {
      const q = quoteFor(l.row.id);
      const input: OrderInput = { instrument: l.row.id, cls: 'option', mode: 'spot', side: l.side, type: 'market', qty, option: l.row.spec };
      const events = useAccount.getState().place(input, q);
      if (!events.some((e) => e.type === 'fill')) {
        // The account store has already said why. Say what that leaves the reader holding.
        if (filled > 0) toast(`Only the first leg of the ${strategy.name.toLowerCase()} filled. You now hold ${optionSymbol(legs[0]!.row.spec)} on its own: close it, or place the other leg from the chain.`, { sticky: true });
        return;
      }
      filled += 1;
    }
  }

  return (
    <section className="opt-ticket" aria-label={`${strategy.name} ticket`}>
      <header className="opt-ticket-head">
        <h2 className="opt-contract">{strategy.name}</h2>
        <p className="sub">{strategy.idea}</p>
      </header>

      {!allLive && legs.length > 0 ? (
        <p className="opt-stale opt-stale-inline" role="status">
          Waiting for live prices from Deribit for {legs.length === 1 ? 'this contract' : 'both legs'}. The numbers below are from the chain read at {clock(chainAt)} and cannot be traded against.
        </p>
      ) : null}

      <div className="opt-fields">
        {strategy.strikes.map((label, i) => (
          <label className="field" key={label}>
            <span className="field-label">{label}</span>
            <span className="field-box">
              <select
                value={chosen[i] ?? ''}
                onChange={(e) => {
                  const next = [...chosen];
                  next[i] = Number(e.target.value);
                  setChosen(next);
                }}
              >
                {strikes.map((k) => (
                  <option key={k} value={k}>
                    {k.toLocaleString('en-US')}
                  </option>
                ))}
              </select>
            </span>
          </label>
        ))}
        <NumField label="Contracts" value={contracts} onChange={(t) => setContracts(t)} note={sample.multiplier === 1 ? `One contract is 1 ${what}. Steps of ${lot}.` : `One contract is ${sample.multiplier} shares.`} invalid={!(n > 0)} />
      </div>

      {legs.length > 0 ? (
        <table className="table opt-legs">
          <thead>
            <tr>
              <th className="l">Leg</th>
              <th className="l">Contract</th>
              <th>Fills at</th>
            </tr>
          </thead>
          <tbody>
            {legs.map((l) => (
              <tr key={l.row.id}>
                <td className="l">
                  <SideTag side={l.side}>{l.side === 'buy' ? 'Buy' : 'Sell'}</SideTag>
                </td>
                <td className="l">{optionSymbol(l.row.spec)}</td>
                <td>{px(l.price)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}

      <div className="ticket-preview" aria-live="polite">
        {problem ? (
          <p className="ticket-problem">{problem}</p>
        ) : sum ? (
          <>
            <p>
              {net < 0 ? `You pay ${dollars(-net, 2)}` : `You receive ${dollars(net, 2)}`}
              {fees > 0 ? `${net < 0 ? ' and' : ', less'} ${dollars(fees, 2)} in fees` : ''}.
            </p>
            {cover === 'cash' ? <p>{dollars(setAside, 2)} is set aside until it is closed or expires: the strike price for every unit.</p> : null}
            {cover === 'shares' ? <p>The {qty} {what} you hold cover it and cannot be sold until it is closed or expires.</p> : null}
            {cover === 'spread' ? <p>{setAside > 0 ? `${dollars(setAside, 2)} is set aside: the most the pair can lose at expiry.` : 'The bought leg covers the sold one. Nothing more is set aside, and the bought leg cannot be sold on its own until the sold one is closed.'}</p> : null}
            {cover === 'shares' ? (
              <p>The most you can make on the option is the premium. If {what} finishes above {dollars(priced[0]!.spec.strike, 0)} you owe the difference in cash; your {what} gains as much, so your profit above that price is capped.</p>
            ) : (
              <>
                <p>The most you can lose is {sum.maxLoss === Infinity ? 'not limited' : dollars(sum.maxLoss + fees, 2)}{net < 0 ? ': what you pay' : ''}.</p>
                <p>The most you can make {sum.maxGain === Infinity ? 'has no limit' : `is ${dollars(Math.max(0, sum.maxGain - fees), 2)}`}.</p>
              </>
            )}
            {sum.breakevens.length > 0 ? (
              <p>
                You break even with {what} at {sum.breakevens.map((b) => dollars(b, b >= 1000 ? 0 : 2)).join(' or ')} at expiry.
              </p>
            ) : null}
            {chance !== null ? (
              <p>
                The option market prices the chance of this finishing in profit at about {Math.round(chance * 100)}%.{' '}
                <Help>The chance that {what} ends in a price range where these legs make money at expiry, read from the spread of prices that the first leg&rsquo;s implied volatility describes. It is what the market is pricing, not a forecast.</Help>
              </p>
            ) : null}
          </>
        ) : null}
      </div>

      <button type="button" className="btn btn-primary ticket-go" data-side={legs[0]?.side ?? 'buy'} disabled={Boolean(problem) || !allLive} onClick={place}>
        <span className="ticket-go-text">{!problem && !allLive ? 'Waiting for live prices' : `Place the ${strategy.name.toLowerCase()}`}</span>
      </button>

      <p className="opt-note">
        Each leg is a market order: buys fill at the ask and sells at the bid, the bought leg first. They fill one after the other, so the prices can move between them. Every leg settles in cash at 08:00 UTC on its expiry day.
      </p>

      {priced.length > 0 && !problem ? (
        <>
          <h3 className="opt-sub">Payoff</h3>
          <Payoff legs={priced} spot={chainIndex} now={now - (now % 60_000)} symbol={what} />
        </>
      ) : null}
    </section>
  );
}
