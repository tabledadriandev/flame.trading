import { SIM } from '../lib/env';
import { binanceTopMarkets } from './binance';
import { allInstruments, registerInstrument, type Instrument } from './instruments';

// One search across everything Flame can show. Crypto comes from the built-in
// list plus Binance's most-traded pairs; stocks and indices from the built-in
// list plus a remote symbol search (registered by the stocks adapter).

let cryptoLoaded: Promise<void> | null = null;

function loadCrypto(): Promise<void> {
  if (SIM) return Promise.resolve();
  cryptoLoaded ??= binanceTopMarkets(60)
    .then((markets) => {
      const known = new Set(allInstruments().map((i) => i.id));
      for (const m of markets) {
        const id = `crypto:${m.base}`;
        if (!known.has(id)) registerInstrument({ id, symbol: m.base, name: m.base, kind: 'crypto', cls: 'crypto', tradable: true });
      }
    })
    .catch((err: unknown) => {
      // Search still works on the built-in list; try the full list again next time.
      console.warn('[flame] could not load the list of crypto markets', err);
      cryptoLoaded = null;
    });
  return cryptoLoaded;
}

type Remote = (q: string) => Promise<Instrument[]>;
let remote: Remote | null = null;
export function registerRemoteSearch(fn: Remote): void {
  remote = fn;
}

function rank(i: Instrument, q: string): number {
  const s = i.symbol.toLowerCase();
  const n = i.name.toLowerCase();
  if (s === q) return 0;
  if (s.startsWith(q)) return 1;
  if (n.startsWith(q)) return 2;
  if (s.includes(q)) return 3;
  if (n.includes(q)) return 4;
  return 9;
}

export function searchLocal(query: string, limit = 12): Instrument[] {
  const q = query.trim().toLowerCase();
  const list = allInstruments().filter((i) => i.kind !== 'odds');
  if (!q) return list.slice(0, limit);
  return list
    .map((i) => ({ i, r: rank(i, q) }))
    .filter((x) => x.r < 9)
    .sort((a, b) => a.r - b.r)
    .slice(0, limit)
    .map((x) => x.i);
}

export interface SearchResult {
  items: Instrument[];
  /** Set when the remote half of the search failed; the local half is still shown. */
  problem: string | null;
}

/** Local matches at once; `onMore` fires as the crypto list and the remote search answer, each time with everything known so far. */
export function search(query: string, onMore: (r: SearchResult) => void): Instrument[] {
  const local = searchLocal(query);
  const q = query.trim();
  let remoteFound: Instrument[] = [];
  let problem: string | null = null;
  const emit = () => {
    const merged = searchLocal(query, 16);
    const ids = new Set(merged.map((m) => m.id));
    onMore({ items: [...merged, ...remoteFound.filter((f) => !ids.has(f.id))].slice(0, 16), problem });
  };
  void loadCrypto().then(emit);
  if (remote && q.length >= 2 && !SIM) {
    remote(q)
      .then((found) => {
        for (const f of found) registerInstrument(f);
        remoteFound = found;
        emit();
      })
      .catch((err: unknown) => {
        console.warn('[flame] symbol search failed', err);
        problem = 'Stock search is not answering; showing the built-in list only.';
        emit();
      });
  }
  return local;
}
