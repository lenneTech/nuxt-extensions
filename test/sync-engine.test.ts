/**
 * The offline-sync protocol engine against an in-memory server (`fixtures/sync-server.ts`), with a
 * real IndexedDB implementation (`fake-indexeddb`).
 *
 * The five scenarios the nest-server's reference test clients pass (DEV-3903) each have their own
 * block: offline create/change/delete, conflict, two tabs, expired session, cleared storage. The
 * browser E2E of the same scenarios against a real nest-server lives in the nuxt-base-starter
 * (DEV-3919, decision E1 of DEV-3917).
 */

import 'fake-indexeddb/auto';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createLtSyncEngine, flushLtSyncBeforeSignOut, ltSyncObjectId, ltSyncUuidV7, resetLtSyncEngines } from '../src/runtime/lib/sync';
import { claimLtSyncOwner, deleteLtSyncDatabase, runLtSyncTx } from '../src/runtime/lib/sync-store';
import { FakeSyncServer } from './fixtures/sync-server';
import { resetStubRuntimeConfig, setStubRuntimeConfig } from './stubs/imports';

type Note = { body?: string; title: string };

let server: FakeSyncServer;

const engine = (options: Partial<Parameters<typeof createLtSyncEngine<Note>>[0]> = {}) => createLtSyncEngine<Note>({ fetch: server.fetch, model: 'note', ...options });

const outbox = () => runLtSyncTx('note', (tx) => tx.listOutbox());

beforeEach(() => {
  setStubRuntimeConfig({ public: { apiUrl: 'https://api.test', ltExtensions: { sync: { basePath: '/sync', enabled: true } } } });
  server = new FakeSyncServer();
});

afterEach(async () => {
  resetLtSyncEngines();
  await deleteLtSyncDatabase();
  resetStubRuntimeConfig();
});

describe('scenario: offline create, change and delete', () => {
  it('keeps every change in the outbox while offline and sends it once online', async () => {
    const client = engine();
    server.online = false;
    const a = await client.create({ title: 'A' });
    const b = await client.create({ title: 'B' });
    await client.update(a.id, { body: 'changed offline' });
    await client.remove(b.id);

    const offline = await client.sync();
    expect(offline.offline).toBe(true);
    // B was created and deleted before it reached the server: nothing to tell it
    expect((await client.list()).map((record) => record.data)).toEqual([{ body: 'changed offline', title: 'A' }]);
    expect(await client.pendingCount()).toBe(1);

    server.online = true;
    const online = await client.sync();
    expect(online).toMatchObject({ applied: 1, offline: false });
    expect(server.live()).toMatchObject([{ data: { body: 'changed offline', title: 'A' }, id: a.id, version: 1 }]);
    expect(await client.get(a.id)).toMatchObject({ version: 1 });
    expect(await client.pendingCount()).toBe(0);
  });

  it('chains baseVersion over changes made while a push was already on its way', async () => {
    const client = engine();
    const a = await client.create({ title: 'A' });
    await client.sync();

    server.online = false;
    await client.update(a.id, { title: 'A2' });
    // The failed push marked the change as carried: a later edit must not fold into it (§6.5)
    await client.sync();
    await client.update(a.id, { title: 'A3' });
    expect((await outbox()).map((item) => item.baseVersion)).toEqual([1, 2]);

    server.online = true;
    await client.sync();
    expect(server.records.get(a.id)).toMatchObject({ data: { title: 'A3' }, version: 3 });
    expect(await client.get(a.id)).toMatchObject({ data: { title: 'A3' }, version: 3 });
  });

  it('sends a delete of a synced record as a tombstone with its base version', async () => {
    const client = engine();
    const a = await client.create({ title: 'A' });
    await client.sync();
    server.online = false;
    await client.update(a.id, { title: 'gone soon' });
    await client.remove(a.id);
    // The unsent change was dropped for the delete, which carries the change's base
    expect(await outbox()).toMatchObject([{ baseVersion: 1, id: a.id, op: 'delete' }]);

    server.online = true;
    await client.sync();
    expect(server.records.get(a.id)).toMatchObject({ deletedAt: expect.any(String), version: 2 });
    expect(await client.get(a.id)).toBeUndefined();
  });
});

describe('scenario: conflict', () => {
  it('lets the server win by default and drops the changes based on the refused one', async () => {
    const client = engine();
    const a = await client.create({ title: 'A' });
    await client.sync();
    server.online = false;
    await client.update(a.id, { title: 'mine' });
    await client.sync();
    await client.update(a.id, { body: 'based on mine' });
    server.online = true;
    server.write(a.id, { title: 'theirs' });

    const result = await client.sync();
    expect(result.conflicts).toHaveLength(1);
    expect(await client.get(a.id)).toMatchObject({ data: { title: 'theirs' }, version: 2 });
    expect(await client.pendingCount()).toBe(0);
    // The follow-up change carried baseVersion 2 — the number of the OTHER writer's version. Sent in
    // the same request it would have been applied on top of it; it must never reach the server
    expect(server.records.get(a.id)).toEqual(expect.objectContaining({ data: { title: 'theirs' }, version: 2 }));
    expect(server.pushes().flatMap((request) => request.body.items).filter((item: { baseVersion?: number }) => item.baseVersion === 2)).toEqual([]);
  });

  it('sends the hook’s answer again on top of the server’s version', async () => {
    const seen: unknown[] = [];
    const client = engine({
      onConflict: (conflict) => {
        seen.push(conflict);
        return { data: { title: `${conflict.server.data?.title} + ${conflict.change.data?.title}` } };
      },
    });
    const a = await client.create({ title: 'A' });
    await client.sync();
    await client.update(a.id, { title: 'mine' });
    server.write(a.id, { title: 'theirs' });

    await client.sync();
    expect(seen).toMatchObject([{ change: { data: { title: 'mine' }, op: 'upsert' }, local: { data: { title: 'mine' } }, server: { data: { title: 'theirs' }, version: 2 } }]);
    expect(server.records.get(a.id)).toMatchObject({ data: { title: 'theirs + mine' }, version: 3 });
    expect(await client.get(a.id)).toMatchObject({ data: { title: 'theirs + mine' }, version: 3 });
    expect(await client.pendingCount()).toBe(0);
  });

  it('never resurrects a record the server deleted, whatever the hook answers', async () => {
    const client = engine({ onConflict: () => ({ data: { title: 'revive' } }) });
    const a = await client.create({ title: 'A' });
    await client.sync();
    await client.update(a.id, { title: 'mine' });
    server.tombstone(a.id);

    const result = await client.sync();
    expect(result.conflicts).toHaveLength(1);
    expect(await client.get(a.id)).toBeUndefined();
    expect(server.records.get(a.id)?.deletedAt).toBeTruthy();
  });
});

describe('scenario: two tabs', () => {
  it('produces neither a duplicate nor a false conflict when two tabs push the same change', async () => {
    const tabA = engine();
    const tabB = engine();
    const a = await tabA.create({ title: 'A' });
    await tabA.update(a.id, { body: 'x' });

    const [first, second] = await Promise.all([tabA.sync(), tabB.sync()]);
    expect([...first.conflicts, ...second.conflicts]).toEqual([]);
    expect(server.live()).toHaveLength(1);
    expect(await tabB.list()).toMatchObject([{ id: a.id, version: 1 }]);
  });

  it('keeps a change answered `retry` and sends it with its mutation id again', async () => {
    const client = engine();
    const a = await client.create({ title: 'A' });
    const [queued] = await outbox();
    server.inProgress.add(queued!.mutationId);

    expect(await client.sync()).toMatchObject({ applied: 0, retried: 1 });
    expect(await client.pendingCount()).toBe(1);
    expect(await client.sync()).toMatchObject({ applied: 1, retried: 0 });
    expect(server.pushes().map((request) => request.body.items[0].mutationId)).toEqual([queued!.mutationId, queued!.mutationId]);
    expect(server.records.get(a.id)?.version).toBe(1);
  });
});

describe('scenario: expired session', () => {
  it('discards nothing on 401 and sends the same mutation ids after signing in again', async () => {
    const client = engine();
    const a = await client.create({ title: 'A' });
    server.authorized = false;

    expect(await client.sync()).toMatchObject({ needsLogin: true });
    expect(await client.pendingCount()).toBe(1);
    expect(server.records.size).toBe(0);

    server.authorized = true;
    expect(await client.sync()).toMatchObject({ applied: 1, needsLogin: false });
    const sent = server.pushes().map((request) => request.body.items[0].mutationId);
    expect(new Set(sent).size).toBe(1);
    expect(server.live()).toMatchObject([{ id: a.id, version: 1 }]);
  });

  it('recognises a change whose answer was lost, without a duplicate', async () => {
    const client = engine();
    await client.create({ title: 'A' });
    server.loseNextPushResponse = true;

    expect(await client.sync()).toMatchObject({ offline: true });
    expect(await client.sync()).toMatchObject({ applied: 1 });
    expect(server.live()).toHaveLength(1);
  });
});

describe('scenario: cleared storage', () => {
  it('starts without a cursor and receives the full state again', async () => {
    const client = engine();
    await client.create({ title: 'A' });
    await client.create({ title: 'B' });
    await client.sync();

    // What a browser does when it removes the site's storage
    await deleteLtSyncDatabase();
    resetLtSyncEngines();
    const fresh = engine();
    expect(await fresh.list()).toEqual([]);

    await fresh.sync();
    expect(server.pulls().at(-1)?.url.searchParams.has('cursor')).toBe(false);
    expect((await fresh.list()).map((record) => record.data?.title)).toEqual(expect.arrayContaining(['A', 'B']));
  });
});

describe('pull', () => {
  it('pages with the cursor and stores it after every page', async () => {
    for (const title of ['1', '2', '3', '4', '5']) server.write(ltSyncObjectId(), { title });
    const client = engine({ pageLimit: 2 });

    await client.sync();
    const cursors = server.pulls().map((request) => request.url.searchParams.get('cursor'));
    expect(cursors).toEqual([null, '2', '4']);
    expect(await client.list()).toHaveLength(5);
    expect(await runLtSyncTx('note', (tx) => tx.getMeta('cursor:note'))).toBe('5');
  });

  it('applies tombstones and never overwrites a newer local version or an unsent change', async () => {
    const client = engine();
    const kept = await client.create({ title: 'kept' });
    const gone = await client.create({ title: 'gone' });
    await client.sync();
    server.tombstone(gone.id);
    server.write(kept.id, { title: 'server' });
    await client.update(kept.id, { title: 'local' });
    // Pull only: the unsent change must survive the newer server version until its push settles
    server.nextPush.push({ status: 200, body: { results: [{ id: kept.id, mutationId: 'x', status: 'retry' }] } });

    await client.sync();
    expect(await client.get(gone.id)).toBeUndefined();
    expect(await client.get(kept.id)).toMatchObject({ data: { title: 'local' } });
  });

  it('drops the local records on 410, keeps the unsent changes and pushes them after the full pull', async () => {
    const client = engine();
    const a = await client.create({ title: 'A' });
    await client.sync();
    const b = await client.create({ title: 'B offline' });
    server.nextPull.push({ body: { code: 'SYNC_RESYNC_REQUIRED', reason: 'horizon' }, status: 410 });
    // The push of B happens first; force its answer to `retry` so B is still unsent when the 410 arrives
    server.nextPush.push({ status: 200, body: { results: [{ id: b.id, mutationId: 'x', status: 'retry' }] } });

    const result = await client.sync();
    expect(result.resynced).toBe(true);
    expect(server.pulls().at(-1)?.url.searchParams.has('cursor')).toBe(false);
    expect(server.live().map((record) => record.id).sort()).toEqual([a.id, b.id].sort());
    expect(await client.pendingCount()).toBe(0);
  });

  it('deletes the model’s records and cursor on 403, keeping only what is unsent', async () => {
    const client = engine();
    await client.create({ title: 'A' });
    await client.sync();
    const unsent = await client.create({ title: 'unsent' });
    server.nextPush.push({ status: 200, body: { results: [{ id: unsent.id, mutationId: 'x', status: 'retry' }] } });
    server.nextPull.push({ status: 403 });

    expect(await client.sync()).toMatchObject({ forbidden: true });
    expect((await client.list()).map((record) => record.id)).toEqual([unsent.id]);
    expect(await runLtSyncTx('note', (tx) => tx.getMeta('cursor:note'))).toBeUndefined();
  });
});

describe('server answers', () => {
  it('reports a backoff on 429 with the Retry-After it asked for, losing nothing', async () => {
    const client = engine();
    await client.create({ title: 'A' });
    server.nextPush.push({ headers: { 'retry-after': '2' }, status: 429 });

    expect(await client.sync()).toMatchObject({ retryAfterMs: 2000 });
    expect(await client.pendingCount()).toBe(1);
  });

  it('drops a rejected change and a record the server never had', async () => {
    const client = engine();
    const bad = await client.create({ title: '' });

    const result = await client.sync();
    expect(result.rejected).toMatchObject([{ code: 'VALIDATION_FAILED', id: bad.id }]);
    expect(await client.get(bad.id)).toBeUndefined();
    expect(await client.pendingCount()).toBe(0);
  });

  it('drops the local record when the server answers not_found', async () => {
    const client = engine();
    const a = await client.create({ title: 'A' });
    await client.sync();
    server.records.delete(a.id);
    await client.update(a.id, { title: 'B' });

    await client.sync();
    expect(await client.get(a.id)).toBeUndefined();
  });

  it('throws an unexpected status instead of hiding it', async () => {
    const client = engine();
    await client.create({ title: 'A' });
    server.nextPush.push({ status: 500 });

    await expect(client.sync()).rejects.toThrow(/answered 500/);
    expect(await client.pendingCount()).toBe(1);
  });
});

describe('requests', () => {
  it('sends JSON pushes to the configured base path with the tenant header', async () => {
    setStubRuntimeConfig({ public: { apiUrl: 'https://api.test', ltExtensions: { sync: { basePath: '/offline' } } } });
    const client = engine({ tenantId: 'tenant-1' });
    await client.create({ title: 'A' });

    await client.sync();
    const [push, pull] = server.requests;
    expect(push!.url.pathname).toBe('/offline/note');
    expect(push!.headers).toMatchObject({ 'content-type': 'application/json', 'x-tenant-id': 'tenant-1' });
    expect(pull!.url.pathname).toBe('/offline/note');
    expect(pull!.headers['x-tenant-id']).toBe('tenant-1');
    expect(pull!.headers['content-type']).toBeUndefined();
  });

  it('collapses sync calls during a running sync into one follow-up run', async () => {
    const client = engine();
    await client.create({ title: 'A' });

    await Promise.all([client.sync(), client.sync(), client.sync(), client.sync()]);
    expect(server.pulls()).toHaveLength(2);
  });
});

describe('ids', () => {
  it('creates ObjectId-hex ids with a timestamp head and a random tail', () => {
    const before = Math.floor(Date.now() / 1000);
    const ids = Array.from({ length: 50 }, () => ltSyncObjectId());
    for (const id of ids) {
      expect(id).toMatch(/^[0-9a-f]{24}$/);
      expect(Math.abs(Number.parseInt(id.slice(0, 8), 16) - before)).toBeLessThanOrEqual(1);
    }
    expect(new Set(ids.map((id) => id.slice(8))).size).toBe(50);
  });

  it('creates uuidv7 mutation ids and record ids for a model declared with them', async () => {
    expect(ltSyncUuidV7()).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    const record = await engine({ idFormat: 'uuidv7' }).create({ title: 'A' });
    expect(record.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7/);
    expect((await outbox())[0]!.mutationId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7/);
  });
});

describe('sign-out and account switch', () => {
  it('pushes what is unsent before sign-out', async () => {
    const client = engine();
    await client.create({ title: 'A' });

    await flushLtSyncBeforeSignOut(1000);
    expect(server.live()).toHaveLength(1);
  });

  it('gives up after the timeout when the server does not answer', async () => {
    const hanging = createLtSyncEngine<Note>({ fetch: () => new Promise<Response>(() => undefined), model: 'note' });
    await hanging.create({ title: 'A' });

    const started = Date.now();
    await flushLtSyncBeforeSignOut(50);
    expect(Date.now() - started).toBeLessThan(1000);
  });

  it('binds the data to the first user and wipes every model for another one', async () => {
    expect(await claimLtSyncOwner('user-1')).toBe(false);
    await engine().create({ title: 'A' });
    await createLtSyncEngine({ fetch: server.fetch, model: 'task' }).create({ title: 'T' });

    expect(await claimLtSyncOwner('user-1')).toBe(false);
    expect(await engine().list()).toHaveLength(1);

    expect(await claimLtSyncOwner('user-2')).toBe(true);
    expect(await engine().list()).toEqual([]);
    expect(await runLtSyncTx('task', (tx) => tx.listRecords())).toEqual([]);
    expect(await engine().pendingCount()).toBe(0);
  });
});
