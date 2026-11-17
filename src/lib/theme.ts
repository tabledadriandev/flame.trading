// Flame follows the system light/dark setting unless the user picks one.
// The choice is a per-browser convenience, so localStorage is the right home.

export type ThemeChoice = 'system' | 'light' | 'dark';

const KEY = 'flame.theme';

export function readTheme(): ThemeChoice {
  try {
    const v = localStorage.getItem(KEY);
    return v === 'light' || v === 'dark' ? v : 'system';
  } catch {
    return 'system';
  }
}

export function writeTheme(choice: ThemeChoice): void {
  try {
    if (choice === 'system') localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, choice);
  } catch {
    // Storage can be unavailable (private mode); the theme still applies for this visit.
  }
  applyTheme(choice);
}

export function applyTheme(choice: ThemeChoice): void {
  const root = document.documentElement;
  if (choice === 'system') root.removeAttribute('data-theme');
  else root.setAttribute('data-theme', choice);
  // Canvas-drawn panes (the chart, the ladder) cannot read CSS variables live; tell them to re-read.
  window.dispatchEvent(new Event('flame:theme'));
}

export interface ThemeColors {
  bg: string;
  surface: string;
  raised: string;
  line: string;
  lineStrong: string;
  ink: string;
  ink2: string;
  ink3: string;
  hot: string;
  cold: string;
}

/** The current token values, resolved, for anything drawn on a canvas. */
export function themeColors(): ThemeColors {
  const cs = getComputedStyle(document.documentElement);
  const v = (name: string) => cs.getPropertyValue(name).trim();
  return {
    bg: v('--bg'),
    surface: v('--surface'),
    raised: v('--raised'),
    line: v('--line'),
    lineStrong: v('--line-strong'),
    ink: v('--ink'),
    ink2: v('--ink-2'),
    ink3: v('--ink-3'),
    hot: v('--hot'),
    cold: v('--cold'),
  };
}

/** A hex colour with an alpha, as rgba(). */
export function alpha(hex: string, a: number): string {
  const h = hex.replace('#', '');
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
  const n = parseInt(full.slice(0, 6), 16);
  if (Number.isNaN(n)) return hex;
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
}

/** Calls back whenever the theme or colour convention changes, including the system setting. */
export function onThemeChange(cb: () => void): () => void {
  const mq = window.matchMedia('(prefers-color-scheme: dark)');
  window.addEventListener('flame:theme', cb);
  mq.addEventListener('change', cb);
  return () => {
    window.removeEventListener('flame:theme', cb);
    mq.removeEventListener('change', cb);
  };
}

export function applyStoredTheme(): void {
  applyTheme(readTheme());
}

export function resolvedTheme(choice: ThemeChoice): 'light' | 'dark' {
  if (choice !== 'system') return choice;
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}
