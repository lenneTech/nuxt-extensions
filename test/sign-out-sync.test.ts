/**
 * `useLtAuth().signOut()` and the local offline-sync data (DEV-3917, AC 3 and decision E3).
 *
 * With sync enabled, sign-out first sends what is unsent — for a bounded time, while the session
 * still exists — and after signing out deletes the whole local database (nest-server `SECURITY.md`:
 * records, cursors and unsent changes). Without sync, and on the server, it touches none of it.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useLtAuth } from '../src/runtime/composables/auth/use-lt-auth';
import { clearAllCookies } from './stubs/cookies';
import { resetStubReactiveStores, resetStubRuntimeConfig, setStubRuntimeConfig } from './stubs/imports';
import { resetTestRenderScope, setTestRenderScope } from './stubs/render-scope';

const calls: string[] = [];
const flush = vi.fn(async (_timeoutMs: number) => {
  calls.push('flush');
});
const deleteDb = vi.fn(async () => {
  calls.push('delete');
});

vi.mock('../src/runtime/lib/sync', () => ({ flushLtSyncBeforeSignOut: (timeoutMs: number) => flush(timeoutMs) }));
vi.mock('../src/runtime/lib/sync-store', () => ({ deleteLtSyncDatabase: () => deleteDb() }));
vi.mock('../src/runtime/composables/use-lt-auth-client', () => ({
  useLtAuthClient: () => ({
    changePassword: () => {},
    passkey: {},
    signIn: { email: async () => ({}) },
    signOut: async () => {
      calls.push('signOut');
      return {};
    },
    signUp: { email: async () => ({}) },
    twoFactor: {},
    useSession: () => ({ value: { data: null, isPending: false } }),
  }),
}));

const withSync = (enabled: boolean) => setStubRuntimeConfig({ public: { ltExtensions: { sync: { basePath: '/sync', enabled } } } });

beforeEach(() => {
  calls.length = 0;
  flush.mockClear();
  deleteDb.mockClear();
  resetStubRuntimeConfig();
  resetStubReactiveStores();
  clearAllCookies();
});

afterEach(() => {
  resetTestRenderScope();
  clearAllCookies();
});

describe('signOut and the offline-sync data', () => {
  it('sends what is unsent, signs out, then deletes the local data — in that order', async () => {
    withSync(true);
    await useLtAuth().signOut();

    // Sending needs the session, so it comes first; deleting comes after the user is signed out
    expect(calls).toEqual(['flush', 'signOut', 'delete']);
    expect(flush).toHaveBeenCalledWith(5000);
  });

  it('touches no sync data when the app did not enable sync', async () => {
    withSync(false);
    await useLtAuth().signOut();

    expect(calls).toEqual(['signOut']);
  });

  it('touches no sync data on the server', async () => {
    withSync(true);
    setTestRenderScope('server');
    await useLtAuth().signOut();

    expect(flush).not.toHaveBeenCalled();
    expect(deleteDb).not.toHaveBeenCalled();
  });

  it('completes the sign-out when deleting the local data fails, and says so', async () => {
    withSync(true);
    deleteDb.mockRejectedValueOnce(new Error('blocked'));
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    await expect(useLtAuth().signOut()).resolves.toEqual({});
    expect(logged).toHaveBeenCalledWith(expect.stringContaining('offline-sync data'), expect.any(Error));
    logged.mockRestore();
  });
});
