import { useEffect, useState } from 'react';
import { Search } from 'lucide-react';
import { binanceTopMarkets, type BinanceMarket } from '../data/binance';
import { BOARD_INDICES, BOARD_MACRO, instrument, registerInstrument, type Instrument } from '../data/instruments';
import { route } from '../data/feed';
import { stockSpark, stocks } from '../data/stocks';
import { Spark, useSpark } from '../desk/Watchlist';
import { SIM } from '../lib/env';
import { pct, price } from '../lib/format';
import { useNow } from '../lib/hooks';
import { EXCHANGES, countdown, sessionState } from '../lib/sessions';
import { openOnDesk } from '../shell/commands';
import { watch } from '../state/live';
import { isStale, useMarket } from '../state/market';
import { usePalette } from '../state/palette';
import { activeItems, useWatchlists } from '../state/watchlists';
import { Help, PaneState } from '../ui/controls';
import { FeedBadge } from '../ui/FeedBadge';

const INDICES = BOARD_INDICES;
const MACRO = BOARD_MACRO;
const CRYPTO = ['crypto:BTC', 'crypto:ETH', 'crypto:SOL', 'crypto:BNB', 'crypto:XRP', 'crypto:DOGE'];

function Clocks() {
  const now = useNow(1_000);
  return (
    <section className="clocks" aria-label="Market hours">
      {EXCHANGES.map((ex) => {
        const s = sessionState(ex, now);
        return (
          <div key={ex.id} className="clock" data-open={s.open ? 'true' : undefined} title={ex.name}>
            <div className="clock-city">{ex.city}</div>
            <div className="clock-time num">{s.clock}</div>
            <div className="clock-state">
              <strong>{s.phase === 'open' ? 'Open' : s.phase === 'lunch' ? 'Lunch break' : 'Closed'}</strong>
              <span className="num">
                {s.label} {countdown(s.until)}
              </span>
            </div>
          </div>
        );
      })}
      <p className="clocks-note">
        Regular sessions, weekdays only.{' '}
        <Help align="right" label="About these clocks">
          Worked out from each exchange's published hours and its time zone, so daylight saving is handled. Exchange holidays are not modelled yet: on a holiday a clock can say “Open” when the
          exchange is shut.
        </Help>
      </p>
    </section>
  );
}

function StockSpark({ id, up }: { id: string; up: boolean }) {
  const symbol = id.slice(id.indexOf(':') + 1);
  // The quote poll already carries today's line for delayed symbols; no extra request.
  const quote = useMarket((s) => s.quotes[id]);
  const [points, setPoints] = useState<number[] | null>(() => stockSpark(symbol) ?? null);
  useEffect(() => setPoints(stockSpark(symbol) ?? null), [symbol, quote]);
  return <Spark points={points} up={up} width={64} height={20} />;
}

function CryptoSpark({ id, up }: { id: string; up: boolean }) {
  return <Spark points={useSpark(id)} up={up} width={64} height={20} />;
}

function BoardRow({ id, now }: { id: string; now: number }) {
  const q = useMarket((s) => s.quotes[id]);
  const i = instrument(id);
  const known = q !== undefined && Number.isFinite(q.changePct);
  const up = (q?.changePct ?? 0) >= 0;
  const stale = q !== undefined && isStale(q, now);
  const delayed = route(id)?.adapter.kind === 'delayed';
  return (
    <button type="button" className="board-row" onClick={() => openOnDesk(id)} title={`Open ${i.name} on the desk`}>
      <span className="board-name">
        <strong>{i.symbol}</strong>
        <small>{i.name === i.symbol ? '' : i.name}</small>
      </span>
      {delayed ? <StockSpark id={id} up={up} /> : <CryptoSpark id={id} up={up} />}
      <span className="board-last num">{q ? price(q.last) : '—'}</span>
      <span className={`board-chg num ${known && !stale ? (up ? 'hot' : 'cold') : ''}`}>{stale ? 'Old' : known ? pct(q.changePct) : '—'}</span>
    </button>
  );
}

function Board({ title, ids, note, empty }: { title: string; ids: string[]; note?: React.ReactNode; empty?: string }) {
  const now = useNow(2_000);
  const first = ids[0];
  const stockBoard = first !== undefined && route(first)?.adapter.id === 'stocks';
  const feed = useMarket((s) => s.feeds.stocks);
  const anyQuote = useMarket((s) => ids.some((id) => s.quotes[id] !== undefined));
  const failed = stockBoard && feed === 'down' && !anyQuote;
  return (
    <section className="board" aria-label={title}>
      <header className="board-head">
        <h2>{title}</h2>
        {first ? <FeedBadge instrumentId={first} /> : null}
      </header>
      {ids.length === 0 ? (
        <PaneState title="Nothing here yet">{empty}</PaneState>
      ) : failed ? (
        <PaneState title="These quotes are not available">
          {stocks.lastProblem() ?? 'The stock data source is not answering.'} Flame keeps trying; nothing is shown rather than old numbers.
        </PaneState>
      ) : (
        <div className="board-rows">
          {ids.map((id) => (
            <BoardRow key={id} id={id} now={now} />
          ))}
        </div>
      )}
      {note ? <p className="board-note">{note}</p> : null}
    </section>
  );
}

function Movers() {
  const [markets, setMarkets] = useState<BinanceMarket[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (SIM) return;
    let alive = true;
    const load = () =>
      binanceTopMarkets(60)
        .then((m) => {
          if (!alive) return;
          for (const x of m) registerInstrument({ id: `crypto:${x.base}`, symbol: x.base, name: instrument(`crypto:${x.base}`).name, kind: 'crypto', cls: 'crypto', tradable: true });
          setMarkets(m);
          setError(null);
        })
        .catch((err: unknown) => {
          console.warn('[flame] movers failed', err);
          if (alive) setError(err instanceof Error ? err.message : 'The list of markets could not be loaded.');
        });
    void load();
    const timer = setInterval(load, 120_000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, []);

  if (SIM) {
    return (
      <section className="board" aria-label="Movers">
        <header className="board-head">
          <h2>Movers</h2>
        </header>
        <PaneState title="Not available with the simulated feed">Gainers and losers are ranked from the live exchange's market list.</PaneState>
      </section>
    );
  }
  const sorted = markets ? [...markets].sort((a, b) => b.changePct - a.changePct) : [];
  const list = (title: string, rows: BinanceMarket[]) => (
    <section className="board" aria-label={title}>
      <header className="board-head">
        <h2>{title}</h2>
        <span className="status">24 hours, top 60 coins by volume</span>
      </header>
      {error && !markets ? (
        <PaneState title="Movers could not be loaded">{error} Trying again in two minutes.</PaneState>
      ) : !markets ? (
        <PaneState title="Loading movers" />
      ) : (
        <div className="board-rows">
          {rows.map((m) => (
            <button key={m.symbol} type="button" className="board-row" onClick={() => openOnDesk(`crypto:${m.base}`)} title={`Open ${m.base} on the desk`}>
              <span className="board-name">
                <strong>{m.base}</strong>
              </span>
              <span />
              <span className="board-last num">{price(m.last)}</span>
              <span className={`board-chg num ${m.changePct >= 0 ? 'hot' : 'cold'}`}>{pct(m.changePct)}</span>
            </button>
          ))}
        </div>
      )}
    </section>
  );
  return (
    <>
      {list('Top gainers', sorted.slice(0, 6))}
      {list('Top losers', sorted.slice(-6).reverse())}
    </>
  );
}

/** How today's moves line up across assets: one bar each, from a shared zero line. */
function MovesStrip({ ids }: { ids: string[] }) {
  const quotes = useMarket((s) => s.quotes);
  const moves = ids
    .map((id) => ({ id, i: instrument(id) as Instrument, chg: quotes[id]?.changePct }))
    .filter((m): m is { id: string; i: Instrument; chg: number } => m.chg !== undefined && Number.isFinite(m.chg));
  const missing = ids.length - moves.length;
  const max = Math.max(1, ...moves.map((m) => Math.abs(m.chg)));
  const up = moves.filter((m) => m.chg > 0).length;
  const read =
    moves.length < 3
      ? 'Not enough prices yet to compare.'
      : up === moves.length
        ? 'Everything is up together.'
        : up === 0
          ? 'Everything is down together.'
          : up >= moves.length * 0.7
            ? `Mostly up: ${up} of ${moves.length} are higher.`
            : up <= moves.length * 0.3
              ? `Mostly down: ${moves.length - up} of ${moves.length} are lower.`
              : `Mixed: ${up} up, ${moves.length - up} down. Assets are not moving as one today.`;
  return (
    <section className="board moves" aria-label="How today's moves line up">
      <header className="board-head">
        <h2>Today across assets</h2>
        <Help align="right" label="How to read this">
          Each bar is one asset's change today (24 hours for coins, since the previous close for the rest), drawn from the same zero line. Bars all on one side mean markets are moving together;
          a split means something is diverging.
        </Help>
      </header>
      <p className="moves-read">{read}</p>
      <div className="moves-rows">
        {[...moves]
          .sort((a, b) => b.chg - a.chg)
          .map((m) => (
            <button key={m.id} type="button" className="moves-row" onClick={() => openOnDesk(m.id)} title={`Open ${m.i.name} on the desk`}>
              <span className="moves-name">{m.i.symbol}</span>
              <span className="moves-track" aria-hidden="true">
                <i className={m.chg >= 0 ? 'moves-up' : 'moves-down'} style={{ width: `${(Math.abs(m.chg) / max) * 50}%` }} />
              </span>
              <span className={`num ${m.chg >= 0 ? 'hot' : 'cold'}`}>{pct(m.chg)}</span>
            </button>
          ))}
      </div>
      {missing > 0 ? <p className="board-note">{missing} {missing === 1 ? 'asset has' : 'assets have'} no price right now and {missing === 1 ? 'is' : 'are'} left out.</p> : null}
    </section>
  );
}

export function Markets() {
  const pinned = useWatchlists(activeItems);
  const listName = useWatchlists((s) => s.lists.find((l) => l.id === s.active)?.name ?? 'Watchlist');

  // Keep prices flowing for everything on the boards while this view is open.
  useEffect(() => watch([...INDICES, ...MACRO, ...CRYPTO]), []);

  return (
    <div className="markets">
      <div className="markets-top">
        <button type="button" className="bar-search markets-search" onClick={() => usePalette.getState().show()}>
          <Search size={14} aria-hidden="true" />
          Search a stock, index or coin
          <kbd>/</kbd>
        </button>
      </div>
      <Clocks />
      <div className="boards">
        <Board title="Stock indices, by their ETFs" ids={INDICES} note="Flame's stock feed carries stocks and ETFs, not the indices themselves, so each index is shown through the fund that tracks it. Prices are 15 minutes behind." />
        <Board title="Bonds, gold and oil, by their ETFs" ids={MACRO} />
        <Board title="Crypto" ids={CRYPTO} />
        <Board title={`Your board: ${listName}`} ids={pinned} empty="Add symbols to your watchlist and they appear here." />
        <Movers />
        <MovesStrip ids={[...INDICES, ...MACRO.slice(0, 3), ...CRYPTO.slice(0, 3)]} />
      </div>
    </div>
  );
}
