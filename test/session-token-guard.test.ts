/**
 * The Better-Auth session token never reaches the readable token cookie.
 *
 * The session token is what the API keeps in the httpOnly `iam.session_token` cookie. Better-Auth
 * also puts it into some response bodies: `verify-totp` / `verify-backup-code` answer
 * `{ token, user }` and `passkey/verify-authentication` answers `{ session, user }`, and
 * nest-server forwards those routes unchanged. A client that stored that value as its "JWT"
 * wrote it into `lt-jwt-token`, which any script on the page can read: one XSS and the session is
 * gone, for its whole lifetime. The starter's 2FA page did exactly that (measured in the Angular
 * port, the same flow), and `authenticateWithPasskey()` had the same branch.
 *
 * So `lt-jwt-token` holds a JWT or nothing. A JWT comes from `GET /iam/token`, or from a body the
 * server already converted (sign-in with `cookies: false`). The shape test is nest-server's
 * `isJwtShaped`: three segments, the header starting with `eyJ`.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { clearAllCookies, readCookieValue } from './stubs/cookies';
import { resetStubReactiveStores, resetStubRuntimeConfig, setStubRuntimeConfig, useCookie } from './stubs/imports';

/** An opaque Better-Auth session token, as `verify-totp` puts it into the body. */
const SESSION_TOKEN = 'XqvQpZ8R2b1sD4fG6hJ7kL9mN0pQrStU';
const JWT = 'eyJhbGciOiJFZERTQSJ9.eyJzdWIiOiJ1c2VyLTEifQ.c2lnbmF0dXJl';
const USER = { email: 'someone@test.com', id: 'user-1', name: 'Someone' };

const client = {
  signIn: { email: vi.fn() },
  signUp: { email: vi.fn() },
  twoFactor: { verifyBackupCode: vi.fn(), verifyTotp: vi.fn() },
};

vi.mock('../src/runtime/composables/use-lt-auth-client', () => ({
  useLtAuthClient: () => ({
    changePassword: () => {},
    passkey: {},
    signIn: client.signIn,
    signOut: async () => ({}),
    signUp: client.signUp,
    twoFactor: client.twoFactor,
    useSession: () => ({ value: { data: null, isPending: false } }),
  }),
}));

let fetchSpy: ReturnType<typeof vi.fn>;
let passkeyAnswer: Record<string, unknown>;
let tokenAnswer: Record<string, unknown>;

const tokenCookie = () => useCookie<string | null>('lt-jwt-token');
/** The stored auth mode. `switchToJwtMode()` writes it through `useCookie`, which in Nuxt reaches document.cookie; the stub does not. */
const storedMode = () => useCookie<{ authMode?: string }>('lt-auth-state').value?.authMode;
const tokenRequests = () => fetchSpy.mock.calls.filter(([url]) => new URL(String(url)).pathname === '/iam/token');

beforeEach(() => {
  resetStubRuntimeConfig();
  resetStubReactiveStores();
  clearAllCookies();
  setStubRuntimeConfig({ public: { apiUrl: 'https://api.example.com', ltExtensions: { auth: { basePath: '/iam' } } } });
  passkeyAnswer = { session: { token: SESSION_TOKEN }, user: USER };
  tokenAnswer = { token: JWT };
  fetchSpy = vi.fn(async (url: string) => {
    const path = new URL(url).pathname;
    const body =
      path === '/iam/token'
        ? tokenAnswer
        : path === '/iam/get-session'
          ? { session: { id: 's-1', token: SESSION_TOKEN }, user: USER }
          : path === '/iam/passkey/generate-authenticate-options'
            ? { allowCredentials: [], challenge: 'Y2hhbGxlbmdl', challengeId: 'c-1', rpId: 'example.com', timeout: 60000, userVerification: 'preferred' }
            : passkeyAnswer;
    return { json: async () => body, ok: true, status: 200 };
  });
  globalThis.fetch = fetchSpy as unknown as typeof globalThis.fetch;
  const buffer = new Uint8Array([1, 2, 3]).buffer;
  Object.defineProperty(navigator, 'credentials', {
    configurable: true,
    value: {
      get: vi.fn(async () => ({
        getClientExtensionResults: () => ({}),
        id: 'cred-1',
        rawId: buffer,
        response: { authenticatorData: buffer, clientDataJSON: buffer, signature: buffer, userHandle: null },
        type: 'public-key',
      })),
    },
  });
  for (const fn of [client.signIn.email, client.signUp.email, client.twoFactor.verifyTotp, client.twoFactor.verifyBackupCode]) fn.mockReset();
});

afterEach(() => {
  clearAllCookies();
  vi.restoreAllMocks();
});

async function auth() {
  const { useLtAuth } = await import('../src/runtime/composables/auth/use-lt-auth');
  return useLtAuth();
}

describe('useLtAuth().twoFactor — completing a sign-in at the second factor', () => {
  it.each(['verifyTotp', 'verifyBackupCode'] as const)('%s keeps the session token out of lt-jwt-token and fetches the JWT from /iam/token', async (method) => {
    client.twoFactor[method].mockResolvedValue({ data: { token: SESSION_TOKEN, user: USER }, error: null });
    const lt = await auth();

    await lt.twoFactor[method]({ code: '123456' });

    expect(tokenCookie().value).toBe(JWT);
    expect(storedMode()).toBe('jwt');
    expect(lt.user.value?.id).toBe('user-1');
    expect(tokenRequests()).toHaveLength(1);
  });

  it('stays on the cookie session when /iam/token gives no JWT, and still stores nothing readable', async () => {
    client.twoFactor.verifyTotp.mockResolvedValue({ data: { token: SESSION_TOKEN, user: USER }, error: null });
    tokenAnswer = { token: SESSION_TOKEN };
    const lt = await auth();

    await lt.twoFactor.verifyTotp({ code: '123456' });

    expect(tokenCookie().value).toBeNull();
    expect(lt.authMode.value).toBe('cookie');
    expect(lt.user.value?.id).toBe('user-1');
  });

  it('takes a JWT the server already put into the body (JWT mode) as it is', async () => {
    client.twoFactor.verifyTotp.mockResolvedValue({ data: { token: JWT, user: USER }, error: null });
    const lt = await auth();

    await lt.twoFactor.verifyTotp({ code: '123456' });

    expect(tokenCookie().value).toBe(JWT);
    expect(lt.authMode.value).toBe('jwt');
    expect(tokenRequests()).toHaveLength(0);
  });

  it('sets nothing when the code is wrong', async () => {
    client.twoFactor.verifyTotp.mockResolvedValue({ data: null, error: { message: 'Invalid code', status: 401 } });
    const lt = await auth();

    const result = await lt.twoFactor.verifyTotp({ code: '000000' });

    expect(result).toMatchObject({ error: { status: 401 } });
    expect(lt.user.value).toBeNull();
    expect(tokenCookie().value).toBeNull();
  });
});

describe('useLtAuth().jwtToken — a JWT or nothing', () => {
  it('refuses a session token', async () => {
    const lt = await auth();

    lt.jwtToken.value = SESSION_TOKEN;

    expect(tokenCookie().value).toBeNull();
    expect(lt.jwtToken.value).toBeNull();
  });

  it('keeps a JWT', async () => {
    const lt = await auth();

    lt.jwtToken.value = JWT;

    expect(tokenCookie().value).toBe(JWT);
  });

  it('turns a hand-written 2FA page that stores the body token into a cookie sign-in with a real JWT', async () => {
    // The starter's 2fa.vue up to 2.38.1: `jwtToken.value = result.data.token; setUser(user, 'jwt')`.
    const lt = await auth();

    lt.jwtToken.value = SESSION_TOKEN;
    lt.setUser(USER, 'jwt');
    await vi.waitFor(() => expect(storedMode()).toBe('jwt'));

    expect(tokenCookie().value).toBe(JWT);
    expect(tokenRequests()).toHaveLength(1);
  });

  it('never marks a sign-in as JWT mode without a JWT to send', async () => {
    tokenAnswer = {};
    const lt = await auth();

    lt.setUser(USER, 'jwt');

    expect(lt.authMode.value).toBe('cookie');
  });

  it('drops a session token an earlier version left in lt-jwt-token, and the JWT mode that came with it', async () => {
    tokenCookie().value = SESSION_TOKEN;
    document.cookie = `lt-auth-state=${encodeURIComponent(JSON.stringify({ authMode: 'jwt', user: USER }))}; path=/`;

    const lt = await auth();

    expect(tokenCookie().value).toBeNull();
    expect(lt.authMode.value).toBe('cookie');
  });
});

describe('useLtAuth().signIn / signUp — only a JWT from the body', () => {
  it.each(['signIn', 'signUp'] as const)('%s.email treats a session token in the body as a cookie sign-in', async (flow) => {
    client[flow].email.mockResolvedValue({ data: { token: SESSION_TOKEN, user: USER }, error: null });
    const lt = await auth();

    await (lt[flow].email as (params: unknown) => Promise<unknown>)({ email: USER.email, name: USER.name, password: 'Secret123!' });

    expect(tokenCookie().value).not.toBe(SESSION_TOKEN);
    expect(lt.user.value?.id).toBe('user-1');
  });

  it('signIn.email keeps the JWT a server with `cookies: false` puts into the body', async () => {
    client.signIn.email.mockResolvedValue({ data: { token: JWT, user: USER }, error: null });
    const lt = await auth();

    await lt.signIn.email({ email: USER.email, password: 'Secret123!' });

    expect(tokenCookie().value).toBe(JWT);
    expect(lt.authMode.value).toBe('jwt');
  });
});

describe('useLtAuth().authenticateWithPasskey — the session in the body stays there', () => {
  it('stores no session token when the answer carries no user, and reads the user through the cookie session', async () => {
    passkeyAnswer = { session: { token: SESSION_TOKEN } };
    const lt = await auth();

    const result = await lt.authenticateWithPasskey();

    expect(result.success).toBe(true);
    expect(result.user?.id).toBe('user-1');
    expect(tokenCookie().value).not.toBe(SESSION_TOKEN);
    expect(JSON.stringify(result)).not.toContain(SESSION_TOKEN);
  });

  it('hands the caller no session token when the answer carries a user', async () => {
    const lt = await auth();

    const result = await lt.authenticateWithPasskey();

    expect(result.user?.id).toBe('user-1');
    expect(JSON.stringify(result)).not.toContain(SESSION_TOKEN);
    expect(tokenCookie().value).not.toBe(SESSION_TOKEN);
  });
});

describe('/lib token helpers', () => {
  it('getLtJwtToken() drops a session token found in lt-jwt-token', async () => {
    const { getLtJwtToken } = await import('../src/runtime/lib/auth-state');
    document.cookie = `lt-jwt-token=${encodeURIComponent(JSON.stringify(SESSION_TOKEN))}; path=/`;

    expect(getLtJwtToken()).toBeNull();
    expect(readCookieValue('lt-jwt-token') ?? '').toBe('');
  });

  it('getLtJwtToken() returns a JWT', async () => {
    const { getLtJwtToken } = await import('../src/runtime/lib/auth-state');
    document.cookie = `lt-jwt-token=${encodeURIComponent(JSON.stringify(JWT))}; path=/`;

    expect(getLtJwtToken()).toBe(JWT);
  });

  it('setLtJwtToken() refuses a session token', async () => {
    const { setLtJwtToken } = await import('../src/runtime/lib/auth-state');

    setLtJwtToken(SESSION_TOKEN);

    expect(readCookieValue('lt-jwt-token') ?? '').not.toContain(SESSION_TOKEN.slice(0, 10));
  });

  it('attemptLtJwtSwitch() does not switch on something that is not a JWT', async () => {
    const { attemptLtJwtSwitch } = await import('../src/runtime/lib/auth-state');
    tokenAnswer = { token: SESSION_TOKEN };

    await expect(attemptLtJwtSwitch('/iam')).resolves.toBe(false);
    expect(readCookieValue('lt-jwt-token') ?? '').toBe('');
  });

  it('isLtJwtShaped() is nest-server’s isJwtShaped', async () => {
    const { isLtJwtShaped } = await import('../src/runtime/lib/auth-state');

    expect(isLtJwtShaped(JWT)).toBe(true);
    expect(isLtJwtShaped(SESSION_TOKEN)).toBe(false);
    expect(isLtJwtShaped('eyJ.only-two')).toBe(false);
    expect(isLtJwtShaped('abc.def.ghi')).toBe(false);
    expect(isLtJwtShaped(null)).toBe(false);
  });
});
