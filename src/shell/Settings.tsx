import { useRef, useState } from 'react';
import { instrument } from '../data/instruments';
import { tradesCsv } from '../journal/stats';
import { readTheme, writeTheme, type ThemeChoice } from '../lib/theme';
import { useAccount } from '../state/account';
import { exportBackup, importBackup } from '../state/persist';
import { DEFAULTS, useSettings, type Convention } from '../state/settings';
import { toast } from '../state/toasts';
import { Dialog, Help, NumField, Segmented } from '../ui/controls';
import { DISCLAIMER } from './Intro';

export function download(name: string, text: string, type: string): void {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1_000);
}

const stampName = (): string => new Date().toISOString().slice(0, 10);

export async function exportJson(): Promise<void> {
  const backup = await exportBackup();
  download(`flame-backup-${stampName()}.json`, JSON.stringify(backup, null, 2), 'application/json');
}

export function exportCsv(): void {
  const csv = tradesCsv(useAccount.getState().live.trades, (id) => instrument(id).symbol);
  download(`flame-trades-${stampName()}.csv`, csv, 'text/csv');
}

const pctText = (rate: number): string => String(parseFloat((rate * 100).toFixed(4)));

export function Settings({ onClose }: { onClose: () => void }) {
  const s = useSettings();
  const reset = useAccount((a) => a.reset);
  const trades = useAccount((a) => a.live.trades.length);
  const [theme, setTheme] = useState<ThemeChoice>(readTheme);
  const [taker, setTaker] = useState(pctText(s.fees.cryptoTaker));
  const [maker, setMaker] = useState(pctText(s.fees.cryptoMaker));
  const [stock, setStock] = useState(pctText(s.fees.stock));
  const [risk, setRisk] = useState(String(s.riskPct));
  const [confirmReset, setConfirmReset] = useState(false);
  const file = useRef<HTMLInputElement>(null);

  const fee = (text: string, n: number, key: 'cryptoTaker' | 'cryptoMaker' | 'stock', set: (v: string) => void) => {
    set(text);
    if (Number.isFinite(n) && n >= 0 && n <= 5) s.patch({ fees: { ...s.fees, [key]: n / 100 } });
  };

  const onImport = async (f: File | undefined) => {
    if (!f) return;
    try {
      if (f.size > 50 * 1024 * 1024) throw new Error('That file is too large to be a Flame backup.');
      const raw: unknown = JSON.parse(await f.text());
      if (!window.confirm('Importing replaces the account, journal, watchlists and settings in this browser with the ones in the file. Continue?')) return;
      await importBackup(raw);
      window.location.reload();
    } catch (err) {
      toast(err instanceof SyntaxError ? 'That file is not a Flame backup.' : err instanceof Error ? err.message : 'The backup could not be imported.', { sticky: true });
    } finally {
      if (file.current) file.current.value = '';
    }
  };

  return (
    <Dialog title="Settings" onClose={onClose} wide>
      <div className="settings">
        <section>
          <h3>Appearance</h3>
          <div className="settings-row">
            <span>Theme</span>
            <Segmented<ThemeChoice>
              label="Theme"
              value={theme}
              onChange={(t) => {
                setTheme(t);
                writeTheme(t);
              }}
              options={[
                { value: 'system', label: 'System' },
                { value: 'light', label: 'Light' },
                { value: 'dark', label: 'Dark' },
              ]}
            />
          </div>
          <div className="settings-row">
            <span>
              Colours for up and down{' '}
              <Help>
                Thermal uses amber for buying and blue for selling: the pair stays distinct with every common kind of colour blindness. Classic is green and red, which many traders are used to
                but which about one man in twelve cannot tell apart; Flame always adds an arrow, a sign or a word, so nothing depends on the colour alone.
              </Help>
            </span>
            <Segmented<Convention>
              label="Colour convention"
              value={s.convention}
              onChange={(convention) => s.patch({ convention })}
              options={[
                { value: 'thermal', label: 'Thermal' },
                { value: 'classic', label: 'Classic green and red' },
              ]}
            />
          </div>
        </section>

        <section>
          <h3>Trading</h3>
          <div className="settings-grid">
            <NumField label="Crypto taker fee" suffix="%" value={taker} onChange={(t, n) => fee(t, n, 'cryptoTaker', setTaker)} note="Charged when an order crosses the spread." />
            <NumField label="Crypto maker fee" suffix="%" value={maker} onChange={(t, n) => fee(t, n, 'cryptoMaker', setMaker)} note="Charged when a resting limit fills." />
            <NumField label="Stock fee" suffix="%" value={stock} onChange={(t, n) => fee(t, n, 'stock', setStock)} note="Most brokers charge none." />
            <NumField
              label="Default risk per trade"
              suffix="% of equity"
              value={risk}
              onChange={(t, n) => {
                setRisk(t);
                if (Number.isFinite(n) && n > 0 && n <= 100) s.patch({ riskPct: n });
              }}
              note="Used when you size a position by risk."
            />
          </div>
          <label className="check">
            <input type="checkbox" checked={s.confirmOrders} onChange={(e) => s.patch({ confirmOrders: e.target.checked })} />
            Ask me to confirm every order
          </label>
          <label className="check">
            <input type="checkbox" checked={s.fillAtLastClose} onChange={(e) => s.patch({ fillAtLastClose: e.target.checked })} />
            Fill stock orders placed outside market hours at the last close, instead of holding them for the open
          </label>
          <label className="check">
            <input type="checkbox" checked={s.sounds} onChange={(e) => s.patch({ sounds: e.target.checked })} />
            Play a sound when an order fills
          </label>
          <button
            type="button"
            className="btn btn-sm"
            onClick={() => {
              s.patch({ fees: DEFAULTS.fees, riskPct: DEFAULTS.riskPct });
              setTaker(pctText(DEFAULTS.fees.cryptoTaker));
              setMaker(pctText(DEFAULTS.fees.cryptoMaker));
              setStock(pctText(DEFAULTS.fees.stock));
              setRisk(String(DEFAULTS.riskPct));
            }}
          >
            Restore default fees and risk
          </button>
        </section>

        <section>
          <h3>Your data</h3>
          <p>Everything lives in this browser. Export a backup to keep a copy, or to move to another device.</p>
          <div className="settings-actions">
            <button
              type="button"
              className="btn"
              onClick={() => void exportJson().catch(() => toast('The backup could not be written.', { sticky: true }))}
            >
              Export a backup (JSON)
            </button>
            <button type="button" className="btn" onClick={exportCsv} disabled={trades === 0}>
              Export trades (CSV)
            </button>
            <button type="button" className="btn" onClick={() => file.current?.click()}>
              Import a backup
            </button>
            <input ref={file} type="file" accept="application/json,.json" hidden onChange={(e) => void onImport(e.target.files?.[0])} />
          </div>
          {confirmReset ? (
            <div className="settings-danger" role="alertdialog" aria-label="Reset the account">
              <p>
                <strong>Reset the paper account to $100,000?</strong> This deletes every position, order, fill and journal entry in this browser. It cannot be undone; export a backup first if you
                want to keep them.
              </p>
              <div className="settings-actions">
                <button type="button" className="btn" onClick={() => setConfirmReset(false)}>
                  Keep my account
                </button>
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={() => {
                    reset('live');
                    setConfirmReset(false);
                    toast('The paper account is back to $100,000.');
                    onClose();
                  }}
                >
                  Delete history and reset
                </button>
              </div>
            </div>
          ) : (
            <button type="button" className="btn" onClick={() => setConfirmReset(true)}>
              Reset the paper account
            </button>
          )}
        </section>
        <section>
          <h3>About</h3>
          <p>{DISCLAIMER}</p>
          <p>Charts are drawn with TradingView's Lightweight Charts. Prices: Binance and six other exchanges for coins, Alpaca for stocks, Polymarket for prediction markets, Hyperliquid for funding.</p>
        </section>
      </div>
    </Dialog>
  );
}
