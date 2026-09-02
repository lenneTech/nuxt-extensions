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
