import { describe, expect, it } from 'vitest';
import { createAccount, placeOrder } from '../engine/engine';
import { DEFAULT_SETTINGS, posKey, type Account, type OptionSpec, type Quote } from '../engine/types';
import { summarise, type Leg } from './payoff';
import { STRATEGIES, defaultStrikes, strategyLegs, type StrategyLeg } from './strategies';

const STRIKES = [56_000, 58_000, 60_000, 62_000, 64_000, 66_000, 68_000, 70_000, 72_000];
const ATM = 4;
const T0 = Date.UTC(2026, 10, 17);
const EXPIRY = Date.UTC(2026, 10, 27, 8);

describe('strategy templates', () => {
  it('start from strikes around the money', () => {
    expect(defaultStrikes('call-spread', STRIKES, ATM)).toEqual([64_000, 68_000]);
    expect(defaultStrikes('put-spread', STRIKES, ATM)).toEqual([64_000, 60_000]);
    expect(defaultStrikes('straddle', STRIKES, ATM)).toEqual([64_000]);
    expect(defaultStrikes('strangle', STRIKES, ATM)).toEqual([60_000, 68_000]);
    expect(defaultStrikes('covered-call', STRIKES, ATM)).toEqual([68_000]);
    expect(defaultStrikes('cash-put', STRIKES, ATM)).toEqual([60_000]);
    // At the edge of the chain the strikes stay inside it.
    expect(defaultStrikes('strangle', STRIKES, 0)).toEqual([56_000, 60_000]);
    expect(defaultStrikes('straddle', [], 0)).toEqual([]);
  });

  it('name their legs with the bought leg first', () => {
    expect(strategyLegs('call-spread', [64_000, 68_000])).toEqual([
      { kind: 'call', side: 'buy', strike: 64_000 },
      { kind: 'call', side: 'sell', strike: 68_000 },
    ]);
    expect(strategyLegs('put-spread', [64_000, 60_000])).toEqual([
      { kind: 'put', side: 'buy', strike: 64_000 },
      { kind: 'put', side: 'sell', strike: 60_000 },
    ]);
    expect(strategyLegs('straddle', [64_000])).toHaveLength(2);
    expect(strategyLegs('covered-call', [68_000])).toEqual([{ kind: 'call', side: 'sell', strike: 68_000 }]);
    expect(strategyLegs('cash-put', [60_000])).toEqual([{ kind: 'put', side: 'sell', strike: 60_000 }]);
  });

  it('refuse strikes that do not make the strategy', () => {
    expect(strategyLegs('call-spread', [68_000, 64_000])).toEqual({ error: 'Sell a call with a higher strike than the one you buy.' });
    expect(strategyLegs('put-spread', [60_000, 64_000])).toEqual({ error: 'Sell a put with a lower strike than the one you buy.' });
    expect(strategyLegs('strangle', [68_000, 60_000])).toEqual({ error: 'The call strike must be above the put strike.' });
    expect(strategyLegs('straddle', [])).toEqual({ error: 'Choose a strike.' });
  });

  it('every template is listed with as many strike labels as it needs', () => {
    for (const s of STRATEGIES) {
      const legs = strategyLegs(s.id, defaultStrikes(s.id, STRIKES, ATM));
      expect(Array.isArray(legs)).toBe(true);
      expect(defaultStrikes(s.id, STRIKES, ATM)).toHaveLength(s.strikes.length);
    }
  });
});

describe('templates through the engine', () => {
  const spec = (l: StrategyLeg): OptionSpec => ({ underlying: 'crypto:BTC', kind: l.kind, strike: l.strike, expiry: EXPIRY, multiplier: 1, venue: 'deribit' });
  const id = (l: StrategyLeg) => `opt:deribit:${l.kind}-${l.strike}`;
  const quote = (mid: number): Quote => ({ bid: mid - 5, ask: mid + 5, last: mid, t: T0, underlying: 64_000 });
  const PRICE: Record<string, number> = { 'call-64000': 1_800, 'call-68000': 500, 'put-64000': 1_750, 'put-60000': 450 };

  function run(a: Account, legs: StrategyLeg[]) {
    const events = [];
    for (const l of legs) {
      const r = placeOrder(a, { instrument: id(l), cls: 'option', mode: 'spot', side: l.side, type: 'market', qty: 1, option: spec(l) }, quote(PRICE[`${l.kind}-${l.strike}`]!), DEFAULT_SETTINGS, T0);
      a = r.account;
      events.push(...r.events);
    }
    return { account: a, events };
  }

  it('a call spread fills both legs: the bought call covers the sold one, with nothing more set aside', () => {
    const legs = strategyLegs('call-spread', [64_000, 68_000]) as StrategyLeg[];
    const r = run(createAccount(100_000, T0), legs);
    expect(r.events.filter((e) => e.type === 'fill')).toHaveLength(2);
    expect(r.account.positions[posKey(id(legs[1]!), 'lev')]).toMatchObject({ margin: 0, cover: { kind: 'spread', key: posKey(id(legs[0]!), 'spot') } });
    // Paid 1,805, received 495: the most it can lose is the difference (and the fees).
    const priced: Leg[] = legs.map((l) => ({ spec: spec(l), side: l.side, qty: 1, price: l.side === 'buy' ? PRICE[`${l.kind}-${l.strike}`]! + 5 : PRICE[`${l.kind}-${l.strike}`]! - 5, iv: 0.45 }));
    expect(summarise(priced)).toEqual({ maxGain: 4_000 - 1_310, maxLoss: 1_310, breakevens: [65_310] });
  });

  it('a put spread sets nothing more aside either, and a cash-secured put sets aside the strike', () => {
    const spread = run(createAccount(100_000, T0), strategyLegs('put-spread', [64_000, 60_000]) as StrategyLeg[]);
    expect(spread.account.positions[posKey('opt:deribit:put-60000', 'lev')]).toMatchObject({ margin: 0, cover: { kind: 'spread' } });
    const csp = run(createAccount(100_000, T0), strategyLegs('cash-put', [60_000]) as StrategyLeg[]);
    expect(csp.account.positions[posKey('opt:deribit:put-60000', 'lev')]).toMatchObject({ margin: 60_000, cover: { kind: 'cash' } });
  });

  it('a covered call is refused without the coin and fills with it', () => {
    const legs = strategyLegs('covered-call', [68_000]) as StrategyLeg[];
    expect(run(createAccount(100_000, T0), legs).events[0]).toMatchObject({ type: 'rejected' });
    const withCoin = placeOrder(createAccount(100_000, T0), { instrument: 'crypto:BTC', cls: 'crypto', mode: 'spot', side: 'buy', type: 'market', qty: 1 }, { bid: 64_000, ask: 64_000, last: 64_000, t: T0 }, DEFAULT_SETTINGS, T0).account;
    expect(run(withCoin, legs).account.positions[posKey(id(legs[0]!), 'lev')]).toMatchObject({ cover: { kind: 'shares', key: posKey('crypto:BTC', 'spot') } });
  });
});
