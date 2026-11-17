import { describe, expect, it } from 'vitest';
import { SCHEMA_VERSION, migrate, readBackup } from './persist';

describe('stored documents', () => {
  it('passes a current document through unchanged', () => {
    expect(migrate('account', { v: SCHEMA_VERSION, data: { cash: 5 }, savedAt: 0 })).toEqual({ cash: 5 });
  });

  it('runs every migration between the stored version and the current one, in order', () => {
    const migrations = {
      account: [
        (d: { cash: number }) => ({ ...d, startCash: 100 }), // v1 → v2
        (d: { cash: number; startCash: number }) => ({ ...d, cash: d.cash * 2 }), // v2 → v3
      ],
    };
    expect(migrate('account', { v: 1, data: { cash: 5 }, savedAt: 0 }, migrations, 3)).toEqual({ cash: 10, startCash: 100 });
    expect(migrate('account', { v: 2, data: { cash: 5, startCash: 1 }, savedAt: 0 }, migrations, 3)).toEqual({ cash: 10, startCash: 1 });
    // Keys without migrations pass through.
    expect(migrate('settings', { v: 1, data: { a: 1 }, savedAt: 0 }, migrations, 3)).toEqual({ a: 1 });
  });

  it('refuses a document from a newer Flame rather than guessing', () => {
    expect(() => migrate('account', { v: SCHEMA_VERSION + 1, data: {}, savedAt: 0 })).toThrow(/newer version/);
    expect(() => migrate('account', { data: {} } as never)).toThrow(/no schema version/);
  });

  it('accepts only Flame backups', () => {
    expect(() => readBackup({ hello: 1 })).toThrow('That file is not a Flame backup.');
    expect(() => readBackup(null)).toThrow('That file is not a Flame backup.');
    expect(() => readBackup({ app: 'flame', schema: SCHEMA_VERSION + 5, documents: {} })).toThrow(/newer version/);
    const docs = readBackup({ app: 'flame', schema: SCHEMA_VERSION, exportedAt: 1, documents: { account: { cash: 1 }, junk: 2 } });
    expect(docs).toEqual({ account: { cash: 1 } });
  });
});
