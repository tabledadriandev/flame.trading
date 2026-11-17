import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource-variable/archivo/standard.css';
import './styles/app.css';
import { App } from './App';
import { applyStoredTheme } from './lib/theme';
import { boot } from './state/boot';

applyStoredTheme();
void boot();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
