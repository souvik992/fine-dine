// IndexedDB on the phone (docs/05: "IndexedDB in PWA"): the outbox, and the last copy of the floor, menu and open
// orders so the app still shows them offline. Falls back to memory where IndexedDB is not available (private tabs).
import { MemoryOutboxStore, type OutboxEntry, type OutboxStore } from '@dinepos/client';

const DB_NAME = 'dinepos-captain';
const OUTBOX = 'outbox';
const CACHE = 'cache';

export interface KeyValueCache {
  get<T>(key: string): Promise<T | undefined>;
  set(key: string, value: unknown): Promise<void>;
}

function done<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('IndexedDB request failed'));
  });
}

function openDb(): Promise<IDBDatabase> {
  const req = indexedDB.open(DB_NAME, 1);
  req.onupgradeneeded = () => {
    const db = req.result;
    if (!db.objectStoreNames.contains(OUTBOX)) db.createObjectStore(OUTBOX, { keyPath: 'seq' });
    if (!db.objectStoreNames.contains(CACHE)) db.createObjectStore(CACHE);
  };
  return done(req);
}

class IdbStores implements OutboxStore, KeyValueCache {
  constructor(private readonly db: IDBDatabase) {}
  private tx(store: string, mode: IDBTransactionMode) {
    return this.db.transaction(store, mode).objectStore(store);
  }
  load() {
    return done(this.tx(OUTBOX, 'readonly').getAll() as IDBRequest<OutboxEntry[]>);
  }
  async put(e: OutboxEntry) {
    await done(this.tx(OUTBOX, 'readwrite').put(e));
  }
  async remove(seqs: readonly number[]) {
    const store = this.tx(OUTBOX, 'readwrite');
    await Promise.all(seqs.map((s) => done(store.delete(s))));
  }
  async get<T>(key: string) {
    return (await done(this.tx(CACHE, 'readonly').get(key))) as T | undefined;
  }
  async set(key: string, value: unknown) {
    await done(this.tx(CACHE, 'readwrite').put(value, key));
  }
}

class MemoryStores extends MemoryOutboxStore implements KeyValueCache {
  private readonly cache = new Map<string, unknown>();
  get<T>(key: string) {
    return Promise.resolve(this.cache.get(key) as T | undefined);
  }
  set(key: string, value: unknown) {
    this.cache.set(key, value);
    return Promise.resolve();
  }
}

/** `durable` is false when the phone browser refused IndexedDB: changes then live only while the page is open. */
export async function openStores(): Promise<{ outbox: OutboxStore; cache: KeyValueCache; durable: boolean }> {
  try {
    const s = new IdbStores(await openDb());
    return { outbox: s, cache: s, durable: true };
  } catch {
    const m = new MemoryStores();
    return { outbox: m, cache: m, durable: false };
  }
}
