/**
 * Regression: `validateSession()` must MERGE the Better-Auth session user onto
 * the cached user (id-guarded), not overwrite it.
 *
 * Bug this guards against — lost nest-server user fields on reload:
 *   Better-Auth's `get-session` returns only the fields Better-Auth owns
 *   (id / email / name + registered additionalFields), NOT nest-server-only user
 *   fields (e.g. custom preferences like `leadTableColumns`). The old code did
 *   `setUser(session.data.user)`, replacing the cached user wholesale, so every
 *   session re-validation (app init / hard reload) dropped those fields. The fix
 *   routes the session user through `mergeSessionUser()`, which merges onto the
 *   cached user of the SAME id and keeps the nest-server-only fields.
 *
 * `mergeSessionUser` is a private helper inside the composable, so the invariant
 * is exercised through the public `validateSession()` with a mocked
 * `authClient.useSession()` — the exact call site of the fix.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { nextTick, reactive } from 'vue';

import { resetStubReactiveStores, resetStubRuntimeConfig } from './stubs/imports';

/**
 * Mutable Better-Auth session, swapped per test. Shape mirrors what the
 * composable reads: `session.value.isPending` + `session.value.data?.user`.
 */
let mockSession: { data: { user: Record<string, unknown> } | null; isPending: boolean } = {
  data: null,
  isPending: false,
};

// Stub the Better-Auth client: only `useSession()` (feeds validateSession) plus
// the surface the composable's destructure / pass-through touches.
vi.mock('../src/runtime/composables/use-lt-auth-client', () => ({
  useLtAuthClient: () => ({
    changePassword: () => {},
    passkey: {},
    signIn: { email: async () => ({}) },
    signOut: async () => ({}),
    signUp: { email: async () => ({}) },
    twoFactor: {},
    useSession: () => ({ value: mockSession }),
  }),
}));

/** Read the live auth-state user straight out of `document.cookie`. */
function readUserFromCookie(): Record<string, unknown> | null {
  for (const part of document.cookie.split('; ')) {
    if (!part.startsWith('lt-auth-state=')) continue;
    try {
      const state = JSON.parse(decodeURIComponent(part.slice('lt-auth-state='.length)));
      if (state?.user) return state.user;
    } catch {
      // skip malformed
    }
  }
  return null;
}

function clearAllCookies(): void {
  for (const part of document.cookie.split(';')) {
    const name = part.split('=')[0]?.trim();
    if (name) {
      document.cookie = `${name}=; path=/; max-age=0`;
    }
  }
}

beforeEach(() => {
  resetStubRuntimeConfig();
  resetStubReactiveStores();
  clearAllCookies();
  mockSession = { data: null, isPending: false };
  // Neutralise the fire-and-forget switchToJwtMode() fetch inside validateSession —
  // keep it off the network and deterministic (ok: false → stays in cookie mode).
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ json: async () => ({}), ok: false }));
});

afterEach(() => {
  clearAllCookies();
  resetStubRuntimeConfig();
  resetStubReactiveStores();
  vi.unstubAllGlobals();
});

describe('validateSession() merges the session user (mergeSessionUser invariant)', () => {
  it('preserves nest-server-only fields when the cached user has the SAME id', async () => {
    const { useLtAuth } = await import('../src/runtime/composables/auth/use-lt-auth');
    const auth = useLtAuth();

    // Cached user: full nest-server user (Better-Auth fields + a nest-server-only field).
    auth.setUser({
      id: 'u1',
      email: 'old@example.com',
      name: 'Old Name',
      leadTableColumns: ['name', 'email', 'status'],
    } as never);

    // Better-Auth get-session returns ONLY Better-Auth fields (no leadTableColumns),
    // with updated email/name.
    mockSession = {
      data: { user: { id: 'u1', email: 'new@example.com', name: 'New Name' } },
      isPending: false,
    };

    const ok = await auth.validateSession();
    expect(ok).toBe(true);

    const user = auth.user.value as unknown as Record<string, unknown>;
    // nest-server-only field survives the merge …
    expect(user.leadTableColumns).toEqual(['name', 'email', 'status']);
    // … while Better-Auth fields are updated from the session.
    expect(user.id).toBe('u1');
    expect(user.email).toBe('new@example.com');
    expect(user.name).toBe('New Name');

    // The persisted cookie carries the merged shape too (what a reload would read).
    expect(readUserFromCookie()).toMatchObject({
      email: 'new@example.com',
      id: 'u1',
      leadTableColumns: ['name', 'email', 'status'],
    });
  });

  it('takes the session user verbatim when the cached user has a DIFFERENT id (no cross-user leak)', async () => {
    const { useLtAuth } = await import('../src/runtime/composables/auth/use-lt-auth');
    const auth = useLtAuth();

    // Cached user is a DIFFERENT identity carrying a private field.
    auth.setUser({
      id: 'u1',
      email: 'first@example.com',
      name: 'First User',
      leadTableColumns: ['secret-column'],
    } as never);

    // Session resolves a different user (e.g. account switch).
    mockSession = {
      data: { user: { id: 'u2', email: 'second@example.com', name: 'Second User' } },
      isPending: false,
    };

    const ok = await auth.validateSession();
    expect(ok).toBe(true);

    const user = auth.user.value as unknown as Record<string, unknown>;
    expect(user.id).toBe('u2');
    expect(user.email).toBe('second@example.com');
    // The other user's private field must NOT bleed onto the new identity.
    expect(user.leadTableColumns).toBeUndefined();
  });

  it('takes the session user verbatim when NO user is cached', async () => {
    const { useLtAuth } = await import('../src/runtime/composables/auth/use-lt-auth');
    const auth = useLtAuth();

    // No prior setUser() → nothing cached.
    mockSession = {
      data: { user: { id: 'u3', email: 'fresh@example.com', name: 'Fresh User' } },
      isPending: false,
    };

    const ok = await auth.validateSession();
    expect(ok).toBe(true);

    const user = auth.user.value as unknown as Record<string, unknown>;
    expect(user.id).toBe('u3');
    expect(user.email).toBe('fresh@example.com');
  });
});

describe('mergeSessionUser keeps authorization keys fail-closed (AUTHZ_KEYS)', () => {
  it('drops an authorization field the session omits (fail-closed) while keeping nest-server-only fields', async () => {
    const { useLtAuth } = await import('../src/runtime/composables/auth/use-lt-auth');
    const auth = useLtAuth();

    // Cached user carries an authz field (role) AND a nest-server-only field.
    auth.setUser({
      id: 'u1',
      email: 'a@example.com',
      role: 'admin',
      leadTableColumns: ['x'],
    } as never);

    // Backend downgraded the user: get-session no longer returns `role`.
    mockSession = { data: { user: { id: 'u1', email: 'a@example.com' } }, isPending: false };

    const ok = await auth.validateSession();
    expect(ok).toBe(true);

    const user = auth.user.value as unknown as Record<string, unknown>;
    // The stale authz field is dropped, not preserved (fail-closed) …
    expect(user.role).toBeUndefined();
    expect(auth.isAdmin.value).toBe(false);
    // … while a non-authz nest-server-only field still survives the merge.
    expect(user.leadTableColumns).toEqual(['x']);
  });

  it('lets the session overwrite an authorization field when it is present', async () => {
    const { useLtAuth } = await import('../src/runtime/composables/auth/use-lt-auth');
    const auth = useLtAuth();

    auth.setUser({ id: 'u1', email: 'a@example.com', role: 'admin' } as never);
    mockSession = {
      data: { user: { id: 'u1', email: 'a@example.com', role: 'user' } },
      isPending: false,
    };

    const ok = await auth.validateSession();
    expect(ok).toBe(true);

    const user = auth.user.value as unknown as Record<string, unknown>;
    expect(user.role).toBe('user');
    expect(auth.isAdmin.value).toBe(false);
  });
});

describe('mergeSessionUser id guard hardening (both ids absent)', () => {
  it('falls back to the session user verbatim when ids are absent on both sides (no id-less merge)', async () => {
    const { useLtAuth } = await import('../src/runtime/composables/auth/use-lt-auth');
    const auth = useLtAuth();

    // Malformed cached identity with NO id, carrying a private field.
    auth.setUser({ email: 'first@example.com', leadTableColumns: ['secret'] } as never);

    // Session user ALSO lacks an id (undefined === undefined must NOT merge).
    mockSession = { data: { user: { email: 'second@example.com' } }, isPending: false };

    const ok = await auth.validateSession();
    expect(ok).toBe(true);

    const user = auth.user.value as unknown as Record<string, unknown>;
    expect(user.email).toBe('second@example.com');
    // The id-less cached private field must NOT bleed onto the id-less session user.
    expect(user.leadTableColumns).toBeUndefined();
  });
});

describe('validateSession() pending + empty-session branches', () => {
  it('waits for a pending session, then merges once it resolves', async () => {
    const { useLtAuth } = await import('../src/runtime/composables/auth/use-lt-auth');
    const auth = useLtAuth();

    auth.setUser({
      id: 'u1',
      email: 'old@example.com',
      name: 'Old',
      leadTableColumns: ['a'],
    } as never);

    // Reactive session so the composable's `watch(() => session.value.isPending)`
    // in the wait branch actually fires when we flip isPending below.
    mockSession = reactive({
      data: { user: { id: 'u1', email: 'new@example.com', name: 'New' } },
      isPending: true,
    });

    const pending = auth.validateSession();
    await nextTick();
    (mockSession as { isPending: boolean }).isPending = false;

    const ok = await pending;
    expect(ok).toBe(true);

    const user = auth.user.value as unknown as Record<string, unknown>;
    expect(user.leadTableColumns).toEqual(['a']);
    expect(user.email).toBe('new@example.com');
  });

  it('returns true from the cached auth-state when the session carries no user', async () => {
    const { useLtAuth } = await import('../src/runtime/composables/auth/use-lt-auth');
    const auth = useLtAuth();

    auth.setUser({ id: 'u1', email: 'a@example.com', name: 'A' } as never);
    mockSession = { data: null, isPending: false };

    const ok = await auth.validateSession();
    expect(ok).toBe(true);
    expect((auth.user.value as unknown as Record<string, unknown>).id).toBe('u1');
  });

  it('returns false when the session carries no user and nothing is cached', async () => {
    const { useLtAuth } = await import('../src/runtime/composables/auth/use-lt-auth');
    const auth = useLtAuth();

    mockSession = { data: null, isPending: false };

    const ok = await auth.validateSession();
    expect(ok).toBe(false);
    expect(auth.user.value).toBeNull();
  });
});

describe('authenticateWithPasskey() routes the get-session fallback through mergeSessionUser (call site 2)', () => {
  it('preserves nest-server-only fields when passkey verify returns a session token without a user', async () => {
    const { useLtAuth } = await import('../src/runtime/composables/auth/use-lt-auth');
    const auth = useLtAuth();

    // Cached full nest-server user (SAME identity the get-session will resolve).
    auth.setUser({
      id: 'u1',
      email: 'old@example.com',
      name: 'Old',
      leadTableColumns: ['name', 'email'],
    } as never);

    // Stub the WebAuthn credential the browser would hand back.
    const fakeCredential = {
      id: 'cred-1',
      type: 'public-key',
      rawId: new ArrayBuffer(8),
      response: {
        authenticatorData: new ArrayBuffer(8),
        clientDataJSON: new ArrayBuffer(8),
        signature: new ArrayBuffer(8),
        userHandle: null,
      },
      getClientExtensionResults: () => ({}),
    };
    vi.stubGlobal('navigator', {
      credentials: { get: vi.fn().mockResolvedValue(fakeCredential) },
    });

    // Route each backend call the passkey flow makes.
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (url.includes('/passkey/generate-authenticate-options')) {
          return {
            ok: true,
            json: async () => ({
              challenge: 'AAAA',
              rpId: 'localhost',
              allowCredentials: [],
              userVerification: 'preferred',
              timeout: 60000,
              challengeId: 'ch-1',
            }),
          };
        }
        if (url.includes('/passkey/verify-authentication')) {
          // Session token WITHOUT a user → forces the get-session fallback (call site 2).
          return { ok: true, json: async () => ({ session: { token: 'tok-1' } }) };
        }
        if (url.includes('/get-session')) {
          // get-session returns ONLY Better-Auth fields (no leadTableColumns).
          return {
            ok: true,
            json: async () => ({ user: { id: 'u1', email: 'new@example.com', name: 'New' } }),
          };
        }
        // switchToJwtMode() /token and anything else: stay off the network.
        return { ok: false, json: async () => ({}) };
      }),
    );

    const result = await auth.authenticateWithPasskey();

    expect(result.success).toBe(true);
    // The RETURNED result.user carries the merged shape (guards the :554-556 wiring) …
    const returned = result.user as unknown as Record<string, unknown>;
    expect(returned.leadTableColumns).toEqual(['name', 'email']);
    expect(returned.email).toBe('new@example.com');
    // … and so does the persisted auth state a reload would read.
    const user = auth.user.value as unknown as Record<string, unknown>;
    expect(user.leadTableColumns).toEqual(['name', 'email']);
    expect(user.email).toBe('new@example.com');
  });
});
