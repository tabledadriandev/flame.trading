import { describe, expect, it } from 'vitest';
import { createAccount, placeOrder } from '../engine/engine';
import { DEFAULT_SETTINGS } from '../engine/types';
import { SCHEMA_VERSION, readBackup } from './persist';
import { accountProblem, documentProblem } from './validate';

const real = () =>
  placeOrder(
    createAccount(100_000, 1),
    { instrument: 'crypto:BTC', cls: 'crypto', mode: 'lev', side: 'buy', type: 'market', qty: 0.5, leverage: 5, sl: 49_000, tp: 53_000 },
    { bid: 50_000, ask: 50_000, last: 50_000, t: 2 },
    DEFAULT_SETTINGS,
    2,
  ).account;

describe('document validation', () => {
  it('accepts an account the engine produced', () => {
    expect(accountProblem(createAccount())).toBeNull();
    expect(accountProblem(real())).toBeNull();
    // And after a round trip through JSON, as a backup file would be.
    expect(accountProblem(JSON.parse(JSON.stringify(real())))).toBeNull();
  });

  it('refuses accounts that are not accounts', () => {
    expect(accountProblem(null)).toMatch(/missing/);
    expect(accountProblem({ ...real(), cash: '1000000' })).toMatch(/cash/);
    expect(accountProblem({ ...real(), cash: Infinity })).toMatch(/cash/);
    expect(accountProblem({ ...real(), orders: 'none' })).toMatch(/order/);
    expect(accountProblem({ ...real(), fills: [{ id: 'f1' }] })).toMatch(/fill/);
    const a = real();
    const key = Object.keys(a.positions)[0]!;
    expect(accountProblem({ ...a, positions: { [key]: { ...a.positions[key]!, qty: -1 } } })).toMatch(/position/);
    expect(accountProblem({ ...a, positions: { [key]: { ...a.positions[key]!, dir: 'sideways' } } })).toMatch(/position/);
    expect(accountProblem({ ...a, trades: [] })).toMatch(/refers to a trade/);
  });

  it('checks the other documents too', () => {
    expect(documentProblem('watchlists', { lists: [{ id: 'a', name: 'Main', items: ['crypto:BTC'] }], active: 'a' })).toBeNull();
    expect(documentProblem('watchlists', { lists: [] })).not.toBeNull();
    expect(documentProblem('watchlists', { lists: [{ id: 'a', name: 'x', items: [1, 2] }] })).not.toBeNull();
    expect(documentProblem('settings', { fees: { cryptoTaker: 0.0005 }, riskPct: 1 })).toBeNull();
    expect(documentProblem('settings', { fees: { cryptoTaker: -1 } })).not.toBeNull();
    expect(documentProblem('levels', { 'crypto:BTC': [{ id: 'v1', price: 60_000, alert: true }] })).toBeNull();
    expect(documentProblem('levels', { 'crypto:BTC': [{ id: 'v1', price: 'high', alert: true }] })).not.toBeNull();
    expect(documentProblem('odds', { notatoken: { question: 'q', outcome: 'Yes', event: 'e', label: null } })).not.toBeNull();
    expect(documentProblem('layout', { sizes: {} })).toBeNull();
  });

  it('a backup with a broken account is refused whole', () => {
    const good = { app: 'flame', schema: SCHEMA_VERSION, exportedAt: 1, documents: { account: JSON.parse(JSON.stringify(real())) } };
    expect(Object.keys(readBackup(good))).toEqual(['account']);
    const bad = { ...good, documents: { account: { ...good.documents.account, cash: 'lots' } } };
    expect(() => readBackup(bad)).toThrow(/cannot be imported/);
    expect(() => readBackup({ ...good, documents: { account: good.documents.account, watchlists: { lists: 'x' } } })).toThrow(/cannot be imported/);
  });
});
