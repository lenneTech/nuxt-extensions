/**
 * Backend calls during SSR are anonymous, by design (DEV-4077).
 *
 * The auth helpers are module singletons, and one Nitro process renders many users' requests, so
 * they may not carry a request's cookies: on the server `getLtAuthMode()` is `'cookie'`,
 * `getLtJwtToken()` is `null` and `isLtAuthenticated()` is `false`. `ltAuthFetch` therefore sends
 * no bearer during SSR and never tries a JWT switch there. The session cookie belongs to the API
 * host anyway (nest-server sets it host-only unless `crossSubDomainCookies` is configured), so the
 * app server does not even receive it. README, "Server-side rendering", says what to do instead.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { getLtAuthMode, getLtJwtToken, isLtAuthenticated, ltAuthFetch } from '../src/runtime/lib/auth-state';
import { clearAllCookies } from './stubs/cookies';
import { resetStubRuntimeConfig, setStubRuntimeConfig } from './stubs/imports';
import { resetTestRenderScope, setTestRenderScope } from './stubs/render-scope';

const JWT = 'eyJhbGciOiJFZERTQSJ9.eyJzdWIiOiJ1MSJ9.c2ln';

beforeEach(() => {
  resetStubRuntimeConfig();
  clearAllCookies();
  // A signed-in browser state, which the server must not pick up from a shared document
  document.cookie = `lt-auth-state=${encodeURIComponent(JSON.stringify({ authMode: 'jwt', user: { email: 'someone@test.com', id: 'u1' } }))}; path=/`;
  document.cookie = `lt-jwt-token=${encodeURIComponent(JSON.stringify(JWT))}; path=/`;
  setStubRuntimeConfig({ apiUrl: 'http://api.internal:3000', public: { apiUrl: 'https://api.example.com', ltExtensions: { auth: { basePath: '/iam' } } } });
  setTestRenderScope('server');
});

afterEach(() => {
  resetTestRenderScope();
  clearAllCookies();
  vi.unstubAllGlobals();
});

describe('SSR: backend calls are anonymous', () => {
  it('reports no session on the server, whatever a browser cookie says', () => {
    expect(getLtAuthMode()).toBe('cookie');
    expect(getLtJwtToken()).toBeNull();
    expect(isLtAuthenticated()).toBe(false);
  });

  it('ltAuthFetch sends no bearer and makes no JWT switch after a 401', async () => {
    const fetchMock = vi.fn(async (_input: unknown, _init?: RequestInit) => new Response('{}', { status: 401 }));
    vi.stubGlobal('fetch', fetchMock);

    const response = await ltAuthFetch('http://api.internal:3000/measures', { method: 'GET' });

    expect(response.status).toBe(401);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(new Headers(fetchMock.mock.calls[0]?.[1]?.headers).has('Authorization')).toBe(false);
  });
});
