import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource-variable/archivo/standard.css';
import './styles/app.css';
import { App } from './App';
import { applyStoredTheme } from './lib/theme';
import { boot } from './state/boot';
import { useAccount } from './state/account';

applyStoredTheme();
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
