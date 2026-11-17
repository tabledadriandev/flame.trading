import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource-variable/archivo/standard.css';
import './styles/app.css';
import { App } from './App';
import { applyStoredTheme } from './lib/theme';
import { boot } from './state/boot';
import { useAccount } from './state/account';
import { toast } from './state/toasts';
import { registerSW } from 'virtual:pwa-register';

applyStoredTheme();
// The service worker keeps the app shell for offline use. When a deploy lands,
// say so and let the user pick the moment to reload.
const updateApp = registerSW({
  onNeedRefresh() {
    toast('A new version of Flame is ready.', { sticky: true, action: { label: 'Reload', run: () => void updateApp(true) } });
  },
  onRegisterError(err: unknown) {
    console.warn('[flame] the service worker could not register; Flame will not open offline', err);
  },
});

boot().catch((err: unknown) => {
  // Never sit on "Opening your account" forever: say what went wrong.
  console.error('[flame] could not start', err);
  useAccount.setState({ ready: true, loadError: err instanceof Error ? err.message : 'Flame could not start.' });
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
