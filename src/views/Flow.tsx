import { useEffect, useMemo, useRef, useState } from 'react';
import { Chart } from '../chart/Chart';
import { indicatorSeries } from '../chart/indicators';
import { useCandles } from '../chart/useCandles';
import { route } from '../data/feed';
import { perpContext, type PerpContext } from '../data/hyperliquid';
import { instrument } from '../data/instruments';
import type { Tick, Timeframe } from '../data/types';
import { Book } from '../desk/Book';
import { buildFootprint, footStep, footprintRead, imbalance, type FootBar } from '../flow/footprint';
import { volumeProfile } from '../indicators/math';
import { clock, compact, moneyShort, pct, price } from '../lib/format';
import { useMarket } from '../state/market';
import { activeItems, useWatchlists } from '../state/watchlists';
import { Help, Pane, PaneState, Segmented } from '../ui/controls';
import { FeedBadge } from '../ui/FeedBadge';

type FlowTf = '1m' | '5m' | '15m';
const TF_MS: Record<FlowTf, number> = { '1m': 60_000, '5m': 300_000, '15m': 900_000 };
const KEEP = 60_000;
const BARS = 8;

/** Every trade since this view opened, plus the last thousand before it. */
function useTrades(id: string): { ticks: Tick[]; problem: string | null; since: number | null } {
  const [ticks, setTicks] = useState<Tick[]>([]);
  const [problem, setProblem] = useState<string | null>(null);
  const store = useRef<Tick[]>([]);
  useEffect(() => {
    store.current = [];
    setTicks([]);
    setProblem(null);
    const r = route(id);
    if (!r || !r.adapter.hasBook) return;
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const show = () => {
      timer = null;
      if (alive) setTicks([...store.current]);
    };
    const add = (more: Tick[]) => {
      store.current.push(...more);
      if (store.current.length > KEEP) store.current.splice(0, store.current.length - KEEP);
      if (!timer) timer = setTimeout(show, 500);
    };
    r.adapter.recentTrades?.(r.symbol).then(
      (older) => {
        if (!alive) return;
        // Trades already streamed since opening may overlap the backfill: keep only what came before them.
        const first = store.current[0]?.t ?? Infinity;
        store.current = [...older.filter((t) => t.t < first), ...store.current];
        show();
      },
      (err: unknown) => {
        console.warn(`[flame] trade history for ${id} failed`, err);
        if (alive) setProblem('Earlier trades could not be loaded, so the footprint starts from when this view opened.');
      },
    );
    const stop = r.adapter.subscribeTrades(r.symbol, add);
    return () => {
      alive = false;
      stop();
      if (timer) clearTimeout(timer);
    };
  }, [id]);
  return { ticks, problem, since: ticks[0]?.t ?? null };
}

function Footprint({ bars, step }: { bars: FootBar[]; step: number }) {
  const shown = bars.slice(-BARS);
  const decimals = Math.max(0, Math.ceil(-Math.log10(step)));
  const prices = useMemo(() => {
    const set = new Set<number>();
    for (const b of shown) for (const p of b.cells.keys()) set.add(p);
    return [...set].sort((a, b) => b - a).slice(0, 26);
  }, [shown]);
  // An imbalance needs enough size to mean something: a twentieth of the busiest cell on screen.
  let biggest = 0;
  for (const b of shown) for (const c of b.cells.values()) biggest = Math.max(biggest, c.buy + c.sell);
  const minSize = biggest / 20;

  return (
    <div className="foot-scroll">
      <table className="foot num">
        <caption className="sr-only">Footprint: volume sold at the bid and bought at the ask, at each price, in each bar</caption>
        <thead>
          <tr>
            <th scope="col" className="l">
              Price
            </th>
            {shown.map((b) => (
              <th key={b.t} scope="col">
                {clock(b.t, false)}
              </th>
            ))}
          </tr>
          <tr className="foot-sub">
            <th className="l" />
            {shown.map((b) => (
              <th key={b.t}>sold × bought</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {prices.map((p) => (
            <tr key={p}>
              <th scope="row" className="l">
                {price(p, decimals)}
              </th>
              {shown.map((b) => {
                const c = b.cells.get(p);
                if (!c) return <td key={b.t} className="foot-empty" />;
                const side = imbalance(c, minSize);
                return (
                  <td key={b.t} data-poc={b.poc === p ? 'true' : undefined} title={`${price(p, decimals)}: ${compact(c.sell)} sold, ${compact(c.buy)} bought${side ? `. ${side === 'buy' ? 'Buyers' : 'Sellers'} outnumber the other side three to one or more.` : ''}`}>
                    <span className={side === 'sell' ? 'cold foot-strong' : ''}>{compact(c.sell)}</span>
                    <i aria-hidden="true">×</i>
                    <span className={side === 'buy' ? 'hot foot-strong' : ''}>{compact(c.buy)}</span>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <th scope="row" className="l">
              Delta
            </th>
            {shown.map((b) => (
              <td key={b.t} className={b.delta >= 0 ? 'hot' : 'cold'}>
                {b.delta >= 0 ? '+' : '−'}
                {compact(Math.abs(b.delta))}
              </td>
            ))}
          </tr>
          <tr>
            <th scope="row" className="l">
              Volume
            </th>
            {shown.map((b) => (
              <td key={b.t}>{compact(b.buy + b.sell)}</td>
            ))}
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

function Funding({ coin }: { coin: string }) {
  const [ctx, setCtx] = useState<PerpContext | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    setCtx(undefined);
    const load = () =>
      perpContext(coin)
        .then((c) => {
          if (!alive) return;
          setCtx(c);
          setError(null);
        })
        .catch((err: unknown) => {
          if (alive) setError(err instanceof Error ? err.message : 'Funding could not be loaded.');
        });
    void load();
    const timer = setInterval(load, 60_000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [coin]);

  return (
    <Pane
      label="Funding and open interest"
      title="Perp funding and open interest"
      className="flow-funding"
      tools={
        <Help align="right" label="How to read this">
          Funding is what longs pay shorts each hour to hold a perp (negative: shorts pay longs). A high positive rate means longs are crowded and paying up to stay in. Open interest is the size
          of all open perp positions: rising with price, new money is backing the move; falling, positions are closing. Flame applies this hourly rate to your own perp positions.
        </Help>
      }
    >
      {error && ctx === undefined ? (
        <PaneState title="Funding is not available">{error} Without it, Flame applies no funding to perp positions.</PaneState>
      ) : ctx === undefined ? (
        <PaneState title="Loading funding" />
      ) : ctx === null ? (
        <PaneState title={`No perp for ${coin} on Hyperliquid`}>Flame takes its funding rate from Hyperliquid. With none listed there, no funding is applied to {coin} perp positions.</PaneState>
      ) : (
        <div className="tiles">
          <div className="tile">
            <div className="tile-label">Funding, per hour</div>
            <div className={`tile-value num ${ctx.funding > 0 ? 'hot' : ctx.funding < 0 ? 'cold' : ''}`}>{pct(ctx.funding * 100, true, 4)}</div>
            <div className="tile-note">{ctx.funding > 0 ? 'Longs pay shorts' : ctx.funding < 0 ? 'Shorts pay longs' : 'Nobody pays'}</div>
          </div>
          <div className="tile">
            <div className="tile-label">The same, per year</div>
            <div className="tile-value num">{pct(ctx.funding * 24 * 365 * 100, true, 1)}</div>
            <div className="tile-note">If the rate stayed here</div>
          </div>
          <div className="tile">
            <div className="tile-label">Open interest</div>
            <div className="tile-value num">{moneyShort(ctx.openInterest * ctx.markPx)}</div>
            <div className="tile-note num">
              {compact(ctx.openInterest)} {coin}
            </div>
          </div>
          <div className="tile">
            <div className="tile-label">Perp against spot index</div>
            <div className="tile-value num">{pct(((ctx.markPx - ctx.oraclePx) / ctx.oraclePx) * 100, true, 3)}</div>
            <div className="tile-note">{ctx.markPx >= ctx.oraclePx ? 'Perp trades above spot' : 'Perp trades below spot'}</div>
          </div>
        </div>
      )}
    </Pane>
  );
}

export function Flow() {
  const id = useMarket((s) => s.instrument);
  const select = useMarket((s) => s.select);
  const watch = useWatchlists(activeItems);
  const [tf, setTf] = useState<FlowTf>('1m');
  const i = instrument(id);
  const coins = useMemo(() => [...new Set([id, ...watch])].filter((x) => x.startsWith('crypto:')), [id, watch]);
  const { ticks, problem, since } = useTrades(id);
  const feed = useCandles(id, tf as Timeframe);
  const bars = useMemo(() => buildFootprint(ticks, TF_MS[tf], 1), [ticks, tf]);
  const step = useMemo(() => footStep(bars.slice(-BARS)), [bars]);
  const foot = useMemo(() => buildFootprint(ticks, TF_MS[tf], step), [ticks, tf, step]);
  const profile = useMemo(() => volumeProfile(feed.candles.slice(-240), 32), [feed.candles]);
  const cvd = useMemo(() => indicatorSeries([{ id: 'cvd', type: 'cvd', params: {} }], feed.candles, true), [feed.candles]);

  if (i.cls !== 'crypto') {
    return (
      <div className="setup">
        <h1 className="page-title" aria-hidden="true">
          Flow
        </h1>
        <p className="setup-lede">
          Order flow needs every trade and a live order book, which Flame has for coins but not for {i.symbol}. Pick a coin to see who is buying and who is selling.
        </p>
        <div className="settings-actions">
          {(coins.length ? coins : ['crypto:BTC', 'crypto:ETH', 'crypto:SOL']).slice(0, 6).map((c) => (
            <button key={c} type="button" className="btn" onClick={() => select(c)}>
              {instrument(c).symbol}
            </button>
          ))}
        </div>
      </div>
    );
  }

  let max = 0;
  for (const r of profile?.rows ?? []) max = Math.max(max, r.volume);

  return (
    <div className="flow">
      <div className="replay-bar" role="toolbar" aria-label="Flow controls">
        <label className="jselect">
          Coin
          <select className="pane-select" value={id} onChange={(e) => select(e.target.value)}>
            {coins.map((c) => (
              <option key={c} value={c}>
                {instrument(c).symbol}
              </option>
            ))}
          </select>
        </label>
        <Segmented<FlowTf> label="Bar size" value={tf} onChange={setTf} options={[{ value: '1m', label: '1m' }, { value: '5m', label: '5m' }, { value: '15m', label: '15m' }]} />
        <FeedBadge instrumentId={id} />
        <strong className="flow-read">{footprintRead(foot)}</strong>
      </div>
      <div className="flow-grid">
        <Pane
          label="Footprint"
          title="Footprint"
          className="flow-foot"
          tools={
            <>
              <span className="sub num">{since ? `Trades since ${clock(since)}` : ''}</span>
              <Help align="right" label="How to read the footprint">
                Each column is one bar; each row a price. A cell shows volume sold into the bid, then volume bought at the ask. A side set in bold and colour outnumbers the other three to one: an
                imbalance. The outlined cell is where the bar traded most. Delta under each column is buying minus selling for that bar.
              </Help>
            </>
          }
        >
          {foot.length === 0 ? (
            <PaneState title="Waiting for trades">{problem ?? 'The footprint builds from the trade stream as it arrives.'}</PaneState>
          ) : (
            <>
              {problem ? <p className="board-note">{problem}</p> : null}
              <Footprint bars={foot} step={step} />
            </>
          )}
        </Pane>

        <Book rangePct={0.02} />

        <Pane
          label="Price and cumulative delta"
          title="Price and cumulative delta"
          className="flow-cvd"
          tools={
            <Help align="right" label="How to read cumulative delta">
              The lower line adds up, bar by bar, volume bought at the ask minus volume sold at the bid. When price makes a new high and the line does not, the move is running out of aggressive
              buyers (and the reverse at lows).
            </Help>
          }
        >
          <div className="chart-wrap">
            {feed.state === 'failed' ? (
              <PaneState
                title="The chart could not load"
                action={
                  <button type="button" className="btn" onClick={feed.retry}>
                    Try again
                  </button>
                }
              >
                {feed.error}
              </PaneState>
            ) : feed.state === 'loading' ? (
              <PaneState title="Loading bars" />
            ) : (
              <Chart label={`${i.symbol} ${tf} with cumulative delta`} dataKey={`flow|${id}|${tf}`} candles={feed.candles} series={cvd} volume={false} onNeedOlder={feed.loadOlder} />
            )}
          </div>
        </Pane>

        <Pane
          label="Volume profile"
          title="Volume profile"
          className="flow-profile"
          tools={
            <Help align="right" label="How to read the volume profile">
              Volume traded at each price over the last 240 bars, split into buying and selling. The longest row is the point of control: the price the market spent most of its business at. The
              value area holds 70% of the volume; price outside it is either rejected back or accepted as a new range.
            </Help>
          }
        >
          {!profile ? (
            <PaneState title="Loading the profile" />
          ) : (
            <div className="pane-body">
              <p className="profile-read num">
                Point of control {price(profile.poc)}. Value area {price(profile.valueLow)} to {price(profile.valueHigh)}.
              </p>
              <div className="profile" role="table" aria-label="Volume by price">
                {[...profile.rows].reverse().map((r) => {
                  const inValue = r.price >= profile.valueLow - 1e-9 && r.price + profile.step <= profile.valueHigh + 1e-9;
                  const isPoc = profile.poc >= r.price && profile.poc < r.price + profile.step;
                  return (
                    <div key={r.price} className="profile-row num" role="row" data-value={inValue ? 'true' : undefined} data-poc={isPoc ? 'true' : undefined}>
                      <span role="cell">{price(r.price)}</span>
                      <span className="profile-track" role="presentation">
                        <i className="vp-sell" style={{ width: `${max ? (r.sell / max) * 100 : 0}%` }} />
                        <i className="vp-buy" style={{ width: `${max ? (r.buy / max) * 100 : 0}%` }} />
                      </span>
                      <span role="cell">
                        {compact(r.volume)}
                        {isPoc ? ' POC' : ''}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </Pane>

        <Funding coin={id.slice('crypto:'.length)} />
      </div>
    </div>
  );
}
