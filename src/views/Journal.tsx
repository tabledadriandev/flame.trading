import { useMemo, useState } from 'react';
import { instrument } from '../data/instruments';
import { ReviewForm, TradeResult } from '../desk/Review';
import { Spark } from '../desk/Watchlist';
import type { TradeRec } from '../engine/types';
import { equityCurve, rDistribution, slice, stats, weeklyReview, type SliceKey, type Stats, type WeeklyChange } from '../journal/stats';
import { dollars, duration, money, pct, qty, rr, stamp } from '../lib/format';
import { exportCsv, exportJson } from '../shell/Settings';
import { useAccount } from '../state/account';
import { useValuation } from '../state/hooks';
import { toast } from '../state/toasts';
import { Help, PaneState, SideTag } from '../ui/controls';
import { EquityChart } from '../ui/EquityChart';

const symbolOf = (id: string): string => instrument(id).symbol;

function Tile({ label, value, tone, help }: { label: string; value: string; tone?: 'hot' | 'cold'; help?: string }) {
  return (
    <div className="tile">
      <div className="tile-label">
        {label}
        {help ? <Help>{help}</Help> : null}
      </div>
      <div className={`tile-value num ${tone ?? ''}`}>{value}</div>
    </div>
  );
}

const tone = (n: number): 'hot' | 'cold' | undefined => (n > 0 ? 'hot' : n < 0 ? 'cold' : undefined);
const pf = (v: number | null): string => (v === null ? '—' : v === Infinity ? 'No losses' : v.toFixed(2));

function StatTiles({ s }: { s: Stats }) {
  return (
    <div className="tiles">
      <Tile label="Closed trades" value={String(s.trades)} />
      <Tile label="Win rate" value={s.trades ? pct(s.winRate * 100, false, 0) : '—'} help="The share of trades that made money. On its own it says little: a 30% win rate is profitable if the winners are big enough." />
      <Tile label="Average win" value={s.wins ? money(s.avgWin) : '—'} />
      <Tile label="Average loss" value={s.losses ? money(-s.avgLoss) : '—'} />
      <Tile label="Expectancy" value={s.trades ? money(s.expectancy, { signed: true }) : '—'} tone={tone(s.expectancy)} help="What an average trade made or lost, after fees. Positive expectancy is the whole game." />
      <Tile
        label="Expectancy in R"
        value={s.expectancyR !== null ? rr(s.expectancyR) : '—'}
        tone={s.expectancyR !== null ? tone(s.expectancyR) : undefined}
        help={`Average result in multiples of the risk taken, over the ${s.withR} ${s.withR === 1 ? 'trade' : 'trades'} that had a stop at entry. +0.3R means every $100 risked returned $30 on average.`}
      />
      <Tile label="Profit factor" value={pf(s.profitFactor)} help="Dollars won for every dollar lost. Above 1.5 is healthy; below 1 the account is shrinking." />
      <Tile label="Max drawdown" value={s.maxDrawdown ? money(-s.maxDrawdown) : '—'} help="The largest fall from a high point in closed P&L. It is what a strategy asks you to sit through." />
      <Tile label="Longest losing streak" value={s.trades ? `${s.longestLosingStreak} ${s.longestLosingStreak === 1 ? 'trade' : 'trades'}` : '—'} />
      <Tile label="Fees paid" value={money(s.fees)} />
    </div>
  );
}

const SLICES: { value: SliceKey; label: string }[] = [
  { value: 'setup', label: 'Setup' },
  { value: 'emotion', label: 'How you felt' },
  { value: 'plan', label: 'Followed the plan' },
  { value: 'instrument', label: 'Instrument' },
  { value: 'weekday', label: 'Day of week' },
  { value: 'hour', label: 'Hour of day' },
];

function Slices({ trades }: { trades: TradeRec[] }) {
  const [by, setBy] = useState<SliceKey>('setup');
  const rows = useMemo(() => slice(trades, by, symbolOf), [trades, by]);
  return (
    <section className="jblock" aria-label="Statistics by tag and time">
      <header className="jhead">
        <h2>What works</h2>
        <label className="jselect">
          Split by
          <select className="pane-select" value={by} onChange={(e) => setBy(e.target.value as SliceKey)}>
            {SLICES.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </select>
        </label>
      </header>
      <div className="jscroll">
        <table className="table">
          <thead>
            <tr>
              <th className="l">{SLICES.find((s) => s.value === by)?.label}</th>
              <th>Trades</th>
              <th>Win rate</th>
              <th>Net P&amp;L</th>
              <th>Expectancy</th>
              <th>In R</th>
              <th>Profit factor</th>
              <th>Max drawdown</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.key}>
                <td className="l">{r.key}</td>
                <td>{r.stats.trades}</td>
                <td>{pct(r.stats.winRate * 100, false, 0)}</td>
                <td className={tone(r.stats.net) ?? ''}>{money(r.stats.net, { signed: true })}</td>
                <td className={tone(r.stats.expectancy) ?? ''}>{money(r.stats.expectancy, { signed: true })}</td>
                <td>{r.stats.expectancyR !== null ? rr(r.stats.expectancyR) : <span className="sub">—</span>}</td>
                <td>{pf(r.stats.profitFactor)}</td>
                <td>{r.stats.maxDrawdown ? money(-r.stats.maxDrawdown) : <span className="sub">—</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function RDistribution({ trades }: { trades: TradeRec[] }) {
  const buckets = useMemo(() => rDistribution(trades), [trades]);
  const total = buckets.reduce((s, b) => s + b.count, 0);
  const max = Math.max(1, ...buckets.map((b) => b.count));
  return (
    <section className="jblock" aria-label="Distribution of results in R">
      <header className="jhead">
        <h2>
          Results in R{' '}
          <Help>
            Each trade's result in multiples of what it risked, counted in whole-R steps. A healthy picture has losses stacked near −1R (stops respected) and a tail of winners to the right.
          </Help>
        </h2>
        <span className="sub">
          {total} {total === 1 ? 'trade' : 'trades'} with a stop at entry
        </span>
      </header>
      {total === 0 ? (
        <PaneState title="No trades with a stop yet">Set a stop-loss when you enter and each result is measured in R.</PaneState>
      ) : (
        <div className="rdist" role="table" aria-label="Trades per R bucket">
          {buckets.map((b) => (
            <div key={b.label} className="rdist-row" role="row">
              <span className="rdist-label num" role="cell">
                {b.label}
              </span>
              <span className="rdist-track" role="presentation">
                <i className={b.from < 0 ? 'rdist-loss' : 'rdist-win'} style={{ width: `${(b.count / max) * 100}%` }} />
              </span>
              <span className="num" role="cell">
                {b.count}
              </span>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function fmtChange(c: WeeklyChange, v: number): string {
  if (c.unit === 'money') return money(v, { signed: c.name === 'Net P&L' });
  if (c.unit === 'percent') return pct(v, false, 0);
  if (c.unit === 'ratio') return v.toFixed(2);
  return String(Math.round(v));
}

function Weekly({ trades }: { trades: TradeRec[] }) {
  const review = useMemo(() => weeklyReview(trades, Date.now()), [trades]);
  return (
    <section className="jblock" aria-label="Weekly review">
      <header className="jhead">
        <h2>This week against last</h2>
      </header>
      {!review ? (
        <PaneState title="Nothing to compare yet">The weekly review appears once you have closed trades in each of the last two weeks.</PaneState>
      ) : (
        <ol className="weekly">
          {review.map((c) => (
            <li key={c.name}>
              <strong>{c.name}</strong>
              <span className="num">
                {fmtChange(c, c.before)} to {fmtChange(c, c.after)}
              </span>
              <p>{c.sentence}</p>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

function TradeRow({ t, open, onToggle }: { t: TradeRec; open: boolean; onToggle: () => void }) {
  const i = instrument(t.instrument);
  return (
    <>
      <tr className="trade-row" data-open={open ? 'true' : undefined}>
        <td className="l">
          <button type="button" className="link" aria-expanded={open} onClick={onToggle}>
            {i.symbol}
          </button>{' '}
          <span className="sub">{t.mode === 'spot' ? 'Spot' : t.cls === 'crypto' ? 'Perp' : 'Margin'}</span>
        </td>
        <td className="l">
          <SideTag side={t.dir === 'long' ? 'buy' : 'sell'}>{t.dir === 'long' ? 'Long' : 'Short'}</SideTag>
        </td>
        <td>{qty(t.qty, t.entryAvg)}</td>
        <td>{dollars(t.entryAvg)}</td>
        <td>{dollars(t.exitAvg)}</td>
        <td>{duration((t.closedAt ?? t.openedAt) - t.openedAt)}</td>
        <td className={tone(t.pnl) ?? ''}>{money(t.pnl, { signed: true })}</td>
        <td className={t.r !== undefined ? (tone(t.r) ?? '') : 'sub'}>{rr(t.r)}</td>
        <td>{money(t.fees)}</td>
        <td className="cold">{t.mae < 0 ? money(t.mae) : <span className="sub">—</span>}</td>
        <td className="hot">{t.mfe > 0 ? money(t.mfe, { signed: true }) : <span className="sub">—</span>}</td>
        <td className="l">{t.review?.setup || <span className="sub">—</span>}</td>
        <td className="l">{t.review?.emotion || <span className="sub">—</span>}</td>
        <td className="l sub">{stamp(t.closedAt ?? t.openedAt)}</td>
      </tr>
      {open ? (
        <tr className="trade-detail">
          <td colSpan={14}>
            <div className="trade-open">
              <div className="trade-facts">
                <div>
                  <TradeResult t={t} />
                </div>
                {t.snapshot && t.snapshot.length > 1 ? (
                  <figure className="trade-snap">
                    <Spark points={t.snapshot} up={t.snapshot[t.snapshot.length - 1]! >= t.snapshot[0]!} width={220} height={56} />
                    <figcaption>The chart as it looked when you entered.</figcaption>
                  </figure>
                ) : (
                  <p className="sub">No chart snapshot was taken for this trade.</p>
                )}
                {t.review?.note ? <p className="trade-note">“{t.review.note}”</p> : null}
                <p className="sub">
                  {t.fillIds.length} {t.fillIds.length === 1 ? 'fill' : 'fills'}. Worst point {money(t.mae)}, best point {money(t.mfe, { signed: true })}
                  {t.funding ? `, funding ${money(t.funding, { signed: true })}` : ''}.
                </p>
              </div>
              <ReviewForm trade={t} onDone={onToggle} />
            </div>
          </td>
        </tr>
      ) : null}
    </>
  );
}

export function Journal() {
  const account = useAccount((s) => s.live);
  const v = useValuation('live');
  const [open, setOpen] = useState<string | null>(null);
  const closed = useMemo(() => account.trades.filter((t) => t.closedAt !== undefined).sort((a, b) => b.closedAt! - a.closedAt!), [account.trades]);
  const s = useMemo(() => stats(closed), [closed]);
  const curve = useMemo(() => equityCurve(closed, account.startCash), [closed, account.startCash]);
  const positions = Object.values(account.positions);
  const invested = v.holdings + v.margin;
  const realised = s.net;
  const waiting = closed.filter((t) => !t.review).length;

  return (
    <div className="journal">
      <header className="jtop">
        <h1 className="page-title" aria-hidden="true">
          Journal
        </h1>
        <div className="jtop-actions">
          <button type="button" className="btn" onClick={exportCsv} disabled={closed.length === 0}>
            Export trades (CSV)
          </button>
          <button type="button" className="btn" onClick={() => void exportJson().catch(() => toast('The backup could not be written.', { sticky: true }))}>
            Export a backup (JSON)
          </button>
        </div>
      </header>

      <section className="jblock" aria-label="Account">
        <div className="tiles">
          <Tile label="Equity" value={money(v.equity)} help="Cash, plus what you hold at current prices, plus margin and unrealised P&L on leveraged positions." />
          <Tile label="Cash" value={money(v.cash)} />
          <Tile label="Invested" value={money(invested)} help="The value of spot holdings plus the margin behind leveraged positions." />
          <Tile label="Realised P&L" value={money(realised, { signed: true })} tone={tone(realised)} help="Everything closed trades have made or lost, after fees." />
          <Tile label="Unrealised P&L" value={money(v.unrealised, { signed: true })} tone={tone(v.unrealised)} help="What open positions would make or lose if closed at the current price." />
        </div>
        {v.equity > 0 ? (
          <div className="alloc" role="img" aria-label={`Allocation: ${pct((v.cash / v.equity) * 100, false, 0)} cash${positions.map((p) => `, ${symbolOf(p.instrument)} ${p.mode === 'spot' ? 'spot' : 'leveraged'}`).join('')}`}>
            <div className="alloc-bar">
              <i className="alloc-cash" style={{ flexGrow: Math.max(0, v.cash) }} title={`Cash ${money(v.cash)}`} />
              {positions.map((p, n) => {
                const worth = p.mode === 'spot' ? p.qty * p.entry : p.margin;
                return <i key={p.key} className="alloc-pos" data-n={n % 4} style={{ flexGrow: worth }} title={`${symbolOf(p.instrument)} ${money(worth)}`} />;
              })}
            </div>
            <div className="alloc-key num">
              <span>Cash {pct((v.cash / v.equity) * 100, false, 0)}</span>
              {positions.map((p) => {
                const worth = p.mode === 'spot' ? p.qty * p.entry : p.margin;
                return (
                  <span key={p.key}>
                    {symbolOf(p.instrument)} {pct((worth / v.equity) * 100, false, 0)}
                  </span>
                );
              })}
            </div>
          </div>
        ) : null}
      </section>

      {closed.length === 0 ? (
        <section className="jblock">
          <PaneState title="No closed trades yet">Close a position and it appears here with its result, its R and a ten-second review. The statistics build from there.</PaneState>
        </section>
      ) : (
        <>
          <section className="jblock" aria-label="Equity curve">
            <header className="jhead">
              <h2>Equity from closed trades</h2>
              <span className="sub">Open positions are not included until they close.</span>
            </header>
            <EquityChart points={curve} label="Equity after each closed trade" />
          </section>

          <section className="jblock" aria-label="Statistics">
            <header className="jhead">
              <h2>Statistics</h2>
            </header>
            <StatTiles s={s} />
          </section>

          <div className="jgrid">
            <RDistribution trades={closed} />
            <Weekly trades={closed} />
          </div>

          <Slices trades={closed} />

          <section className="jblock" aria-label="Closed trades">
            <header className="jhead">
              <h2>Closed trades</h2>
              <span className="sub">{waiting > 0 ? `${waiting} waiting for a review. Select a trade to review it.` : 'Select a trade to see its detail or change its review.'}</span>
            </header>
            <div className="jscroll">
              <table className="table">
                <thead>
                  <tr>
                    <th className="l">Instrument</th>
                    <th className="l">Side</th>
                    <th>Size</th>
                    <th>Entry</th>
                    <th>Exit</th>
                    <th>Held</th>
                    <th>P&amp;L</th>
                    <th>R</th>
                    <th>Fees</th>
                    <th>
                      Worst{' '}
                      <Help align="right">Maximum adverse excursion: the most the trade was losing at any point while open.</Help>
                    </th>
                    <th>
                      Best{' '}
                      <Help align="right">Maximum favourable excursion: the most the trade was winning at any point. A big gap between this and the result means profit was given back.</Help>
                    </th>
                    <th className="l">Setup</th>
                    <th className="l">Felt</th>
                    <th className="l">Closed</th>
                  </tr>
                </thead>
                <tbody>
                  {closed.map((t) => (
                    <TradeRow key={t.id} t={t} open={open === t.id} onToggle={() => setOpen(open === t.id ? null : t.id)} />
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}
    </div>
  );
}
