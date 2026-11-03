/**
 * An in-memory stand-in for the nest-server sync module, for the offline-sync tests.
 *
 * It answers like `docs/offline-sync-protocol.md` (nest-server >= 12.2.0) with the default
 * conflict strategy `reject`: records carry a `version` the server increments, a delete leaves a
 * tombstone, the cursor is opaque to the client, a mutation id is answered with its recorded
 * outcome, an upsert on a tombstone or with a stale `baseVersion` is a `conflict` with the server's
 * record. What the real server checks beyond that (rights, tenants, validation) is out of scope;
 * an empty `title` stands in for a validation failure.
 */

import type { LtSyncPushResult } from '../../src/runtime/types/sync';

interface ServerRecord {
  data?: Record<string, unknown>;
  deletedAt: null | string;
  id: string;
  seq: number;
  updatedAt: string;
  version: number;
}

interface ForcedAnswer {
  body?: unknown;
  headers?: Record<string, string>;
  status: number;
}

export interface LoggedRequest {
  body?: any;
  headers: Record<string, string>;
  method: string;
  url: URL;
}

const json = (status: number, body?: unknown, headers: Record<string, string> = {}): Response =>
  new Response(body === undefined ? null : JSON.stringify(body), { headers: { 'content-type': 'application/json', ...headers }, status });

export class FakeSyncServer {
  /** Every request, in order */
  readonly requests: LoggedRequest[] = [];
  readonly records = new Map<string, ServerRecord>();
  /** Recorded outcome per mutation id (§6.5) */
  readonly outcomes = new Map<string, LtSyncPushResult>();
  /** `false`: every request fails like a dropped connection */
  online = true;
  /** `false`: every request answers 401 */
  authorized = true;
  /** One-shot answers for the next pulls, e.g. `{ status: 410, body: { code: 'SYNC_RESYNC_REQUIRED', reason: 'horizon' } }` */
  readonly nextPull: ForcedAnswer[] = [];
  /** One-shot answers for the next pushes */
  readonly nextPush: ForcedAnswer[] = [];
  /** Mutation ids answered `retry` once — "still in progress in another tab" */
  readonly inProgress = new Set<string>();
  /** Apply the next push, then drop the connection before the answer arrives */
  loseNextPushResponse = false;
  private seq = 0;

  /** A change somebody else made, straight on the server */
  write(id: string, data: Record<string, unknown>): ServerRecord {
    const existing = this.records.get(id);
    const record: ServerRecord = {
      data: { ...existing?.data, ...data },
      deletedAt: null,
      id,
      seq: ++this.seq,
      updatedAt: new Date().toISOString(),
      version: (existing?.version ?? 0) + 1,
    };
    this.records.set(id, record);
    return record;
  }

  /** A delete somebody else made: a tombstone */
  tombstone(id: string): void {
    const existing = this.records.get(id);
    if (!existing) return;
    this.records.set(id, { ...existing, data: undefined, deletedAt: new Date().toISOString(), seq: ++this.seq, version: existing.version + 1 });
  }

  /** The live records, by id */
  live(): ServerRecord[] {
    return [...this.records.values()].filter((record) => !record.deletedAt).sort((a, b) => (a.id < b.id ? -1 : 1));
  }

  pushes(): LoggedRequest[] {
    return this.requests.filter((request) => request.method === 'POST');
  }

  pulls(): LoggedRequest[] {
    return this.requests.filter((request) => request.method === 'GET');
  }

  readonly fetch = async (input: string, init: RequestInit = {}): Promise<Response> => {
    const url = new URL(input);
    const method = init.method ?? 'GET';
    const body = init.body ? JSON.parse(String(init.body)) : undefined;
    this.requests.push({ body, headers: Object.fromEntries(new Headers(init.headers).entries()), method, url });
    if (!this.online) throw new TypeError('Failed to fetch');
    if (!this.authorized) return json(401, { message: 'Unauthorized' });
    if (method === 'GET') {
      const forced = this.nextPull.shift();
      return forced ? json(forced.status, forced.body, forced.headers) : this.pull(url);
    }
    const forced = this.nextPush.shift();
    if (forced) return json(forced.status, forced.body, forced.headers);
    const results = (body.items as any[]).map((item) => this.apply(item));
    if (this.loseNextPushResponse) {
      this.loseNextPushResponse = false;
      throw new TypeError('connection reset');
    }
    return json(200, { results });
  };

  private view(record: ServerRecord): NonNullable<LtSyncPushResult['record']> {
    const { seq: _seq, ...rest } = record;
    return record.deletedAt ? { deletedAt: rest.deletedAt, id: rest.id, updatedAt: rest.updatedAt, version: rest.version } : rest;
  }

  private pull(url: URL): Response {
    const after = Number(url.searchParams.get('cursor') ?? 0);
    const limit = Number(url.searchParams.get('limit') ?? 200);
    const changed = [...this.records.values()].filter((record) => record.seq > after).sort((a, b) => a.seq - b.seq);
    const page = changed.slice(0, limit);
    const cursor = String(page.at(-1)?.seq ?? after);
    return json(200, { cursor, hasMore: changed.length > limit, items: page.map((record) => this.view(record)) });
  }

  private apply(item: { baseVersion?: number; data?: Record<string, unknown>; id: string; mutationId: string; op: 'delete' | 'upsert' }): LtSyncPushResult {
    const { id, mutationId } = item;
    const recorded = this.outcomes.get(mutationId);
    if (recorded) {
      const current = this.records.get(id);
      return { ...recorded, ...(current ? { record: this.view(current) } : {}) };
    }
    if (this.inProgress.delete(mutationId)) return { id, mutationId, status: 'retry' };
    const existing = this.records.get(id);
    const conflict = (): LtSyncPushResult => ({ id, mutationId, record: this.view(existing!), status: 'conflict', version: existing!.version });
    let outcome: LtSyncPushResult;
    if (item.op === 'upsert' && item.data?.title === '') {
      outcome = { code: 'VALIDATION_FAILED', details: [{ field: 'title' }], id, mutationId, status: 'rejected' };
    } else if (item.op === 'upsert') {
      if (item.baseVersion === undefined) {
        outcome = existing ? conflict() : { id, mutationId, status: 'applied', version: this.write(id, item.data ?? {}).version };
      } else if (!existing) {
        outcome = { id, mutationId, status: 'not_found' };
      } else if (existing.deletedAt || existing.version !== item.baseVersion) {
        outcome = conflict();
      } else {
        outcome = { id, mutationId, status: 'applied', version: this.write(id, item.data ?? {}).version };
      }
    } else if (!existing) {
      outcome = { id, mutationId, status: 'not_found' };
    } else if (existing.deletedAt) {
      outcome = { id, mutationId, status: 'applied', version: existing.version };
    } else if (existing.version !== item.baseVersion) {
      outcome = conflict();
    } else {
      this.tombstone(id);
      outcome = { id, mutationId, status: 'applied', version: this.records.get(id)!.version };
    }
    this.outcomes.set(mutationId, outcome);
    return outcome;
  }
}
