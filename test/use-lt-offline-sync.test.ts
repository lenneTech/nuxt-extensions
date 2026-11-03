/**
 * `useLtOfflineSync()` — the reactive layer over the protocol engine: when it syncs, what it shows,
 * and who it shows it to.
 *
 * The protocol itself is proven in `sync-engine.test.ts`. Here the server is the same in-memory
 * stand-in, reached through the real `ltAuthFetch` (global `fetch` replaced), and IndexedDB is
 * `fake-indexeddb`.
 */

import 'fake-indexeddb/auto';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { effectScope, nextTick, ref, watch, type EffectScope } from 'vue';

import { useLtOfflineSync } from '../src/runtime/composables/use-lt-offline-sync';
import { resetLtSyncEngines } from '../src/runtime/lib/sync';
import { deleteLtSyncDatabase } from '../src/runtime/lib/sync-store';
import type { UseLtOfflineSyncOptions, UseLtOfflineSyncReturn } from '../src/runtime/types/sync';
import { FakeSyncServer } from './fixtures/sync-server';
import { resetStubReactiveStores, resetStubRuntimeConfig, setStubRuntimeConfig } from './stubs/imports';
import { resetTestRenderScope, setTestRenderScope } from './stubs/render-scope';

const currentUser = ref<{ id: string } | null>({ id: 'user-1' });

vi.mock('../src/runtime/composables/auth/use-lt-auth', () => ({
  useLtAuth: () => ({ user: currentUser }),
}));

type Note = { title: string };

let server: FakeSyncServer;
let scopes: EffectScope[];

/** Mount the composable in its own scope, as a component would */
function mount(options: UseLtOfflineSyncOptions<Note> = {}, model = 'note'): UseLtOfflineSyncReturn<Note> {
  const scope = effectScope();
  scopes.push(scope);
  return scope.run(() => useLtOfflineSync<Note>(model, options))!;
}

const until = async (condition: () => boolean, label = 'condition') => {
  for (let i = 0; i < 300 && !condition(); i++) await new Promise((resolve) => setTimeout(resolve, 5));
  expect(condition(), label).toBe(true);
};

const titles = (sync: UseLtOfflineSyncReturn<Note>) => sync.records.value.map((record) => record.data?.title).sort();

beforeEach(() => {
  setStubRuntimeConfig({ public: { apiUrl: 'https://api.test', ltExtensions: { sync: { basePath: '/sync', enabled: true } } } });
  server = new FakeSyncServer();
  vi.stubGlobal('fetch', server.fetch);
  currentUser.value = { id: 'user-1' };
  scopes = [];
});

afterEach(async () => {
  for (const scope of scopes) scope.stop();
  vi.unstubAllGlobals();
  resetLtSyncEngines();
  await deleteLtSyncDatabase();
  resetStubRuntimeConfig();
  resetStubReactiveStores();
  resetTestRenderScope();
});

describe('useLtOfflineSync — start and local changes', () => {
  it('pulls at start and shows the records', async () => {
    server.write('6720c0aaaaaaaaaaaaaaaaaa', { title: 'from server' });
    const notes = mount();

    await until(() => notes.records.value.length === 1, 'pulled record');
    expect(titles(notes)).toEqual(['from server']);
    expect(notes.lastSyncedAt.value).toBeInstanceOf(Date);
    expect(notes.syncing.value).toBe(false);
  });

  it('shows a change at once and sends it shortly after', async () => {
    const notes = mount();
    await until(() => notes.lastSyncedAt.value !== null);

    await notes.create({ title: 'A' });
    expect(titles(notes)).toEqual(['A']);
    expect(notes.pendingCount.value).toBe(1);
    await until(() => server.live().length === 1, 'pushed');
    await until(() => notes.pendingCount.value === 0);
  });

  it('keeps changes while offline and sends them on `online`', async () => {
    const notes = mount();
    await until(() => notes.lastSyncedAt.value !== null);
    server.online = false;

    await notes.create({ title: 'offline' });
    await notes.sync();
    expect(notes.offline.value).toBe(true);
    expect(notes.pendingCount.value).toBe(1);

    server.online = true;
    window.dispatchEvent(new Event('online'));
    await until(() => server.live().length === 1, 'sent on online');
    expect(notes.offline.value).toBe(false);
  });

  it('syncs on focus', async () => {
    const notes = mount();
    await until(() => notes.lastSyncedAt.value !== null);
    server.write('6720c0aaaaaaaaaaaaaaaaab', { title: 'later' });

    window.dispatchEvent(new Event('focus'));
    await until(() => notes.records.value.length === 1, 'pulled on focus');
  });

  it('leaves syncing to the app with `auto: false`', async () => {
    server.write('6720c0aaaaaaaaaaaaaaaaac', { title: 'x' });
    const notes = mount({ auto: false });
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(server.pulls()).toHaveLength(0);

    await notes.sync();
    expect(titles(notes)).toEqual(['x']);
  });

  it('reports a 401 without losing anything', async () => {
    const notes = mount({ auto: false });
    await notes.create({ title: 'A' });
    server.authorized = false;

    await notes.sync();
    expect(notes.needsLogin.value).toBe(true);
    expect(notes.pendingCount.value).toBe(1);
  });
});

describe('useLtOfflineSync — whose data it is', () => {
  it('wipes the previous user’s data before showing anything to another user', async () => {
    const notes = mount({ auto: false });
    await notes.create({ title: 'private of user 1' });
    await until(() => notes.records.value.length === 1);

    currentUser.value = { id: 'user-2' };
    await nextTick();
    await until(() => notes.records.value.length === 0, 'wiped on account switch');
    expect(notes.pendingCount.value).toBe(0);
    expect(await notes.get(notes.records.value[0]?.id ?? 'none')).toBeUndefined();
  });

  it('never shows the previous user’s records while the claim for a new user is still running', async () => {
    const first = mount({ auto: false });
    await first.create({ title: 'private of user 1' });
    scopes.pop()!.stop();

    const seen: string[] = [];
    const notes = mount({ auto: false });
    watch(notes.records, (records) => seen.push(...records.map((record) => record.data?.title ?? '')), { flush: 'sync' });
    // The account changes while the start-up claim for user 1 is still on its way
    currentUser.value = { id: 'user-2' };

    await until(() => notes.pendingCount.value === 0 && seen.length === 0, 'settled for user 2');
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(seen).not.toContain('private of user 1');
    expect(notes.records.value).toEqual([]);
  });

  it('shows nothing and refuses changes while nobody is signed in', async () => {
    currentUser.value = null;
    const notes = mount({ auto: false });

    await expect(notes.create({ title: 'A' })).rejects.toThrow(/no signed-in user/);
    expect(await notes.sync()).toMatchObject({ needsLogin: true });
    expect(notes.records.value).toEqual([]);
  });

  it('keeps the data when the same user signs in again after the session ended', async () => {
    const notes = mount({ auto: false });
    await notes.create({ title: 'kept' });

    currentUser.value = null;
    await until(() => notes.records.value.length === 0);
    currentUser.value = { id: 'user-1' };
    await until(() => notes.records.value.length === 1, 'kept for the same user');
    expect(notes.pendingCount.value).toBe(1);
  });

  it('empties when another tab deletes the database (sign-out there)', async () => {
    const notes = mount({ auto: false });
    await notes.create({ title: 'A' });

    await deleteLtSyncDatabase();
    await until(() => notes.records.value.length === 0, 'cleared by the other tab');
  });
});

describe('useLtOfflineSync — tabs and hints', () => {
  it('shows a change made in another tab', async () => {
    const tabA = mount({ auto: false });
    const tabB = mount({ auto: false });
    // Let both finish their start-up read, or B's first read would see A's record by itself
    await tabB.get('none');
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(tabB.records.value).toEqual([]);

    await tabA.create({ title: 'from A' });
    await until(() => tabB.records.value.length === 1, 'B refreshed');
    expect(titles(tabB)).toEqual(['from A']);
  });

  it('pulls on a hint and again on every reconnect of the stream', async () => {
    server.hintsEnabled = true;
    const notes = mount();
    await until(() => server.openHintStreams() === 1, 'stream open');
    const pullsAfterStart = server.pulls().length;

    server.write('6720c0aaaaaaaaaaaaaaaaad', { title: 'hinted' });
    server.hint('note');
    await until(() => notes.records.value.length === 1, 'pulled on hint');

    // The planned end of a stream: the hint sent in between is never replayed, so the reconnect pulls
    server.write('6720c0aaaaaaaaaaaaaaaaae', { title: 'missed hint' });
    const pullsBefore = server.pulls().length;
    server.endHintStreams();
    await until(() => notes.records.value.length === 2, 'pulled on reconnect');
    expect(server.pulls().length).toBeGreaterThan(pullsBefore);
    expect(pullsBefore).toBeGreaterThan(pullsAfterStart);
  });

  it('shares one stream between every instance on the page', async () => {
    server.hintsEnabled = true;
    mount();
    mount();
    mount({}, 'task');

    await until(() => server.requests.filter((request) => request.url.pathname.endsWith('/hints')).at(-1)?.url.searchParams.get('models') === 'note,task');
    await until(() => server.openHintStreams() === 1, 'one stream left open');
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(server.openHintStreams()).toBe(1);
  });

  it('closes the stream when the scope ends', async () => {
    server.hintsEnabled = true;
    mount();
    await until(() => server.openHintStreams() === 1);

    scopes.pop()!.stop();
    await until(() => server.openHintStreams() === 0, 'stream closed');
  });

  it('opens no stream with `hints: false`', async () => {
    server.hintsEnabled = true;
    const notes = mount({ hints: false });
    await until(() => notes.lastSyncedAt.value !== null);
    expect(server.requests.some((request) => request.url.pathname.endsWith('/hints'))).toBe(false);
  });
});

describe('useLtOfflineSync — server-side rendering', () => {
  it('renders an empty list and touches no storage', async () => {
    setTestRenderScope('server');
    const notes = mount();

    expect(notes.records.value).toEqual([]);
    await expect(notes.create({ title: 'A' })).rejects.toThrow(/browser only/);
    expect(await notes.sync()).toMatchObject({ applied: 0 });
    expect(server.requests).toEqual([]);
  });
});
