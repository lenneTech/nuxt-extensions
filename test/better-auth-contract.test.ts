import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

// Pins the better-auth surface this module actually consumes, in the spirit of
// `upstream-dom-contract.test.ts` — and for the same reason CLAUDE.md records:
// "The 1.13.0 defect shipped because a fixture was invented rather than observed."
//
// The better-auth dependency was in exactly that pre-1.14.0 state. `auth-client.ts`
// reaches every plugin surface through a type assertion, so `vue-tsc --noEmit` cannot
// see a rename upstream; and the file had 0% runtime coverage, so no test could either.
// A dropped `verifyTotp` would have produced `undefined` at client construction and a
// 2FA failure at call time, with a green build and a green suite.
//
// 1.15.0's premise is "this module requires better-auth 1.7". These tests are what
// turn that from an assertion in a CHANGELOG into a fact the suite enforces.
//
// Written against the REAL installed packages, never a hand-written fixture. Because
// the peer range now pins one minor line, that is stable rather than flaky.

const ROOT = process.cwd();
const pkg = JSON.parse(readFileSync(resolve(ROOT, 'package.json'), 'utf8'));

describe('better-auth subpath exports', () => {
  // The CHANGELOG cites 1.7 removing `./plugins/oidc-provider` and `./plugins/mcp/client`
  // as evidence that better-auth breaks in MINOR releases — the argument for the `<1.8.0`
  // upper bound. This module imports three subpaths; all three must resolve.
  it('exposes better-auth/vue with createAuthClient', async () => {
    const mod = await import('better-auth/vue');
    expect(typeof mod.createAuthClient).toBe('function');
  });

  it('exposes better-auth/client/plugins with the plugins this module uses', async () => {
    const mod = await import('better-auth/client/plugins');
    expect(typeof mod.adminClient).toBe('function');
    expect(typeof mod.twoFactorClient).toBe('function');
  });

  it('exposes @better-auth/passkey/client with passkeyClient', async () => {
    const mod = await import('@better-auth/passkey/client');
    expect(typeof mod.passkeyClient).toBe('function');
  });
});

describe('better-auth installed version', () => {
  it('the installed better-auth satisfies the declared peer floor', async () => {
    // Complements `peer-dependency-ranges.test.ts`, which compares the manifest strings.
    // This asserts against what is actually on disk and imported above.
    const installed = JSON.parse(readFileSync(resolve(ROOT, 'node_modules/better-auth/package.json'), 'utf8'));
    const [major, minor] = installed.version.split('.').map(Number);
    expect(major).toBe(1);
    expect(minor).toBeGreaterThanOrEqual(7);
    expect(minor).toBeLessThan(8);
  });

  it('two-factor enable still returns a method-discriminated result', async () => {
    // THE claim 1.15.0's peer floor rests on: 1.7 gives `twoFactor.enable` a
    // discriminated result carrying `method`, which 1.6.26 never sent — the mismatch
    // that broke 2FA activation in every fullstack project.
    //
    // Verified against the shipped OpenAPI schema rather than by calling the endpoint,
    // because the response shape IS the contract with the nest-server end. If a future
    // better-auth drops `method` from `required`, the protocol assumption behind the
    // pin no longer holds and this fails — which is the point.
    const source = readFileSync(resolve(ROOT, 'node_modules/better-auth/dist/plugins/two-factor/index.mjs'), 'utf8');
    const enableBlock = source.slice(source.indexOf('"/two-factor/enable"'));
    expect(enableBlock).toContain('required: ["method"]');
    expect(enableBlock).toContain('method: "otp"');
    expect(enableBlock).toContain('method: "totp"');
  });
});

describe('createLtAuthClient plugin surfaces', () => {
  // `auth-client.ts` reads these members EAGERLY when it builds the returned object.
  // Nothing else in the suite constructs the client at all, so without this block a
  // rename upstream is invisible until a user hits it.
  //
  // Imported dynamically: the module pulls in `#imports` (Nuxt auto-imports), stubbed
  // in `vitest.config`. Keep this consistent with how other tests reach runtime code.
  it('builds a client exposing the twoFactor actions the wrapper forwards to', async () => {
    const { createLtAuthClient } = await import('../src/runtime/lib/auth-client');

    const client = createLtAuthClient({
      baseURL: 'http://localhost:3000',
      enableAdmin: true,
      enablePasskey: false,
      enableTwoFactor: true,
    });

    for (const action of ['enable', 'disable', 'generateBackupCodes', 'verifyTotp', 'verifyBackupCode'] as const) {
      expect(typeof client.twoFactor[action], `twoFactor.${action} must be callable`).toBe('function');
    }
  });

  it('exposes the admin surface when enableAdmin is on', async () => {
    const { createLtAuthClient } = await import('../src/runtime/lib/auth-client');
    const client = createLtAuthClient({ baseURL: 'http://localhost:3000', enableAdmin: true, enablePasskey: false });
    expect(client.admin).toBeDefined();
  });

  it('still constructs when every optional plugin is disabled', async () => {
    // Regression guard for the wrapper's own robustness: the returned object always
    // declares a `twoFactor` key, including when the plugin was never registered.
    const { createLtAuthClient } = await import('../src/runtime/lib/auth-client');
    expect(() =>
      createLtAuthClient({
        baseURL: 'http://localhost:3000',
        enableAdmin: false,
        enablePasskey: false,
        enableTwoFactor: false,
      }),
    ).not.toThrow();
  });
});

describe('peer declaration matches what is imported', () => {
  it('every better-auth package this module imports is declared as a peer', () => {
    const imported = ['better-auth', '@better-auth/passkey'];
    for (const name of imported) {
      expect(pkg.peerDependencies?.[name], `${name} is imported by src/ but not declared as a peer`).toBeTruthy();
    }
  });
});

describe('the client is a dynamic-path proxy, not a plain object', () => {
  // The upstream fact the whole passthrough list rests on, pinned against the INSTALLED
  // package rather than a fixture. `auth-client.ts` must name every method it exposes
  // because a spread of this object yields nothing; if better-auth ever adds an `ownKeys`
  // trap, these assertions fail and the comments in `auth-client.ts` — plus the fixture in
  // `auth-client-passthrough.test.ts` — have gone stale and must be revisited.

  it('owns no enumerable properties, so a spread copies nothing', async () => {
    const { createAuthClient } = await import('better-auth/vue');
    const client = createAuthClient({ baseURL: 'http://localhost:3000', basePath: '/iam' });

    expect(Object.keys(client)).toEqual([]);
    expect(Object.keys({ ...client })).toEqual([]);
  });

  it('fabricates any name on access, which is why probing it proves nothing', async () => {
    const { createAuthClient } = await import('better-auth/vue');
    const client = createAuthClient({ baseURL: 'http://localhost:3000', basePath: '/iam' }) as any;

    // Both the real methods...
    expect(typeof client.sendVerificationEmail).toBe('function');
    expect(typeof client.verifyEmail).toBe('function');
    // ...and a name that exists nowhere in better-auth. A test that asserts "the method is
    // there" against this object is therefore always green and never useful — the reason
    // `auth-client-passthrough.test.ts` asserts on OUR returned object instead.
    expect(typeof client.thisEndpointDoesNotExist).toBe('function');
  });

  it('a spread of it does not carry methods to a consumer', async () => {
    const { createAuthClient } = await import('better-auth/vue');
    const client = createAuthClient({ baseURL: 'http://localhost:3000', basePath: '/iam' }) as any;

    // The exact shape `auth-client.ts` used to rely on, and the exact reason it failed.
    const spread: any = { ...client };
    expect(spread.sendVerificationEmail).toBeUndefined();
    expect(spread.signIn).toBeUndefined();
  });
});
