import type { Account } from '../engine/types';
import { registerSnapshot, useAccount } from './account';
import { recentCloses } from '../chart/useCandles';
import { seedClock } from './clock';
import { setFrameErrorHandler } from '../data/schedule';
import { SIM } from '../lib/env';
import { startLive, stopLive } from './live';
import { startFunding, stopFunding } from './funding';
import { startExpiry, stopExpiry } from './options';
import { startTokens, useTokens, type TokenMeta } from './tokens';
import { useMarket } from './market';
import { flush, freezeSaves, load, persistent, setSaveErrorHandler } from './persist';
import { useSettings, type Settings } from './settings';
import { toast } from './toasts';
import { useWatchlists, type Watchlist } from './watchlists';
import { useLayout, type LayoutDoc } from './layout';
import { useIndicators } from './indicators';
import { useLevels, type Level } from './levels';
import { startSettlement, useOdds, type OddsMeta } from './odds';

const LOCK = SIM ? 'flame-account-sim' : 'flame-account';
const channel = typeof BroadcastChannel === 'undefined' ? null : new BroadcastChannel(LOCK);

/**
 * One tab at a time owns the account. Two tabs would each keep their own copy
 * in memory and save over each other's fills. Returns false when another tab
 * already holds it.
 */
function claimAccount(): Promise<boolean> {
  if (typeof navigator === 'undefined' || !navigator.locks) return Promise.resolve(true);
  return new Promise((resolve) => {
    void navigator.locks
      .request(LOCK, { ifAvailable: true }, (lock) => {
        if (!lock) {
          resolve(false);
          return undefined;
        }
        resolve(true);
        // Hold the lock until another tab asks to take over.
        return new Promise<void>((release) => {
          channel?.addEventListener('message', (e) => {
            if (e.data !== 'takeover') return;
            void flush().then(() => {
              freezeSaves();
              // Stand down completely: no feeds, no engine, nothing saved from here on.
              stopLive();
              stopFunding();
              stopExpiry();
              useAccount.setState({ elsewhere: true });
              release();
            });
          });
        });
      })
      .catch((err: unknown) => {
        console.warn('[flame] could not take the account lock; continuing without it', err);
        resolve(true);
      });
  });
}

/** Ask the tab that owns the account to hand it over, then load it here. */
export function takeOver(): void {
  channel?.postMessage('takeover');
  if (!navigator.locks) {
    window.location.reload();
    return;
  }
  // The lock frees once the other tab has saved; reloading then claims it.
  void navigator.locks.request(LOCK, () => undefined).then(() => window.location.reload());
}

/** Read what the browser kept, then start the feeds. */
export async function boot(): Promise<void> {
  if (!(await claimAccount())) {
    useAccount.setState({ ready: true, elsewhere: true });
    return;
  }

  const [account, settings, watch, layout] = await Promise.all([
    load<Account>('account'),
    load<Partial<Settings>>('settings'),
    load<{ lists?: Watchlist[]; active?: string }>('watchlists'),
    load<LayoutDoc>('layout'),
  ]);
  const levels = await load<Record<string, Level[]>>('levels');
  if (levels.ok) useLevels.getState().hydrate(levels.data);
  const odds = await load<Record<string, OddsMeta>>('odds');
  if (odds.ok) useOdds.getState().hydrate(odds.data);
  startSettlement();
  const tokens = await load<Record<string, TokenMeta>>('tokens');
  if (tokens.ok) useTokens.getState().hydrate(tokens.data);
  startTokens();

  if (settings.ok) useSettings.getState().hydrate(settings.data);
  else useSettings.getState().hydrate(undefined);
  if (watch.ok) useWatchlists.getState().hydrate(watch.data);
  if (layout.ok) {
    useMarket.getState().hydrate(layout.data);
    useLayout.getState().hydrate(layout.data);
    useIndicators.getState().hydrate(layout.data as { indicators?: unknown; volume?: unknown; chartType?: unknown } | undefined);
  }

  if (account.ok) {
    useAccount.getState().hydrate(account.data);
    // The gap since the last visit is replayed as soon as the first price arrives.
    seedClock(useAccount.getState().live.lastSeen);
  } else {
    // Do not start a fresh account over one that exists but cannot be read.
    useAccount.setState({ ready: true, loadError: account.error });
  }

  const lost = [!settings.ok && 'settings', !watch.ok && 'watchlists', !layout.ok && 'layout', !levels.ok && 'chart levels', !tokens.ok && 'token names'].filter(Boolean);
  if (lost.length) toast(`Could not read your stored ${lost.join(', ')}. Defaults are in use.`, { sticky: true });
  if (!persistent) toast('This browser is not letting Flame store data. Your account will last only until this tab closes.', { sticky: true });

  setSaveErrorHandler(() => toast('Could not save to this browser. Export a backup from Settings to keep your account.', { sticky: true }));
  window.addEventListener('pagehide', () => void flush());
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) void flush();
  });

  registerSnapshot((id) => recentCloses(id));

  let warned = false;
  setFrameErrorHandler(() => {
    if (warned) return;
    warned = true;
    toast('A price update could not be processed. If prices or orders look wrong, reload the page.', { sticky: true });
  });

  if (account.ok) {
    startLive();
    startFunding();
    startExpiry();
  }
}
