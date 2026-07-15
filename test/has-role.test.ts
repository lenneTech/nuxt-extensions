/**
 * `hasRole` / `hasAnyRole` — the guarded role checks the library publishes so
 * consumers never hand-roll the unguarded `user.value?.roles?.includes(x)`.
 *
 * Same union semantics and `Array.isArray` guard as `isAdmin`, which is now just
 * `hasRole('admin')` — so these tests also pin that the guard (no throw, no
 * substring fail-open, case-sensitive) holds for arbitrary roles, not only 'admin'.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { clearAllCookies } from './stubs/cookies';
import { resetStubReactiveStores, resetStubRuntimeConfig } from './stubs/imports';
import { malformedUser } from './stubs/users';

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
  clearAllCookies();
});

afterEach(() => {
  clearAllCookies();
  resetStubRuntimeConfig();
  resetStubReactiveStores();
});

describe('hasRole — both user shapes', () => {
  it('matches a role in the nest-server `roles` array', async () => {
    const { useLtAuth } = await import('../src/runtime/composables/auth/use-lt-auth');
    const auth = useLtAuth();

    auth.setUser({ id: 'u1', email: 'a@example.com', roles: ['user', 'editor'] });

    expect(auth.hasRole('editor')).toBe(true);
    expect(auth.hasRole('user')).toBe(true);
    expect(auth.hasRole('admin')).toBe(false);
  });

  it('matches the Better-Auth singular `role`', async () => {
    const { useLtAuth } = await import('../src/runtime/composables/auth/use-lt-auth');
    const auth = useLtAuth();

    auth.setUser({ id: 'u1', email: 'a@example.com', role: 'editor' });

    expect(auth.hasRole('editor')).toBe(true);
    expect(auth.hasRole('admin')).toBe(false);
  });

  it('is false when no user is set', async () => {
    const { useLtAuth } = await import('../src/runtime/composables/auth/use-lt-auth');
    const auth = useLtAuth();

    expect(auth.hasRole('admin')).toBe(false);
  });
});

describe('hasRole — guard (no throw, no fail-open, case-sensitive)', () => {
  it('does NOT fail open on a malformed string `roles` that contains the wanted role', async () => {
    const { useLtAuth } = await import('../src/runtime/composables/auth/use-lt-auth');
    const auth = useLtAuth();

    // Without `Array.isArray`, `String.prototype.includes('admin')` on the string
    // `'superadmin'` would be `true` — the exact substring-confusion the guard closes.
    auth.setUser(malformedUser({ id: 'u1', email: 'evil@example.com', roles: 'superadmin' }));

    expect(auth.hasRole('admin')).toBe(false);
  });

  it('does not throw on a non-array `roles`', async () => {
    const { useLtAuth } = await import('../src/runtime/composables/auth/use-lt-auth');
    const auth = useLtAuth();

    auth.setUser(malformedUser({ id: 'u1', email: 'evil@example.com', roles: 42 }));

    expect(() => auth.hasRole('admin')).not.toThrow();
    expect(auth.hasRole('admin')).toBe(false);
  });

  it('matches case-sensitively', async () => {
    const { useLtAuth } = await import('../src/runtime/composables/auth/use-lt-auth');
    const auth = useLtAuth();

    auth.setUser({ id: 'u1', email: 'a@example.com', roles: ['Editor'] });

    expect(auth.hasRole('editor')).toBe(false);
    expect(auth.hasRole('Editor')).toBe(true);
  });
});

describe('hasAnyRole — union of the given roles', () => {
  it('is true when the user has ANY of the given roles', async () => {
    const { useLtAuth } = await import('../src/runtime/composables/auth/use-lt-auth');
    const auth = useLtAuth();

    auth.setUser({ id: 'u1', email: 'a@example.com', roles: ['editor'] });

    expect(auth.hasAnyRole('admin', 'editor')).toBe(true);
  });

  it('is false when the user has NONE of the given roles', async () => {
    const { useLtAuth } = await import('../src/runtime/composables/auth/use-lt-auth');
    const auth = useLtAuth();

    auth.setUser({ id: 'u1', email: 'a@example.com', roles: ['user'] });

    expect(auth.hasAnyRole('admin', 'editor')).toBe(false);
  });

  it('is false for no arguments (empty union)', async () => {
    const { useLtAuth } = await import('../src/runtime/composables/auth/use-lt-auth');
    const auth = useLtAuth();

    auth.setUser({ id: 'u1', email: 'a@example.com', roles: ['admin'] });

    expect(auth.hasAnyRole()).toBe(false);
  });

  it('spans BOTH shapes (`role` and `roles`) in one check', async () => {
    const { useLtAuth } = await import('../src/runtime/composables/auth/use-lt-auth');
    const auth = useLtAuth();

    auth.setUser({ id: 'u1', email: 'a@example.com', role: 'support', roles: ['editor'] });

    expect(auth.hasAnyRole('support')).toBe(true);
    expect(auth.hasAnyRole('editor')).toBe(true);
    expect(auth.hasAnyRole('admin')).toBe(false);
  });
});

describe('isAdmin is exactly hasRole("admin")', () => {
  it('agrees with hasRole for the admin role', async () => {
    const { useLtAuth } = await import('../src/runtime/composables/auth/use-lt-auth');
    const auth = useLtAuth();

    auth.setUser({ id: 'u1', email: 'a@example.com', roles: ['admin'] });

    expect(auth.isAdmin.value).toBe(auth.hasRole('admin'));
    expect(auth.isAdmin.value).toBe(true);
  });
});
