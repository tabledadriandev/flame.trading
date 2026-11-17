import { useEffect, useState } from 'react';
import { dexQuote, knownPool, knownRisk, parseDexId, poolRead, riskReport, type RiskReport } from '../data/dex';
import { instrument } from '../data/instruments';
import { buyFromPool, exitValue, poolLiquidity, poolOrderCap, poolPrice, sellToPool } from '../engine/pool';
import { posKey, type OrderInput } from '../engine/types';
import { compact, dollars, money, parseNumber, tokenPrice } from '../lib/format';
import { useNow } from '../lib/hooks';
import { useAccount } from '../state/account';
import { useMarket } from '../state/market';
import { keepToken } from '../state/tokens';
import { Help, NumField, Pane, PaneState, Segmented } from '../ui/controls';
import { FeedBadge } from '../ui/FeedBadge';

// The ticket for an on-chain token. Dollars only: you say how much to spend,
// and the pool decides how many tokens that buys and at what price. What the
// order will cost beyond the price on the screen is shown before it is placed.

const LEVEL = { high: 'High', medium: 'Medium', lower: 'Lower' } as const;
const SHARES = ['25', '50', '100'] as const;
type Share = (typeof SHARES)[number];

const pctText = (share: number): string => `${(share * 100).toFixed(share < 0.001 ? 3 : 2)}%`;
const count = (n: number): string => (n >= 1000 ? compact(n) : n.toLocaleString('en-US', { maximumFractionDigits: n >= 1 ? 2 : 6 }));

export function MemeTicket() {
  const id = useMarket((s) => s.instrument);
  const account = useAccount((s) => s.live);
  const now = useNow(1_000);
  const [side, setSide] = useState<'buy' | 'sell'>('buy');
  const [spend, setSpend] = useState('100');
  const [share, setShare] = useState<Share>('100');
  const [risk, setRisk] = useState<RiskReport | null | undefined>(() => knownRisk(id));
  const [riskProblem, setRiskProblem] = useState<string | null>(null);

  const at = parseDexId(id);
  const info = knownPool(id);
  const q = dexQuote(id, now);
  const pool = q?.pool;
  const symbol = info?.symbol ?? instrument(id).symbol;
  const held = account.positions[posKey(id, 'spot')];

  // The contract report is asked for once the pool is known, and before any buy.
  const token = info?.token;
  useEffect(() => {
    setRisk(knownRisk(id));
    setRiskProblem(null);
    if (!info) return;
    let alive = true;
    riskReport(info)
      .then((r) => alive && setRisk(r))
      .catch((err: unknown) => {
        console.warn('[flame] risk report could not be read', err);
        if (alive) setRiskProblem(err instanceof Error ? err.message : 'The risk report could not be read.');
      });
    return () => {
      alive = false;
    };
  }, [id, token]);

  useEffect(() => {
    if (!held && side === 'sell') setSide('buy');
  }, [held, side]);

  if (!at) return null;

  const dollarsIn = parseNumber(spend);
  const buy = pool && dollarsIn > 0 ? buyFromPool(pool, dollarsIn) : null;
  const sellQty = held ? held.qty * (Number(share) / 100) : 0;
  const sell = pool && sellQty > 0 ? sellToPool(pool, sellQty) : null;
  const read = info ? poolRead(info, now) : null;

  let problem: string | null = null;
  if (!pool) problem = info ? 'Waiting for a fresh reading of the pool.' : 'Reading the pool.';
  else if (side === 'buy') {
    if (!(dollarsIn > 0)) problem = 'Enter how many dollars to spend.';
    else if (dollarsIn > account.cash) problem = `You have ${dollars(account.cash, 2)} in cash.`;
    else if (buy && buy.dollars > poolOrderCap(pool) * (1 + 1e-9)) {
      problem = `One order may not be more than 2% of the pool's liquidity: ${dollars(poolOrderCap(pool), 2)} here. A bigger position could not be sold back without moving the price against you.`;
    } else if (!buy || !(buy.tokens > 0)) problem = 'The pool is empty: there is nothing to buy.';
  } else if (!held) problem = `You hold no ${symbol}.`;
  else if (q?.sellBlocked) problem = `This sale would fail. ${q.sellBlocked}`;

  function submit() {
    const fresh = dexQuote(id);
    if (problem || !fresh?.pool) return;
    const qty = side === 'buy' ? buyFromPool(fresh.pool, dollarsIn).tokens : sellQty;
    if (!(qty > 0)) return;
    const input: OrderInput = { instrument: id, cls: 'meme', mode: 'spot', side, type: 'market', qty };
    const events = useAccount.getState().place(input, fresh);
    // Keep the token's name with the account from its first fill, for the journal.
    if (info && events.some((e) => e.type === 'fill')) keepToken(info);
  }

  // A paper order does not move the real pool, so selling straight back meets the same curve again: the
  // impact is paid a second time. This is also what the position will be marked at the moment it fills.
  const backOut = buy && pool ? exitValue(pool, buy.tokens) : null;
  const tax = q?.sellTax ?? 0;

  return (
    <Pane label="Order ticket" title="Ticket" className="pane-ticket" tools={<FeedBadge instrumentId={id} />}>
      <div className="pane-body ticket meme-ticket">
        {!info ? (
          <PaneState title="Reading the pool" />
        ) : (
          <>
            <Segmented<'buy' | 'sell'>
              label="Side"
              block
              tall
              value={side}
              onChange={setSide}
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
                  disabled: !held,
                  title: held ? undefined : `You hold no ${symbol}`,
                  label: (
                    <>
                      <span className="side-glyph cold" aria-hidden="true">▼</span> Sell
                    </>
                  ),
                },
              ]}
            />

            {side === 'buy' ? (
              <NumField label="Dollars to spend" prefix="$" value={spend} onChange={(t) => setSpend(t)} invalid={!(dollarsIn > 0)} note={pool ? `The pool takes at most ${dollars(poolOrderCap(pool), 2)} in one order.` : undefined} />
            ) : (
              <div className="field">
                <span className="field-label">How much of your {symbol} to sell</span>
                <Segmented<Share> label="Share of the position to sell" block tall value={share} onChange={setShare} options={SHARES.map((s) => ({ value: s, label: `${s}%` }))} />
              </div>
            )}

            <div className="ticket-preview" aria-live="polite">
              {problem ? (
                <p className="ticket-problem">{problem}</p>
              ) : side === 'buy' && buy && pool ? (
                <>
                  <p>
                    Spend {dollars(dollarsIn, 2)}: about {count(buy.tokens)} {symbol} at {tokenPrice(buy.price)} each.
                  </p>
                  <p>
                    Price impact {pctText(buy.impact)}, or {dollars(buy.impactDollars, 2)}: your own order pushes the price up as it fills.{' '}
                    <Help>The pool holds ${compact(poolLiquidity(pool))}. Spending {dollars(buy.dollars, 2)} against the ${compact(pool.dollars)} on its dollar side moves the average price you pay by that share. In a thin pool even a small order pays a lot more than the price on the screen.</Help>
                  </p>
                  <p>Pool fee {dollars(buy.fee, 2)}.</p>
                  {backOut !== null ? (
                    <p>
                      Sold straight back, it would return about {dollars(backOut * (1 - tax), 2)}: a cost of {dollars(dollarsIn - backOut * (1 - tax), 2)} just to get in and out.
                    </p>
                  ) : null}
                </>
              ) : sell && held ? (
                <>
                  <p>
                    Sell {count(sellQty)} {symbol} for about {dollars(sell.dollars - sell.fee - sell.dollars * tax, 2)}.
                  </p>
                  <p>
                    Price impact {pctText(sell.impact)}, or {dollars(sell.impactDollars, 2)}: your own sale pushes the price down as it fills.
                  </p>
                  <p>
                    Pool fee {dollars(sell.fee, 2)}
                    {tax > 0 ? `, and the token's contract keeps ${pctText(tax)} (${dollars(sell.dollars * tax, 2)})` : ''}.
                  </p>
                  <p>Result on what you sell: {money(sell.dollars - sell.fee - sell.dollars * tax - held.entry * sellQty, { signed: true })}.</p>
                </>
              ) : null}
            </div>

            <button type="button" className="btn btn-primary ticket-go" data-side={side} disabled={Boolean(problem)} onClick={submit}>
              <span className="ticket-go-text">{side === 'buy' ? `Buy ${dollarsIn > 0 ? dollars(dollarsIn, 2) : ''} of ${symbol}` : `Sell ${share}% of your ${symbol}`}</span>
            </button>

            {held && pool ? (
              <p className="meme-held num">
                You hold {count(held.qty)} {symbol}. The pool would pay {dollars(exitValue(pool, held.qty) * (1 - tax), 2)} for all of it now; at the price on the screen it looks like {dollars(held.qty * poolPrice(pool), 2)}.
              </p>
            ) : null}

            <section className="meme-risk" aria-label="Risk">
              <h3 className="pool-sub">Before you buy</h3>
              {q?.sellBlocked ? (
                <p className="meme-warn">
                  <strong>You would not be able to sell this.</strong> {q.sellBlocked} Flame treats that as it plays out at worst: a paper sale of this token fails.
                </p>
              ) : null}
              {tax > 0 ? (
                <p className="meme-warn">
                  <strong>Every sale loses {pctText(tax)}.</strong> RugCheck reports a transfer fee in the token&rsquo;s contract; it comes out of what you get.
                </p>
              ) : null}
              {read ? (
                <p>
                  <strong>Pool: {LEVEL[read.level]} risk.</strong> {read.reasons.join(', ')}. This is Flame&rsquo;s read of the pool&rsquo;s numbers, not a check of the contract.
                </p>
              ) : null}
              {at.chain !== 'solana' ? (
                <p className="sub">No contract check is available for this chain, so Flame cannot say whether the token can block or tax sales.</p>
              ) : riskProblem ? (
                <p className="sub">The RugCheck report could not be read ({riskProblem}) Flame cannot say whether this token can block or tax sales.</p>
              ) : risk === undefined ? (
                <p className="sub">Reading the RugCheck report.</p>
              ) : risk === null ? (
                <p className="sub">RugCheck has no report for this token.</p>
              ) : risk.items.length === 0 ? (
                <p className="sub">
                  RugCheck lists no risks for this token (score {risk.score} of 100, lower is safer). That is not a promise: most new tokens still go to zero.
                </p>
              ) : (
                <>
                  <p className="sub">RugCheck score {risk.score} of 100 (lower is safer). It reports:</p>
                  <ul className="meme-risks">
                    {risk.items.slice(0, 6).map((r) => (
                      <li key={r.name}>
                        <strong>{r.name}</strong>
                        {r.level === 'danger' ? ' (serious)' : ''}
                        {r.detail ? `: ${r.detail}` : ''}
                      </li>
                    ))}
                  </ul>
                </>
              )}
              <p className="sub">
                Spot only, no leverage, no stops: nothing guarantees the pool will still be there. Paper money; Flame never connects a wallet.
                {at.chain === 'solana' ? (
                  <>
                    {' '}
                    Contract report from{' '}
                    <a className="link" href="https://rugcheck.xyz" target="_blank" rel="noreferrer">
                      RugCheck
                    </a>
                    .
                  </>
                ) : null}
              </p>
            </section>
          </>
        )}
      </div>
    </Pane>
  );
}
