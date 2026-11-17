import { useEffect, useState } from 'react';
import { ASSUMED_FEE, chainName, knownPool, parseDexId, poolReserves, poolTrades, type PoolTradeRow, type Reserves } from '../data/dex';
import { instrument } from '../data/instruments';
import { age, clock, compact, tokenPrice } from '../lib/format';
import { useNow } from '../lib/hooks';
import { useMarket } from '../state/market';
import { Help, Pane, PaneState, SideTag } from '../ui/controls';

// A token has no order book. This pane shows what stands in its place: the
// pool. How much is in it, on both sides, decides what any order costs and
// whether a position can be sold at all.

const REFRESH = 60_000;

export function PoolPane() {
  const id = useMarket((s) => s.instrument);
  const at = parseDexId(id);
  const now = useNow(1_000);
  const pool = knownPool(id);
  const [reserves, setReserves] = useState<Reserves | null>(null);
  const [trades, setTrades] = useState<PoolTradeRow[] | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  useEffect(() => {
    setReserves(null);
    setTrades(null);
    setProblem(null);
    if (!at) return;
    let alive = true;
    const read = () => {
      poolReserves(at.chain, at.address)
        .then((r) => alive && setReserves(r))
        .catch((err: unknown) => console.warn('[flame] pool reserves could not be read', err));
      poolTrades(at.chain, at.address)
        .then((t) => {
          if (!alive) return;
          setTrades(t);
          setProblem(null);
        })
        .catch((err: unknown) => {
          console.warn('[flame] pool trades could not be read', err);
          if (alive) setProblem(err instanceof Error ? err.message : 'The pool’s recent trades could not be read.');
        });
    };
    read();
    const timer = setInterval(() => {
      if (!document.hidden) read();
    }, REFRESH);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [id]);

  if (!at) return null;
  const symbol = pool?.symbol ?? instrument(id).symbol;
  const quote = pool?.quoteSymbol || 'quote asset';
  const stale = pool ? now - pool.t > 75_000 : false;
  const curve = reserves?.labels.some((l) => /clmm|dlmm|v3|v4|cl/i.test(l)) ?? false;

  return (
    <Pane
      label="Liquidity pool"
      title="Pool"
      className="pane-book pane-pool"
      tools={
        <Help align="right" label="What a pool is">
          A token trades against a pool that holds some of the token and some of another asset. There is no order book and nobody on the other side: the pool sets the price from the ratio of what it holds. A buy takes tokens out and pushes the price up; a sale puts them back and pushes it down. The less there is in the pool, the further each trade moves it.
        </Help>
      }
    >
      <div className="pane-body pool-body">
        {!pool ? (
          <PaneState title="Reading the pool" />
        ) : (
          <>
            {stale ? <p className="pool-stale">The pool was last read at {clock(pool.t)}. Orders wait for a fresh reading.</p> : null}
            <dl className="pool-facts num">
              <div>
                <dt>Liquidity</dt>
                <dd>${compact(pool.liquidity)}</dd>
              </div>
              <div>
                <dt>{symbol} in the pool</dt>
                <dd>{reserves ? compact(reserves.base) : '—'}</dd>
              </div>
              <div>
                <dt>{quote} in the pool</dt>
                <dd>{reserves ? compact(reserves.quote) : '—'}</dd>
              </div>
              <div>
                <dt>Pool fee</dt>
                <dd>{pool.fee !== null ? `${(pool.fee * 100).toFixed(2)}%` : `${(ASSUMED_FEE * 100).toFixed(1)}% assumed`}</dd>
              </div>
              <div>
                <dt>Locked</dt>
                <dd>{pool.lockedPct !== null ? `${pool.lockedPct.toFixed(0)}%` : 'Not reported'}</dd>
              </div>
              <div>
                <dt>Age</dt>
                <dd>{pool.createdAt !== null ? age(now - pool.createdAt) : '—'}</dd>
              </div>
              <div>
                <dt>Market cap</dt>
                <dd>{pool.marketCap !== null ? `$${compact(pool.marketCap)}` : '—'}</dd>
              </div>
              <div>
                <dt>Volume, 24h</dt>
                <dd>${compact(pool.volume24h)}</dd>
              </div>
            </dl>
            <p className="pool-note">
              {curve
                ? 'This pool concentrates its liquidity in a price range. Flame prices orders as if the same dollars were spread evenly (a constant-product pool), which is close for small orders and kinder than the real thing for large ones.'
                : 'Orders are priced on the constant-product curve: with x tokens and y dollars in the pool, spending Δy buys x·Δy ÷ (y + Δy) tokens.'}
              {pool.fee === null ? ' GeckoTerminal does not publish this pool’s fee, so 0.3% is assumed.' : ''}
            </p>

            <h3 className="pool-sub">Largest recent trades</h3>
            {problem ? (
              <p className="pool-note">{problem}</p>
            ) : !trades ? (
              <p className="pool-note">Reading the trades.</p>
            ) : trades.length === 0 ? (
              <p className="pool-note">No recent trades in this pool.</p>
            ) : (
              <table className="table pool-trades">
                <thead>
                  <tr>
                    <th className="l">Time</th>
                    <th className="l">Side</th>
                    <th>Price</th>
                    <th>Size</th>
                  </tr>
                </thead>
                <tbody>
                  {trades.map((t, n) => (
                    <tr key={`${t.t}-${n}`}>
                      <td className="l">{clock(t.t)}</td>
                      <td className="l">
                        <SideTag side={t.side}>{t.side === 'buy' ? 'Buy' : 'Sell'}</SideTag>
                      </td>
                      <td>{tokenPrice(t.price)}</td>
                      <td>${compact(t.size)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            <p className="pool-note pool-credit">
              {chainName(at.chain)} pool on {pool.dex || 'a decentralised exchange'}. Pool data from{' '}
              <a className="link" href="https://www.geckoterminal.com" target="_blank" rel="noreferrer">
                GeckoTerminal
              </a>
              ; reserves from{' '}
              <a className="link" href="https://dexscreener.com" target="_blank" rel="noreferrer">
                DexScreener
              </a>
              . Read every 30 seconds, not streamed.
            </p>
          </>
        )}
      </div>
    </Pane>
  );
}
