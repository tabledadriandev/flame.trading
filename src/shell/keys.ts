import { useEffect } from 'react';
import { TIMEFRAMES } from '../data/types';
import { VIEWS } from '../lib/route';
import { useLayout } from '../state/layout';
import { useMarket } from '../state/market';
import { usePalette } from '../state/palette';
import { VIEW_KEYS, closeSelected, goView, limitAtHover, ticketSide, toggleZen } from './commands';

// The keyboard map from docs/product-spec.md. Keys are ignored while typing in
// a field, and whenever a modifier other than Shift is held (so browser
// shortcuts keep working).

const typing = (el: EventTarget | null): boolean => {
  const t = el as HTMLElement | null;
  if (!t || !t.tagName) return false;
  return t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable;
};

export function useGlobalKeys(): void {
  useEffect(() => {
    let gAt = 0;
    const onKey = (e: KeyboardEvent) => {
      const palette = usePalette.getState();
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        if (palette.open) palette.hide();
        else palette.show();
        return;
      }
      if (e.metaKey || e.ctrlKey || e.altKey || palette.open) return;
      if (e.key === 'Escape') {
        const l = useLayout.getState();
        if (l.zen) l.setZen(false);
        else if (l.maximised) l.toggleMax(l.maximised);
        else if (typing(e.target)) (e.target as HTMLElement).blur();
        return;
      }
      if (typing(e.target) || document.querySelector('[role="dialog"][aria-modal="true"]')) return;
      const k = e.key.toLowerCase();

      // G then a letter goes to a view.
      if (Date.now() - gAt < 1_200) {
        gAt = 0;
        const view = VIEWS.find((v) => VIEW_KEYS[v].toLowerCase() === k);
        if (view) {
          e.preventDefault();
          goView(view);
          return;
        }
      }
      if (k === 'g') {
        gAt = Date.now();
        return;
      }

      if (k === '/') {
        e.preventDefault();
        palette.show();
      } else if (k >= '1' && k <= '7') {
        const tf = TIMEFRAMES[Number(k) - 1];
        if (tf) useMarket.getState().setTf(tf.id);
      } else if (k === 'b') {
        e.preventDefault();
        ticketSide('buy');
      } else if (k === 's') {
        e.preventDefault();
        ticketSide('sell');
      } else if (k === 'l') {
        e.preventDefault();
        limitAtHover();
      } else if (k === 'x') {
        closeSelected();
      } else if (k === 'z') {
        toggleZen();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
}
