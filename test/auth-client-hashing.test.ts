import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * What the auth client actually puts on the wire.
 *
 * WHY THIS EXISTS NEXT TO THE SHAPE TEST
 *
 * `auth-client-param-forwarding.test.ts` reads the SOURCE and asserts that each hashing wrapper
 * spreads the caller's params. That catches a field whitelist. It does not catch the inverse and
 * far worse mutation:
 *
 *     { newPassword: hashedPassword, ...params }
 *
 * Valid JavaScript, `params` still carries the raw value, the spread overwrites the hash — **the
 * plaintext password goes on the wire** — and a source-shape assertion that merely looks for
 * `...params` stays green. It was green: the shape test passed 11/11 with exactly that mutation
 * applied. Worse, trailing-spread is the more common JS idiom, so somebody following the
 * instruction "forward the caller's params" writes it that way by default.
 *
 * A guard that a defect SATISFIES is worse than no guard, because it also carries the reassurance.
 * So the contract is asserted where it is true or false: on the request payload.
 *
 * These tests are the reason the shape test can stay narrow — between them, a whitelist rebuild
 * and an order inversion are both caught, and neither needs the source to be parsed.
 */

const hashedFor = (value: string): string => {
  // The same digest `ltSha256` produces, computed independently so the assertion does not simply
  // agree with the implementation about what hashing means.
  const crypto = require('node:crypto');
  return crypto.createHash('sha256').update(value).digest('hex');
};

/** Captures the body each better-auth method is called with. */
const calls: Record<string, { options?: unknown; params: Record<string, any> } | undefined> = {};

/** Reads a recorded call, failing with a useful message rather than a null dereference. */
const recorded = (name: string): { options?: unknown; params: Record<string, any> } => {
  const entry = calls[name];
  if (!entry) {
    throw new Error(`${name} never reached the better-auth client`);
  }
  return entry;
};

const record =
  (name: string) =>
  (params: Record<string, any>, options?: unknown) => {
    calls[name] = { options, params };
    return Promise.resolve({ data: true, error: null });
  };

vi.mock('better-auth/vue', () => ({
  createAuthClient: () => ({
    $Infer: {},
    $fetch: vi.fn(),
    $store: {},
    admin: {},
    changePassword: record('changePassword'),
    getSession: vi.fn(),
    passkey: {},
    requestPasswordReset: record('requestPasswordReset'),
    resetPassword: record('resetPassword'),
    signIn: { email: record('signIn.email'), passkey: vi.fn() },
    signOut: vi.fn(),
    signUp: { email: record('signUp.email') },
    twoFactor: {
      disable: record('twoFactor.disable'),
      enable: record('twoFactor.enable'),
      generateBackupCodes: record('twoFactor.generateBackupCodes'),
      verifyBackupCode: vi.fn(),
      verifyTotp: vi.fn(),
    },
  }),
}));

vi.mock('better-auth/client/plugins', () => ({
  adminClient: () => ({}),
  inferAdditionalFields: () => ({}),
  jwtClient: () => ({}),
  twoFactorClient: () => ({}),
}));

vi.mock('@better-auth/passkey/client', () => ({ passkeyClient: () => ({}) }));

const PLAINTEXT = 'correct horse battery staple';

describe('auth client — what reaches the wire', () => {
  let client: any;

  beforeEach(async () => {
    for (const key of Object.keys(calls)) delete calls[key];
    const { createLtAuthClient } = await import('../src/runtime/lib/auth-client');
    client = createLtAuthClient({ baseURL: 'https://api.example.com' } as any);
  });

  const CASES: { call: (c: any) => Promise<unknown>; field: string; name: string }[] = [
    { call: (c) => c.signIn.email({ email: 'a@test.com', password: PLAINTEXT }), field: 'password', name: 'signIn.email' },
    {
      call: (c) => c.signUp.email({ email: 'a@test.com', name: 'A', password: PLAINTEXT }),
      field: 'password',
      name: 'signUp.email',
    },
    {
      call: (c) => c.changePassword({ currentPassword: 'old-one', newPassword: PLAINTEXT }),
      field: 'newPassword',
      name: 'changePassword',
    },
    { call: (c) => c.resetPassword({ newPassword: PLAINTEXT, token: 't' }), field: 'newPassword', name: 'resetPassword' },
    { call: (c) => c.twoFactor.disable({ password: PLAINTEXT }), field: 'password', name: 'twoFactor.disable' },
    { call: (c) => c.twoFactor.enable({ password: PLAINTEXT }), field: 'password', name: 'twoFactor.enable' },
    {
      call: (c) => c.twoFactor.generateBackupCodes({ password: PLAINTEXT }),
      field: 'password',
      name: 'twoFactor.generateBackupCodes',
    },
  ];

  for (const testCase of CASES) {
    it(`${testCase.name} sends the hash, never the plaintext`, async () => {
      await testCase.call(client);

      const sent = recorded(testCase.name);
      expect(sent.params[testCase.field]).toBe(hashedFor(PLAINTEXT));

      // The decisive assertion. A trailing spread — `{ [field]: hashed, ...params }` — overwrites
      // the hash with the raw value and is invisible to any source-shape check.
      expect(
        JSON.stringify(sent.params),
        `${testCase.name} put the PLAINTEXT password on the wire. The usual cause is a spread ` +
          'placed AFTER the hashed field, which overwrites it.',
      ).not.toContain(PLAINTEXT);
    });
  }

  it('changePassword hashes both passwords and keeps revokeOtherSessions', async () => {
    await client.changePassword({ currentPassword: 'old-one', newPassword: PLAINTEXT, revokeOtherSessions: true });

    const sent = recorded('changePassword');
    expect(sent.params.currentPassword).toBe(hashedFor('old-one'));
    expect(sent.params.newPassword).toBe(hashedFor(PLAINTEXT));
    // The option this release exists for: better-auth reads it on the update-user route, and the
    // old whitelist dropped it — a caller believed foreign sessions were ended when they were not.
    expect(sent.params.revokeOtherSessions).toBe(true);
    expect(JSON.stringify(sent.params)).not.toContain('old-one');
  });

  it('twoFactor.enable keeps method and issuer', async () => {
    // Both are in better-auth's body schema, and the whitelist dropped them: `method: 'otp'`
    // silently set up TOTP instead of email/SMS codes.
    await client.twoFactor.enable({ issuer: 'Acme', method: 'otp', password: PLAINTEXT });

    expect(recorded('twoFactor.enable').params.method).toBe('otp');
    expect(recorded('twoFactor.enable').params.issuer).toBe('Acme');
  });

  it('requestPasswordReset forwards redirectTo untouched and hashes nothing', async () => {
    // It carries an address, never a password — so it is a bare passthrough, and `redirectTo` has
    // to survive: better-auth resolves it against the API origin, and a dropped one is a 403 with
    // no mail sent and nothing visible in the browser.
    await client.requestPasswordReset({ email: 'a@test.com', redirectTo: 'https://app.example.com/auth/reset' });

    expect(recorded('requestPasswordReset').params.redirectTo).toBe('https://app.example.com/auth/reset');
    expect(recorded('requestPasswordReset').params.email).toBe('a@test.com');
  });

  it('resetPassword forwards the token unchanged', async () => {
    await client.resetPassword({ newPassword: PLAINTEXT, token: 'tok-abc' });

    expect(recorded('resetPassword').params.token).toBe('tok-abc');
  });
});
