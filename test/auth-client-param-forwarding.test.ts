import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

// A HASHING WRAPPER REPLACES ONE FIELD — IT IS NEVER A WHITELIST.
//
// `auth-client.ts` wraps the better-auth methods that carry a password so the value is
// SHA256-hashed before it leaves the browser. Several of those wrappers used to REBUILD
// the payload from named fields (`{ newPassword: hashed, token: params.token }`) instead
// of spreading it, which silently dropped every option the caller passed alongside.
//
// That is not a style question. `requestPasswordReset`/`resetPassword` carry `redirectTo`,
// and better-auth resolves it against the API origin (`new URL(callbackURL, ctx.baseURL)`).
// In a split app/API deployment a dropped value therefore lands on the API host, the route
// does not exist, and the answer is a 403 INVALID_REDIRECT_URL — no mail sent, nothing
// visible in the browser. A reset that quietly never happens. `changePassword` loses
// `revokeOtherSessions` the same way, which is a security option rather than a nicety.
//
// SCOPE, corrected. An earlier version of this header claimed "a runtime test cannot see this".
// That is true only of a whitelist that happens to list every field a test passes — and false for
// the far more dangerous inversion, `{ field: hashed, ...params }`, which puts the PLAINTEXT
// password on the wire and which this file's own assertion used to satisfy. A runtime test sees
// that one immediately.
//
// So the contract lives in `auth-client-hashing.test.ts`, on the request payload. This file keeps
// only the source-level half: a spread is present at each call site, visible in review.
//
// If you add a wrapper that hashes something, add it here too.

const SOURCE = readFileSync(resolve(process.cwd(), 'src/runtime/lib/auth-client.ts'), 'utf8');

/** Every wrapper that hashes a field and must therefore forward the rest untouched. */
const HASHING_WRAPPERS = [
  // No `?.` on these two: an optional call turned a missing method into `undefined`, which a
  // caller reads as "no error" and reports as success while the password is unchanged. They
  // throw now instead, so the call sites are plain.
  'baseClient.changePassword(',
  'baseClient.resetPassword(',
  'baseClient.signIn.email(',
  'baseClient.signUp.email(',
  '(baseClient as any).twoFactor.disable(',
  '(baseClient as any).twoFactor.enable(',
  '(baseClient as any).twoFactor.generateBackupCodes(',
];

describe('auth-client forwards caller parameters', () => {
  // NARROW ON PURPOSE. This file used to slice the payload with `indexOf('}')`, which cuts at the
  // FIRST brace — a nested object literal or an `Object.assign` made a CORRECT implementation fail.
  // Worse, it was positional-blind: `{ newPassword: hashed, ...params }` puts the plaintext
  // password on the wire and satisfied the assertion. Both halves stood exactly the wrong way
  // round: correct code broke, dangerous code passed.
  //
  // `auth-client-hashing.test.ts` now asserts the real contract on the request payload, where it
  // is true or false rather than merely shaped. What is left here is the one thing only the source
  // can say: that a spread is present at all, so a future whitelist rebuild is visible in review
  // even before the runtime test runs.
  for (const call of HASHING_WRAPPERS) {
    it(`${call} spreads the caller's params`, () => {
      const index = SOURCE.indexOf(call);
      expect(index, `call site not found — was it renamed? (${call})`).toBeGreaterThan(-1);

      // A generous window rather than a hand-rolled brace matcher: the assertion is "a spread
      // appears in this call", and a parser that gets braces wrong is how this file produced
      // false failures in the first place.
      const window = SOURCE.slice(index, index + 400);
      expect(
        window,
        `${call} must forward the caller's params with \`...params\`. Placement is asserted by ` +
          'auth-client-hashing.test.ts, which reads the actual request payload.',
      ).toContain('...params');
    });
  }

  it('lists every wrapper that hashes — the list cannot silently fall behind the source', () => {
    // `HASHING_WRAPPERS` is hand-maintained, so an eighth wrapper added without touching it
    // would be guarded by nothing at all, and every test above would still pass. This finds
    // the call sites from the source instead: any call on `baseClient` whose payload carries a
    // `hashed…` value is, by definition, a hashing wrapper.
    const found = [...SOURCE.matchAll(/((?:\(baseClient as any\)|baseClient)(?:\.[A-Za-z]+)+\()(?=[^\n]*hashed)/g)].map(
      (match) => match[1],
    );

    expect(
      [...new Set(found)].sort(),
      'A call site forwards a hashed value but is not in HASHING_WRAPPERS (or vice versa). Add ' +
        'it here AND to auth-client-hashing.test.ts — a wrapper nobody listed is a wrapper nobody guards.',
    ).toEqual([...HASHING_WRAPPERS].sort());
  });

  it('requestPasswordReset stays a bare passthrough', () => {
    // It takes an email address, never a password, so there is nothing to hash. Wrapping it would
    // only add a place for `redirectTo` to get lost.
    expect(SOURCE).toContain('requestPasswordReset: baseClient.requestPasswordReset,');
  });
});

// The composable half of this contract — that `useLtAuth()` returns the reset pair at all — used
// to be asserted here with a 4-space-indent regex over the source. It was removed rather than
// fixed, because it could not do the job: the file has 4-space-indented keys in several unrelated
// object literals, so deleting `resetPassword` from the return object and dropping a decoy
// `resetPassword: null,` into the cookie-options block left the suite fully green.
//
// `auth-types.test-d.ts` asserts the same thing structurally, against `UseLtAuthReturn` itself, and
// `vue-tsc` catches a missing member as TS2741 because `useLtAuth(): UseLtAuthReturn` is annotated.
// A type the compiler already enforces does not also need a regex that can be fooled by
// reformatting.
