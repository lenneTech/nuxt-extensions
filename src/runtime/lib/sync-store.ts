/**
 * IndexedDB storage of the offline sync (`useLtOfflineSync`).
 *
 * ONE database per origin holds every synchronized model: records, the outbox of unsent changes,
 * and meta values (cursors, the owning user). One database is what makes sign-out safe — the
 * nest-server's `SECURITY.md` asks a client to delete every record, cursor and unsent change, and
 * deleting the whole database is the one operation that cannot miss a model.
 *
 * Every tab of the origin shares the database; IndexedDB serializes their read-write transactions.
 * A transaction stays open only while `fn` awaits requests of that same transaction, so nothing
 * inside `run()` may await anything else (a fetch, a timer, an app hook).
 */

import type { LtSyncRecord } from '../types/sync';

/** Name of the database every model shares */
export const LT_SYNC_DB_NAME = 'lt-offline-sync';

/** BroadcastChannel the tabs of an origin use to tell each other about changes */
export const LT_SYNC_CHANNEL_NAME = 'lt-offline-sync';

const STORES = ['meta', 'outbox', 'records'];

/** An outbox entry: a protocol push item (§6.2) plus local bookkeeping */
export interface LtSyncOutboxItem {
  /** Set once a push carried the item; it is never changed again, a repeat must carry the same change (§6.5) */
  attempted?: boolean;
  baseVersion?: number;
  data?: Record<string, unknown>;
  id: string;
  mutationId: string;
  op: 'delete' | 'upsert';
  seq?: number;
}

/** What `run()` hands its callback: the transaction's operations, scoped to one model */
export interface LtSyncStoreTx {
  addOutbox: (item: LtSyncOutboxItem) => Promise<unknown>;
  /** Delete every local record of the model except `keepIds` */
  clearRecords: (keepIds: Set<string>) => Promise<void>;
  deleteMeta: (key: string) => Promise<unknown>;
  deleteRecord: (id: string) => Promise<unknown>;
  getMeta: <V = unknown>(key: string) => Promise<undefined | V>;
  getRecord: (id: string) => Promise<LtSyncRecord | undefined>;
  /** The model's unsent changes in the order they were made */
  listOutbox: () => Promise<LtSyncOutboxItem[]>;
  listRecords: () => Promise<LtSyncRecord[]>;
  putOutbox: (item: LtSyncOutboxItem) => Promise<unknown>;
  putRecord: (record: LtSyncRecord) => Promise<unknown>;
  removeOutbox: (mutationId: string) => Promise<void>;
  setMeta: (key: string, value: unknown) => Promise<unknown>;
}

const done = <R>(request: IDBRequest<R>): Promise<R> =>
  new Promise((resolve, reject) => {
    request.addEventListener('success', () => resolve(request.result));
    request.addEventListener('error', () => reject(request.error));
  });

let connection: IDBDatabase | undefined;
let opening: Promise<IDBDatabase> | undefined;

function openDatabase(): Promise<IDBDatabase> {
  if (connection) return Promise.resolve(connection);
  opening ??= (async () => {
    const request = indexedDB.open(LT_SYNC_DB_NAME, 1);
    request.addEventListener('upgradeneeded', () => {
      const db = request.result;
      db.createObjectStore('records', { keyPath: ['model', 'id'] }).createIndex('model', 'model');
      const outbox = db.createObjectStore('outbox', { autoIncrement: true, keyPath: 'seq' });
      outbox.createIndex('mutationId', 'mutationId', { unique: true });
      outbox.createIndex('model', 'model');
      db.createObjectStore('meta', { keyPath: 'key' });
    });
    try {
      const db = await done(request);
      // Another tab deleting the database (sign-out, account switch) must not wait for this one
      db.addEventListener('versionchange', () => {
        db.close();
        if (connection === db) connection = undefined;
      });
      connection = db;
      return db;
    } finally {
      opening = undefined;
    }
  })();
  return opening;
}

/** Run `fn` in one read-write transaction over the model's records, outbox and meta values */
export async function runLtSyncTx<R>(model: string, fn: (tx: LtSyncStoreTx) => Promise<R>): Promise<R> {
  const db = await openDatabase();
  const transaction = db.transaction(STORES, 'readwrite');
  const finished = new Promise<void>((resolve, reject) => {
    transaction.addEventListener('complete', () => resolve());
    transaction.addEventListener('abort', () => reject(transaction.error ?? new Error('transaction aborted')));
    transaction.addEventListener('error', () => reject(transaction.error));
  });
  const store = (name: string) => transaction.objectStore(name);
  const strip = (stored: (LtSyncRecord & { model?: string }) | undefined): LtSyncRecord | undefined => {
    if (!stored) return undefined;
    const { model: _model, ...record } = stored;
    return record;
  };
  const tx: LtSyncStoreTx = {
    addOutbox: (item) => {
      const { seq: _seq, ...rest } = item;
      return done(store('outbox').add({ ...rest, model }));
    },
    clearRecords: async (keepIds) => {
      const keys = (await done(store('records').index('model').getAllKeys(model))) as [string, string][];
      for (const key of keys) {
        if (!keepIds.has(key[1])) await done(store('records').delete(key));
      }
    },
    deleteMeta: (key) => done(store('meta').delete(key)),
    deleteRecord: (id) => done(store('records').delete([model, id])),
    getMeta: async <V>(key: string) => ((await done(store('meta').get(key))) as undefined | { value: V })?.value,
    getRecord: async (id) => strip(await done(store('records').get([model, id]))),
    listOutbox: async () => {
      // An index lists equal keys in primary-key order, which is `seq`: the order the changes were made
      const items = (await done(store('outbox').index('model').getAll(model))) as (LtSyncOutboxItem & { model?: string })[];
      return items.map(({ model: _model, ...item }) => item);
    },
    listRecords: async () => ((await done(store('records').index('model').getAll(model))) as LtSyncRecord[]).map((record) => strip(record)!),
    putOutbox: (item) => done(store('outbox').put({ ...item, model })),
    putRecord: (record) => done(store('records').put({ ...record, model })),
    removeOutbox: async (mutationId) => {
      const key = await done(store('outbox').index('mutationId').getKey(mutationId));
      if (key !== undefined) await done(store('outbox').delete(key));
    },
    setMeta: (key, value) => done(store('meta').put({ key, value })),
  };
  let result: R;
  try {
    result = await fn(tx);
  } catch (error) {
    transaction.abort();
    await finished.catch(() => undefined);
    throw error;
  }
  await finished;
  return result;
}

/** The models that hold unsent changes, in no particular order */
export async function listLtSyncPendingModels(): Promise<string[]> {
  const db = await openDatabase();
  const transaction = db.transaction(['outbox'], 'readonly');
  const items = (await done(transaction.objectStore('outbox').getAll())) as { model: string }[];
  return [...new Set(items.map((item) => item.model))];
}

/**
 * Bind the local data to the signed-in user. The first user claims it; a different user wipes
 * every model before anything is shown or pulled — an account switch must not show the previous
 * user's records (nest-server `SECURITY.md`). Answers whether it wiped.
 */
export async function claimLtSyncOwner(userId: string): Promise<boolean> {
  const owner = await runLtSyncTx('', (tx) => tx.getMeta<string>('owner'));
  if (owner === userId) return false;
  if (owner !== undefined) await deleteLtSyncDatabase();
  await runLtSyncTx('', (tx) => tx.setMeta('owner', userId));
  return owner !== undefined;
}

/**
 * Delete every record, cursor and unsent change of every model — on sign-out and on an account
 * switch. Other tabs close their connection on `versionchange` and are told via the channel.
 */
export async function deleteLtSyncDatabase(): Promise<void> {
  if (typeof indexedDB === 'undefined') return;
  await opening?.catch(() => undefined);
  connection?.close();
  connection = undefined;
  await new Promise<void>((resolve, reject) => {
    const request = indexedDB.deleteDatabase(LT_SYNC_DB_NAME);
    request.addEventListener('success', () => resolve());
    request.addEventListener('error', () => reject(request.error));
    // A tab that ignores `versionchange` would block forever; the delete completes once it closes
    request.addEventListener('blocked', () => undefined);
  });
  postLtSyncMessage({ type: 'cleared' });
}

/** Messages the tabs exchange */
export type LtSyncMessage = { model: string; type: 'changed' } | { type: 'cleared' };

/**
 * Tell every listener of this origin, this tab's included (a fresh channel is not the receiver's
 * own); a no-op where BroadcastChannel is missing
 */
function postLtSyncMessage(message: LtSyncMessage): void {
  if (typeof BroadcastChannel === 'undefined') return;
  const channel = new BroadcastChannel(LT_SYNC_CHANNEL_NAME);
  try {
    channel.postMessage(message);
  } finally {
    channel.close();
  }
}
