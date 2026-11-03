/**
 * Offline sync of one model with the nest-server sync module (>= 12.2.0).
 *
 * Records live in IndexedDB; changes made offline wait in an outbox and go out with the next sync.
 * The composable syncs at start, on `online`, on focus and after a server hint, and pulls once on
 * every reconnect of the hint stream (protocol §9). Tabs coordinate: one syncs at a time (Web Locks),
 * the others pick up the result (BroadcastChannel); without either API it stays correct, only busier.
 *
 * The local data belongs to the signed-in user. A different user wipes it before anything is shown
 * or pulled; `useLtAuth().signOut()` sends what is unsent and then deletes it. An expired session
 * deletes nothing: after signing in again the outbox goes out without duplicates (protocol §4).
 *
 * @example
 * ```ts
 * const notes = useLtOfflineSync<{ title: string }>('note');
 * await notes.create({ title: 'Einkaufen' });
 * // notes.records.value, notes.pendingCount.value, notes.offline.value, notes.needsLogin.value
 * ```
 */

import { getCurrentScope, onScopeDispose, readonly, ref, shallowRef, watch } from '#imports';

import { createLtSyncEngine } from '../lib/sync';
import { subscribeLtSyncHints } from '../lib/sync-hints';
import { claimLtSyncOwner, LT_SYNC_CHANNEL_NAME, type LtSyncMessage } from '../lib/sync-store';
import type { LtSyncPushResult, LtSyncRecord, LtSyncResult, UseLtOfflineSyncOptions, UseLtOfflineSyncReturn } from '../types/sync';
import { useLtAuth } from './auth/use-lt-auth';

/** First wait after a failed sync (offline, 429, 503, `retry`); doubles up to the maximum (§11) */
const BACKOFF_START_MS = 1000;
const BACKOFF_MAX_MS = 60_000;

/** A local change syncs this long after the last one, so typing does not push every keystroke */
const LOCAL_CHANGE_DELAY_MS = 300;

const emptyResult = (overrides: Partial<LtSyncResult> = {}): LtSyncResult => ({
  applied: 0,
  conflicts: [],
  forbidden: false,
  needsLogin: false,
  offline: false,
  rejected: [],
  resynced: false,
  retried: 0,
  ...overrides,
});

export function useLtOfflineSync<T extends Record<string, unknown> = Record<string, unknown>>(model: string, options: UseLtOfflineSyncOptions<T> = {}): UseLtOfflineSyncReturn<T> {
  const records = shallowRef<readonly LtSyncRecord<T>[]>([]);
  const pendingCount = ref(0);
  const offline = ref(false);
  const syncing = ref(false);
  const needsLogin = ref(false);
  const forbidden = ref(false);
  const conflicts = shallowRef<LtSyncPushResult[]>([]);
  const rejected = shallowRef<LtSyncPushResult[]>([]);
  const error = ref<Error | null>(null);
  const lastSyncedAt = ref<Date | null>(null);

  const state = {
    conflicts: readonly(conflicts) as UseLtOfflineSyncReturn<T>['conflicts'],
    error: readonly(error) as UseLtOfflineSyncReturn<T>['error'],
    forbidden: readonly(forbidden),
    lastSyncedAt: readonly(lastSyncedAt) as UseLtOfflineSyncReturn<T>['lastSyncedAt'],
    needsLogin: readonly(needsLogin),
    offline: readonly(offline),
    pendingCount: readonly(pendingCount),
    // A shallow ref typed read-only: consumers cannot reassign it but can bind single records
    records: records as UseLtOfflineSyncReturn<T>['records'],
    rejected: readonly(rejected) as UseLtOfflineSyncReturn<T>['rejected'],
    syncing: readonly(syncing),
  };

  // IndexedDB exists only in the browser: on the server the composable renders an empty list
  if (import.meta.server || typeof indexedDB === 'undefined') {
    const browserOnly = () => Promise.reject(new Error('useLtOfflineSync: offline sync runs in the browser only'));
    return { ...state, create: browserOnly, get: async () => undefined, remove: browserOnly, sync: async () => emptyResult(), update: browserOnly };
  }

  const auto = options.auto !== false;
  const { user } = useLtAuth();
  const engine = createLtSyncEngine<T>({ idFormat: options.idFormat, model, onConflict: options.onConflict, pageLimit: options.pageLimit, tenantId: options.tenantId });
  const channel = typeof BroadcastChannel === 'undefined' ? undefined : new BroadcastChannel(LT_SYNC_CHANNEL_NAME);

  // --- owner: the local data belongs to the signed-in user ----------------------------------------

  let ownerId: null | string = null;
  let claiming: null | { id: string; done: Promise<boolean> } = null;
  const currentUserId = () => (user.value?.id ? String(user.value.id) : null);

  /** Whether a signed-in user owns the local data; claims it first, wiping another user's (account switch) */
  async function ensureOwner(): Promise<boolean> {
    const id = currentUserId();
    if (!id) {
      ownerId = null;
      return false;
    }
    if (id === ownerId) return true;
    // A claim is per user: one still running for the previous user must not answer for this one
    if (claiming?.id !== id) {
      const pending = { done: claimLtSyncOwner(id), id };
      claiming = pending;
      void pending.done.finally(() => {
        if (claiming === pending) claiming = null;
      });
    }
    await claiming.done;
    // The user changed while the claim ran: claim for the one signed in now, never show the data to them as the other's
    if (currentUserId() !== id) return ensureOwner();
    ownerId = id;
    return true;
  }

  async function refresh(): Promise<void> {
    if (!(await ensureOwner())) {
      records.value = [];
      pendingCount.value = 0;
      return;
    }
    const [list, pending] = await Promise.all([engine.list(), engine.pendingCount()]);
    records.value = list;
    pendingCount.value = pending;
  }

  async function owned<R>(fn: () => Promise<R>): Promise<R> {
    if (!(await ensureOwner())) throw new Error('useLtOfflineSync: no signed-in user owns the local data');
    return fn();
  }

  // --- sync ---------------------------------------------------------------------------------------

  let timer: ReturnType<typeof setTimeout> | undefined;
  let backoffMs = 0;
  let disposed = false;
  let closeHints: (() => void) | undefined;
  /** Why the hint stream stopped: `disabled` for good (404), `unauthorized` until a sync gets through */
  let hintsStopped: 'disabled' | 'unauthorized' | null = null;

  function schedule(ms: number): void {
    if (disposed) return;
    clearTimeout(timer);
    timer = setTimeout(() => void sync().catch(() => undefined), ms);
  }

  /** Wait longer after every failure, as long as the server asks or cannot be reached (§11) */
  function backOff(retryAfterMs = 0): void {
    backoffMs = Math.min(backoffMs ? backoffMs * 2 : BACKOFF_START_MS, BACKOFF_MAX_MS);
    // While the browser knows it is offline, its `online` event is the trigger, not a timer
    if (auto && !(typeof navigator !== 'undefined' && navigator.onLine === false)) schedule(Math.max(retryAfterMs, backoffMs));
  }

  async function sync(): Promise<LtSyncResult> {
    if (!(await ensureOwner())) {
      needsLogin.value = true;
      return emptyResult({ needsLogin: true });
    }
    syncing.value = true;
    try {
      const result = await engine.sync();
      error.value = null;
      offline.value = result.offline;
      needsLogin.value = result.needsLogin;
      forbidden.value = result.forbidden;
      conflicts.value = result.conflicts;
      rejected.value = result.rejected;
      if (result.offline || result.retryAfterMs !== undefined || result.retried) {
        backOff(result.retryAfterMs);
      } else if (!result.needsLogin) {
        backoffMs = 0;
        lastSyncedAt.value = new Date();
        // The stream stopped on a 401; a sync that got through means the user is back
        if (hintsStopped === 'unauthorized') {
          hintsStopped = null;
          startHints();
        }
      }
      return result;
    } catch (caught) {
      error.value = caught instanceof Error ? caught : new Error(String(caught));
      throw caught;
    } finally {
      syncing.value = false;
      await refresh();
      channel?.postMessage({ scope: engine.scope, type: 'changed' } satisfies LtSyncMessage);
    }
  }

  const autoSync = () => {
    if (auto) void sync().catch(() => undefined);
  };

  async function afterLocalChange(): Promise<void> {
    channel?.postMessage({ scope: engine.scope, type: 'changed' } satisfies LtSyncMessage);
    await refresh();
    if (auto) schedule(LOCAL_CHANGE_DELAY_MS);
  }

  // --- hints (§9) ---------------------------------------------------------------------------------

  function startHints(): void {
    if (!auto || options.hints === false || closeHints || hintsStopped || disposed) return;
    if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
    if (!user.value?.id) return;
    // One stream per tab and tenant, shared by every instance (see `subscribeLtSyncHints`)
    closeHints = subscribeLtSyncHints({
      model,
      // Hints sent while the stream was down are not replayed: every (re)connect pulls once
      onConnect: autoSync,
      onHint: autoSync,
      onStop: (reason) => {
        stopHints();
        hintsStopped = reason;
      },
      tenantId: options.tenantId,
    });
  }

  function stopHints(): void {
    closeHints?.();
    closeHints = undefined;
  }

  // --- triggers -----------------------------------------------------------------------------------

  const onOnline = () => {
    offline.value = false;
    backoffMs = 0;
    autoSync();
  };
  const onOffline = () => {
    offline.value = true;
  };
  const onVisibility = () => {
    // A hidden tab keeps no stream open; coming back, the reconnect pulls (A10)
    if (document.visibilityState === 'hidden') {
      stopHints();
      return;
    }
    startHints();
    autoSync();
  };
  const onMessage = (event: MessageEvent<LtSyncMessage>) => {
    if (event.data?.type === 'cleared') {
      // Signed out or another account in some tab: the database is gone, claim it anew
      ownerId = null;
      void refresh();
    } else if (event.data?.type === 'changed' && event.data.scope === engine.scope) {
      void refresh();
    }
  };

  if (typeof window !== 'undefined') {
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    window.addEventListener('focus', autoSync);
    document.addEventListener('visibilitychange', onVisibility);
    if (navigator.onLine === false) offline.value = true;
  }
  channel?.addEventListener('message', onMessage);

  const stopUserWatch = watch(
    () => user.value?.id ?? null,
    (id, previous) => {
      if (id === previous) return;
      stopHints();
      hintsStopped = hintsStopped === 'disabled' ? 'disabled' : null;
      void refresh().then(() => {
        if (!id) return;
        startHints();
        autoSync();
      });
    },
  );

  if (getCurrentScope()) {
    onScopeDispose(() => {
      disposed = true;
      clearTimeout(timer);
      stopHints();
      stopUserWatch();
      channel?.removeEventListener('message', onMessage);
      channel?.close();
      if (typeof window !== 'undefined') {
        window.removeEventListener('online', onOnline);
        window.removeEventListener('offline', onOffline);
        window.removeEventListener('focus', autoSync);
        document.removeEventListener('visibilitychange', onVisibility);
      }
    });
  }

  // Start: show what is local, then sync and listen for hints
  void refresh().then(() => {
    startHints();
    autoSync();
  });

  return {
    ...state,
    async create(data) {
      const record = await owned(() => engine.create(data));
      await afterLocalChange();
      return record;
    },
    async get(id) {
      return (await ensureOwner()) ? engine.get(id) : undefined;
    },
    async remove(id) {
      await owned(() => engine.remove(id));
      await afterLocalChange();
    },
    sync,
    async update(id, data) {
      const record = await owned(() => engine.update(id, data));
      await afterLocalChange();
      return record;
    },
  };
}
