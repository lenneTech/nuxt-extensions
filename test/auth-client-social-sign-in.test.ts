/**
 * `useLtAuthClient().signIn.social` reaches Better-Auth, and hands application code no session
 * token.
 *
 * Sign-in through a provider the API configured (`betterAuth.socialProviders` in nest-server) has
 * two shapes, both on `POST /iam/sign-in/social`:
 *
 * - Redirect: the answer is `{ url, redirect: true }`, and Better-Auth's client navigates to the
 *   provider. The session cookie is set by the API's callback, the browser comes back to
 *   `callbackURL` (or to `errorCallbackURL` with `?error=`).
 * - ID token: with `idToken` the answer is `{ token, user }` at once, no navigation. That is how
 *   an app embedded in a host that already knows the user (Microsoft Teams, a native shell) signs
 *   in. `token` is Better-Auth's session token, the value the API keeps in the httpOnly cookie.
 *
 * There is no password in either, so nothing is hashed: the caller's parameters go through as they
 * are, `additionalParams` included (`{ prompt: 'none' }` asks the provider for a silent sign-in).
 * The session token is removed like in the 2FA answers, see `auth-client-session-token.test.ts`.
 *
 * Until 4.0.3 the method was missing: the type promised it through a spread that copied nothing,
 * and then it was left out on purpose. A project that needed it called the route with `$fetch`.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const SESSION_TOKEN = 'XqvQpZ8R2b1sD4fG6hJ7kL9mN0pQrStU';
const JWT = 'eyJhbGciOiJFZERTQSJ9.eyJzdWIiOiJ1c2VyLTEifQ.c2lnbmF0dXJl';
const USER = { email: 'someone@test.com', id: 'user-1' };

const social = vi.fn();

vi.mock('better-auth/vue', () => ({
  createAuthClient: () => ({
    $Infer: {},
    $fetch: vi.fn(),
    $store: {},
    admin: {},
    changePassword: vi.fn(),
    getSession: vi.fn(),
    passkey: {},
    requestPasswordReset: vi.fn(),
    resetPassword: vi.fn(),
    signIn: { email: vi.fn(), passkey: vi.fn(), social },
    signOut: vi.fn(),
    signUp: { email: vi.fn() },
    twoFactor: { disable: vi.fn(), enable: vi.fn(), generateBackupCodes: vi.fn(), verifyBackupCode: vi.fn(), verifyTotp: vi.fn() },
  }),
}));

vi.mock('better-auth/client/plugins', () => ({
  adminClient: () => ({}),
  inferAdditionalFields: () => ({}),
  jwtClient: () => ({}),
  twoFactorClient: () => ({}),
}));

vi.mock('@better-auth/passkey/client', () => ({ passkeyClient: () => ({}) }));

describe('auth client — sign-in through a social provider', () => {
  let client: any;

  beforeEach(async () => {
    social.mockReset();
    const { createLtAuthClient } = await import('../src/runtime/lib/auth-client');
    client = createLtAuthClient({ baseURL: 'https://api.example.com' } as any);
  });

  it('hands the caller’s parameters and options to Better-Auth unchanged', async () => {
    social.mockResolvedValue({ data: { redirect: true, url: 'https://login.example.com/authorize' }, error: null });
    const params = {
      additionalParams: { prompt: 'none' },
      callbackURL: 'https://app.example.com/auth/callback',
      errorCallbackURL: 'https://app.example.com/auth/login',
      loginHint: 'someone@test.com',
      provider: 'microsoft',
    };
    const options = { onError: () => {} };

    const result = await client.signIn.social(params, options);

    expect(social).toHaveBeenCalledWith(params, options);
    expect(result.data).toEqual({ redirect: true, url: 'https://login.example.com/authorize' });
  });

  it('removes the session token from an ID-token sign-in and keeps the user', async () => {
    social.mockResolvedValue({ data: { redirect: false, token: SESSION_TOKEN, user: USER }, error: null });

    const result = await client.signIn.social({ idToken: { token: 'provider-id-token' }, provider: 'microsoft' });

    expect(result.data).toEqual({ redirect: false, user: USER });
  });

  it('keeps a JWT a server put into the answer on purpose', async () => {
    social.mockResolvedValue({ data: { redirect: false, token: JWT, user: USER }, error: null });

    expect((await client.signIn.social({ idToken: { token: 'provider-id-token' }, provider: 'microsoft' })).data.token).toBe(JWT);
  });

  it('passes an error through unchanged', async () => {
    const error = { data: null, error: { message: 'signup disabled', status: 401 } };
    social.mockResolvedValue(error);

    await expect(client.signIn.social({ idToken: { token: 'provider-id-token' }, provider: 'microsoft' })).resolves.toBe(error);
  });
});
