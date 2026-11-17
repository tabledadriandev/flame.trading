import { useState, type ReactNode } from 'react';
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
  Sun,
  Waves,
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

  function toggleTheme() {
    const next = theme === 'dark' ? 'light' : 'dark';
    writeTheme(next);
    setTheme(next);
  }

  return (
    <div className="shell">
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
        <div className="bar-search" aria-disabled="true" title="Search arrives with the command palette">
          <Search size={14} aria-hidden="true" />
          Search a stock, index or coin
          <kbd>⌘K</kbd>
        </div>
        {SIM ? (
          <span className="status" data-level="warn" title="Every price on screen is made up. Remove ?sim=1 from the address to see real markets.">
            Simulated feed
          </span>
        ) : null}
        <AccountBadge />
        <button
          type="button"
          className="theme-toggle"
          onClick={toggleTheme}
          aria-label={theme === 'dark' ? 'Switch to the light theme' : 'Switch to the dark theme'}
        >
          {theme === 'dark' ? <Sun size={15} aria-hidden="true" /> : <Moon size={15} aria-hidden="true" />}
        </button>
      </header>

      <main className="view">{children}</main>
      <Toasts />
    </div>
  );
}
