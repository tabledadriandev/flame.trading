import { useSyncExternalStore } from 'react';

// Views are addressed by a plain hash (#desk, #markets) so the app stays a
// static single page and every view can be bookmarked.

export const VIEWS = ['desk', 'markets', 'flow', 'odds', 'options', 'replay', 'lab', 'journal', 'news'] as const;
export type ViewId = (typeof VIEWS)[number];

function current(): ViewId {
  const id = window.location.hash.replace(/^#/, '');
  return (VIEWS as readonly string[]).includes(id) ? (id as ViewId) : 'desk';
}

function subscribe(onChange: () => void): () => void {
  window.addEventListener('hashchange', onChange);
  return () => window.removeEventListener('hashchange', onChange);
}

export function useView(): ViewId {
  return useSyncExternalStore(subscribe, current, () => 'desk');
}
