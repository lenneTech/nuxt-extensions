/**
 * The offline-sync hint stream (`GET /sync/hints`, protocol §9), read with fetch rather than
 * EventSource so it signs in with a cookie and a JWT alike (decision E2 of DEV-3917).
 *
 * The load-bearing behaviour is the pull on every reconnect: the server ends a stream before the
 * first hint after its re-check interval and never replays that hint (DEV-3917, scope).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { openLtSyncHints, subscribeLtSyncHints } from '../src/runtime/lib/sync-hints';
import { resetStubRuntimeConfig, setStubRuntimeConfig } from './stubs/imports';

const encoder = new TextEncoder();

/** A response streaming `chunks`, then ending — or staying open until aborted */
function sse(chunks: string[], { keepOpen = false } = {}): (signal: AbortSignal) => Response {
  return (signal) =>
    new Response(
      new ReadableStream<Uint8Array>({
        start(controller) {
          for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
          if (!keepOpen) controller.close();
          signal.addEventListener('abort', () => controller.error(new DOMException('aborted', 'AbortError')));
        },
      }),
      { headers: { 'content-type': 'text/event-stream' }, status: 200 },
    );
}

interface Call {
  headers: Record<string, string>;
  url: URL;
}

/** A fetch answering each connect with the next of `answers` */
function scripted(answers: Array<((signal: AbortSignal) => Response) | Error | number>) {
  const calls: Call[] = [];
  const fetch = vi.fn(async (input: string, init: RequestInit) => {
    calls.push({ headers: Object.fromEntries(new Headers(init.headers).entries()), url: new URL(input) });
    const answer = answers.shift() ?? sse([], { keepOpen: true });
    if (answer instanceof Error) throw answer;
    if (typeof answer === 'number') return new Response(null, { status: answer });
    return answer(init.signal!);
  });
  return { calls, fetch };
}

const until = async (condition: () => boolean) => {
  for (let i = 0; i < 200 && !condition(); i++) await new Promise((resolve) => setTimeout(resolve, 5));
  expect(condition()).toBe(true);
};

let close: (() => void) | undefined;

beforeEach(() => {
  setStubRuntimeConfig({ public: { apiUrl: 'https://api.test', ltExtensions: { sync: { basePath: '/sync' } } } });
});

afterEach(() => {
  close?.();
  close = undefined;
  resetStubRuntimeConfig();
});

describe('openLtSyncHints', () => {
  it('reports change events split across chunks and skips keep-alive comments', async () => {
    const hints: string[] = [];
    const { fetch } = scripted([sse([': keep-alive\n\n', 'event: change\nda', 'ta: {"model":"note","at":"2026-11-02T09:15:44.002Z"}\n', '\nevent: change\r\ndata: {"model":"task"}\r\n\r\n'], { keepOpen: true })]);

    close = openLtSyncHints({ fetch, models: ['note', 'task'], onConnect: () => undefined, onHint: (model) => hints.push(model) });
    await until(() => hints.length === 2);
    expect(hints).toEqual(['note', 'task']);
  });

  it('asks for the models as an event stream, with the tenant', async () => {
    const { calls, fetch } = scripted([sse([], { keepOpen: true })]);

    close = openLtSyncHints({ fetch, models: ['note', 'task'], onConnect: () => undefined, onHint: () => undefined, tenantId: 't-1' });
    await until(() => calls.length === 1);
    expect(calls[0]!.url.pathname).toBe('/sync/hints');
    expect(calls[0]!.url.searchParams.get('models')).toBe('note,task');
    expect(calls[0]!.headers).toMatchObject({ accept: 'text/event-stream', 'x-tenant-id': 't-1' });
  });

  it('reconnects after the server ends the stream, with its retry, and connects again each time', async () => {
    let connects = 0;
    const { fetch } = scripted([sse(['retry: 10\n\n']), sse(['retry: 10\n\n']), sse([], { keepOpen: true })]);

    close = openLtSyncHints({ fetch, models: ['note'], onConnect: () => connects++, onHint: () => undefined });
    // Every connect is a pull for the caller: the hint lost at the planned end is not replayed (§9)
    await until(() => connects === 3);
  });

  it('stops for good when the server switched SSE off, and when the session ended', async () => {
    const stops: string[] = [];
    const disabled = scripted([404]);
    close = openLtSyncHints({ fetch: disabled.fetch, models: ['note'], onConnect: () => undefined, onHint: () => undefined, onStop: (reason) => stops.push(reason) });
    const unauthorized = scripted([401]);
    const closeOther = openLtSyncHints({ fetch: unauthorized.fetch, models: ['note'], onConnect: () => undefined, onHint: () => undefined, onStop: (reason) => stops.push(reason) });

    await until(() => stops.length === 2);
    expect(stops.sort()).toEqual(['disabled', 'unauthorized']);
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(disabled.fetch).toHaveBeenCalledTimes(1);
    expect(unauthorized.fetch).toHaveBeenCalledTimes(1);
    closeOther();
  });

  it('retries after a network error and after an unexpected status', async () => {
    vi.useFakeTimers();
    try {
      let connects = 0;
      const { fetch } = scripted([new TypeError('Failed to fetch'), 502, sse([], { keepOpen: true })]);
      close = openLtSyncHints({ fetch, models: ['note'], onConnect: () => connects++, onHint: () => undefined });

      await vi.advanceTimersByTimeAsync(3000);
      expect(fetch).toHaveBeenCalledTimes(2);
      // The second failure doubles the wait
      await vi.advanceTimersByTimeAsync(5999);
      expect(fetch).toHaveBeenCalledTimes(2);
      await vi.advanceTimersByTimeAsync(1);
      expect(fetch).toHaveBeenCalledTimes(3);
      expect(connects).toBe(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('ignores a malformed hint instead of dying on it', async () => {
    const hints: string[] = [];
    const { fetch } = scripted([sse(['event: change\ndata: {not json\n\n', 'event: change\ndata: {"model":"note"}\n\n'], { keepOpen: true })]);

    close = openLtSyncHints({ fetch, models: ['note'], onConnect: () => undefined, onHint: (model) => hints.push(model) });
    await until(() => hints.length === 1);
  });

  it('closes the open stream and reconnects no more', async () => {
    let connects = 0;
    const { fetch } = scripted([sse([], { keepOpen: true })]);
    close = openLtSyncHints({ fetch, models: ['note'], onConnect: () => connects++, onHint: () => undefined });
    await until(() => connects === 1);

    close();
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});

describe('subscribeLtSyncHints — one stream per tab and tenant', () => {
  /** A fetch that keeps every stream open and remembers which are still open, and for which models */
  function streams() {
    const opened: { models: string; signal: AbortSignal; tenant?: string; write: (text: string) => void }[] = [];
    const fetch = vi.fn(async (input: string, init: RequestInit) => {
      let write!: (text: string) => void;
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          write = (text) => controller.enqueue(encoder.encode(text));
          init.signal!.addEventListener('abort', () => controller.error(new DOMException('aborted', 'AbortError')));
        },
      });
      const headers = new Headers(init.headers);
      opened.push({ models: new URL(input).searchParams.get('models')!, signal: init.signal!, tenant: headers.get('x-tenant-id') ?? undefined, write });
      return new Response(body, { status: 200 });
    });
    const open = () => opened.filter((stream) => !stream.signal.aborted);
    return { fetch, open };
  }

  const subscriber = (model: string, tenantId?: string) => ({ hints: 0, connects: 0, model, stops: [] as string[], tenantId });
  const subscribe = (s: ReturnType<typeof subscriber>) =>
    subscribeLtSyncHints({
      model: s.model,
      onConnect: () => s.connects++,
      onHint: () => s.hints++,
      onStop: (reason) => s.stops.push(reason),
      tenantId: s.tenantId,
    });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('keeps ONE stream for every instance and model of a tenant, however many there are', async () => {
    const { fetch, open } = streams();
    vi.stubGlobal('fetch', fetch);
    const list = subscriber('note');
    const badge = subscriber('note');
    const tasks = subscriber('task');
    const unsubscribe = [subscribe(list), subscribe(badge), subscribe(tasks)];

    // Over HTTP/1.1 six streams would take every connection to the API host; it stays one
    await until(() => open().length === 1 && open()[0]!.models === 'note,task');
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(open()).toHaveLength(1);
    for (const off of unsubscribe) off();
  });

  it('routes a hint to the instances of its model only, and every connect to all', async () => {
    const { fetch, open } = streams();
    vi.stubGlobal('fetch', fetch);
    const notes = subscriber('note');
    const tasks = subscriber('task');
    const off = [subscribe(notes), subscribe(tasks)];
    await until(() => open().length === 1 && open()[0]!.models === 'note,task' && notes.connects > 0 && tasks.connects > 0);

    open()[0]!.write('event: change\ndata: {"model":"task"}\n\n');
    await until(() => tasks.hints === 1);
    expect(notes.hints).toBe(0);
    for (const unsubscribe of off) unsubscribe();
  });

  it('narrows the stream when an instance leaves and closes it with the last one', async () => {
    const { fetch, open } = streams();
    vi.stubGlobal('fetch', fetch);
    const offNotes = subscribe(subscriber('note'));
    const offTasks = subscribe(subscriber('task'));
    await until(() => open().length === 1 && open()[0]!.models === 'note,task');

    offTasks();
    await until(() => open().length === 1 && open()[0]!.models === 'note');
    offNotes();
    // Closed with the last instance
    await until(() => open().length === 0);
  });

  it('keeps a separate stream per tenant', async () => {
    const { fetch, open } = streams();
    vi.stubGlobal('fetch', fetch);
    const off = [subscribe(subscriber('note', 't-1')), subscribe(subscriber('note', 't-2'))];

    await until(() => open().length === 2);
    expect(open().map((stream) => stream.tenant).sort()).toEqual(['t-1', 't-2']);
    for (const unsubscribe of off) unsubscribe();
  });

  it('tells every instance when the stream stops for good', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 401 })));
    const a = subscriber('note');
    const b = subscriber('task');
    const off = [subscribe(a), subscribe(b)];

    await until(() => a.stops.length > 0 && b.stops.length > 0);
    expect([...a.stops, ...b.stops].every((reason) => reason === 'unauthorized')).toBe(true);
    for (const unsubscribe of off) unsubscribe();
  });
});
