import { useEffect, useState } from 'react';
import { dexQuote, knownPool, knownRisk, lastPool, parseDexId, poolProblem, poolRead, riskReport, type RiskReport } from '../data/dex';
import { instrument } from '../data/instruments';
import { addCost, isEmpty, poolLiquidity, poolOrderCap, poolPrice, positionValue, sellProceeds, tokensFor } from '../engine/pool';
import { posKey, type OrderInput } from '../engine/types';
import { clock, compact, dollars, money, parseNumber, tokenPrice } from '../lib/format';
import { useNow } from '../lib/hooks';
import { useAccount } from '../state/account';
import { useMarket } from '../state/market';
import { toast } from '../state/toasts';
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
  // Orders need a fresh reading. The holding line may use an older one, and says how old.
  const q = dexQuote(id, now);
  const pool = q?.pool;
  const symbol = info?.symbol ?? instrument(id).symbol;
  const held = account.positions[posKey(id, 'spot')];
  const heldQty = held?.qty ?? 0;

  // The contract report is read once the pool is known. On Solana a buy waits for it, or for word that it failed.
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

  // What the risk source says now, or what it said when the position was bought if it cannot be read now.
  const blocked = q?.sellBlocked ?? held?.sellBlocked ?? null;
  const tax = q?.sellTax ?? held?.sellTax ?? 0;
  const empty = pool ? isEmpty(pool) : false;
  const awaitingRisk = at.chain === 'solana' && risk === undefined && !riskProblem;

  const dollarsIn = parseNumber(spend);
  const net = pool ? dollarsIn / (1 + pool.fee) : 0;
  const buyTokens = pool && dollarsIn > 0 && !empty ? tokensFor(pool, heldQty, dollarsIn) : 0;
  const buyPrice = buyTokens > 0 ? net / buyTokens : 0;
  const spot = pool ? poolPrice(pool) : 0;
  const sellQty = heldQty * (Number(share) / 100);
  const proceeds = pool && sellQty > 0 ? sellProceeds(pool, heldQty, sellQty) : 0;
  const sellFee = pool ? proceeds * pool.fee : 0;
  const sellTax = proceeds * tax;
  const read = info ? poolRead(info, now) : null;
  const why = poolProblem(id);

  let problem: string | null = null;
  if (!pool) problem = info ? `Waiting for a fresh reading of the pool.${why ? ` ${why}` : ''}` : 'Reading the pool.';
  else if (side === 'buy') {
    if (empty) problem = 'The pool is empty: its liquidity has been pulled, and there is nothing to buy.';
    else if (awaitingRisk) problem = 'Reading the RugCheck report on this token. A buy waits for it.';
    else if (!(dollarsIn > 0)) problem = 'Enter how many dollars to spend.';
    else if (dollarsIn > account.cash) problem = `You have ${dollars(account.cash, 2)} in cash.`;
    else if (!(buyTokens > 0)) problem = 'The pool cannot fill an order of this size.';
    else if (addCost(pool, 0, heldQty + buyTokens) > poolOrderCap(pool) * (1 + 1e-9)) {
      problem = `A position may not be more than 2% of the pool's liquidity: ${dollars(poolOrderCap(pool), 2)} here${heldQty > 0 ? ', and you already hold some' : ''}. A bigger one could not be sold back without moving the price against you.`;
    }
  } else if (!held) problem = `You hold no ${symbol}.`;
  else if (blocked) problem = `This sale would fail. ${blocked}`;

  function submit() {
    const fresh = dexQuote(id);
    if (problem) return;
    if (!fresh?.pool) {
      toast('The reading of the pool went stale before the order could be placed. Nothing was done; try again when a new one arrives.');
      return;
    }
    const qty = side === 'buy' ? tokensFor(fresh.pool, heldQty, dollarsIn) : sellQty;
    if (!(qty > 0)) {
      toast('The pool could not fill that order. Nothing was done.');
      return;
    }
    const input: OrderInput = { instrument: id, cls: 'meme', mode: 'spot', side, type: 'market', qty };
    const events = useAccount.getState().place(input, fresh);
    // Keep the token's name with the account from its first fill, for the journal.
    if (info && events.some((e) => e.type === 'fill')) keepToken(info);
  }

  // A paper order does not move the real pool, so what was just bought would be sold back down the same
  // curve: the impact is paid again on the way out. This is also what the position is marked at.
  const backOut = pool && buyTokens > 0 ? sellProceeds(pool, heldQty + buyTokens, buyTokens) * (1 - Math.min(1, pool.fee + tax)) : null;
  const mark = lastPool(id);
  const worth = held && mark ? positionValue(mark.pool, held.qty, tax, blocked !== null) : null;
  const markStale = mark ? now - mark.t > 75_000 : false;

  return (
    <Pane label="Order ticket" title="Ticket" className="pane-ticket" tools={<FeedBadge instrumentId={id} />}>
      <div className="pane-body ticket meme-ticket">
        {!info ? (
          <PaneState title="Reading the pool">{why ?? null}</PaneState>
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
              <NumField label="Dollars to spend" prefix="$" value={spend} onChange={(t) => setSpend(t)} invalid={!(dollarsIn > 0)} note={pool && !empty ? `A position in this pool can be at most ${dollars(poolOrderCap(pool), 2)}.` : undefined} />
            ) : (
              <div className="field">
                <span className="field-label">How much of your {symbol} to sell</span>
                <Segmented<Share> label="Share of the position to sell" block tall value={share} onChange={setShare} options={SHARES.map((s) => ({ value: s, label: `${s}%` }))} />
              </div>
            )}

            <div className="ticket-preview" aria-live="polite">
              {problem ? (
                <p className="ticket-problem">{problem}</p>
              ) : side === 'buy' && pool ? (
                <>
                  <p>
                    Spend {dollars(dollarsIn, 2)}: about {count(buyTokens)} {symbol} at {tokenPrice(buyPrice)} each.
                  </p>
                  <p>
                    Price impact {pctText(buyPrice / spot - 1)}, or {dollars(net - buyTokens * spot, 2)}: your own order pushes the price up as it fills.{' '}
                    <Help>
                      The pool holds ${compact(poolLiquidity(pool))}. Spending {dollars(net, 2)} against the ${compact(pool.dollars)} on its dollar side moves the average price you pay. In a thin pool even a small order pays a lot more than the price on the screen.
                      {heldQty > 0 ? ' What you already hold counts as already taken from the pool, so adding to it costs more than the first buy did.' : ''}
                    </Help>
                  </p>
                  <p>Pool fee {dollars(dollarsIn - net, 2)}.</p>
                  {backOut !== null ? (
                    <p>
                      Sold straight back, it would return about {dollars(backOut, 2)}: a cost of {dollars(dollarsIn - backOut, 2)} just to get in and out.
                    </p>
                  ) : null}
                </>
              ) : held && pool && empty ? (
                <>
                  <p>The pool is empty: its liquidity has been pulled. Selling returns nothing.</p>
                  <p>It does close the position, at a loss of {dollars(held.entry * sellQty, 2)}, and records the trade as a rug in your journal.</p>
                </>
              ) : held && pool ? (
                <>
                  <p>
                    Sell {count(sellQty)} {symbol} for about {dollars(Math.max(0, proceeds - sellFee - sellTax), 2)}.
                  </p>
                  <p>
                    Price impact {pctText(sellQty > 0 && spot > 0 ? 1 - proceeds / sellQty / spot : 0)}, or {dollars(sellQty * spot - proceeds, 2)}: your own sale pushes the price down as it fills.
                  </p>
                  <p>
                    Pool fee {dollars(sellFee, 2)}
                    {tax > 0 ? `, and the token's contract keeps ${pctText(tax)} (${dollars(sellTax, 2)})` : ''}.
                  </p>
                  <p>Result on what you sell: {money(proceeds - sellFee - sellTax - held.entry * sellQty, { signed: true })}.</p>
                </>
              ) : null}
            </div>

            <button type="button" className="btn btn-primary ticket-go" data-side={side} disabled={Boolean(problem)} onClick={submit}>
              <span className="ticket-go-text">
                {side === 'buy' ? `Buy ${dollarsIn > 0 ? dollars(dollarsIn, 2) : ''} of ${symbol}` : empty ? `Write off ${share}% of your ${symbol}` : `Sell ${share}% of your ${symbol}`}
              </span>
            </button>

            {held ? (
              <p className="meme-held num">
                You hold {count(held.qty)} {symbol}.{' '}
                {worth === null
                  ? 'There is no reading of the pool to value it with.'
                  : blocked
                    ? 'It is valued at nothing: Flame will not let it be sold.'
                    : `The pool would pay ${dollars(worth, 2)} for all of it${markStale && mark ? `, going by the reading from ${clock(mark.t)}` : ' now'}; at the price on the screen it looks like ${dollars(held.qty * poolPrice(mark!.pool), 2)}.`}
              </p>
            ) : null}

            <section className="meme-risk" aria-label="Risk">
              <h3 className="pool-sub">Before you buy</h3>
              {blocked ? (
                <p className="meme-warn">
                  <strong>You would not be able to sell this.</strong> {blocked} Flame treats that as it plays out at worst: a paper sale of this token fails.
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
                  RugCheck lists no risks for this token{risk.score !== null ? ` (score ${risk.score} of 100, lower is safer)` : ''}. That is not a promise: most new tokens still go to zero.
                </p>
              ) : (
                <>
                  <p className="sub">{risk.score !== null ? `RugCheck score ${risk.score} of 100 (lower is safer). It reports:` : 'RugCheck reports:'}</p>
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
