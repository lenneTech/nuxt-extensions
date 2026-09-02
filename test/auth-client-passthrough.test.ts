import { describe, expect, it, vi } from 'vitest';

/**
 * Which Better-Auth methods `createLtAuthClient()` actually hands to consumers.
 *
 * WHY THIS EXISTS
 *
 * The returned object used to begin with `...baseClient`, under a comment claiming it
 * spread "all base client properties and methods". It spread nothing: Better-Auth's client
 * is a `new Proxy(function () {}, { apply, get })` with no `ownKeys` trap, so it owns no
 * enumerable properties and a spread copies none of them.
 *
 * At the TYPE level the spread copied everything, because TypeScript spreads declared
 * members regardless of what the runtime does. `LtAuthClient` is
 * `ReturnType<typeof createLtAuthClient>`, so roughly fourteen methods were promised by the
 * type, offered by autocomplete, waved through by the compiler — and `undefined` when
 * called. Three projects independently hit that and rebuilt the call against raw `$fetch`.
 *
 * So the list in `auth-client.ts` IS the surface. Nothing catches what it omits, and
 * nothing warns when a name is dropped: deleting a line produces no type error here, only a
 * `TypeError` in somebody's browser.
 *
 * WHY THE FIXTURE IS A PROXY AND NOT AN OBJECT LITERAL
 *
 * The neighbouring suites mock `better-auth/vue` with a plain object. That is right for
 * what they assert, and fatal for this one: a plain object spreads perfectly, so against
 * such a fixture the deleted `...baseClient` would still "work" and this guard would pass
 * while the defect it exists for is present. That is the failure mode CLAUDE.md records
 * from 1.13.0 — "a fixture was invented rather than observed, and the invented selector
 * matched the invented fixture".
 *
 * The fixture below therefore reproduces the real mechanism, and `the fixture is spread-
 * empty` asserts it does, so the guard cannot quietly degrade into agreeing with itself.
 * That the REAL client behaves this way is pinned separately, against the installed
 * package, in `better-auth-contract.test.ts`.
 */

/** A stand-in for `createDynamicPathProxy`: fabricates on `get`, owns nothing. */
const makeDynamicPathProxy = (): any =>
  new Proxy(function () {} as any, {
    get: (_target, prop) => {
      if (prop === 'then') return undefined; // keep it un-thenable, or `await` hangs
      if (prop === '$Infer' || prop === '$store') return {};
      return makeDynamicPathProxy();
    },
  });

vi.mock('better-auth/vue', () => ({ createAuthClient: () => makeDynamicPathProxy() }));
vi.mock('better-auth/client/plugins', () => ({
  adminClient: () => ({}),
  inferAdditionalFields: () => ({}),
  jwtClient: () => ({}),
  twoFactorClient: () => ({}),
}));
vi.mock('@better-auth/passkey/client', () => ({ passkeyClient: () => ({}) }));

/**
 * Every name `auth-client.ts` is expected to expose.
 *
 * Adding a method to the client means adding it here too — deliberately, because each entry
 * is a promise this package then keeps across versions. A method that is NOT here is not a
 * gap by default: `deleteUser` and `changeEmail` are left out because Better-Auth gates both
 * behind server options that `@lenne.tech/nest-server` does not set, so exposing them would
 * offer callers a route that answers with an error (`deleteUser` additionally carries a
 * password and would need the same lockstep as `admin.*`).
 */
const EXPECTED_METHODS = [
  '$Infer',
  '$fetch',
  '$store',
  'admin',
  'changePassword',
  'getSession',
  'passkey',
  'requestPasswordReset',
  'resetPassword',
  'sendVerificationEmail',
  'signIn',
  'signOut',
  'signUp',
  'twoFactor',
  'useSession',
  'verifyEmail',
] as const;

const buildClient = async (): Promise<any> => {
  const { createLtAuthClient } = await import('../src/runtime/lib/auth-client');
  return createLtAuthClient({ baseURL: 'https://api.example.com' } as any);
};

describe('auth client — the passthrough list is the whole surface', () => {
  it('the fixture is spread-empty, like the real better-auth client', () => {
    // Guards the guard. If this ever fails, the fixture stopped reproducing the mechanism
    // and every assertion below became meaningless without going red.
    const proxy = makeDynamicPathProxy();
    expect(Object.keys(proxy)).toEqual([]);
    expect(Object.keys({ ...proxy })).toEqual([]);
    // ...while still answering any name, which is what makes a spread look plausible.
    expect(typeof proxy.sendVerificationEmail).toBe('function');
  });

  it('exposes exactly the expected methods', async () => {
    const client = await buildClient();
    expect(Object.keys(client).sort()).toEqual([...EXPECTED_METHODS].sort());
  });

  for (const name of EXPECTED_METHODS) {
    it(`${name} survives to the consumer`, async () => {
      const client = await buildClient();
      // `toBeDefined` is not enough: the whole defect is a name that reads as present and
      // is `undefined` at the point of use.
      expect(client[name], `${name} is missing from the passthrough list`).toBeDefined();
    });
  }

  it('does not expose methods that were deliberately left out', async () => {
    const client = await buildClient();
    // Not a wish list — these are the ones a spread WOULD have brought in, so this is what
    // separates "the list works" from "something is spreading again".
    for (const absent of ['deleteUser', 'changeEmail', 'listSessions', 'revokeSessions', 'updateUser', 'linkSocial']) {
      expect(client[absent], `${absent} appeared without being listed`).toBeUndefined();
    }
  });
});

/**
 * The sub-objects, which is where this defect survived its own fix.
 *
 * 1.17.0 removed the top-level `...baseClient` and left `...baseClient.signIn`,
 * `...baseClient.signUp` and `...baseClient.twoFactor` in place. Those spread nothing either —
 * `baseClient.signIn` is fabricated by the same proxy and is `Object.keys`-empty in turn — so
 * `twoFactor.getTotpUri` and `signIn.social` stayed declared-but-`undefined` through a release
 * whose entire point was removing exactly that.
 *
 * The guard above could not see it: it asserts on the TOP-LEVEL keys, and `twoFactor` is
 * present at the top level whatever it contains. So the shape of the assertion, not its
 * subject, is what let the second half through.
 */
const EXPECTED_SUB_METHODS: Record<string, readonly string[]> = {
  signIn: ['email', 'passkey'],
  signUp: ['email'],
  twoFactor: ['disable', 'enable', 'generateBackupCodes', 'verifyBackupCode', 'verifyTotp'],
};

describe('auth client — sub-objects are listed, not spread', () => {
  it('the fixture sub-objects are spread-empty too', () => {
    // Same guard-the-guard as above, one level down: an object-literal fixture would spread
    // perfectly here and make every assertion below meaningless.
    const proxy = makeDynamicPathProxy();
    expect(Object.keys(proxy.twoFactor)).toEqual([]);
    expect(Object.keys({ ...proxy.twoFactor })).toEqual([]);
  });

  for (const [group, methods] of Object.entries(EXPECTED_SUB_METHODS)) {
    it(`${group} exposes exactly its listed methods`, async () => {
      const client = await buildClient();
      expect(Object.keys(client[group]).sort()).toEqual([...methods].sort());
    });

    for (const name of methods) {
      it(`${group}.${name} survives to the consumer`, async () => {
        const client = await buildClient();
        expect(client[group][name], `${group}.${name} is missing`).toBeDefined();
      });
    }
  }

  it('does not re-declare the Better-Auth methods that are not listed', async () => {
    const client = await buildClient();
    // The four that 1.17.0 still promised. `getTotpUri` is the one to watch: it renders the
    // TOTP QR code, so it is what a project reaches for next.
    expect(client.twoFactor.getTotpUri, 'twoFactor.getTotpUri appeared without being listed').toBeUndefined();
    expect(client.twoFactor.sendOtp, 'twoFactor.sendOtp appeared without being listed').toBeUndefined();
    expect(client.twoFactor.verifyOtp, 'twoFactor.verifyOtp appeared without being listed').toBeUndefined();
    expect(client.signIn.social, 'signIn.social appeared without being listed').toBeUndefined();
  });
});
