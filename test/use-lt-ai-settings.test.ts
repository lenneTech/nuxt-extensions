/**
 * `useLtAiSettings()` — the user's own AI settings (`GET/PUT /ai/settings`, nest-server >= 12.3.0).
 *
 * `ltAuthFetch` is a controlled stub, as in `ai-request.test.ts`, so the requests the composable
 * sends and the answers it adopts can be asserted exactly.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useLtAiSettings } from '../src/runtime/composables/use-lt-ai-settings';
import { resetStubReactiveStores, resetStubRuntimeConfig } from './stubs/imports';

const ltAuthFetchMock = vi.fn();

vi.mock('../src/runtime/lib/auth-state', () => ({
  buildLtApiUrl: (path: string) => path,
  ltAuthFetch: (...args: unknown[]) => ltAuthFetchMock(...args),
}));

function answer(status: number, body: unknown): Response {
  return { ok: status >= 200 && status < 300, status, json: async () => body } as unknown as Response;
}

const ENFORCED = { error: 'Forbidden', message: '#LTNS_0609: This AI setting is fixed by the server', statusCode: 403 };

beforeEach(() => {
  resetStubRuntimeConfig();
  resetStubReactiveStores();
  ltAuthFetchMock.mockReset();
});

describe('useLtAiSettings', () => {
  it('loads the settings as they take effect', async () => {
    ltAuthFetchMock.mockResolvedValueOnce(answer(200, { mcpConfirmation: true, mcpConfirmationEnforced: false }));
    const ai = useLtAiSettings();
    expect(ai.enforced.value).toBe(false);

    await ai.load();

    const [url, init] = ltAuthFetchMock.mock.calls[0]!;
    expect(url).toBe('/ai/settings');
    expect(init.method).toBe('GET');
    expect(ai.settings.value).toEqual({ mcpConfirmation: true, mcpConfirmationEnforced: false });
    expect(ai.enforced.value).toBe(false);
    expect(ai.loading.value).toBe(false);
  });

  it('reports a setting the server fixed as enforced', async () => {
    ltAuthFetchMock.mockResolvedValueOnce(answer(200, { mcpConfirmation: true, mcpConfirmationEnforced: true }));
    const ai = useLtAiSettings();

    await ai.load();
    expect(ai.enforced.value).toBe(true);
  });

  it('sends only the choice and adopts the server’s answer, not the input', async () => {
    ltAuthFetchMock.mockResolvedValueOnce(answer(200, { mcpConfirmation: true, mcpConfirmationEnforced: false }));
    const ai = useLtAiSettings();
    await ai.load();
    // The server answers with what takes effect; here it differs from the input on purpose
    ltAuthFetchMock.mockResolvedValueOnce(answer(200, { mcpConfirmation: true, mcpConfirmationEnforced: true }));

    await ai.update({ mcpConfirmation: false });

    const [url, init] = ltAuthFetchMock.mock.calls[1]!;
    expect(url).toBe('/ai/settings');
    expect(init.method).toBe('PUT');
    expect(JSON.parse(init.body)).toEqual({ mcpConfirmation: false });
    expect(ai.settings.value).toEqual({ mcpConfirmation: true, mcpConfirmationEnforced: true });
    expect(ai.enforced.value).toBe(true);
  });

  it('keeps the previous value when the server refuses a fixed setting (403 #LTNS_0609)', async () => {
    ltAuthFetchMock.mockResolvedValueOnce(answer(200, { mcpConfirmation: true, mcpConfirmationEnforced: false }));
    const ai = useLtAiSettings();
    await ai.load();
    ltAuthFetchMock.mockResolvedValueOnce(answer(403, ENFORCED));

    await expect(ai.update({ mcpConfirmation: false })).rejects.toMatchObject({ status: 403 });

    expect(ai.error.value).toContain('#LTNS_0609');
    expect(ai.settings.value).toEqual({ mcpConfirmation: true, mcpConfirmationEnforced: false });
    expect(ai.loading.value).toBe(false);
  });

  it('reports a failed load without throwing', async () => {
    ltAuthFetchMock.mockResolvedValueOnce(answer(401, { message: 'Unauthorized', statusCode: 401 }));
    const ai = useLtAiSettings();

    await ai.load();

    expect(ai.error.value).toBe('Unauthorized');
    expect(ai.settings.value).toBeNull();
    expect(ai.enforced.value).toBe(false);
  });
});
