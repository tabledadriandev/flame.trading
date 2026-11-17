import { useMemo, useState } from 'react';
import { Chart, type ChartMarker } from '../chart/Chart';
import { fetchCandles } from '../chart/useCandles';
import { instrument } from '../data/instruments';
import { tfMs, type Candle, type Timeframe } from '../data/types';
import { DEFAULT_LAB, MIN_TRADES, STRATEGIES, outOfSample, runBacktest, strategy, type BtResult, type OutOfSample, type Settings, type Sizing, type StrategyId } from '../lab/backtest';
import { day, dollars, money, parseNumber, pct } from '../lib/format';
import { useMarket } from '../state/market';
import { activeItems, useWatchlists } from '../state/watchlists';
import { Help, NumField, PaneState, Segmented } from '../ui/controls';
import { EquityChart } from '../ui/EquityChart';

type LabTf = '1h' | '4h' | '1d' | '1w';
const YEARS = ['1', '2', '3', '5'] as const;
type Years = (typeof YEARS)[number];

interface Run {
  id: string;
  tf: LabTf;
  years: number;
  candles: Candle[];
  result: BtResult;
  oos: OutOfSample | null;
  strategy: StrategyId;
  params: Record<string, number>;
  settings: Settings;
}

const ratio = (v: number | null): string => (v === null ? '—' : v === Infinity ? 'No losses' : v.toFixed(2));
const tone = (n: number): string => (n > 0 ? 'hot' : n < 0 ? 'cold' : '');

function ResultTiles({ r, compact }: { r: BtResult; compact?: boolean }) {
  const tiles: { label: string; value: string; cls?: string; help?: string }[] = [
    { label: 'Total return', value: pct(r.totalReturn * 100), cls: tone(r.totalReturn) },
    { label: 'Buy and hold', value: pct(r.buyHold * 100), cls: tone(r.buyHold), help: 'What simply buying at the start and holding to the end would have returned, with the same costs. A rule that cannot beat this has to justify itself some other way, such as a smaller drawdown.' },
    { label: 'Per year (CAGR)', value: pct(r.cagr * 100), cls: tone(r.cagr), help: 'The steady yearly rate that would produce the same total return.' },
    { label: 'Max drawdown', value: pct(-r.maxDrawdown * 100), help: 'The deepest fall from a high point in equity. It is what following the rule would have asked you to sit through.' },
    { label: 'Trades', value: String(r.trades.length) },
    { label: 'Win rate', value: r.trades.length ? pct(r.winRate * 100, false, 0) : '—' },
    { label: 'Profit factor', value: ratio(r.profitFactor), help: 'Dollars won for every dollar lost. Above 1.5 is healthy.' },
    { label: 'Expectancy', value: r.trades.length ? money(r.expectancy, { signed: true }) : '—', cls: tone(r.expectancy), help: 'The average result of one trade, after costs.' },
    { label: 'Exposure', value: pct(r.exposure * 100, false, 0), help: 'The share of bars the rule was in the market. Lower exposure for the same return means less risk taken.' },
  ];
  return (
    <div className="tiles">
      {(compact ? tiles.slice(0, 6) : tiles).map((t) => (
        <div key={t.label} className="tile">
          <div className="tile-label">
            {t.label}
            {t.help ? <Help>{t.help}</Help> : null}
          </div>
          <div className={`tile-value num ${t.cls ?? ''}`}>{t.value}</div>
        </div>
      ))}
    </div>
  );
}

export function Lab() {
  const deskId = useMarket((s) => s.instrument);
  const watch = useWatchlists(activeItems);
  const [id, setId] = useState(deskId);
  const [tf, setTf] = useState<LabTf>('1d');
  const [years, setYears] = useState<Years>('3');
  const [strat, setStrat] = useState<StrategyId>('ma-cross');
  const [params, setParams] = useState<Record<string, string>>({});
  const [fee, setFee] = useState('0.05');
  const [slip, setSlip] = useState('0.02');
  const [sizing, setSizing] = useState<Sizing['kind']>('percent');
  const [amount, setAmount] = useState<Record<Sizing['kind'], string>>({ fixed: '10000', percent: '100', risk: '1' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [run, setRun] = useState<Run | null>(null);

  const def = strategy(strat);
  const options = useMemo(() => [...new Set([id, deskId, ...watch])], [id, deskId, watch]);
  const value = (key: string, fallback: number): number => {
    const n = parseNumber(params[`${strat}.${key}`] ?? '');
    return Number.isFinite(n) ? n : fallback;
  };

  const go = async () => {
    setError(null);
    const p: Record<string, number> = {};
    for (const d of def.params) {
      const v = value(d.key, d.value);
      if (v < d.min || v > d.max) {
        setError(`${d.label} must be between ${d.min} and ${d.max}.`);
        return;
      }
      p[d.key] = v;
    }
    if (p.fast !== undefined && p.slow !== undefined && p.fast >= p.slow) {
      setError('The fast average must be shorter than the slow one.');
      return;
    }
    const feeN = parseNumber(fee);
    const slipN = parseNumber(slip);
    const amt = parseNumber(amount[sizing]);
    if (!(feeN >= 0 && feeN <= 5) || !(slipN >= 0 && slipN <= 5)) {
      setError('Fees and slippage are percentages between 0 and 5.');
      return;
    }
    if (!(amt > 0) || (sizing !== 'fixed' && amt > 100)) {
      setError(sizing === 'fixed' ? 'Enter how many dollars to put into each trade.' : 'Enter a percentage between 0 and 100.');
      return;
    }
    const settings: Settings = {
      ...DEFAULT_LAB,
      fee: feeN / 100,
      slippage: slipN / 100,
      sizing: sizing === 'fixed' ? { kind: 'fixed', dollars: amt } : sizing === 'percent' ? { kind: 'percent', percent: amt } : { kind: 'risk', percent: amt, atrMultiple: 2 },
    };
    setBusy(true);
    try {
      const want = Math.ceil((Number(years) * 365.25 * 86_400_000) / tfMs(tf as Timeframe));
      const all = await fetchCandles(id, tf as Timeframe, Math.min(want, 9_000));
      // Drop the bar still forming: a backtest should only see finished bars.
      const candles = all.slice(0, -1);
      if (candles.length < 120) throw new Error(`Only ${candles.length} bars of history are available for this instrument and timeframe: too few to test a rule on.`);
      const result = runBacktest(candles, def, p, settings);
      setRun({ id, tf, years: Number(years), candles, result, oos: outOfSample(candles, def, settings), strategy: strat, params: p, settings });
    } catch (err) {
      console.error('[flame] backtest failed', err);
      setError(err instanceof Error ? err.message : 'The history could not be loaded.');
    } finally {
      setBusy(false);
    }
  };

  const markers = useMemo<ChartMarker[]>(() => {
    if (!run) return [];
    return run.result.trades.flatMap((t) => [
      { t: t.entryT, side: 'buy' as const },
      { t: t.exitT, side: 'sell' as const },
    ]);
  }, [run]);
  const hold = useMemo(() => {
    if (!run) return [];
    const first = run.candles[0];
    if (!first) return [];
    return run.candles.map((c) => ({ t: c.t, equity: (run.settings.startCash * c.c) / first.o }));
  }, [run]);
  const sym = instrument(run?.id ?? id).symbol;

  return (
    <div className="lab">
      <header className="jtop">
        <h1 className="page-title" aria-hidden="true">
          Lab
        </h1>
        <p className="lab-lede">Test a rule on history before you risk play money on it. Fills happen at the next bar's open, with fees and slippage.</p>
      </header>

      <form
        className="lab-form"
        onSubmit={(e) => {
          e.preventDefault();
          void go();
        }}
      >
        <fieldset>
          <legend>Market</legend>
          <label className="field">
            <span className="field-label">Instrument</span>
            <span className="field-box">
              <select value={id} onChange={(e) => setId(e.target.value)}>
                {options.map((o) => (
                  <option key={o} value={o}>
                    {instrument(o).symbol}
                  </option>
                ))}
              </select>
            </span>
          </label>
          <div className="field">
            <span className="field-label">Bars</span>
            <Segmented<LabTf>
              label="Timeframe"
              value={tf}
              onChange={setTf}
              tall
              options={[
                { value: '1h', label: '1h' },
                { value: '4h', label: '4h' },
                { value: '1d', label: 'Daily' },
                { value: '1w', label: 'Weekly' },
              ]}
            />
          </div>
          <div className="field">
            <span className="field-label">History</span>
            <Segmented<Years> label="Years of history" value={years} onChange={setYears} tall options={YEARS.map((y) => ({ value: y, label: `${y} ${y === '1' ? 'year' : 'years'}` }))} />
          </div>
        </fieldset>

        <fieldset>
          <legend>Rule</legend>
          <label className="field">
            <span className="field-label">Strategy</span>
            <span className="field-box">
              <select value={strat} onChange={(e) => setStrat(e.target.value as StrategyId)}>
                {STRATEGIES.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </span>
            <span className="field-note">{def.rule} Long only.</span>
          </label>
          <div className="lab-params">
            {def.params.map((d) => (
              <NumField key={`${strat}.${d.key}`} label={d.label} value={params[`${strat}.${d.key}`] ?? String(d.value)} onChange={(text) => setParams((p) => ({ ...p, [`${strat}.${d.key}`]: text }))} />
            ))}
          </div>
        </fieldset>

        <fieldset>
          <legend>Costs and size</legend>
          <div className="lab-params">
            <NumField label="Fee per side" suffix="%" value={fee} onChange={(t) => setFee(t)} />
            <NumField label="Slippage per side" suffix="%" value={slip} onChange={(t) => setSlip(t)} />
          </div>
          <div className="field">
            <span className="field-label">
              Position size
              {sizing === 'risk' ? (
                <Help>
                  Each trade risks this share of equity. The stop sits two average true ranges below the entry, and the position is sized so that being stopped out loses exactly that share.
                </Help>
              ) : null}
            </span>
            <Segmented<Sizing['kind']>
              label="Position sizing"
              value={sizing}
              onChange={setSizing}
              tall
              options={[
                { value: 'percent', label: 'Percent of equity' },
                { value: 'fixed', label: 'Fixed dollars' },
                { value: 'risk', label: 'Fixed risk' },
              ]}
            />
          </div>
          <NumField
            label={sizing === 'fixed' ? 'Dollars per trade' : sizing === 'percent' ? 'Share of equity per trade' : 'Risk per trade'}
            prefix={sizing === 'fixed' ? '$' : undefined}
            suffix={sizing === 'fixed' ? undefined : '%'}
            value={amount[sizing]}
            onChange={(t) => setAmount((a) => ({ ...a, [sizing]: t }))}
          />
        </fieldset>

        <div className="lab-run">
          <button type="submit" className="btn btn-primary setup-go" disabled={busy}>
            {busy ? 'Running' : 'Run the test'}
          </button>
          {error ? (
            <p className="setup-error" role="alert">
              {error}
            </p>
          ) : null}
        </div>
      </form>

      {!run ? (
        <section className="jblock">
          <PaneState title="No test run yet">Choose a market and a rule, then run the test. The result shows the equity curve, every trade, and how the rule did on data it was not tuned on.</PaneState>
        </section>
      ) : (
        <>
          <section className="jblock" aria-label="Result">
            <header className="jhead">
              <h2>
                {strategy(run.strategy).name} on {sym}
              </h2>
              <span className="sub">
                {run.candles.length} {run.tf === '1d' ? 'daily' : run.tf === '1w' ? 'weekly' : run.tf} bars, {day(run.result.from, true)} to {day(run.result.to, true)}
              </span>
            </header>
            {run.result.trades.length < MIN_TRADES ? (
              <p className="lab-warn" role="note">
                <strong>
                  This result rests on {run.result.trades.length} {run.result.trades.length === 1 ? 'trade' : 'trades'}.
                </strong>{' '}
                Fewer than {MIN_TRADES} is too few to tell skill from luck: one or two different outcomes would change every number below. Test more history or a shorter timeframe.
              </p>
            ) : null}
            <ResultTiles r={run.result} />
          </section>

          <section className="jblock" aria-label="Equity curve">
            <header className="jhead">
              <h2>Equity</h2>
              <span className="sub">Starting from {money(run.settings.startCash, { decimals: 0 })}</span>
            </header>
            <EquityChart points={run.result.curve} compare={hold} compareLabel="Buy and hold" label="Backtest equity curve" height={240} />
          </section>

          <section className="jblock" aria-label="Out-of-sample check">
            <header className="jhead">
              <h2>
                Out-of-sample check{' '}
                <Help>
                  Any rule can be tuned to look good on the past. So Flame tunes the parameters on the first 70% of the bars, then runs the winner on the last 30%, which the tuning never saw. If
                  it only works on the part it was tuned on, it has learned the past, not the market.
                </Help>
              </h2>
            </header>
            {!run.oos ? (
              <PaneState title="Not enough bars to split">The check needs at least 90 bars: 60 to tune on and 30 to test on.</PaneState>
            ) : (
              <>
                <p className={`lab-verdict ${run.oos.agrees ? '' : 'lab-verdict-no'}`}>{run.oos.verdict}</p>
                <div className="lab-oos">
                  <div>
                    <h3>
                      Tuned on the first 70% <span className="sub">({day(run.oos.inSample.from, true)} to {day(run.oos.inSample.to, true)})</span>
                    </h3>
                    <p className="sub">
                      Best of {run.oos.tried} combinations:{' '}
                      {strategy(run.strategy)
                        .params.map((d) => `${d.label.toLowerCase()} ${run.oos!.best[d.key]}`)
                        .join(', ')}
                      .
                    </p>
                    <ResultTiles r={run.oos.inSample} compact />
                  </div>
                  <div>
                    <h3>
                      Run on the last 30%, unseen <span className="sub">({day(run.oos.outOfSample.from, true)} to {day(run.oos.outOfSample.to, true)})</span>
                    </h3>
                    <p className="sub">The same parameters, on bars the tuning never saw.</p>
                    <ResultTiles r={run.oos.outOfSample} compact />
                  </div>
                </div>
              </>
            )}
          </section>

          <section className="jblock" aria-label="Trades on the chart">
            <header className="jhead">
              <h2>Trades on the chart</h2>
              <span className="sub">An up arrow is an entry, a down arrow an exit.</span>
            </header>
            <div className="review-chart">
              <Chart label={`${sym} with the backtest's trades`} dataKey={`lab|${run.id}|${run.tf}|${run.result.to}|${run.strategy}`} candles={run.candles} markers={markers} intraday={run.tf === '1h' || run.tf === '4h'} />
            </div>
          </section>

          <section className="jblock" aria-label="Trade list">
            <header className="jhead">
              <h2>Trade list</h2>
              <span className="sub">
                {run.result.trades.length} {run.result.trades.length === 1 ? 'trade' : 'trades'}
              </span>
            </header>
            {run.result.trades.length === 0 ? (
              <PaneState title="The rule never traded">Its entry condition was not met once in this history. Try other parameters or a longer period.</PaneState>
            ) : (
              <div className="jscroll lab-trades">
                <table className="table">
                  <thead>
                    <tr>
                      <th className="l">Entered</th>
                      <th>Entry</th>
                      <th className="l">Exited</th>
                      <th>Exit</th>
                      <th>Size</th>
                      <th>Bars held</th>
                      <th>Fees</th>
                      <th>P&amp;L</th>
                      <th>Return</th>
                      <th className="l">Exit reason</th>
                    </tr>
                  </thead>
                  <tbody>
                    {run.result.trades.map((t, n) => (
                      <tr key={n}>
                        <td className="l">{day(t.entryT, true)}</td>
                        <td>{dollars(t.entryPrice)}</td>
                        <td className="l">{day(t.exitT, true)}</td>
                        <td>{dollars(t.exitPrice)}</td>
                        <td>{t.qty.toLocaleString('en-US', { maximumFractionDigits: 4 })}</td>
                        <td>{t.bars}</td>
                        <td>{money(t.fees)}</td>
                        <td className={tone(t.pnl)}>{money(t.pnl, { signed: true })}</td>
                        <td className={tone(t.pnl)}>{pct((t.exitPrice / t.entryPrice - 1) * 100)}</td>
                        <td className="l sub">{t.reason === 'signal' ? 'Rule' : t.reason === 'stop' ? 'Stop' : 'End of test'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </>
      )}
    </div>
  );
}
