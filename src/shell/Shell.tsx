import { useEffect, useState, type ReactNode } from 'react';
import {
  ChartCandlestick,
  FlaskConical,
  Globe,
  History,
  Moon,
  Newspaper,
  NotebookPen,
  Percent,
  Search,
  Settings as SettingsIcon,
  Sun,
  Waves,
  WifiOff,
  type LucideIcon,
} from 'lucide-react';
import { Mark } from './Mark';
import type { ViewId } from '../lib/route';
import { readTheme, resolvedTheme, writeTheme } from '../lib/theme';
import { SIM } from '../lib/env';
import { money } from '../lib/format';
import { useValuation } from '../state/hooks';
import { useAccount } from '../state/account';
import { Toasts } from '../ui/Toasts';
import { Help } from '../ui/controls';
import { usePalette } from '../state/palette';
import { useMarket } from '../state/market';
import { useLayout } from '../state/layout';
import { Palette } from './Palette';
import { Settings } from './Settings';
import { Intro } from './Intro';
import { useGlobalKeys } from './keys';

function AccountBadge() {
  const v = useValuation('live');
  const start = useAccount((s) => s.live.startCash);
  const total = v.equity - start;
  return (
    <div className="bar-account">
      <span className="bar-account-label">
        Paper equity{' '}
        <Help align="right">
          Cash, plus the value of what you hold, plus the margin behind leveraged positions and their unrealised P&amp;L. All of it is play money.
        </Help>
      </span>
      <span className="bar-account-value num">{money(v.equity)}</span>
      <span className={`bar-account-pnl num ${total >= 0 ? 'hot' : 'cold'}`} title="Change since the account started">
        {money(total, { signed: true })}
      </span>
    </div>
  );
}

export const NAV: { id: ViewId; label: string; icon: LucideIcon }[] = [
  { id: 'desk', label: 'Desk', icon: ChartCandlestick },
  { id: 'markets', label: 'Markets', icon: Globe },
  { id: 'flow', label: 'Flow', icon: Waves },
  { id: 'odds', label: 'Odds', icon: Percent },
  { id: 'replay', label: 'Replay', icon: History },
  { id: 'lab', label: 'Lab', icon: FlaskConical },
  { id: 'journal', label: 'Journal', icon: NotebookPen },
  { id: 'news', label: 'News', icon: Newspaper },
];

export function Shell({ view, children }: { view: ViewId; children: ReactNode }) {
  const [theme, setTheme] = useState(() => resolvedTheme(readTheme()));

  const zen = useLayout((s) => s.zen) && view === 'desk';
  const [settings, setSettings] = useState(false);
  const online = useMarket((s) => s.online);
  useEffect(() => {
    document.title = `Flame: ${NAV.find((n) => n.id === view)?.label ?? 'Desk'}`;
  }, [view]);
  useGlobalKeys();

  function toggleTheme() {
    const next = theme === 'dark' ? 'light' : 'dark';
    writeTheme(next);
    setTheme(next);
  }

  return (
    <div className="shell" data-zen={zen ? 'true' : undefined}>
      <nav className="rail" aria-label="Views">
        <div className="rail-mark">
          <Mark />
        </div>
        <div className="rail-nav">
          {NAV.map(({ id, label, icon: Icon }) => (
            <a key={id} className="rail-link" href={`#${id}`} aria-current={view === id ? 'page' : undefined}>
              <Icon size={18} strokeWidth={1.75} aria-hidden="true" />
              {label}
            </a>
          ))}
        </div>
      </nav>

      <header className="bar">
        <span className="wordmark">Flame</span>
        <button type="button" className="bar-search" onClick={() => usePalette.getState().show()} aria-keyshortcuts="Meta+K Control+K /">
          <Search size={14} aria-hidden="true" />
          Search a stock, index or coin
          <kbd>{/Mac|iPhone|iPad/.test(navigator.platform) ? '⌘K' : 'Ctrl K'}</kbd>
        </button>
        {!online ? (
          <span className="status" data-level="warn" role="status" title="This device is offline. Prices and order fills are paused; your journal and history still work. Everything resumes when the connection returns.">
            <WifiOff size={11} aria-hidden="true" />
            Offline: feeds paused
          </span>
        ) : null}
        {SIM ? (
          <span className="status" data-level="warn" title="Every price on screen is made up. Remove ?sim=1 from the address to see real markets.">
            Simulated feed
          </span>
        ) : null}
        <AccountBadge />
        <button type="button" className="theme-toggle" onClick={() => setSettings(true)} aria-label="Settings" title="Settings">
          <SettingsIcon size={15} aria-hidden="true" />
        </button>
        <button
          type="button"
          className="theme-toggle"
          onClick={toggleTheme}
          aria-label={theme === 'dark' ? 'Switch to the light theme' : 'Switch to the dark theme'}
        >
          {theme === 'dark' ? <Sun size={15} aria-hidden="true" /> : <Moon size={15} aria-hidden="true" />}
        </button>
      </header>

      <main className="view">
        <h1 className="sr-only">{NAV.find((n) => n.id === view)?.label}</h1>
        {children}
      </main>
      <Palette />
      <Intro />
      {settings ? <Settings onClose={() => setSettings(false)} /> : null}
      <Toasts />
    </div>
  );
}
