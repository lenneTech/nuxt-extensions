/**
 * The offline-sync hint stream (`GET /sync/hints`, protocol §9), read with fetch rather than
 * EventSource so it signs in with a cookie and a JWT alike (decision E2 of DEV-3917).
 *
 * The load-bearing behaviour is the pull on every reconnect: the server ends a stream before the
 * first hint after its re-check interval and never replays that hint (DEV-3917, scope).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { openLtSyncHints } from '../src/runtime/lib/sync-hints';
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
