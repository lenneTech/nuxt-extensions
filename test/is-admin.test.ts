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

import { resetStubReactiveStores, resetStubRuntimeConfig } from './stubs/imports';

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
});

afterEach(() => {
  clearAllCookies();
  resetStubRuntimeConfig();
  resetStubReactiveStores();
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
    auth.setUser({ id: 'u1', email: 'evil@example.com', roles: 42 } as never);

    expect(() => auth.isAdmin.value).not.toThrow();
    expect(auth.isAdmin.value).toBe(false);
  });
});
