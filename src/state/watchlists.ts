import { create } from 'zustand';
import { save } from './persist';

export interface Watchlist {
  id: string;
  name: string;
  items: string[];
}

interface WatchStore {
  lists: Watchlist[];
  active: string;
  setActive(id: string): void;
  add(instrument: string): void;
  remove(instrument: string): void;
  move(from: number, to: number): void;
  createList(name: string): void;
  renameList(id: string, name: string): void;
  deleteList(id: string): void;
  hydrate(d: { lists?: Watchlist[]; active?: string } | undefined): void;
}

const DEFAULT_LISTS: Watchlist[] = [
  { id: 'main', name: 'Main', items: ['crypto:BTC', 'crypto:ETH', 'crypto:SOL', 'crypto:BNB', 'crypto:XRP', 'crypto:DOGE', 'crypto:AVAX', 'crypto:LINK'] },
];

export const useWatchlists = create<WatchStore>((set, get) => {
  const commit = (p: Partial<Pick<WatchStore, 'lists' | 'active'>>) => {
    set(p);
    save('watchlists', { lists: get().lists, active: get().active });
  };
  const edit = (fn: (items: string[]) => string[]) =>
    commit({ lists: get().lists.map((l) => (l.id === get().active ? { ...l, items: fn(l.items) } : l)) });
  return {
    lists: DEFAULT_LISTS,
    active: 'main',
    setActive: (id) => commit({ active: id }),
    add: (instrument) => edit((items) => (items.includes(instrument) ? items : [...items, instrument])),
    remove: (instrument) => edit((items) => items.filter((i) => i !== instrument)),
    move: (from, to) =>
      edit((items) => {
        const next = [...items];
        const [moved] = next.splice(from, 1);
        if (moved === undefined) return items;
        next.splice(Math.max(0, Math.min(next.length, to)), 0, moved);
        return next;
      }),
    createList(name) {
      const id = `l${Date.now().toString(36)}`;
      commit({ lists: [...get().lists, { id, name: name.trim() || 'New list', items: [] }], active: id });
    },
    renameList: (id, name) => commit({ lists: get().lists.map((l) => (l.id === id ? { ...l, name: name.trim() || l.name } : l)) }),
    deleteList(id) {
      const lists = get().lists.filter((l) => l.id !== id);
      if (lists.length === 0) return;
      commit({ lists, active: get().active === id ? lists[0]!.id : get().active });
    },
    hydrate(d) {
      if (d?.lists?.length) set({ lists: d.lists, active: d.lists.some((l) => l.id === d.active) ? d.active! : d.lists[0]!.id });
    },
  };
});

export const activeItems = (s: WatchStore): string[] => s.lists.find((l) => l.id === s.active)?.items ?? [];
