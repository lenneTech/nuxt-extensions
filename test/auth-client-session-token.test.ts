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

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const SESSION_TOKEN = 'XqvQpZ8R2b1sD4fG6hJ7kL9mN0pQrStU';
const JWT = 'eyJhbGciOiJFZERTQSJ9.eyJzdWIiOiJ1c2VyLTEifQ.c2lnbmF0dXJl';
const USER = { email: 'someone@test.com', id: 'user-1' };

const base = { disable: vi.fn(), enable: vi.fn(), verifyBackupCode: vi.fn(), verifyTotp: vi.fn() };
const changePassword = vi.fn();

vi.mock('better-auth/vue', () => ({
  createAuthClient: () => ({
    $Infer: {},
    $fetch: vi.fn(),
    $store: {},
    admin: {},
    changePassword,
    getSession: vi.fn(),
    passkey: {},
    requestPasswordReset: vi.fn(),
    resetPassword: vi.fn(),
    signIn: { email: vi.fn(), passkey: vi.fn() },
    signOut: vi.fn(),
    signUp: { email: vi.fn() },
    twoFactor: { generateBackupCodes: vi.fn(), ...base },
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
    changePassword.mockReset();
    const { createLtAuthClient } = await import('../src/runtime/lib/auth-client');
    client = createLtAuthClient({ baseURL: 'https://api.example.com' } as any);
  });

  afterEach(() => {
    document.cookie = 'lt-jwt-token=; path=/; max-age=0';
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

  it('changePassword removes the session token of the new session (revokeOtherSessions)', async () => {
    changePassword.mockResolvedValue({ data: { token: SESSION_TOKEN, user: USER }, error: null });

    const result = await client.changePassword({ currentPassword: 'old-secret', newPassword: 'new-secret', revokeOtherSessions: true });

    expect(result.data).toEqual({ user: USER });
  });
});

/**
 * nest-server (>= 12.11.0) in JWT mode answers both routes with the JWT of the session that is
 * valid after the answer. Turning 2FA on replaces the session, and the JWT stored before is
 * refused from then on (it carries the old session's `sid`). The starter turns 2FA on through
 * this client, not through `useLtAuth()`, so the client stores the new JWT itself; otherwise the
 * next request in JWT mode goes out with the refused one.
 */
describe('auth client — 2FA answers carrying a JWT', () => {
  const OLD_JWT = 'eyJhbGciOiJFZERTQSJ9.eyJzaWQiOiJvbGQifQ.b2xkLXNpZ25hdHVyZQ';
  const tokenCookie = (): null | string => {
    const row = document.cookie.split('; ').find((part) => part.startsWith('lt-jwt-token='));
    return row ? (JSON.parse(decodeURIComponent(row.slice('lt-jwt-token='.length))) as string) : null;
  };
  const authMode = (): string | undefined => {
    const row = document.cookie.split('; ').find((part) => part.startsWith('lt-auth-state='));
    return row ? (JSON.parse(decodeURIComponent(row.slice('lt-auth-state='.length))) as { authMode?: string }).authMode : undefined;
  };
  let client: any;

  beforeEach(async () => {
    base.verifyTotp.mockReset();
    base.verifyBackupCode.mockReset();
    base.disable.mockReset();
    base.enable.mockReset();
    changePassword.mockReset();
    for (const name of ['lt-jwt-token', 'lt-auth-state']) {
      document.cookie = `${name}=; path=/; max-age=0`;
    }
    document.cookie = `lt-jwt-token=${encodeURIComponent(JSON.stringify(OLD_JWT))}; path=/`;
    document.cookie = `lt-auth-state=${encodeURIComponent(JSON.stringify({ authMode: 'jwt', user: USER }))}; path=/`;
    const { createLtAuthClient } = await import('../src/runtime/lib/auth-client');
    client = createLtAuthClient({ baseURL: 'https://api.example.com' } as any);
  });

  it.each(['verifyTotp', 'verifyBackupCode'] as const)('%s stores the JWT of the answer in place of the refused one', async (method) => {
    base[method].mockResolvedValue({ data: { token: JWT, user: USER }, error: null });

    const result = await client.twoFactor[method]({ code: '123456' });

    expect(tokenCookie()).toBe(JWT);
    expect(authMode()).toBe('jwt');
    expect(result.data.token).toBe(JWT);
  });

  it('leaves the stored JWT alone when the answer carries a session token (cookie mode)', async () => {
    base.verifyTotp.mockResolvedValue({ data: { token: SESSION_TOKEN, user: USER }, error: null });

    await client.twoFactor.verifyTotp({ code: '123456' });

    expect(tokenCookie()).toBe(OLD_JWT);
  });

  it('leaves the stored JWT alone when the answer carries no token', async () => {
    base.verifyTotp.mockResolvedValue({ data: { user: USER }, error: null });

    await client.twoFactor.verifyTotp({ code: '123456' });

    expect(tokenCookie()).toBe(OLD_JWT);
  });

  it('stores nothing when the code is wrong', async () => {
    base.verifyTotp.mockResolvedValue({ data: null, error: { message: 'Invalid code', status: 401 } });

    await client.twoFactor.verifyTotp({ code: '000000' });

    expect(tokenCookie()).toBe(OLD_JWT);
  });

  it('changePassword with revokeOtherSessions stores the JWT of the new session', async () => {
    // Better-Auth deletes every session of the user and creates a new one; nest-server answers
    // `{ token: <JWT of the new session>, user }` where the body carries a token.
    changePassword.mockResolvedValue({ data: { token: JWT, user: USER }, error: null });

    const result = await client.changePassword({ currentPassword: 'old-secret', newPassword: 'new-secret', revokeOtherSessions: true });

    expect(tokenCookie()).toBe(JWT);
    expect(authMode()).toBe('jwt');
    expect(result.data.token).toBe(JWT);
  });

  it('changePassword without revokeOtherSessions leaves the stored JWT alone', async () => {
    changePassword.mockResolvedValue({ data: { token: null, user: USER }, error: null });

    await client.changePassword({ currentPassword: 'old-secret', newPassword: 'new-secret' });

    expect(tokenCookie()).toBe(OLD_JWT);
  });

  /**
   * `two-factor/disable` always replaces the session, `two-factor/enable` does with `method: 'otp'`
   * and with `skipVerificationOnEnable`. nest-server 12.11.0 answers them without a token, so the
   * stored JWT stays refused; from 12.11.1 on the answer carries the JWT of the new session.
   */
  it.each([
    ['disable', { status: true, token: JWT }],
    ['enable', { method: 'otp', token: JWT }],
    ['enable', { backupCodes: ['a1b2c3'], method: 'totp', token: JWT, totpURI: 'otpauth://totp/x' }],
  ] as const)('twoFactor.%s stores the JWT of the new session the answer carries', async (method, answer) => {
    base[method].mockResolvedValue({ data: { ...answer }, error: null });

    const result = await client.twoFactor[method]({ password: 'secret' });

    expect(tokenCookie()).toBe(JWT);
    expect(authMode()).toBe('jwt');
    expect(result.data.token).toBe(JWT);
  });

  it.each([
    ['disable', { status: true }],
    ['enable', { backupCodes: ['a1b2c3'], totpURI: 'otpauth://totp/x' }],
  ] as const)('twoFactor.%s without a token in the answer (nest-server 12.11.0) leaves the stored JWT alone', async (method, answer) => {
    base[method].mockResolvedValue({ data: { ...answer }, error: null });

    await client.twoFactor[method]({ password: 'secret' });

    expect(tokenCookie()).toBe(OLD_JWT);
  });

  it.each(['disable', 'enable'] as const)('twoFactor.%s removes a token that is not a JWT and stores nothing', async (method) => {
    base[method].mockResolvedValue({ data: { status: true, token: SESSION_TOKEN }, error: null });

    const result = await client.twoFactor[method]({ password: 'secret' });

    expect(result.data).toEqual({ status: true });
    expect(tokenCookie()).toBe(OLD_JWT);
  });

  it('keeps cookie mode a cookie mode: storing the JWT switches nothing', async () => {
    document.cookie = `lt-auth-state=${encodeURIComponent(JSON.stringify({ authMode: 'cookie', user: USER }))}; path=/`;
    base.verifyTotp.mockResolvedValue({ data: { token: JWT, user: USER }, error: null });

    await client.twoFactor.verifyTotp({ code: '123456' });

    expect(tokenCookie()).toBe(JWT);
    expect(authMode()).toBe('cookie');
  });
});
