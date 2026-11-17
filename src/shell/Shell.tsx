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
        <div className="bar-account">
          <span className="bar-account-label">Paper account</span>
          <span className="bar-account-value num">$100,000.00</span>
        </div>
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
    </div>
  );
}
