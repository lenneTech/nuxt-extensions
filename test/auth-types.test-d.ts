import { assertType, describe, expectTypeOf, it } from 'vitest';

import type { LtAuthClient } from '../src/runtime/lib/auth-client';
import type { UseLtAuthReturn } from '../src/runtime/types/auth';

/**
 * The TYPE contract of the auth surface.
 *
 * WHY THIS FILE EXISTS
 *
 * 1.15.0 broke consuming projects by narrowing the auth client's type surface, and 1.15.1 reverted
 * it. 1.16.0 then widened three signatures with `& Record<string, unknown>` — a different costume
 * for the same failure, because TypeScript gives a `type` alias an implicit index signature and an
 * `interface` deliberately none. An interface-typed variable or a `Ref<Form>.value` therefore did
 * not compile, and those are the dominant shapes in this stack
 * (`app/interfaces/*.interface.ts`).
 *
 * Twice in one release line is a pattern, not an accident, and neither `vue-tsc --noEmit` nor the
 * runtime suite could see it: both only compile THIS package, and the break is at the boundary.
 * So the boundary is asserted here, from the outside, in the caller shapes that actually occur.
 *
 * Run by `pnpm test` (vitest typechecks `*.test-d.ts`).
 */

// The shapes a real caller passes. Declared as an `interface` on purpose — that is the one the
// previous signature rejected.
interface PasswordForm {
  currentPassword: string;
  newPassword: string;
}

interface ResetForm {
  newPassword: string;
  token: string;
}

/** What Valibot's `InferOutput<>` produces, and what a `Ref<T>.value` unwraps to. */
type InferredForm = { currentPassword: string; newPassword: string };

declare const auth: UseLtAuthReturn;
declare const form: PasswordForm;
declare const inferred: InferredForm;
declare const resetForm: ResetForm;
declare const reactive: { value: PasswordForm };

describe('UseLtAuthReturn accepts the caller shapes that occur', () => {
  it('takes an interface-typed variable', () => {
    // THE regression. `& Record<string, unknown>` rejected exactly this.
    assertType(auth.changePassword(form));
    assertType(auth.resetPassword(resetForm));
  });

  it('takes a ref value', () => {
    assertType(auth.changePassword(reactive.value));
  });

  it('takes a type alias / InferOutput shape', () => {
    assertType(auth.changePassword(inferred));
  });

  it('takes a fresh object literal', () => {
    assertType(auth.changePassword({ currentPassword: 'a', newPassword: 'b' }));
  });

  it('takes the forwarded options this release exists for', () => {
    // `revokeOtherSessions` is the option the old whitelist dropped. If the signature ever closes
    // again, this is what says so.
    assertType(auth.changePassword({ currentPassword: 'a', newPassword: 'b', revokeOtherSessions: true }));
    assertType(auth.requestPasswordReset({ email: 'a@test.com', redirectTo: 'https://app.example.com/reset' }));
  });
});

describe('UseLtAuthReturn refuses a stray plaintext credential', () => {
  it('rejects a foreign password field on changePassword', () => {
    // Widening the signature to forward options also removed the compiler's objection to a stray
    // plaintext credential — which would travel in the request body into proxy logs and error
    // reporters. Naming the foreign keys `never` puts the objection back.
    // @ts-expect-error `password` is not this method's credential and must not ride along
    auth.changePassword({ currentPassword: 'a', newPassword: 'b', password: 'plaintext' });
  });

  it('rejects any password field on requestPasswordReset', () => {
    // It carries an address and nothing else; a password here could only be an accident.
    // @ts-expect-error
    auth.requestPasswordReset({ email: 'a@test.com', password: 'plaintext' });
  });

  it('rejects a foreign credential on resetPassword', () => {
    // @ts-expect-error `currentPassword` belongs to changePassword, not to a token-based reset
    auth.resetPassword({ currentPassword: 'old', newPassword: 'b', token: 't' });
  });
});

describe('the reset pair is on the composable at all', () => {
  it('exposes requestPasswordReset and resetPassword', () => {
    // The gap that made a project hand-roll its own reset flow, forget the client-side hashing,
    // and desynchronise the two credential stores. A structural assertion, so removing either
    // method fails here rather than in a consumer.
    expectTypeOf<UseLtAuthReturn>().toHaveProperty('requestPasswordReset');
    expectTypeOf<UseLtAuthReturn>().toHaveProperty('resetPassword');
    expectTypeOf<UseLtAuthReturn>().toHaveProperty('changePassword');
  });
});

/**
 * The auth CLIENT's type surface — the half a runtime test provably cannot guard.
 *
 * `LtAuthClient` is `ReturnType<typeof createLtAuthClient>`, so a `...baseClient` spread in that
 * object contributes every DECLARED member of Better Auth's client to the published type while
 * contributing nothing at runtime (the client is a proxy with no `ownKeys` trap). That asymmetry
 * is the entire defect: methods that type-check, autocomplete, and are `undefined` when called.
 *
 * `auth-client-passthrough.test.ts` asserts the runtime half. It cannot assert this one, and the
 * attempt is instructive: re-adding `...baseClient.twoFactor` to the source leaves that suite
 * green, because against a faithful proxy fixture the spread is inert there too. A runtime guard
 * can only ever observe what the spread does — which is nothing — never what it promises.
 *
 * So the promise is asserted here. If someone reintroduces a spread, these fail and that suite
 * does not.
 */
describe('LtAuthClient promises exactly what it has', () => {
  it('does not declare the Better-Auth methods that are deliberately not passed through', () => {
    expectTypeOf<LtAuthClient>().not.toHaveProperty('updateUser');
    expectTypeOf<LtAuthClient>().not.toHaveProperty('deleteUser');
    expectTypeOf<LtAuthClient>().not.toHaveProperty('listSessions');
    expectTypeOf<LtAuthClient>().not.toHaveProperty('revokeSessions');
    expectTypeOf<LtAuthClient>().not.toHaveProperty('linkSocial');
  });

  it('does not declare sub-object methods that are not listed', () => {
    // The four that survived 1.17.0, because that release removed only the top-level spread.
    expectTypeOf<LtAuthClient['twoFactor']>().not.toHaveProperty('getTotpUri');
    expectTypeOf<LtAuthClient['twoFactor']>().not.toHaveProperty('sendOtp');
    expectTypeOf<LtAuthClient['twoFactor']>().not.toHaveProperty('verifyOtp');
    expectTypeOf<LtAuthClient['signIn']>().not.toHaveProperty('social');
  });

  it('still declares everything it does pass through', () => {
    // The other half: a guard that only forbids would be satisfied by an empty client.
    expectTypeOf<LtAuthClient>().toHaveProperty('sendVerificationEmail');
    expectTypeOf<LtAuthClient>().toHaveProperty('verifyEmail');
    expectTypeOf<LtAuthClient>().toHaveProperty('getSession');
    expectTypeOf<LtAuthClient['twoFactor']>().toHaveProperty('verifyTotp');
    expectTypeOf<LtAuthClient['signIn']>().toHaveProperty('email');
    expectTypeOf<LtAuthClient['signIn']>().toHaveProperty('passkey');
  });
});

/**
 * `setUser` takes Better Auth's session user unchanged.
 *
 * Its `image` is `string | null | undefined`; `LtUser.image` is `string | undefined`. Passing
 * `getSession().data.user` straight in therefore did not compile, and every consumer wrote the
 * same normalising line — while this package's own call sites hid it behind `as LtUser`.
 */
describe('setUser accepts a Better-Auth session user', () => {
  it('accepts image: null without a cast', () => {
    const auth = {} as UseLtAuthReturn;
    assertType(auth.setUser({ email: 'a@test.com', id: '1', image: null }));
  });

  it('still accepts a real image and no image at all', () => {
    const auth = {} as UseLtAuthReturn;
    assertType(auth.setUser({ email: 'a@test.com', id: '1', image: 'https://x/y.png' }));
    assertType(auth.setUser({ email: 'a@test.com', id: '1' }));
    assertType(auth.setUser(null));
  });
});
