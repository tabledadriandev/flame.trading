import { useCallback, useEffect, useRef, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { CHAINS, chainName, drainedWhy, listPools, poolRead, type Chain, type PoolInfo } from '../data/dex';
import { SIM } from '../lib/env';
import { age, clock, compact, pct, tokenPrice } from '../lib/format';
import { openOnDesk } from '../shell/commands';
import { nameToken } from '../state/tokens';
import { PaneState, Segmented, Tabs } from '../ui/controls';

// Launchpad: new and moving on-chain tokens, with what is in each pool. The
// lesson is in the last tab: most of them end with the liquidity gone.

type Tab = 'new' | 'trending' | 'movers' | 'volume' | 'drained';

const TABS: { id: Tab; label: string }[] = [
  { id: 'new', label: 'New' },
  { id: 'trending', label: 'Trending' },
  { id: 'movers', label: 'Movers' },
  { id: 'volume', label: 'Volume' },
  { id: 'drained', label: 'Drained' },
];

const ABOUT: Record<Tab, string> = {
  new: 'Pools created in the last few minutes, newest first. Most will not last the day.',
  trending: 'Pools that GeckoTerminal sees the most activity and attention on right now.',
  movers: 'The biggest moves over the last hour, up or down, among busy pools.',
  volume: 'The pools that traded the most dollars in the last 24 hours.',
  drained: 'Recent pools whose liquidity has been pulled or whose price has collapsed. Whoever still holds these cannot get out.',
};

const REFRESH = 45_000;
const LEVEL = { high: 'High', medium: 'Medium', lower: 'Lower' } as const;

function unique(list: PoolInfo[]): PoolInfo[] {
  const seen = new Set<string>();
  return list.filter((p) => (seen.has(p.id) ? false : (seen.add(p.id), true)));
}

async function load(chain: Chain, tab: Tab): Promise<PoolInfo[]> {
  if (tab === 'new' || tab === 'trending' || tab === 'volume') return listPools(chain, tab);
  if (tab === 'movers') {
    const [a, b] = await Promise.all([listPools(chain, 'trending'), listPools(chain, 'volume')]);
    return unique([...a, ...b])
      .filter((p) => p.change.h1 !== null && p.liquidity >= 10_000)
      .sort((x, y) => Math.abs(y.change.h1!) - Math.abs(x.change.h1!));
  }
  // Drained: look through the recent pools for the ones that have already died.
  const pages = await Promise.all([listPools(chain, 'new', 1), listPools(chain, 'new', 2), listPools(chain, 'new', 3), listPools(chain, 'trending')]);
  return unique(pages.flat()).filter((p) => drainedWhy(p) !== null);
}

/** Dollars in thousands and millions; under a dollar is nothing. */
const usd = (v: number): string => (v < 1 ? '$0' : `$${compact(v)}`);

const change = (v: number | null) => (v === null ? <span className="sub">—</span> : <span className={v > 0 ? 'hot' : v < 0 ? 'cold' : undefined}>{pct(v, true, Math.abs(v) >= 100 ? 0 : 1)}</span>);

function Row({ p, now, tab }: { p: PoolInfo; now: number; tab: Tab }) {
  const read = poolRead(p, now);
  const why = tab === 'drained' ? drainedWhy(p) : null;
  return (
    <tr>
      <td className="l lp-token">
        <button
          type="button"
          className="link"
          onClick={() => {
            nameToken(p);
            openOnDesk(p.id);
          }}
          title={`Open ${p.symbol} on the desk`}
        >
          {p.symbol}
        </button>{' '}
        <span className="sub lp-name">{p.name}</span>
      </td>
      <td className="l lp-chain">{chainName(p.chain)}</td>
      <td className="lp-age">{p.createdAt !== null ? age(now - p.createdAt) : '—'}</td>
      <td>{tokenPrice(p.price)}</td>
      <td className="lp-cap">{p.marketCap !== null ? usd(p.marketCap) : '—'}</td>
      <td>{usd(p.liquidity)}</td>
      <td className="lp-m5">{change(p.change.m5)}</td>
      <td className="lp-h1">{change(p.change.h1)}</td>
      <td>{change(p.change.h24)}</td>
      <td className="lp-trades">{p.trades24h > 0 ? compact(p.trades24h).replace(/\.00$/, '') : '—'}</td>
      <td className="l lp-risk">
        {why ? (
          <strong>{why}</strong>
        ) : (
          <>
            <strong data-level={read.level}>{LEVEL[read.level]}</strong> <span className="sub">{read.reasons.slice(0, 2).join(', ')}</span>
          </>
        )}
      </td>
    </tr>
  );
}

export function Launchpad() {
  const [chain, setChain] = useState<Chain>('solana');
  const [tab, setTab] = useState<Tab>('new');
  const [rows, setRows] = useState<PoolInfo[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [readAt, setReadAt] = useState(0);
  const [busy, setBusy] = useState(false);

  // A slower answer for a tab or chain the reader has left is dropped.
  const want = useRef('');
  want.current = `${chain}|${tab}`;
  const refresh = useCallback(() => {
    if (SIM) return;
    const key = `${chain}|${tab}`;
    setBusy(true);
    load(chain, tab)
      .then((list) => {
        if (want.current !== key) return;
        setRows(list);
        // The time on the list is when its oldest reading was fetched, not when it was drawn.
        setReadAt(list.length > 0 ? Math.min(...list.map((p) => p.t)) : Date.now());
        setError(null);
      })
      .catch((err: unknown) => {
        console.warn('[flame] launchpad failed', err);
        if (want.current === key) setError(err instanceof Error ? err.message : 'The pools could not be loaded.');
      })
      .finally(() => setBusy(false));
  }, [chain, tab]);

  useEffect(() => {
    setRows(null);
    setError(null);
    refresh();
    const timer = setInterval(() => {
      if (!document.hidden) refresh();
    }, REFRESH);
    return () => clearInterval(timer);
  }, [refresh]);

  const head = (
    <header className="jtop">
      <h1 className="page-title" aria-hidden="true">
        Launchpad
      </h1>
      <p className="lab-lede">
        New tokens trade against a pool, not an order book. Most go to zero, and what is in the pool decides whether you can get out. The Drained tab is there to prove it: those are tokens people bought this week.
      </p>
    </header>
  );

  if (SIM) {
    return (
      <div className="launchpad">
        {head}
        <PaneState title="Launchpad is not shown with the simulated feed">The simulated feed has no pools. Open Flame without ?sim=1 to see real ones.</PaneState>
      </div>
    );
  }

  const now = readAt || Date.now();
  return (
    <div className="launchpad">
      {head}
      <div className="lp-bar">
        <Segmented<Chain> label="Chain" value={chain} onChange={setChain} options={CHAINS.map((c) => ({ value: c.id, label: c.name }))} />
        <span className="sub lp-asof">{readAt ? `Read at ${clock(readAt)}; refreshes every 45 seconds.` : ''}</span>
        <button type="button" className="btn btn-sm" onClick={refresh} disabled={busy}>
          <RefreshCw size={12} aria-hidden="true" /> Refresh
        </button>
      </div>
      <div className="lp-tabs">
        <Tabs<Tab> label="List" value={tab} onChange={setTab} tabs={TABS} />
      </div>
      <p className="lp-about">{ABOUT[tab]}</p>

      {error && !rows ? (
        <PaneState title="The pools could not be loaded" action={<button type="button" className="btn" onClick={refresh}>Try again</button>}>
          {error}
        </PaneState>
      ) : !rows ? (
        <PaneState title="Reading the pools" />
      ) : rows.length === 0 ? (
        <PaneState title={tab === 'drained' ? 'No drained pools in the latest batch' : 'Nothing to show'}>
          {tab === 'drained' ? `None of the newest pools on ${chainName(chain)} has been drained yet. Try another chain, or look again in a few minutes.` : 'GeckoTerminal returned no pools for this list.'}
        </PaneState>
      ) : (
        <>
          {error ? <p className="opt-stale">The list could not be refreshed ({error}) These numbers are from {clock(readAt)}.</p> : null}
          <div className="opt-scroll">
            <table className="table lp-table">
              <thead>
                <tr>
                  <th className="l">Token</th>
                  <th className="l lp-chain">Chain</th>
                  <th className="lp-age" title="Since the pool was created">Age</th>
                  <th>Price</th>
                  <th className="lp-cap" title="Every token that exists, at this price">Market cap</th>
                  <th title="Both sides of the pool, in dollars. It decides how much you can sell, and at what price">Liquidity</th>
                  <th className="lp-m5">5m</th>
                  <th className="lp-h1">1h</th>
                  <th>24h</th>
                  <th className="lp-trades" title="Buys and sells in the last 24 hours">Trades</th>
                  <th className="l lp-risk" title="Flame's read of the pool from its numbers alone. It is not an audit of the token's contract">
                    {tab === 'drained' ? 'What happened' : 'Risk read'}
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((p) => (
                  <Row key={p.id} p={p} now={now} tab={tab} />
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      <p className="sub lp-credit">
        Pool data from{' '}
        <a className="link" href="https://www.geckoterminal.com" target="_blank" rel="noreferrer">
          GeckoTerminal
        </a>
        . The risk read is Flame&rsquo;s own, from the pool&rsquo;s age, size and trading: it is not a check of the token&rsquo;s contract. Open a token to see its pool and, on Solana, the RugCheck report. Paper money only: Flame never connects a wallet.
      </p>
    </div>
  );
}
