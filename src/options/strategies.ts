// Option strategies as templates: each names the legs to trade, in the order
// they must be placed (bought legs first, so a sold leg finds its cover).
// Pure: the view supplies the strikes that exist and prices the legs.

export type StrategyId = 'call-spread' | 'put-spread' | 'straddle' | 'strangle' | 'covered-call' | 'cash-put';

export interface StrategyLeg {
  kind: 'call' | 'put';
  side: 'buy' | 'sell';
  strike: number;
}

export interface Strategy {
  id: StrategyId;
  name: string;
  /** What it is for, in a sentence. */
  idea: string;
  /** Labels for the strikes the reader chooses: one or two. */
  strikes: string[];
}

export const STRATEGIES: Strategy[] = [
  {
    id: 'call-spread',
    name: 'Call spread',
    idea: 'Buy a call and sell a dearer-strike call against it. Cheaper than the call alone; the gain stops at the strike you sold.',
    strikes: ['Buy the call at', 'Sell the call at'],
  },
  {
    id: 'put-spread',
    name: 'Put spread',
    idea: 'Buy a put and sell a lower-strike put against it. Cheaper than the put alone; the gain stops at the strike you sold.',
    strikes: ['Buy the put at', 'Sell the put at'],
  },
  {
    id: 'straddle',
    name: 'Straddle',
    idea: 'Buy a call and a put at the same strike. It pays if the price moves far enough either way, and loses both premiums if it stays put.',
    strikes: ['Strike'],
  },
  {
    id: 'strangle',
    name: 'Strangle',
    idea: 'Buy a put below the price and a call above it. Cheaper than a straddle; the price has to move further before it pays.',
    strikes: ['Buy the put at', 'Buy the call at'],
  },
  {
    id: 'covered-call',
    name: 'Covered call',
    idea: 'Sell a call against the asset you already hold. You keep the premium; above the strike your gain is capped.',
    strikes: ['Sell the call at'],
  },
  {
    id: 'cash-put',
    name: 'Cash-secured put',
    idea: 'Sell a put and set aside the cash to cover it. You keep the premium; below the strike you take the loss as if you had bought there.',
    strikes: ['Sell the put at'],
  },
];

/** The strikes a template starts from: around the money, `gap` strikes apart. */
export function defaultStrikes(id: StrategyId, strikes: number[], atm: number, gap = 2): number[] {
  const at = (i: number): number => strikes[Math.min(strikes.length - 1, Math.max(0, i))]!;
  if (strikes.length === 0) return [];
  switch (id) {
    case 'call-spread':
      return [at(atm), at(atm + gap)];
    case 'put-spread':
      return [at(atm), at(atm - gap)];
    case 'straddle':
      return [at(atm)];
    case 'strangle':
      return [at(atm - gap), at(atm + gap)];
    case 'covered-call':
      return [at(atm + gap)];
    case 'cash-put':
      return [at(atm - gap)];
  }
}

/** The legs for a template at the chosen strikes, or why those strikes do not make it. */
export function strategyLegs(id: StrategyId, chosen: number[]): StrategyLeg[] | { error: string } {
  const [a, b] = chosen;
  if (a === undefined) return { error: 'Choose a strike.' };
  switch (id) {
    case 'call-spread':
      if (b === undefined || !(b > a)) return { error: 'Sell a call with a higher strike than the one you buy.' };
      return [
        { kind: 'call', side: 'buy', strike: a },
        { kind: 'call', side: 'sell', strike: b },
      ];
    case 'put-spread':
      if (b === undefined || !(b < a)) return { error: 'Sell a put with a lower strike than the one you buy.' };
      return [
        { kind: 'put', side: 'buy', strike: a },
        { kind: 'put', side: 'sell', strike: b },
      ];
    case 'straddle':
      return [
        { kind: 'call', side: 'buy', strike: a },
        { kind: 'put', side: 'buy', strike: a },
      ];
    case 'strangle':
      if (b === undefined || !(b > a)) return { error: 'The call strike must be above the put strike.' };
      return [
        { kind: 'put', side: 'buy', strike: a },
        { kind: 'call', side: 'buy', strike: b },
      ];
    case 'covered-call':
      return [{ kind: 'call', side: 'sell', strike: a }];
    case 'cash-put':
      return [{ kind: 'put', side: 'sell', strike: a }];
  }
}
