import { create } from 'zustand';
import { registerInstrument } from '../data/instruments';
import { onMarket } from '../data/poly';
import { posKey } from '../engine/types';
import { useAccount } from './account';
import { save } from './persist';
import { toast } from './toasts';

// What each prediction-market position is a bet on. The engine knows an
// outcome only by its token id; this keeps the question and the outcome name,
// so a position reads "Yes: Fed cuts in December?" after a reload.

export interface OddsMeta {
  question: string;
  outcome: string;
  label: string | null;
  event: string;
}

interface OddsStore {
  meta: Record<string, OddsMeta>;
  remember(token: string, m: OddsMeta): void;
  hydrate(d: Record<string, OddsMeta> | undefined): void;
}

function register(token: string, m: OddsMeta): void {
  const what = m.label ?? m.question;
  registerInstrument({ id: `poly:${token}`, symbol: `${m.outcome}: ${what.length > 34 ? `${what.slice(0, 32)}…` : what}`, name: m.question, kind: 'odds', cls: 'odds', tradable: true });
}

export const useOdds = create<OddsStore>((set, get) => ({
  meta: {},
  remember(token, m) {
    register(token, m);
    set({ meta: { ...get().meta, [token]: m } });
    save('odds', get().meta);
  },
  hydrate(d) {
    if (!d || typeof d !== 'object') return;
    for (const [token, m] of Object.entries(d)) if (m && typeof m.question === 'string' && typeof m.outcome === 'string') register(token, m);
    set({ meta: d });
  },
}));

let settling = false;

/** When a market that the account holds has resolved, pay it out: $1 a share to the winning outcome, $0 to the rest. */
export function startSettlement(): void {
  if (settling) return;
  settling = true;
  onMarket((token, d) => {
    if (!d.market.resolved) return;
    const id = `poly:${token}`;
    const a = useAccount.getState();
    const pos = a.live.positions[posKey(id, 'spot')];
    const own = d.market.outcomes.find((o) => o.token === token);
    if (!pos || !own) return;
    // A resolved market prices the winner at 1 and the others at 0. Anything in between is not settled yet.
    if (own.price < 0.99 && own.price > 0.01) return;
    const payout = own.price >= 0.99 ? 1 : 0;
    a.settle(id, payout);
    toast(`"${d.market.question}" resolved. Your ${own.name} shares ${payout === 1 ? 'paid $1 each' : 'expired worthless'}.`, { sticky: true });
  });
}
