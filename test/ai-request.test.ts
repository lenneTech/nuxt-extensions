/**
 * Unit tests for the AI client helpers in `src/runtime/lib/ai.ts` that are not
 * covered by the SSE-parser suite: `ltAiResponseError`, `ltAiRequest`, and the
 * URL builders. We mock `auth-state.ts` so the helpers can run without a Nuxt
 * runtime — `ltAuthFetch` becomes a controlled stub that returns whatever the
 * test wants, and `buildLtApiUrl` becomes an identity function so we can
 * assert exactly what `buildLtAiUrl` produced.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { resetStubReactiveStores, resetStubRuntimeConfig, setStubRuntimeConfig } from './stubs/imports';

const ltAuthFetchMock = vi.fn();

vi.mock('../src/runtime/lib/auth-state', () => ({
  buildLtApiUrl: (path: string) => path,
  ltAuthFetch: (...args: unknown[]) => ltAuthFetchMock(...args),
}));

function makeResponse(init: { body?: unknown; ok?: boolean; status?: number } = {}): Response {
  const status = init.status ?? 200;
  const ok = init.ok ?? (status >= 200 && status < 300);
  const body = init.body;
  return {
    ok,
    status,
    json: async () => body,
  } as unknown as Response;
}

beforeEach(() => {
  resetStubRuntimeConfig();
  resetStubReactiveStores();
  ltAuthFetchMock.mockReset();
});

describe('buildLtAiUrl + getLtAiBasePath', () => {
  it('falls back to /ai when runtimeConfig has no AI base path', async () => {
    const { buildLtAiUrl, getLtAiBasePath } = await import('../src/runtime/lib/ai');
    expect(getLtAiBasePath()).toBe('/ai');
    expect(buildLtAiUrl('/prompt')).toBe('/ai/prompt');
  });

  it('honours runtimeConfig.public.ltExtensions.ai.basePath', async () => {
    setStubRuntimeConfig({ public: { ltExtensions: { ai: { basePath: '/assistant' } } } });
    const { buildLtAiUrl, getLtAiBasePath } = await import('../src/runtime/lib/ai');
    expect(getLtAiBasePath()).toBe('/assistant');
    expect(buildLtAiUrl('/stream')).toBe('/assistant/stream');
  });
});

describe('ltAiResponseError', () => {
  it('uses backend message string verbatim', async () => {
    const { ltAiResponseError } = await import('../src/runtime/lib/ai');
    const err = await ltAiResponseError(makeResponse({ ok: false, status: 400, body: { message: 'oops' } }));
    expect(err.message).toBe('oops');
    expect(err.status).toBe(400);
  });

  it('joins array messages with commas', async () => {
    const { ltAiResponseError } = await import('../src/runtime/lib/ai');
    const err = await ltAiResponseError(makeResponse({ ok: false, status: 422, body: { message: ['a', 'b'] } }));
    expect(err.message).toBe('a, b');
  });

  it('falls back to the `error` field when `message` is absent', async () => {
    const { ltAiResponseError } = await import('../src/runtime/lib/ai');
    const err = await ltAiResponseError(makeResponse({ ok: false, status: 500, body: { error: 'boom' } }));
    expect(err.message).toBe('boom');
  });

  it('falls back to HTTP status text when the body is unparseable', async () => {
    const { ltAiResponseError } = await import('../src/runtime/lib/ai');
    const response = { ok: false, status: 503, json: async () => { throw new Error('bad json'); } } as unknown as Response;
    const err = await ltAiResponseError(response);
    expect(err.message).toBe('HTTP 503');
    expect(err.status).toBe(503);
  });

  it('caps an oversized backend message at 1 KiB', async () => {
    const { ltAiResponseError } = await import('../src/runtime/lib/ai');
    const huge = 'x'.repeat(5000);
    const err = await ltAiResponseError(makeResponse({ ok: false, status: 400, body: { message: huge } }));
    expect(err.message.length).toBeLessThanOrEqual(1025); // 1024 + ellipsis
    expect(err.message.endsWith('…')).toBe(true);
  });
});

describe('ltAiRequest', () => {
  it('returns the parsed JSON body on 2xx', async () => {
    ltAuthFetchMock.mockResolvedValueOnce(makeResponse({ body: { id: '1' } }));
    const { ltAiRequest } = await import('../src/runtime/lib/ai');
    const result = await ltAiRequest<{ id: string }>('GET', '/prompts');
    expect(result).toEqual({ id: '1' });
  });

  it('returns undefined on a 204 No Content', async () => {
    ltAuthFetchMock.mockResolvedValueOnce(makeResponse({ status: 204 }));
    const { ltAiRequest } = await import('../src/runtime/lib/ai');
    const result = await ltAiRequest<unknown>('DELETE', '/prompts/abc');
    expect(result).toBeUndefined();
  });

  it('serialises the body and sets JSON headers when body is given', async () => {
    ltAuthFetchMock.mockResolvedValueOnce(makeResponse({ body: { ok: true } }));
    const { ltAiRequest } = await import('../src/runtime/lib/ai');
    await ltAiRequest('POST', '/prompts', { name: 'x' });
    const [, init] = ltAuthFetchMock.mock.calls[0] as [string, RequestInit];
    expect(init.method).toBe('POST');
    expect(init.body).toBe(JSON.stringify({ name: 'x' }));
    expect(init.headers).toMatchObject({ 'Content-Type': 'application/json', Accept: 'application/json' });
  });

  it('omits the request body when none is given', async () => {
    ltAuthFetchMock.mockResolvedValueOnce(makeResponse({ body: [] }));
    const { ltAiRequest } = await import('../src/runtime/lib/ai');
    await ltAiRequest('GET', '/prompts');
    const [, init] = ltAuthFetchMock.mock.calls[0] as [string, RequestInit];
    expect(init.body).toBeUndefined();
    expect(init.headers).toEqual({ Accept: 'application/json' });
  });

  it('forwards an AbortSignal to ltAuthFetch', async () => {
    ltAuthFetchMock.mockResolvedValueOnce(makeResponse({ body: {} }));
    const { ltAiRequest } = await import('../src/runtime/lib/ai');
    const controller = new AbortController();
    await ltAiRequest('GET', '/prompts', undefined, { signal: controller.signal });
    const [, init] = ltAuthFetchMock.mock.calls[0] as [string, RequestInit];
    expect(init.signal).toBe(controller.signal);
  });

  it('throws an Error with the parsed backend message on non-2xx', async () => {
    ltAuthFetchMock.mockResolvedValueOnce(makeResponse({ ok: false, status: 403, body: { message: 'nope' } }));
    const { ltAiRequest } = await import('../src/runtime/lib/ai');
    await expect(ltAiRequest('GET', '/prompts')).rejects.toMatchObject({ message: 'nope', status: 403 });
  });
});
