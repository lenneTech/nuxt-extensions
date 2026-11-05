/**
 * `useSystemSetup()` against the HTTP-init release of `@lenne.tech/nest-server` (>= 12.4.0).
 *
 * A deployed API refuses `POST /system-setup/init` unless the HTTP init is released
 * (`systemSetup.httpInit`), and may demand a setup token. `GET /system-setup/status` reports both:
 * `httpInitEnabled` and `httpInitTokenRequired`. The composable exposes them so a setup page can
 * show a notice instead of a form that can only fail with 403, and send the token as the
 * `X-System-Setup-Token` header — never in the body, and never hashed: the server compares it as
 * given.
 *
 * An API before 12.4.0 sends neither field and accepts the HTTP init, so a missing field reads as
 * "released" (the server's 403 is the actual boundary, not this flag).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { resetStubReactiveStores, resetStubRuntimeConfig } from './stubs/imports';
import { resetTestRenderScope } from './stubs/render-scope';

let fetchSpy: ReturnType<typeof vi.fn>;

function respondWith(body: unknown): void {
  fetchSpy.mockImplementation(async () => body);
}

async function loadComposable() {
  const { useSystemSetup } = await import('../src/runtime/composables/auth/use-system-setup');
  return useSystemSetup();
}

beforeEach(() => {
  resetStubRuntimeConfig();
  resetStubReactiveStores();
  resetTestRenderScope();
  fetchSpy = vi.fn(async () => ({}));
  globalThis.$fetch = fetchSpy as unknown as typeof globalThis.$fetch;
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('useSystemSetup — HTTP-init status', () => {
  it('is undecided until the status was checked', async () => {
    const { httpInitEnabled, httpInitTokenRequired, needsSetup } = await loadComposable();

    expect(needsSetup.value).toBeNull();
    expect(httpInitEnabled.value).toBeNull();
    expect(httpInitTokenRequired.value).toBeNull();
  });

  it('reports a blocked HTTP init, so the setup page can show a notice instead of the form', async () => {
    respondWith({ betterAuthEnabled: true, httpInitEnabled: false, httpInitTokenRequired: false, needsSetup: true });
    const { checkSetupStatus, httpInitEnabled, httpInitTokenRequired, needsSetup } = await loadComposable();

    await expect(checkSetupStatus()).resolves.toBe(true);

    expect(needsSetup.value).toBe(true);
    expect(httpInitEnabled.value).toBe(false);
    expect(httpInitTokenRequired.value).toBe(false);
  });

  it('reports a released HTTP init that demands a token', async () => {
    respondWith({ betterAuthEnabled: true, httpInitEnabled: true, httpInitTokenRequired: true, needsSetup: true });
    const { checkSetupStatus, httpInitEnabled, httpInitTokenRequired } = await loadComposable();

    await checkSetupStatus();

    expect(httpInitEnabled.value).toBe(true);
    expect(httpInitTokenRequired.value).toBe(true);
  });

  it('treats an API before 12.4.0, which sends neither field, as released without a token', async () => {
    respondWith({ betterAuthEnabled: true, needsSetup: true });
    const { checkSetupStatus, httpInitEnabled, httpInitTokenRequired } = await loadComposable();

    await checkSetupStatus();

    expect(httpInitEnabled.value).toBe(true);
    expect(httpInitTokenRequired.value).toBe(false);
  });

  it('counts only a real boolean, so a malformed value falls back like a missing field', async () => {
    respondWith({ httpInitEnabled: 'false', httpInitTokenRequired: 'true', needsSetup: true });
    const { checkSetupStatus, httpInitEnabled, httpInitTokenRequired } = await loadComposable();

    await checkSetupStatus();

    expect(httpInitEnabled.value).toBe(true);
    expect(httpInitTokenRequired.value).toBe(false);
  });

  it('shares the status between calls, like needsSetup', async () => {
    respondWith({ httpInitEnabled: false, httpInitTokenRequired: false, needsSetup: true });
    const first = await loadComposable();
    await first.checkSetupStatus();

    const second = await loadComposable();

    expect(second.httpInitEnabled.value).toBe(false);
  });

  it('keeps the old fallback when the status endpoint fails: no setup flow', async () => {
    fetchSpy.mockImplementation(async () => {
      throw new Error('404 Not Found');
    });
    const { checkSetupStatus, needsSetup } = await loadComposable();

    await expect(checkSetupStatus()).resolves.toBe(false);

    expect(needsSetup.value).toBe(false);
  });
});

describe('useSystemSetup — initSetup', () => {
  const params = { email: 'admin@test.com', name: 'Admin', password: 'Secret123!' };

  async function sha256(value: string): Promise<string> {
    const { ltSha256 } = await import('../src/runtime/utils/crypto');
    return ltSha256(value);
  }

  it('sends no token header when no token is given, so a local setup stays as simple as before', async () => {
    const { initSetup } = await loadComposable();

    await initSetup(params);

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, options] = fetchSpy.mock.calls[0]!;
    expect(url).toBe('/system-setup/init');
    expect(options).toEqual({
      body: { email: params.email, name: params.name, password: await sha256(params.password) },
      method: 'POST',
    });
  });

  it('sends the token as X-System-Setup-Token, unhashed and never in the body', async () => {
    const { initSetup } = await loadComposable();
    const token = 'a-setup-token-of-32-characters!!';

    await initSetup({ ...params, token });

    const [, options] = fetchSpy.mock.calls[0]!;
    expect(options.headers).toEqual({ 'X-System-Setup-Token': token });
    expect(options.body).toEqual({ email: params.email, name: params.name, password: await sha256(params.password) });
    expect(JSON.stringify(options.body)).not.toContain(token);
  });

  it('drops whitespace around the token, which an HTTP header cannot carry (a pasted line break would abort the request)', async () => {
    const { initSetup } = await loadComposable();

    await initSetup({ ...params, token: '  a-setup-token-of-32-characters!!\n' });

    expect(fetchSpy.mock.calls[0]![1].headers).toEqual({ 'X-System-Setup-Token': 'a-setup-token-of-32-characters!!' });
  });

  it('sends no header for a blank token', async () => {
    const { initSetup } = await loadComposable();

    await initSetup({ ...params, token: ' \n ' });

    expect(fetchSpy.mock.calls[0]![1]).not.toHaveProperty('headers');
  });

  it('marks the setup as done after a successful init', async () => {
    respondWith({ httpInitEnabled: true, httpInitTokenRequired: false, needsSetup: true });
    const { checkSetupStatus, initSetup, needsSetup } = await loadComposable();
    await checkSetupStatus();

    respondWith({ success: true });
    await initSetup(params);

    expect(needsSetup.value).toBe(false);
  });

  it('passes a refusal through unchanged, so its #LTNS_ code reaches the error translation', async () => {
    respondWith({ httpInitEnabled: true, httpInitTokenRequired: true, needsSetup: true });
    const { checkSetupStatus, initSetup, needsSetup } = await loadComposable();
    await checkSetupStatus();

    const refusal = Object.assign(new Error('[POST] "/system-setup/init": 403 Forbidden'), {
      data: { message: '#LTNS_0054: Invalid system setup token', statusCode: 403 },
      statusCode: 403,
    });
    fetchSpy.mockImplementation(async (url: string) => {
      if (url === '/system-setup/init') throw refusal;
      return { httpInitEnabled: true, httpInitTokenRequired: true, needsSetup: true };
    });

    await expect(initSetup({ ...params, token: 'wrong-token-but-16-chars' })).rejects.toBe(refusal);
    expect(needsSetup.value).toBe(true);
  });

  it('re-reads the status after a 403, so page and middleware see an API restarted with a new configuration', async () => {
    respondWith({ httpInitEnabled: true, httpInitTokenRequired: false, needsSetup: true });
    const { checkSetupStatus, httpInitEnabled, httpInitTokenRequired, initSetup } = await loadComposable();
    await checkSetupStatus();

    // The API now demands a token it did not demand when the page loaded.
    const refusal = Object.assign(new Error('[POST] "/system-setup/init": 403 Forbidden'), {
      data: { message: '#LTNS_0054: Invalid system setup token', statusCode: 403 },
      statusCode: 403,
    });
    fetchSpy.mockImplementation(async (url: string) => {
      if (url === '/system-setup/init') throw refusal;
      return { httpInitEnabled: true, httpInitTokenRequired: true, needsSetup: true };
    });

    await expect(initSetup(params)).rejects.toBe(refusal);

    expect(fetchSpy).toHaveBeenLastCalledWith('/system-setup/status');
    expect(httpInitEnabled.value).toBe(true);
    expect(httpInitTokenRequired.value).toBe(true);
  });

  it('switches to the notice when the API closed the HTTP setup since the page loaded (LTNS_0053)', async () => {
    respondWith({ httpInitEnabled: true, httpInitTokenRequired: false, needsSetup: true });
    const { checkSetupStatus, httpInitEnabled, initSetup } = await loadComposable();
    await checkSetupStatus();

    const refusal = Object.assign(new Error('[POST] "/system-setup/init": 403 Forbidden'), {
      data: { message: '#LTNS_0053: System setup via HTTP is disabled', statusCode: 403 },
      statusCode: 403,
    });
    fetchSpy.mockImplementation(async (url: string) => {
      if (url === '/system-setup/init') throw refusal;
      return { httpInitEnabled: false, httpInitTokenRequired: false, needsSetup: true };
    });

    await expect(initSetup(params)).rejects.toBe(refusal);

    expect(httpInitEnabled.value).toBe(false);
  });

  it('does not re-read the status after an error that is not a refusal', async () => {
    const { initSetup } = await loadComposable();
    fetchSpy.mockImplementation(async () => {
      throw new TypeError('Failed to fetch');
    });

    await expect(initSetup(params)).rejects.toThrow('Failed to fetch');

    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('rethrows the refusal even when re-reading the status fails too', async () => {
    const { initSetup, needsSetup } = await loadComposable();
    const refusal = Object.assign(new Error('403 Forbidden'), { statusCode: 403 });
    fetchSpy.mockImplementation(async (url: string) => {
      if (url === '/system-setup/init') throw refusal;
      throw new TypeError('Failed to fetch');
    });

    await expect(initSetup(params)).rejects.toBe(refusal);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    // The failed re-read keeps the existing fallback of checkSetupStatus().
    expect(needsSetup.value).toBe(false);
  });
});
