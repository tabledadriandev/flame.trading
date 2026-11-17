import type { Account } from '../engine/types';
import { useAccount } from './account';
import { catchUp } from './away';
import { startLive } from './live';
import { useMarket } from './market';
import { flush, load, persistent, setSaveErrorHandler } from './persist';
import { useSettings, type Settings } from './settings';
import { toast } from './toasts';
import { useWatchlists, type Watchlist } from './watchlists';
import { useLayout, type LayoutDoc } from './layout';

/** Read what the browser kept, then start the feeds. */
export async function boot(): Promise<void> {
  const [account, settings, watch, layout] = await Promise.all([
    load<Account>('account'),
    load<Partial<Settings>>('settings'),
    load<{ lists?: Watchlist[]; active?: string }>('watchlists'),
    load<LayoutDoc>('layout'),
  ]);

  if (settings.ok) useSettings.getState().hydrate(settings.data);
  else useSettings.getState().hydrate(undefined);
  if (watch.ok) useWatchlists.getState().hydrate(watch.data);
  if (layout.ok) {
    useMarket.getState().hydrate(layout.data);
    useLayout.getState().hydrate(layout.data);
  }

  if (account.ok) {
    useAccount.getState().hydrate(account.data);
  } else {
    // Do not start a fresh account over one that exists but cannot be read.
    useAccount.setState({ ready: true, loadError: account.error });
  }

  const lost = [!settings.ok && 'settings', !watch.ok && 'watchlists', !layout.ok && 'layout'].filter(Boolean);
  if (lost.length) toast(`Could not read your stored ${lost.join(', ')}. Defaults are in use.`, { sticky: true });
  if (!persistent) toast('This browser is not letting Flame store data. Your account will last only until this tab closes.', { sticky: true });

  setSaveErrorHandler(() => toast('Could not save to this browser. Export a backup from Settings to keep your account.', { sticky: true }));
  window.addEventListener('pagehide', () => void flush());
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) void flush();
  });

  startLive();
  if (account.ok) void catchUp();
}
