/**
 * `auth.enableAdmin` is off by default (DEV-4076).
 *
 * `@lenne.tech/nest-server` does not register Better-Auth's `admin()` plugin, so every `admin.*`
 * route answers 404, and `admin.createUser` / `admin.setUserPassword` are the only methods this
 * library passes through UNHASHED (CLAUDE.md, "admin.* is passed through UNHASHED"). With the
 * default on, that trap was armed in every project. The default is now `false`; a project whose
 * backend serves the admin routes switches it on, and a warning says when the backend's
 * `/iam/features` reports no admin plugin.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { resetLtWarnOnceState, warnLtAdminPluginUnserved } from '../src/runtime/lib/auth-state';
import { resetStubRuntimeConfig, setStubRuntimeConfig } from './stubs/imports';

const registered: Array<{ id: string }[]> = [];

vi.mock('better-auth/vue', () => ({
  createAuthClient: (options: { plugins: { id: string }[] }) => {
    registered.push(options.plugins);
    return {
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
      twoFactor: { disable: vi.fn(), enable: vi.fn(), generateBackupCodes: vi.fn(), verifyBackupCode: vi.fn(), verifyTotp: vi.fn() },
      useSession: () => ({}),
    };
  },
}));

vi.mock('better-auth/client/plugins', () => ({
  adminClient: () => ({ id: 'admin' }),
  twoFactorClient: () => ({ id: 'two-factor' }),
}));

vi.mock('@better-auth/passkey/client', () => ({ passkeyClient: () => ({ id: 'passkey' }) }));

const moduleSource = readFileSync(resolve(process.cwd(), 'src/module.ts'), 'utf8');

beforeEach(() => {
  registered.length = 0;
  resetStubRuntimeConfig();
  resetLtWarnOnceState();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('auth.enableAdmin default', () => {
  it('is false in the module defaults and in the runtime config', () => {
    expect(moduleSource).toMatch(/auth: \{[\s\S]*?enableAdmin: false,[\s\S]*?\}/);
    expect(moduleSource).toMatch(/enableAdmin: resolvedOptions\.auth\?\.enableAdmin \?\? false,/);
  });

  it('createLtAuthClient() registers no admin client plugin unless asked to', async () => {
    const { createLtAuthClient } = await import('../src/runtime/lib/auth-client');

    createLtAuthClient({ baseURL: 'https://api.example.com' });
    createLtAuthClient({ baseURL: 'https://api.example.com', enableAdmin: true });

    expect(registered.map((plugins) => plugins.map((plugin) => plugin.id).includes('admin'))).toEqual([false, true]);
  });
});

describe('warning when the backend serves no admin plugin', () => {
  it('warns once when enableAdmin is on and /iam/features reports no admin plugin (nest-server)', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    setStubRuntimeConfig({ public: { ltExtensions: { auth: { enableAdmin: true } } } });

    warnLtAdminPluginUnserved({ enabled: true, passkey: true, twoFactor: true });
    warnLtAdminPluginUnserved({ enabled: true });

    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]?.[0])).toContain('enableAdmin');
  });

  it('stays quiet when the backend reports the admin plugin, or enableAdmin is off', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    setStubRuntimeConfig({ public: { ltExtensions: { auth: { enableAdmin: true } } } });
    warnLtAdminPluginUnserved({ admin: true, enabled: true });
    setStubRuntimeConfig({ public: { ltExtensions: { auth: { enableAdmin: false } } } });
    warnLtAdminPluginUnserved({ enabled: true });

    expect(warn).not.toHaveBeenCalled();
  });

  it('is called by useLtAuth().fetchFeatures() with the answer of /iam/features', () => {
    const source = readFileSync(resolve(process.cwd(), 'src/runtime/composables/auth/use-lt-auth.ts'), 'utf8');
    expect(source).toMatch(/features\.value = result;[\s\S]{0,200}warnLtAdminPluginUnserved\(result\)/);
  });
});
