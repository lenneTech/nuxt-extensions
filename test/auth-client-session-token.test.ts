/**
 * `useLtAuthClient().twoFactor.verifyTotp` / `verifyBackupCode` hand application code no session
 * token.
 *
 * Better-Auth answers both with `{ token, user }`, the token being its session token (the value
 * the API keeps in the httpOnly cookie); nest-server forwards these routes unchanged. A 2FA page
 * that took `result.data.token` for a JWT stored it in the readable `lt-jwt-token` cookie. With
 * the token removed, the same page takes its cookie-mode branch, and nothing readable holds it.
 * See `session-token-guard.test.ts` for the composable side.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const SESSION_TOKEN = 'XqvQpZ8R2b1sD4fG6hJ7kL9mN0pQrStU';
const JWT = 'eyJhbGciOiJFZERTQSJ9.eyJzdWIiOiJ1c2VyLTEifQ.c2lnbmF0dXJl';
const USER = { email: 'someone@test.com', id: 'user-1' };

const base = { verifyBackupCode: vi.fn(), verifyTotp: vi.fn() };

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
    signIn: { email: vi.fn(), passkey: vi.fn() },
    signOut: vi.fn(),
    signUp: { email: vi.fn() },
    twoFactor: { disable: vi.fn(), enable: vi.fn(), generateBackupCodes: vi.fn(), ...base },
  }),
}));

vi.mock('better-auth/client/plugins', () => ({
  adminClient: () => ({}),
  inferAdditionalFields: () => ({}),
  jwtClient: () => ({}),
  twoFactorClient: () => ({}),
}));

vi.mock('@better-auth/passkey/client', () => ({ passkeyClient: () => ({}) }));

describe('auth client — 2FA answers without the session token', () => {
  let client: any;

  beforeEach(async () => {
    base.verifyTotp.mockReset();
    base.verifyBackupCode.mockReset();
    const { createLtAuthClient } = await import('../src/runtime/lib/auth-client');
    client = createLtAuthClient({ baseURL: 'https://api.example.com' } as any);
  });

  it.each(['verifyTotp', 'verifyBackupCode'] as const)('%s removes the session token and keeps the user', async (method) => {
    base[method].mockResolvedValue({ data: { token: SESSION_TOKEN, user: USER }, error: null });

    const result = await client.twoFactor[method]({ code: '123456', trustDevice: true });

    expect(result.data).toEqual({ user: USER });
    expect(base[method]).toHaveBeenCalledWith({ code: '123456', trustDevice: true });
  });

  it('keeps a JWT a server put into the answer on purpose', async () => {
    base.verifyTotp.mockResolvedValue({ data: { token: JWT, user: USER }, error: null });

    expect((await client.twoFactor.verifyTotp({ code: '123456' })).data.token).toBe(JWT);
  });

  it('passes an error through unchanged', async () => {
    const error = { data: null, error: { message: 'Invalid code', status: 401 } };
    base.verifyTotp.mockResolvedValue(error);

    await expect(client.twoFactor.verifyTotp({ code: '000000' })).resolves.toBe(error);
  });
});
