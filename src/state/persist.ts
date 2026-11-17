import { SIM } from '../lib/env';

// Local-first storage. Everything Flame keeps (account, journal, watchlists,
// layout, settings) lives in one IndexedDB store as versioned documents.
// Candles are never stored.

export const SCHEMA_VERSION = 1;

export interface Envelope<T = unknown> {
  /** Schema version the document was written with. */
  v: number;
  data: T;
  savedAt: number;
}

type Migration = (data: any) => any;

/**
 * Migrations per document key. Entry `n` upgrades a document from schema
 * version n + 1 to n + 2. Add one whenever a stored shape changes, and bump
 * SCHEMA_VERSION.
 */
export const MIGRATIONS: Record<string, Migration[]> = {};

/** Bring a stored document up to the current schema. Throws if it is from a newer Flame. */
export function migrate<T>(key: string, env: Envelope, migrations = MIGRATIONS, current = SCHEMA_VERSION): T {
  if (typeof env?.v !== 'number' || env.v < 1) throw new Error(`Stored ${key} has no schema version.`);
  if (env.v > current) throw new Error(`Stored ${key} was written by a newer version of Flame (schema ${env.v}).`);
  let data = env.data;
  const steps = migrations[key] ?? [];
  for (let v = env.v; v < current; v++) {
    const step = steps[v - 1];
    if (step) data = step(data);
  }
  return data as T;
}

// The simulated feed gets its own database, so made-up prices can never fill
// orders in, or mark, the real paper account.
const DB_NAME = SIM ? 'flame-sim' : 'flame';
const STORE = 'kv';

let dbPromise: Promise<IDBDatabase | null> | null = null;
/** False when the browser refuses IndexedDB (some private windows). The UI says so. */
export let persistent = true;
const memory = new Map<string, Envelope>();

function open(): Promise<IDBDatabase | null> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve) => {
    if (typeof indexedDB === 'undefined') {
      persistent = false;
      resolve(null);
      return;
    }
    let req: IDBOpenDBRequest;
    try {
      req = indexedDB.open(DB_NAME, 1);
    } catch (err) {
      console.warn('[flame] IndexedDB is not available; nothing will be kept after this tab closes', err);
      persistent = false;
      resolve(null);
      return;
    }
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => {
      console.warn('[flame] IndexedDB refused to open; nothing will be kept after this tab closes', req.error);
      persistent = false;
      resolve(null);
    };
  });
  return dbPromise;
}

function tx<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>): Promise<T | undefined> {
  return open().then(
    (db) =>
      new Promise<T | undefined>((resolve, reject) => {
        if (!db) {
          resolve(undefined);
          return;
        }
        const t = db.transaction(STORE, mode);
        const req = run(t.objectStore(STORE));
        t.oncomplete = () => resolve(req.result);
        t.onerror = () => reject(t.error);
        t.onabort = () => reject(t.error);
      }),
  );
}

export type LoadResult<T> = { ok: true; data: T | undefined } | { ok: false; error: string };

/** Read a document. A document that cannot be read is reported, never silently replaced. */
export async function load<T>(key: string): Promise<LoadResult<T>> {
  try {
    const db = await open();
    const env = db ? await tx<Envelope>('readonly', (s) => s.get(key)) : memory.get(key);
    if (env === undefined) return { ok: true, data: undefined };
    return { ok: true, data: migrate<T>(key, env) };
  } catch (err) {
    console.error(`[flame] could not read stored ${key}`, err);
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

const timers = new Map<string, ReturnType<typeof setTimeout>>();
const pending = new Map<string, unknown>();
let onSaveError: ((key: string, err: unknown) => void) | null = null;

export function setSaveErrorHandler(fn: (key: string, err: unknown) => void): void {
  onSaveError = fn;
}

async function write(key: string, data: unknown): Promise<void> {
  const env: Envelope = { v: SCHEMA_VERSION, data, savedAt: Date.now() };
  try {
    const db = await open();
    if (db) await tx('readwrite', (s) => s.put(env, key));
    else memory.set(key, env);
  } catch (err) {
    console.error(`[flame] could not save ${key}`, err);
    onSaveError?.(key, err);
  }
}

/** Save a document soon. Rapid changes collapse into one write. */
export function save(key: string, data: unknown, delay = 400): void {
  pending.set(key, data);
  if (timers.has(key)) return;
  timers.set(
    key,
    setTimeout(() => {
      timers.delete(key);
      const latest = pending.get(key);
      pending.delete(key);
      void write(key, latest);
    }, delay),
  );
}

/** Write everything that is waiting, now. Called when the page is hidden or closed. */
export function flush(): Promise<void> {
  const jobs: Promise<void>[] = [];
  for (const [key, timer] of timers) {
    clearTimeout(timer);
    jobs.push(write(key, pending.get(key)));
  }
  timers.clear();
  pending.clear();
  return Promise.all(jobs).then(() => undefined);
}

export async function remove(key: string): Promise<void> {
  const timer = timers.get(key);
  if (timer) clearTimeout(timer);
  timers.delete(key);
  pending.delete(key);
  const db = await open();
  if (db) await tx('readwrite', (s) => s.delete(key));
  else memory.delete(key);
}

export const KEYS = ['account', 'settings', 'watchlists', 'layout', 'levels'] as const;
export type StoreKey = (typeof KEYS)[number];

export interface Backup {
  app: 'flame';
  schema: number;
  exportedAt: number;
  documents: Record<string, unknown>;
}

export async function exportBackup(): Promise<Backup> {
  await flush();
  const documents: Record<string, unknown> = {};
  for (const key of KEYS) {
    const res = await load(key);
    if (res.ok && res.data !== undefined) documents[key] = res.data;
  }
  return { app: 'flame', schema: SCHEMA_VERSION, exportedAt: Date.now(), documents };
}

/** Validate a backup file's outer shape and return its documents, migrated. Throws with a sentence fit to show. */
export function readBackup(raw: unknown): Record<string, unknown> {
  const b = raw as Partial<Backup> | null;
  if (!b || typeof b !== 'object' || b.app !== 'flame' || typeof b.schema !== 'number' || typeof b.documents !== 'object' || !b.documents) {
    throw new Error('That file is not a Flame backup.');
  }
  if (b.schema > SCHEMA_VERSION) throw new Error('That backup was made by a newer version of Flame.');
  const out: Record<string, unknown> = {};
  for (const key of KEYS) {
    const data = (b.documents as Record<string, unknown>)[key];
    if (data !== undefined) out[key] = migrate(key, { v: b.schema, data, savedAt: b.exportedAt ?? 0 });
  }
  return out;
}

export async function importBackup(raw: unknown): Promise<void> {
  const docs = readBackup(raw);
  for (const [key, data] of Object.entries(docs)) await write(key, data);
}
