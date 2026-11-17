import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Pause, Play, SkipForward, Square } from 'lucide-react';
import { Chart, type ChartMarker } from '../chart/Chart';
import { route } from '../data/feed';
import { instrument } from '../data/instruments';
import { TIMEFRAMES, tfMs, type Candle, type Timeframe } from '../data/types';
import { orderLines } from '../desk/chartLines';
import { Drawer } from '../desk/Drawer';
import { TradeResult, tradeTitle } from '../desk/Review';
import { Ticket } from '../desk/Ticket';
import { closedTrades } from '../engine/engine';
import type { Quote } from '../engine/types';
import { stats } from '../journal/stats';
import { dollars, money, pct, rr, stamp } from '../lib/format';
import { closeInput, useAccount } from '../state/account';
import { useMarket } from '../state/market';
import { useReplaySeed } from '../state/replay';
import { engineSettings } from '../state/settings';
import { toast } from '../state/toasts';
import { activeItems, useWatchlists } from '../state/watchlists';
import { Pane, PaneState, Segmented, SideTag } from '../ui/controls';
import { StatusBadge } from '../ui/FeedBadge';
import { Readout } from '../desk/ChartPane';

const CONTEXT = 300;
const SPEEDS = ['1', '2', '5', '10', '20'] as const;
type Speed = (typeof SPEEDS)[number];

const toLocalInput = (t: number): string => {
  const d = new Date(t - new Date(t).getTimezoneOffset() * 60_000);
  return d.toISOString().slice(0, 16);
};

interface Session {
  id: string;
  tf: Timeframe;
  bars: Candle[];
  /** Index of the last bar shown. */
  cursor: number;
  /** Index of the first bar that was replayed (everything before it was context). */
  startIndex: number;
  /** No more history after the bars loaded. */
  exhausted: boolean;
}

export function Replay() {
  const deskId = useMarket((s) => s.instrument);
  const deskTf = useMarket((s) => s.tf);
  const watch = useWatchlists(activeItems);
  const [id, setId] = useState(deskId);
  const [tf, setTf] = useState<Timeframe>(deskTf === '1w' ? '1d' : deskTf);
  const [start, setStart] = useState(() => toLocalInput(Date.now() - 30 * 86_400_000));
  const [session, setSession] = useState<Session | null>(null);
  const [phase, setPhase] = useState<'setup' | 'loading' | 'running' | 'review'>('setup');
  const [error, setError] = useState<string | null>(null);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState<Speed>('2');
  const [hover, setHover] = useState<Candle | null>(null);
  const practice = useAccount((s) => s.practice);
  const live = useRef<Session | null>(null);
  live.current = session;
  const loadingMore = useRef(false);

  const begin = useCallback(async (inst: string, frame: Timeframe, from: number) => {
    const r = route(inst);
    if (!r) {
      setError('Flame has no data source for this instrument yet.');
      return;
    }
    setPhase('loading');
    setError(null);
    setPlaying(false);
    try {
      const ms = tfMs(frame);
      const bars = await r.adapter.candles(r.symbol, frame, { from: from - CONTEXT * ms, limit: 1000 });
      const startIndex = bars.findIndex((b) => b.t >= from);
      if (bars.length < 20 || startIndex < 0) throw new Error('There are no bars from that date for this instrument and timeframe. Pick an earlier date or a longer timeframe.');
      if (startIndex >= bars.length - 1) throw new Error('That date is too recent: there is nothing after it to replay.');
      // No bar before the start means the history begins later than the date asked for.
      if (startIndex === 0) throw new Error(`The ${TIMEFRAMES.find((t) => t.id === frame)?.label} history for this instrument only goes back to ${stamp(bars[0]!.t)}. Pick a later date or a longer timeframe.`);
      useAccount.getState().reset('practice');
      setSession({ id: inst, tf: frame, bars, cursor: Math.max(startIndex - 1, 0), startIndex, exhausted: false });
      setPhase('running');
    } catch (err) {
      console.error('[flame] replay could not start', err);
      setError(err instanceof Error ? err.message : 'The history could not be loaded.');
      setPhase('setup');
    }
  }, []);

  // "Replay from here" on the desk chart lands here with everything chosen.
  useEffect(() => {
    const seed = useReplaySeed.getState().take();
    if (!seed) return;
    setId(seed.instrument);
    setTf(seed.tf);
    setStart(toLocalInput(seed.t));
    void begin(seed.instrument, seed.tf, seed.t);
  }, [begin]);

  const more = useCallback(() => {
    const s = live.current;
    const r = s ? route(s.id) : null;
    if (!s || !r || s.exhausted || loadingMore.current) return;
    loadingMore.current = true;
    const last = s.bars[s.bars.length - 1]!;
    r.adapter
      .candles(r.symbol, s.tf, { from: last.t + tfMs(s.tf), limit: 1000 })
      .then((next) => {
        const fresh = next.filter((b) => b.t > last.t);
        const cur = live.current;
        if (!cur || cur.id !== s.id || cur.tf !== s.tf) return;
        const grown = { ...cur, bars: [...cur.bars, ...fresh.filter((b) => b.t > cur.bars[cur.bars.length - 1]!.t)], exhausted: fresh.length === 0 };
        live.current = grown;
        setSession(grown);
      })
      .catch((err: unknown) => {
        console.warn('[flame] replay could not load more bars', err);
        toast('The next stretch of history could not be loaded. Step again to retry.');
      })
      .finally(() => {
        loadingMore.current = false;
      });
  }, []);

  const step = useCallback(() => {
    const s = live.current;
    if (!s) return false;
    const next = s.bars[s.cursor + 1];
    if (!next) {
      if (!s.exhausted) more();
      return false;
    }
    useAccount.getState().onBar(s.id, next, 'practice');
    // Move the cursor now, not at the next render: two quick steps must not replay the same bar.
    const moved = { ...s, cursor: s.cursor + 1 };
    live.current = moved;
    setSession(moved);
    if (s.bars.length - s.cursor < 60) more();
    return true;
  }, [more]);

  useEffect(() => {
    if (!playing || phase !== 'running') return;
    const timer = setInterval(() => {
      if (!step()) setPlaying(false);
    }, 1000 / Number(speed));
    return () => clearInterval(timer);
  }, [playing, speed, phase, step]);

  useEffect(() => {
    if (phase !== 'running') return;
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if (el.tagName === 'INPUT' || el.tagName === 'SELECT' || el.tagName === 'TEXTAREA' || e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === 'ArrowRight') {
        e.preventDefault();
        setPlaying(false);
        step();
      } else if (e.key === ' ' && el.tagName !== 'BUTTON') {
        e.preventDefault();
        setPlaying((p) => !p);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [phase, step]);

  const current = session ? session.bars[session.cursor] : undefined;
  const quote = useCallback(
    (inst: string): Quote | undefined => {
      const s = live.current;
      const bar = s?.bars[s.cursor];
      if (!s || !bar || inst !== s.id) return undefined;
      // The price is the close of the bar on screen; fills happen at the end of that bar.
      return { bid: bar.c, ask: bar.c, last: bar.c, t: bar.t + tfMs(s.tf) - 1 };
    },
    [],
  );

  const end = () => {
    const s = live.current;
    if (!s) return;
    setPlaying(false);
    const a = useAccount.getState();
    for (const key of Object.keys(a.practice.positions)) {
      const input = closeInput(useAccount.getState().practice, key);
      const q = quote(s.id);
      if (input && q) a.place(input, q, 'practice', q.t);
    }
    for (const o of useAccount.getState().practice.orders) if (o.status === 'working') a.cancel(o.id, 'practice');
    setPhase('review');
  };

  const visible = useMemo(() => (session ? session.bars.slice(0, session.cursor + 1) : []), [session]);
  const sym = instrument(session?.id ?? id).symbol;
  const lines = useMemo(() => {
    if (!session) return [];
    const a = useAccount.getState();
    return orderLines(practice, session.id, engineSettings(), {
      amend: (o, p) => a.amend(o, p, 'practice', quote(session.id)),
      cancel: (o) => a.cancel(o, 'practice'),
      brackets: (k, b) => a.brackets(k, b, 'practice', quote(session.id)?.t),
    }, sym);
  }, [practice, session, quote, sym]);
  const markers = useMemo<ChartMarker[]>(() => {
    if (!session) return [];
    const ms = tfMs(session.tf);
    const seen = new Set<string>();
    const out: ChartMarker[] = [];
    for (const f of practice.fills) {
      const bar = session.bars.find((b) => f.t >= b.t && f.t < b.t + ms);
      if (!bar) continue;
      const key = `${bar.t}${f.side}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ t: bar.t, side: f.side });
    }
    return out;
  }, [practice.fills, session]);

  const options = useMemo(() => [...new Set([id, deskId, ...watch])], [id, deskId, watch]);

  // ---------- Setup ----------
  if (phase === 'setup' || phase === 'loading' || !session) {
    return (
      <div className="setup">
        <h1 className="page-title" aria-hidden="true">
          Replay
        </h1>
        <p className="setup-lede">
          Pick a moment in the past. The chart hides everything after it, and you trade it bar by bar with a separate $100,000 practice account. Your live paper account is not touched.
        </p>
        <form
          className="setup-form"
          onSubmit={(e) => {
            e.preventDefault();
            const t = new Date(start).getTime();
            if (!Number.isFinite(t)) setError('Choose a start date.');
            else if (t > Date.now() - tfMs(tf) * 5) setError('Choose a start date in the past, far enough back to have bars after it.');
            else void begin(id, tf, t);
          }}
        >
          <label className="field">
            <span className="field-label">Instrument</span>
            <span className="field-box">
              <select value={id} onChange={(e) => setId(e.target.value)}>
                {options.map((o) => (
                  <option key={o} value={o}>
                    {instrument(o).symbol} {instrument(o).name !== instrument(o).symbol ? `(${instrument(o).name})` : ''}
                  </option>
                ))}
              </select>
            </span>
            <span className="field-note">Load another symbol on the desk and it appears here.</span>
          </label>
          <div className="field">
            <span className="field-label">Timeframe</span>
            <Segmented<Timeframe> label="Timeframe" value={tf} onChange={setTf} tall options={TIMEFRAMES.filter((t) => t.id !== '1w').map((t) => ({ value: t.id, label: t.label }))} />
          </div>
          <label className="field">
            <span className="field-label">Start at</span>
            <span className="field-box">
              <input type="datetime-local" value={start} max={toLocalInput(Date.now())} onChange={(e) => setStart(e.target.value)} />
            </span>
          </label>
          <button type="submit" className="btn btn-primary setup-go" disabled={phase === 'loading'}>
            {phase === 'loading' ? 'Loading history' : 'Start replay'}
          </button>
          {error ? (
            <p className="setup-error" role="alert">
              {error}
            </p>
          ) : null}
        </form>
      </div>
    );
  }

  // ---------- Review ----------
  if (phase === 'review') {
    const trades = closedTrades(practice);
    const s = stats(trades);
    const endBar = session.bars[session.cursor]!;
    const after = session.bars.slice(session.cursor + 1, session.cursor + 121);
    const later = after[after.length - 1];
    const move = later ? (later.c / endBar.c - 1) * 100 : null;
    const highAfter = after.length ? Math.max(...after.map((b) => b.h)) : null;
    const lowAfter = after.length ? Math.min(...after.map((b) => b.l)) : null;
    return (
      <div className="replay-review">
        <header className="jtop">
          <h1 className="page-title">What you did, and what happened next</h1>
          <div className="jtop-actions">
            <button type="button" className="btn btn-primary" onClick={() => { setSession(null); setPhase('setup'); }}>
              Replay another moment
            </button>
          </div>
        </header>
        <section className="jblock">
          <div className="tiles">
            <div className="tile">
              <div className="tile-label">Practice result</div>
              <div className={`tile-value num ${s.net > 0 ? 'hot' : s.net < 0 ? 'cold' : ''}`}>{money(s.net, { signed: true })}</div>
            </div>
            <div className="tile">
              <div className="tile-label">Trades</div>
              <div className="tile-value num">{s.trades}</div>
            </div>
            <div className="tile">
              <div className="tile-label">Win rate</div>
              <div className="tile-value num">{s.trades ? pct(s.winRate * 100, false, 0) : '—'}</div>
            </div>
            <div className="tile">
              <div className="tile-label">Average result in R</div>
              <div className="tile-value num">{s.expectancyR !== null ? rr(s.expectancyR) : '—'}</div>
            </div>
            <div className="tile">
              <div className="tile-label">Bars replayed</div>
              <div className="tile-value num">{session.cursor - session.startIndex + 1}</div>
            </div>
          </div>
        </section>
        <section className="jblock">
          <header className="jhead">
            <h2>What happened next</h2>
            <span className="sub">
              {sym}, {TIMEFRAMES.find((t) => t.id === session.tf)?.label} bars, from {stamp(session.bars[session.startIndex]!.t)} to {stamp(endBar.t)}
            </span>
          </header>
          <p className="review-next">
            {move === null
              ? 'You replayed to the end of the history loaded, so there is nothing after it to show.'
              : `You stopped at ${dollars(endBar.c)}. Over the next ${after.length} bars ${sym} ${move >= 0 ? 'rose' : 'fell'} ${pct(Math.abs(move), false)} to ${dollars(later!.c)}, trading as high as ${dollars(highAfter!)} and as low as ${dollars(lowAfter!)}. The chart below shows those bars after your last one.`}
          </p>
          <div className="review-chart">
            <Chart label={`${sym} replay with the bars that followed`} dataKey={`review|${session.id}|${session.tf}|${session.cursor}`} candles={[...visible, ...after]} markers={markers} intraday={session.tf !== '1d'} />
          </div>
        </section>
        <section className="jblock">
          <header className="jhead">
            <h2>Your trades</h2>
            <span className="sub">Positions still open when you ended were closed at the last price.</span>
          </header>
          {trades.length === 0 ? (
            <PaneState title="You took no trades">Sitting out is a decision too. Was there a setup you passed on?</PaneState>
          ) : (
            <div className="jscroll">
              <table className="table">
                <thead>
                  <tr>
                    <th className="l">Trade</th>
                    <th>Entry</th>
                    <th>Exit</th>
                    <th className="l">Result</th>
                    <th className="l">Opened</th>
                    <th className="l">Closed</th>
                  </tr>
                </thead>
                <tbody>
                  {trades.map((t) => (
                    <tr key={t.id}>
                      <td className="l">
                        <SideTag side={t.dir === 'long' ? 'buy' : 'sell'}>{tradeTitle(t)}</SideTag>
                      </td>
                      <td>{dollars(t.entryAvg)}</td>
                      <td>{dollars(t.exitAvg)}</td>
                      <td className="l">
                        <TradeResult t={t} />
                      </td>
                      <td className="l sub">{stamp(t.openedAt)}</td>
                      <td className="l sub">{stamp(t.closedAt ?? t.openedAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
    );
  }

  // ---------- Running ----------
  const atEnd = session.exhausted && session.cursor >= session.bars.length - 1;
  return (
    <div className="replay">
      <div className="replay-bar" role="toolbar" aria-label="Replay controls">
        <strong>{sym}</strong>
        <span className="num sub">{current ? stamp(current.t) : ''}</span>
        <StatusBadge state="simulated" word="Replay, practice account" />
        <div className="replay-controls">
          <button type="button" className="btn" onClick={() => { setPlaying(false); step(); }} disabled={atEnd} title="Step one bar (right arrow)">
            <SkipForward size={14} aria-hidden="true" />
            Step
          </button>
          <button type="button" className="btn" onClick={() => setPlaying(!playing)} disabled={atEnd} aria-pressed={playing} title="Play or pause (space)">
            {playing ? <Pause size={14} aria-hidden="true" /> : <Play size={14} aria-hidden="true" />}
            {playing ? 'Pause' : 'Play'}
          </button>
          <Segmented<Speed> label="Bars per second" value={speed} onChange={setSpeed} options={SPEEDS.map((v) => ({ value: v, label: `${v}×`, title: `${v} ${v === '1' ? 'bar' : 'bars'} a second` }))} />
          <button type="button" className="btn btn-primary" onClick={end}>
            <Square size={13} aria-hidden="true" />
            End replay
          </button>
        </div>
      </div>
      <div className="replay-grid">
        <Pane label="Replay chart" className="pane-chart" title={`${sym}, ${TIMEFRAMES.find((t) => t.id === session.tf)?.label} bars`} tools={<Readout c={hover ?? current ?? null} />}>
          <div className="chart-wrap">
            <Chart
              label={`${sym} replay chart`}
              dataKey={`replay|${session.id}|${session.tf}|${session.startIndex}`}
              candles={visible}
              lines={lines}
              markers={markers}
              intraday={session.tf !== '1d'}
              onHover={setHover}
            />
            {atEnd ? <div className="chart-note">This is the last bar of history. End the replay to see the review.</div> : null}
          </div>
        </Pane>
        <div className="replay-side">
          <Ticket book="practice" instrumentId={session.id} getQuote={quote} pulse={session.cursor} badge={<StatusBadge state="simulated" word="Practice" />} />
          <Pane label="Book and tape" title="Book and tape" className="replay-nobook">
            <PaneState title="Not available in replay">Order books and individual trades are not kept as history. Orders here fill at bar prices, one basis point against you.</PaneState>
          </Pane>
        </div>
        <Drawer book="practice" quote={quote} />
      </div>
    </div>
  );
}
