/**
 * The global `lt-system-setup` middleware against the HTTP-init release of nest-server (>= 12.4.0).
 *
 * It redirects to the setup page while no admin exists — but only while the API accepts the setup
 * over HTTP. A deployment that creates its first admin from its configuration refuses
 * `POST /system-setup/init` with 403, so a forced redirect would hold every visitor on a page whose
 * only action fails, and the login would be unreachable. Without the HTTP init the middleware
 * therefore redirects nowhere; the setup page stays reachable and shows its notice there.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { resetStubReactiveStores, resetStubRuntimeConfig, setStubRuntimeConfig } from './stubs/imports';
import { resetTestRenderScope } from './stubs/render-scope';

type Middleware = (to: { path: string }) => Promise<unknown>;

let fetchSpy: ReturnType<typeof vi.fn>;

function statusResponse(body: Record<string, unknown>): void {
  fetchSpy.mockImplementation(async () => body);
}

async function runMiddleware(path: string): Promise<unknown> {
  const { default: middleware } = (await import('../src/runtime/middleware/setup')) as unknown as { default: Middleware };
  return middleware({ path });
}

beforeEach(() => {
  resetStubRuntimeConfig();
  resetStubReactiveStores();
  resetTestRenderScope();
  fetchSpy = vi.fn(async () => ({}));
  globalThis.$fetch = fetchSpy as unknown as typeof globalThis.$fetch;
});

describe('setup middleware — HTTP init released', () => {
  beforeEach(() => statusResponse({ httpInitEnabled: true, httpInitTokenRequired: false, needsSetup: true }));

  it('redirects to the setup page while no admin exists', async () => {
    await expect(runMiddleware('/')).resolves.toEqual({ navigateTo: '/auth/setup' });
  });

  it('stays on the setup page', async () => {
    await expect(runMiddleware('/auth/setup')).resolves.toBeUndefined();
  });

  it('honours a configured setup path', async () => {
    setStubRuntimeConfig({ public: { ltExtensions: { auth: { systemSetup: { setupPath: '/einrichtung' } } } } });

    await expect(runMiddleware('/')).resolves.toEqual({ navigateTo: '/einrichtung' });
  });
});

describe('setup middleware — HTTP init not released', () => {
  beforeEach(() => statusResponse({ httpInitEnabled: false, httpInitTokenRequired: false, needsSetup: true }));

  it('does not redirect, so every page stays reachable', async () => {
    await expect(runMiddleware('/')).resolves.toBeUndefined();
  });

  it('keeps the login reachable', async () => {
    await expect(runMiddleware('/auth/login')).resolves.toBeUndefined();
  });

  it('leaves the setup page reachable, where the notice is shown', async () => {
    await expect(runMiddleware('/auth/setup')).resolves.toBeUndefined();
  });

  it('never redirects, however often the route changes', async () => {
    for (const path of ['/', '/auth/login', '/auth/setup', '/', '/auth/setup']) {
      await expect(runMiddleware(path)).resolves.toBeUndefined();
    }
    // The status is read once and then shared.
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });
});

describe('setup middleware — unchanged paths', () => {
  it('redirects against an API before 12.4.0, which accepts the HTTP setup and reports no release', async () => {
    statusResponse({ betterAuthEnabled: true, needsSetup: true });

    await expect(runMiddleware('/')).resolves.toEqual({ navigateTo: '/auth/setup' });
  });

  it('sends the setup page to the login once an admin exists', async () => {
    statusResponse({ httpInitEnabled: false, httpInitTokenRequired: false, needsSetup: false });

    await expect(runMiddleware('/auth/setup')).resolves.toEqual({ navigateTo: '/auth/login' });
  });

  it('does not redirect an ordinary page once an admin exists', async () => {
    statusResponse({ httpInitEnabled: true, httpInitTokenRequired: false, needsSetup: false });

    await expect(runMiddleware('/')).resolves.toBeUndefined();
  });

  it('does not redirect when the status endpoint fails', async () => {
    fetchSpy.mockImplementation(async () => {
      throw new Error('500 Internal Server Error');
    });

    await expect(runMiddleware('/')).resolves.toBeUndefined();
  });
});
