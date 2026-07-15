/**
 * `isAdmin` must recognise BOTH user shapes.
 *
 * Bug this guards against — the admin UI silently disappearing:
 *   `isAdmin` used to be `user.value?.role === 'admin'`, i.e. Better-Auth's
 *   admin-plugin shape (a singular `role` string) only. `@lenne.tech/nest-server`
 *   registers `roles` as a CORE Better-Auth additionalField (`type: 'string[]'`),
 *   so its users carry `roles: ['admin']` and NO singular `role` at all. Against a
 *   real nest-server backend `isAdmin` was therefore permanently `false`, and every
 *   `v-if="isAdmin"` branch (admin nav, admin pages) vanished for actual admins —
 *   with no error anywhere, because `undefined === 'admin'` is simply false.
 *
 * Both shapes are now accepted, and neither may leak into the other's result.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { clearAllCookies } from './stubs/cookies';
import { resetStubReactiveStores, resetStubRequestHeaders, resetStubRuntimeConfig, setStubRequestHeaders } from './stubs/imports';
import { resetTestRenderScope, setTestRenderScope } from './stubs/render-scope';
import { malformedUser } from './stubs/users';

// Stub the Better-Auth client so `useLtAuth()` can be instantiated without the
// real client + its peer-deps. Only the surface the composable touches exists.
vi.mock('../src/runtime/composables/use-lt-auth-client', () => ({
  useLtAuthClient: () => ({
    changePassword: () => {},
    passkey: {},
    signIn: { email: async () => ({}) },
    signOut: async () => ({}),
    signUp: { email: async () => ({}) },
    twoFactor: {},
    useSession: () => ({ value: { data: null, isPending: false } }),
  }),
}));

beforeEach(() => {
  resetStubRuntimeConfig();
  resetStubReactiveStores();
  resetStubRequestHeaders();
  resetTestRenderScope();
  clearAllCookies();
});

afterEach(() => {
  clearAllCookies();
  resetStubRuntimeConfig();
  resetStubReactiveStores();
  resetStubRequestHeaders();
  resetTestRenderScope();
});

describe('isAdmin — multi-role shape (nest-server: roles: string[])', () => {
  it('is true for `roles: ["admin"]` WITHOUT a singular `role` (the nest-server user)', async () => {
    const { useLtAuth } = await import('../src/runtime/composables/auth/use-lt-auth');
    const auth = useLtAuth();

    // Exactly what a real nest-server / Better-Auth get-session returns: no `role`.
    auth.setUser({ id: 'u1', email: 'admin@example.com', roles: ['admin'] });

    expect(auth.isAdmin.value).toBe(true);
  });

  it('is true when `admin` sits among several roles', async () => {
    const { useLtAuth } = await import('../src/runtime/composables/auth/use-lt-auth');
    const auth = useLtAuth();

    auth.setUser({ id: 'u1', email: 'a@example.com', roles: ['user', 'admin', 'editor'] });

    expect(auth.isAdmin.value).toBe(true);
  });

  it('is false for a non-admin roles array', async () => {
    const { useLtAuth } = await import('../src/runtime/composables/auth/use-lt-auth');
    const auth = useLtAuth();

    auth.setUser({ id: 'u1', email: 'user@example.com', roles: ['user'] });

    expect(auth.isAdmin.value).toBe(false);
  });

  it('is false for an empty roles array (nest-server defaultValue)', async () => {
    const { useLtAuth } = await import('../src/runtime/composables/auth/use-lt-auth');
    const auth = useLtAuth();

    auth.setUser({ id: 'u1', email: 'user@example.com', roles: [] });

    expect(auth.isAdmin.value).toBe(false);
  });
});

describe('isAdmin — single-role shape (Better-Auth admin plugin: role: string)', () => {
  it('is true for `role: "admin"` (unchanged upstream behaviour)', async () => {
    const { useLtAuth } = await import('../src/runtime/composables/auth/use-lt-auth');
    const auth = useLtAuth();

    auth.setUser({ id: 'u1', email: 'admin@example.com', role: 'admin' });

    expect(auth.isAdmin.value).toBe(true);
  });

  it('is false for a non-admin `role`', async () => {
    const { useLtAuth } = await import('../src/runtime/composables/auth/use-lt-auth');
    const auth = useLtAuth();

    auth.setUser({ id: 'u1', email: 'user@example.com', role: 'user' });

    expect(auth.isAdmin.value).toBe(false);
  });
});

describe('isAdmin — absent / malformed user', () => {
  it('is false when no user is set', async () => {
    const { useLtAuth } = await import('../src/runtime/composables/auth/use-lt-auth');
    const auth = useLtAuth();

    expect(auth.user.value).toBeNull();
    expect(auth.isAdmin.value).toBe(false);
  });

  it('is false when the user carries neither `role` nor `roles`', async () => {
    const { useLtAuth } = await import('../src/runtime/composables/auth/use-lt-auth');
    const auth = useLtAuth();

    auth.setUser({ id: 'u1', email: 'plain@example.com' });

    expect(auth.isAdmin.value).toBe(false);
  });

  it('is false (and does not throw) for a malformed non-array `roles`', async () => {
    const { useLtAuth } = await import('../src/runtime/composables/auth/use-lt-auth');
    const auth = useLtAuth();

    // The auth-state cookie is client-writable, so `roles` can arrive as junk.
    // The computed must degrade to `false`, never throw (`.includes` on a number).
    auth.setUser(malformedUser({ id: 'u1', email: 'evil@example.com', roles: 42 }));

    expect(() => auth.isAdmin.value).not.toThrow();
    expect(auth.isAdmin.value).toBe(false);
  });

  it('is false for a non-array `roles` STRING — even one that CONTAINS "admin" (the Array.isArray guard)', async () => {
    const { useLtAuth } = await import('../src/runtime/composables/auth/use-lt-auth');
    const auth = useLtAuth();

    // The sibling `roles: 42` case pins "does not throw". This one pins "does not
    // duck-type": a string carries its OWN `.includes`, which SUBSTRING-matches. A
    // guard written as `roles?.includes?.('admin')` — a plausible refactor that still
    // survives the `42` case — would return `true` here and hand the admin UI to a
    // `superadmin`. Only `Array.isArray` closes that door.
    auth.setUser(malformedUser({ id: 'u1', email: 'evil@example.com', roles: 'superadmin' }));

    expect(auth.isAdmin.value).toBe(false);
  });

  it('is false for a bare `roles` string equal to "admin" (the array shape is the contract)', async () => {
    const { useLtAuth } = await import('../src/runtime/composables/auth/use-lt-auth');
    const auth = useLtAuth();

    // `LtUser.roles` is `string[]`. A bare string is a malformed cookie, not a
    // shorthand — fail closed rather than guess what the writer meant.
    auth.setUser(malformedUser({ id: 'u1', email: 'evil@example.com', roles: 'admin' }));

    expect(auth.isAdmin.value).toBe(false);
  });

  it('is false for capitalised role names in either shape (matching is case-SENSITIVE)', async () => {
    const { useLtAuth } = await import('../src/runtime/composables/auth/use-lt-auth');
    const auth = useLtAuth();

    // nest-server's RoleEnum.ADMIN and Better-Auth's admin plugin both emit lowercase
    // `admin`, and nest-server's own hasRole() is case-sensitive. Pinning this keeps a
    // well-meant `.toLowerCase()` from widening who counts as an admin.
    auth.setUser({ id: 'u1', email: 'a@example.com', roles: ['Admin'] });
    expect(auth.isAdmin.value).toBe(false);

    auth.setUser({ id: 'u2', email: 'b@example.com', role: 'ADMIN' });
    expect(auth.isAdmin.value).toBe(false);
  });
});

describe('isAdmin — reactivity (computed cache invalidation)', () => {
  it('flips true → false when the user is downgraded at runtime', async () => {
    const { useLtAuth } = await import('../src/runtime/composables/auth/use-lt-auth');
    const auth = useLtAuth();

    auth.setUser({ id: 'u1', email: 'a@example.com', roles: ['admin'] });

    // This read is LOAD-BEARING, not a sanity check: a Vue `computed` is lazy, so
    // without it the assertion below would be the computed's FIRST evaluation and the
    // cache-invalidation path — the one thing a `computed` gets wrong — would stay
    // untested. A `setUser` that only wrote `document.cookie` (not a reactive source)
    // and skipped `authState.value` would freeze isAdmin here, and this is the only
    // test that would notice.
    expect(auth.isAdmin.value).toBe(true);

    auth.setUser({ id: 'u1', email: 'a@example.com', roles: ['user'] });

    expect(auth.isAdmin.value).toBe(false);
  });

  it('flips false → true when the user is promoted at runtime', async () => {
    const { useLtAuth } = await import('../src/runtime/composables/auth/use-lt-auth');
    const auth = useLtAuth();

    auth.setUser({ id: 'u1', email: 'a@example.com', roles: ['user'] });
    expect(auth.isAdmin.value).toBe(false);

    auth.setUser({ id: 'u1', email: 'a@example.com', roles: ['user', 'admin'] });

    expect(auth.isAdmin.value).toBe(true);
  });

  it('flips true → false on clearUser() (logout closes the admin UI)', async () => {
    const { useLtAuth } = await import('../src/runtime/composables/auth/use-lt-auth');
    const auth = useLtAuth();

    auth.setUser({ id: 'u1', email: 'a@example.com', roles: ['admin'] });
    expect(auth.isAdmin.value).toBe(true);

    auth.clearUser();

    expect(auth.user.value).toBeNull();
    expect(auth.isAdmin.value).toBe(false);
  });
});

describe('isAdmin — both shapes present (union semantics)', () => {
  it('is true when only `roles` grants admin, even though `role` says otherwise', async () => {
    const { useLtAuth } = await import('../src/runtime/composables/auth/use-lt-auth');
    const auth = useLtAuth();

    // Deliberate: admin if EITHER shape grants it. The shapes are owned by different
    // plugins, so neither is authoritative over the other — `isAdmin` is their union,
    // NOT a precedence chain (`roles ?? role`), which would silently flip this to
    // false. Pinned here so a refactor has to make that choice consciously.
    auth.setUser({ id: 'u1', email: 'a@example.com', role: 'user', roles: ['admin'] });

    expect(auth.isAdmin.value).toBe(true);
  });

  it('is true when only `role` grants admin, even though `roles` says otherwise', async () => {
    const { useLtAuth } = await import('../src/runtime/composables/auth/use-lt-auth');
    const auth = useLtAuth();

    auth.setUser({ id: 'u1', email: 'a@example.com', role: 'admin', roles: ['user'] });

    expect(auth.isAdmin.value).toBe(true);
  });

  it('is false when both shapes are present and neither grants admin', async () => {
    const { useLtAuth } = await import('../src/runtime/composables/auth/use-lt-auth');
    const auth = useLtAuth();

    auth.setUser({ id: 'u1', email: 'a@example.com', role: 'user', roles: ['editor'] });

    expect(auth.isAdmin.value).toBe(false);
  });
});

describe('isAdmin — SSR scope (resolved from the request Cookie header)', () => {
  it('is true during SSR for a nest-server admin carried in the request Cookie header', async () => {
    // On the server `resolvedAuthState` does NOT read `document.cookie` — it reads the
    // raw request Cookie header captured once at useLtAuth() call time (`ssrCookieHeader`).
    // That branch is where the bug is most visible: `v-if="isAdmin"` renders during SSR,
    // so a false `isAdmin` here means admin nav is missing from the server-rendered
    // first paint. Scope + header must both be set BEFORE useLtAuth() is instantiated.
    setTestRenderScope('server');
    setStubRequestHeaders({
      cookie: `lt-auth-state=${encodeURIComponent(
        JSON.stringify({ user: { id: 'u1', email: 'admin@example.com', roles: ['admin'] }, authMode: 'cookie' }),
      )}`,
    });

    const { useLtAuth } = await import('../src/runtime/composables/auth/use-lt-auth');
    const auth = useLtAuth();

    expect(auth.user.value).toMatchObject({ id: 'u1' });
    expect(auth.isAdmin.value).toBe(true);
  });

  it('is false during SSR for a non-admin roles array in the request Cookie header', async () => {
    setTestRenderScope('server');
    setStubRequestHeaders({
      cookie: `lt-auth-state=${encodeURIComponent(
        JSON.stringify({ user: { id: 'u1', email: 'user@example.com', roles: ['user'] }, authMode: 'cookie' }),
      )}`,
    });

    const { useLtAuth } = await import('../src/runtime/composables/auth/use-lt-auth');
    const auth = useLtAuth();

    expect(auth.isAdmin.value).toBe(false);
  });
});
