import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { TOPICS, fetchEvents, fetchMarket, polyQuote, type OddsDetail, type OddsEvent, type OddsMarket, type OddsOutcome } from '../data/poly';
import { marketFill } from '../engine/rules';
import { posKey } from '../engine/types';
import { money, moneyShort, parseNumber } from '../lib/format';
import { closeInput, useAccount } from '../state/account';
import { useOdds } from '../state/odds';
import { toast } from '../state/toasts';
import { Dialog, Help, NumField, PaneState, Segmented } from '../ui/controls';

const cents = (p: number): string => `${(p * 100).toFixed(p < 0.1 || p > 0.9 ? 1 : 0)}¢`;
const chance = (p: number): string => (p < 0.01 ? 'under 1%' : p > 0.99 ? 'over 99%' : `${Math.round(p * 100)}%`);

function timeLeft(end: string | null, now: number): string {
  const t = end ? Date.parse(end) : NaN;
  if (!Number.isFinite(t)) return 'No end date';
  const ms = t - now;
  if (ms <= 0) return 'Ended, awaiting result';
  const d = Math.floor(ms / 86_400_000);
  if (d >= 60) return `Ends in ${Math.round(d / 30)} months`;
  if (d >= 2) return `Ends in ${d} days`;
  const h = Math.floor(ms / 3_600_000);
  return h >= 1 ? `Ends in ${h} ${h === 1 ? 'hour' : 'hours'}` : 'Ends within the hour';
}

interface Pick {
  event: OddsEvent;
  market: OddsMarket;
  outcome: OddsOutcome;
}

/** A card's rows: for a yes/no event, its two outcomes; for an event of many markets, the leading markets' "Yes". */
function rowsOf(e: OddsEvent): { label: string; market: OddsMarket; outcome: OddsOutcome }[] {
  if (e.markets.length === 1) {
    const m = e.markets[0]!;
    return m.outcomes.slice(0, 4).map((o) => ({ label: o.name, market: m, outcome: o }));
  }
  return e.markets.slice(0, 4).map((m) => ({ label: m.label ?? m.question, market: m, outcome: m.outcomes[0]! }));
}

function Card({ event, onPick, now }: { event: OddsEvent; onPick: (p: Pick) => void; now: number }) {
  const rows = rowsOf(event);
  return (
    <article className="odds-card">
      <h2>{event.title}</h2>
      <div className="odds-rows">
        {rows.map((r) => {
          const change = r.market.weekChange;
          return (
            <button key={r.outcome.token} type="button" className="odds-row" onClick={() => onPick({ event, market: r.market, outcome: r.outcome })} title={`Open "${r.market.question}"`}>
              <span className="odds-label">{r.label}</span>
              <span className="odds-track" aria-hidden="true">
                <i style={{ width: `${Math.max(1, r.outcome.price * 100)}%` }} />
              </span>
              <strong className="num">{chance(r.outcome.price)}</strong>
              <span className={`num odds-change ${change ? (change > 0 ? 'hot' : 'cold') : ''}`} title="Change this week, in percentage points">
                {change !== null && Math.abs(change) >= 0.005 ? `${change > 0 ? '+' : '−'}${Math.abs(change * 100).toFixed(0)}` : ''}
              </span>
            </button>
          );
        })}
      </div>
      <footer className="odds-foot num">
        <span>{moneyShort(event.volume24h)} traded today</span>
        <span>{timeLeft(event.endDate, now)}</span>
        {event.marketCount > rows.length && event.markets.length > 1 ? <span>{event.marketCount - rows.length} more outcomes</span> : null}
      </footer>
    </article>
  );
}

function History({ points }: { points: { t: number; p: number }[] }) {
  if (points.length < 2) return <p className="cone-note">No price history for this outcome yet.</p>;
  const W = 520;
  const H = 120;
  const t0 = points[0]!.t;
  const t1 = points[points.length - 1]!.t;
  const x = (t: number) => 4 + ((t - t0) / Math.max(1, t1 - t0)) * (W - 48);
  const y = (p: number) => 6 + (1 - p) * (H - 12);
  const d = points.map((p, i) => `${i ? 'L' : 'M'}${x(p.t).toFixed(1)} ${y(p.p).toFixed(1)}`).join(' ');
  const first = points[0]!.p;
  const last = points[points.length - 1]!.p;
  return (
    <figure className="odds-history">
      <svg width="100%" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Probability over the last week: from ${chance(first)} to ${chance(last)}.`}>
        {[0, 0.5, 1].map((v) => (
          <g key={v}>
            <line x1={4} x2={W - 44} y1={y(v)} y2={y(v)} className="eq-grid" />
            <text x={W - 40} y={y(v) + 4} className="eq-tick">
              {v * 100}%
            </text>
          </g>
        ))}
        <path d={d} className="eq-line" />
      </svg>
      <figcaption>
        The market's probability over the last week, hourly: {chance(first)} then, {chance(last)} now.
      </figcaption>
    </figure>
  );
}

function MarketDialog({ pick, onClose }: { pick: Pick; onClose: () => void }) {
  const [token, setToken] = useState(pick.outcome.token);
  const [detail, setDetail] = useState<OddsDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dollars, setDollars] = useState('100');
  const account = useAccount((s) => s.live);
  const place = useAccount((s) => s.place);
  const remember = useOdds((s) => s.remember);
  const outcome = pick.market.outcomes.find((o) => o.token === token) ?? pick.outcome;
  const id = `poly:${token}`;
  const held = account.positions[posKey(id, 'spot')];

  // The outcome on screen. An answer for any other outcome is out of date and is dropped.
  const showing = useRef(token);
  showing.current = token;
  const load = useCallback(() => {
    setError(null);
    fetchMarket(token, true)
      .then((d) => {
        if (showing.current === token) setDetail(d);
      })
      .catch((err: unknown) => {
        if (showing.current === token) setError(err instanceof Error ? err.message : 'The market could not be loaded.');
      });
  }, [token]);

  useEffect(() => {
    setDetail(null);
    load();
    const timer = setInterval(load, 20_000);
    return () => clearInterval(timer);
  }, [load]);

  const bid = detail?.book.bids[0]?.price;
  const ask = detail?.book.asks[0]?.price;
  const spend = parseNumber(dollars);
  const quote = detail ? polyQuote(token) : undefined;
  // Shares = dollars ÷ price, at the prices the book actually offers.
  const shares = quote && ask && spend > 0 ? spend / marketFill(quote, 'buy', spend / ask).price : 0;
  const avg = shares > 0 ? spend / shares : 0;
  const closed = detail?.market.closed ?? pick.market.closed;
  const problem = closed
    ? 'This market has closed and no longer trades.'
    : !detail
      ? null
      : !quote || !ask
        ? 'Nobody is offering this outcome right now, so there is nothing to buy.'
        : !(spend > 0)
          ? 'Enter how many dollars to put on it.'
          : spend > account.cash
            ? `That is more than your ${money(account.cash)} of cash.`
            : null;

  const buy = () => {
    if (problem || !quote || !(shares > 0)) return;
    remember(token, { question: pick.market.question, outcome: outcome.name, label: pick.market.label, event: pick.event.title });
    place({ instrument: id, cls: 'odds', mode: 'spot', side: 'buy', type: 'market', qty: shares }, quote);
  };
  const sell = () => {
    const input = closeInput(useAccount.getState().live, posKey(id, 'spot'));
    const q = polyQuote(token);
    if (!input || !q) {
      toast('Nobody is bidding for this outcome right now, so it cannot be sold. It will settle when the market resolves.');
      return;
    }
    place(input, q);
  };

  return (
    <Dialog title={pick.market.question} onClose={onClose} wide>
      <div className="odds-detail">
        <div className="odds-pick">
          <Segmented<string>
            label="Outcome"
            value={token}
            onChange={setToken}
            tall
            options={pick.market.outcomes.map((o) => ({ value: o.token, label: `${o.name} ${cents(o.price)}` }))}
          />
          <Help align="right" label="How prediction markets work">
            A share pays $1 if this outcome happens and nothing if it does not. So a price of 35¢ is the market saying the chance is about 35%. Buy at the ask; sell before the end at the bid, or
            hold until the market resolves.
          </Help>
        </div>

        {error ? (
          <PaneState
            title="This market could not be loaded"
            action={
              <button type="button" className="btn" onClick={load}>
                Try again
              </button>
            }
          >
            {error}
          </PaneState>
        ) : !detail ? (
          <PaneState title="Loading the market" />
        ) : (
          <>
            <History points={detail.history} />
            <dl className="odds-facts num">
              <div>
                <dt>Best bid (what a seller gets)</dt>
                <dd>{bid !== undefined ? cents(bid) : 'None'}</dd>
              </div>
              <div>
                <dt>Best ask (what a buyer pays)</dt>
                <dd>{ask !== undefined ? cents(ask) : 'None'}</dd>
              </div>
              <div>
                <dt>Ends</dt>
                <dd>{timeLeft(detail.market.endDate, Date.now())}</dd>
              </div>
            </dl>

            <form
              className="odds-ticket"
              onSubmit={(e) => {
                e.preventDefault();
                buy();
              }}
            >
              <NumField label={`Buy ${outcome.name} for`} prefix="$" value={dollars} onChange={(t) => setDollars(t)} />
              <p className="ticket-preview">
                {problem ? (
                  <span className={spend > 0 || closed ? 'ticket-problem' : 'ticket-hint'}>{problem}</span>
                ) : (
                  `Buy ${shares.toFixed(1)} ${outcome.name} shares at about ${cents(avg)}. Pays ${money(shares)} if ${outcome.name === 'Yes' || outcome.name === 'No' ? `the answer is ${outcome.name}` : `${outcome.name} wins`}, nothing if not. No fee.`
                )}
              </p>
              <button type="submit" className="btn btn-primary ticket-go" data-side="buy" disabled={!!problem || !(shares > 0)}>
                <span className="ticket-go-text">
                  Buy {outcome.name} for {money(spend > 0 ? spend : 0, { decimals: 0 })}
                </span>
              </button>
            </form>

            {held ? (
              <div className="odds-held num">
                <span>
                  You hold {held.qty.toFixed(1)} {outcome.name} shares bought at {cents(held.entry)}.
                  {bid !== undefined ? ` Selling now at ${cents(bid)} returns about ${money(held.qty * bid)}.` : ''}
                </span>
                <button type="button" className="btn" onClick={sell} disabled={bid === undefined || closed}>
                  Sell at the bid
                </button>
              </div>
            ) : null}
          </>
        )}
      </div>
    </Dialog>
  );
}

function Holdings({ onOpen }: { onOpen: (token: string) => void }) {
  const account = useAccount((s) => s.live);
  const meta = useOdds((s) => s.meta);
  const held = Object.values(account.positions).filter((p) => p.cls === 'odds');
  if (held.length === 0) return null;
  return (
    <section className="jblock" aria-label="Your prediction-market positions">
      <header className="jhead">
        <h2>Your positions</h2>
        <span className="sub">They also appear in Positions on the desk. Each settles at $1 or $0 a share when its market resolves.</span>
      </header>
      <div className="jscroll">
        <table className="table">
          <thead>
            <tr>
              <th className="l">Market</th>
              <th className="l">Outcome</th>
              <th>Shares</th>
              <th>Paid</th>
              <th>Cost</th>
              <th>Pays if right</th>
              <th>
                <span className="sr-only">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {held.map((p) => {
              const token = p.instrument.slice('poly:'.length);
              const m = meta[token];
              return (
                <tr key={p.key}>
                  <td className="l">{m?.question ?? 'A prediction market'}</td>
                  <td className="l">{m?.outcome ?? '—'}</td>
                  <td>{p.qty.toFixed(1)}</td>
                  <td>{cents(p.entry)}</td>
                  <td>{money(p.qty * p.entry)}</td>
                  <td>{money(p.qty)}</td>
                  <td>
                    <button type="button" className="btn btn-sm" onClick={() => onOpen(token)}>
                      Open
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

export function Odds() {
  const [topic, setTopic] = useState('trending');
  const [events, setEvents] = useState<OddsEvent[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pick, setPick] = useState<Pick | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const meta = useOdds((s) => s.meta);

  // The topic on screen. A slower answer for a topic the user has left is dropped.
  const showing = useRef(topic);
  showing.current = topic;
  const load = useCallback(() => {
    setError(null);
    fetchEvents(topic)
      .then((e) => {
        if (showing.current !== topic) return;
        setEvents(e);
        setNow(Date.now());
      })
      .catch((err: unknown) => {
        console.warn('[flame] prediction markets failed', err);
        if (showing.current === topic) setError(err instanceof Error ? err.message : 'The markets could not be loaded.');
      });
  }, [topic]);

  useEffect(() => {
    setEvents(null);
    load();
    const timer = setInterval(load, 60_000);
    return () => clearInterval(timer);
  }, [load]);

  // A held position opens from its token: rebuild the pick from what was remembered, then let the dialog load the rest.
  const openHeld = useCallback(
    (token: string) => {
      fetchMarket(token)
        .then((d) => {
          const outcome = d.market.outcomes.find((o) => o.token === token);
          if (!outcome) return;
          const m = meta[token];
          setPick({ event: { id: '', slug: '', title: m?.event ?? d.market.question, endDate: d.market.endDate, volume24h: 0, volume: 0, topics: [], markets: [d.market], marketCount: 1 }, market: d.market, outcome });
        })
        .catch((err: unknown) => toast(err instanceof Error ? err.message : 'That market could not be loaded.'));
    },
    [meta],
  );

  const shown = useMemo(() => events ?? [], [events]);

  return (
    <div className="odds">
      <header className="jtop">
        <h1 className="page-title" aria-hidden="true">
          Odds
        </h1>
        <p className="lab-lede">
          Prediction markets as live probabilities, from Polymarket. Take either side with paper money: a share pays $1 if you are right.
        </p>
      </header>
      <div className="odds-topics" role="tablist" aria-label="Topics">
        {TOPICS.map((t) => (
          <button key={t.id} type="button" role="tab" className="phone-tab" aria-selected={topic === t.id} onClick={() => setTopic(t.id)}>
            {t.label}
          </button>
        ))}
      </div>
      <Holdings onOpen={openHeld} />
      {error && !events ? (
        <PaneState
          title="The markets could not be loaded"
          action={
            <button type="button" className="btn" onClick={load}>
              Try again
            </button>
          }
        >
          {error}
        </PaneState>
      ) : !events ? (
        <PaneState title="Loading markets" />
      ) : shown.length === 0 ? (
        <PaneState title="No open markets on this topic">Try another topic.</PaneState>
      ) : (
        <>
          {error ? <p className="board-note">Could not refresh just now ({error}) Showing the last prices loaded.</p> : null}
          <div className="odds-grid">
            {shown.map((e) => (
              <Card key={e.id} event={e} onPick={setPick} now={now} />
            ))}
          </div>
        </>
      )}
      {pick ? <MarketDialog pick={pick} onClose={() => setPick(null)} /> : null}
    </div>
  );
}
