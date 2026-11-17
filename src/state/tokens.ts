import { create } from 'zustand';
import { chainName, onPool, parseDexId, type PoolInfo } from '../data/dex';
import { registerInstrument } from '../data/instruments';
import { useAccount } from './account';
import { save } from './persist';

// A pool's id is only an address. This keeps the token's name for every pool
// the account has traded, so positions and journal entries still read "GTA6"
// after a reload, offline, or long after the pool has gone.

export interface TokenMeta {
  symbol: string;
  name: string;
  quote: string;
  /** The token's own address, for the risk report. */
  token: string;
}

interface TokenStore {
  meta: Record<string, TokenMeta>;
  remember(id: string, m: TokenMeta): void;
  hydrate(d: Record<string, TokenMeta> | undefined): void;
}

function register(id: string, m: TokenMeta): void {
  const at = parseDexId(id);
  if (!at) return;
  registerInstrument({ id, symbol: m.symbol, name: `${m.name}, against ${m.quote || 'its pool'} on ${chainName(at.chain)}`, kind: 'token', cls: 'meme', tradable: true });
}

export const useTokens = create<TokenStore>((set, get) => ({
  meta: {},
  remember(id, m) {
    const had = get().meta[id];
    if (had && had.symbol === m.symbol && had.name === m.name && had.quote === m.quote && had.token === m.token) return;
    register(id, m);
    set({ meta: { ...get().meta, [id]: m } });
    save('tokens', get().meta);
  },
  hydrate(d) {
    if (!d || typeof d !== 'object') return;
    for (const [id, m] of Object.entries(d)) if (m && typeof m.symbol === 'string' && typeof m.name === 'string') register(id, m);
    set({ meta: d });
  },
}));

const metaOf = (p: PoolInfo): TokenMeta => ({ symbol: p.symbol, name: p.name, quote: p.quoteSymbol, token: p.token });

/** Give a pool its name for this session (so the desk can show it), without storing it. */
export function nameToken(p: PoolInfo): void {
  register(p.id, metaOf(p));
}

let started = false;

/** Name every pool as it is read; store the name only for pools the account has touched. */
export function startTokens(): void {
  if (started) return;
  started = true;
  onPool((p) => {
    nameToken(p);
    const a = useAccount.getState().live;
    const mine = Object.values(a.positions).some((x) => x.instrument === p.id) || a.trades.some((t) => t.instrument === p.id);
    if (mine) useTokens.getState().remember(p.id, metaOf(p));
  });
}

/** Called when an order on a pool fills, so the name is kept from the first trade. */
export function keepToken(p: PoolInfo): void {
  useTokens.getState().remember(p.id, metaOf(p));
}
