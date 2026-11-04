/**
 * `useLtAiStatus()` — whether the API's AI module is on (`GET /ai/status`, public).
 *
 * The global `fetch` is replaced, so the request the composable sends and the
 * state it derives from each kind of answer can be asserted exactly.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useLtAiStatus } from '../src/runtime/composables/use-lt-ai-status';
import { resetStubReactiveStores, resetStubRuntimeConfig, setStubRuntimeConfig, useState } from './stubs/imports';

const fetchMock = vi.fn();

function answer(status: number, body: unknown, json = true): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => {
      if (!json) throw new SyntaxError('Unexpected token <');
      return body;
    },
  } as unknown as Response;
}

beforeEach(() => {
  setStubRuntimeConfig({ public: { apiUrl: 'https://api.test' } });
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  resetStubRuntimeConfig();
  resetStubReactiveStores();
});

describe('useLtAiStatus — what each answer means', () => {
  it.each([true, false])('reports the module as on with mcp=%s for a 200', async (mcp) => {
    fetchMock.mockResolvedValueOnce(answer(200, { mcp }));
    const status = useLtAiStatus();
    expect(status.loaded.value).toBe(false);

    await status.load();

    expect(status.enabled.value).toBe(true);
    expect(status.mcp.value).toBe(mcp);
    expect(status.error.value).toBeNull();
    expect(status.loaded.value).toBe(true);
  });

  it('asks the public endpoint without credentials', async () => {
    fetchMock.mockResolvedValueOnce(answer(200, { mcp: true }));
    await useLtAiStatus().load();

    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('https://api.test/ai/status');
    expect(init.credentials).toBe('omit');
    expect(init.headers).not.toHaveProperty('Authorization');
  });

  it('treats a 404 as "AI is off", not as an error', async () => {
    fetchMock.mockResolvedValueOnce(answer(404, { message: 'Not Found', statusCode: 404 }));
    const status = useLtAiStatus();

    await status.load();

    expect(status.enabled.value).toBe(false);
    expect(status.mcp.value).toBe(false);
    expect(status.error.value).toBeNull();
    expect(status.loaded.value).toBe(true);
  });

  it.each([
    ['a 5xx', () => fetchMock.mockResolvedValueOnce(answer(503, { message: 'Service Unavailable' })), 'HTTP 503'],
    ['a network error', () => fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch')), 'AI status request failed'],
    ['a timeout', () => fetchMock.mockRejectedValueOnce(new DOMException('The operation was aborted due to timeout', 'TimeoutError')), 'AI status request timed out'],
    ['an HTML page with 200', () => fetchMock.mockResolvedValueOnce(answer(200, undefined, false)), 'Unexpected AI status response'],
    ['a 200 without a boolean mcp', () => fetchMock.mockResolvedValueOnce(answer(200, { mcp: 'yes' })), 'Unexpected AI status response'],
  ])('fails closed on %s and says why', async (_label, arrange, message) => {
    arrange();
    const status = useLtAiStatus();

    await expect(status.load()).resolves.toBeUndefined();

    expect(status.enabled.value).toBe(false);
    expect(status.mcp.value).toBe(false);
    expect(status.error.value).toBe(message);
    expect(status.loaded.value).toBe(true);
  });

  it('gives up after 5 s and fails closed instead of stalling the server render', async () => {
    const controller = new AbortController();
    const timeout = vi.spyOn(AbortSignal, 'timeout').mockReturnValue(controller.signal);
    fetchMock.mockImplementationOnce(
      (_url: string, init: RequestInit) =>
        new Promise((_resolve, reject) => init.signal?.addEventListener('abort', () => reject(init.signal!.reason))),
    );
    const status = useLtAiStatus();
    const loading = status.load();

    controller.abort(new DOMException('The operation was aborted due to timeout', 'TimeoutError'));
    await loading;

    expect(timeout).toHaveBeenCalledWith(5000);
    expect(status.loaded.value).toBe(true);
    expect(status.enabled.value).toBe(false);
    expect(status.error.value).toBe('AI status request timed out');
  });

  it('never puts the private API URL into the state the server renders into the page', async () => {
    // What Node's fetch throws for an unparseable NUXT_API_URL and for one carrying credentials
    fetchMock.mockRejectedValueOnce(new TypeError('Failed to parse URL from 10.12.0.5:3000/ai/status'));
    const status = useLtAiStatus();
    await status.load();
    fetchMock.mockRejectedValueOnce(new TypeError('Request cannot be constructed from a URL that includes credentials: http://svc:s3cret@api-internal:3000/ai/status'));
    await status.load({ force: true });

    const serialized = JSON.stringify(useState('lt-ai-status').value);
    expect(serialized).not.toContain('10.12.0.5');
    expect(serialized).not.toContain('s3cret');
    expect(serialized).not.toContain('api-internal');
  });
});

describe('useLtAiStatus — one request per app start', () => {
  it('shares one request between every caller loading at the same time', async () => {
    fetchMock.mockResolvedValueOnce(answer(200, { mcp: true }));
    const layout = useLtAiStatus();
    const middleware = useLtAiStatus();

    await Promise.all([layout.load(), middleware.load(), useLtAiStatus().load()]);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(layout.enabled.value).toBe(true);
    expect(middleware.mcp.value).toBe(true);
  });

  it('keeps two concurrent server requests apart, each with its own answer', async () => {
    let releaseFirst!: (response: Response) => void;
    fetchMock.mockImplementationOnce(() => new Promise<Response>((resolve) => (releaseFirst = resolve)));
    fetchMock.mockResolvedValueOnce(answer(200, { mcp: true }));

    const first = useLtAiStatus();
    const loadingFirst = first.load();
    // A second request: its own Nuxt app and its own payload state
    resetStubReactiveStores();
    const second = useLtAiStatus();
    const loadingSecond = second.load();

    releaseFirst(answer(200, { mcp: true }));
    await Promise.all([loadingFirst, loadingSecond]);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(second.loaded.value).toBe(true);
    expect(second.enabled.value).toBe(true);
  });

  it('does not ask again once loaded, unless forced', async () => {
    fetchMock.mockResolvedValueOnce(answer(200, { mcp: true }));
    const status = useLtAiStatus();
    await status.load();
    await useLtAiStatus().load();
    expect(fetchMock).toHaveBeenCalledTimes(1);

    fetchMock.mockResolvedValueOnce(answer(404, {}));
    await status.load({ force: true });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(status.enabled.value).toBe(false);
  });

  it('adopts the state the server rendered without a second request', async () => {
    // What hydration finds in the payload after SSR loaded the status
    useState('lt-ai-status', () => ({ enabled: true, error: null, loaded: true, mcp: false }));
    const status = useLtAiStatus();

    await status.load();

    expect(fetchMock).not.toHaveBeenCalled();
    expect(status.enabled.value).toBe(true);
    expect(status.mcp.value).toBe(false);
  });
});
