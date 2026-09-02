import { beforeEach, describe, expect, it } from 'vitest';

import { resetStubReactiveStores, resetStubRuntimeConfig, useState } from './stubs/imports';

/**
 * The two properties other repositories now depend on, pinned here because neither is
 * visible from the side that relies on it.
 *
 * 1. THE MARKER FORMAT IS A CROSS-REPOSITORY CONTRACT.
 *
 * `@lenne.tech/nest-server` wraps failed Better-Auth responses so their `message` carries
 * its own marker — `#LTNS_0027: Link is invalid or expired` in place of better-auth's bare
 * `Invalid token`. It does that specifically because `ERROR_CODE_REGEX` in
 * `use-lt-error-translation.ts` recognises the shape, which lets one fix serve every
 * project instead of each frontend growing its own lookup table.
 *
 * Nothing on either side enforces the agreement. Tighten the regex here and nest-server's
 * wrapping silently stops translating; both suites stay green, because each repository is
 * internally consistent and only the assembled system has both halves. That is the same
 * failure mode CLAUDE.md records for the peer-dependency range.
 *
 * 2. THE DEGRADED PATH MUST STAY READABLE.
 *
 * When `/i18n/errors/:locale` cannot be reached at app start, the plugin logs and carries
 * on with an empty map. `translateError` then returns the developer message — English, but
 * a sentence. It must never return `''` or `undefined`; an empty error box tells the user
 * nothing at all, and the case is not rare enough to hand-wave, since a reset link that has
 * expired now reaches it routinely.
 *
 * The same property is why `translateError(x) || 'Fallback'` is a no-op, a pattern that
 * spread through six pages of one starter before anyone measured it. The last test states
 * that outright so the JSDoc claim has something enforcing it.
 */

const NEST_SERVER_ERRORS = [
  { code: 'LTNS_0027', de: 'Dieser Link ist nicht (mehr) gültig. Bitte fordern Sie einen neuen an.', developer: 'Link is invalid or expired' },
  { code: 'LTNS_0003', de: 'Der Token ist ungültig oder fehlerhaft.', developer: 'Invalid or malformed token' },
  { code: 'LTNS_0100', de: 'Sie sind nicht angemeldet.', developer: 'Unauthorized - User is not logged in' },
] as const;

/**
 * Seed both locales with the same entry, so the assertion holds whichever locale
 * `detectLocale()` picks in this environment. The test is about the lookup, not about
 * locale detection.
 */
function seedTranslations(entries: Record<string, string>): void {
  useState<Record<string, Record<string, string>>>('lt-error-translations').value = { de: entries, en: entries };
}

const loadComposable = async () => {
  const { useLtErrorTranslation } = await import('../src/runtime/composables/use-lt-error-translation');
  return useLtErrorTranslation();
};

describe('nest-server marker format', () => {
  beforeEach(() => {
    resetStubRuntimeConfig();
    resetStubReactiveStores();
  });

  for (const error of NEST_SERVER_ERRORS) {
    it(`parses ${error.code} out of a real nest-server message`, async () => {
      const { parseError } = await loadComposable();
      const parsed = parseError(`#${error.code}: ${error.developer}`);

      expect(parsed.code).toBe(error.code);
      expect(parsed.developerMessage).toBe(error.developer);
    });

    it(`translates ${error.code} when the catalogue has it`, async () => {
      seedTranslations({ [error.code]: error.de });
      const { translateError } = await loadComposable();

      expect(translateError(`#${error.code}: ${error.developer}`)).toBe(error.de);
    });
  }

  it('reads the marker off an error object, not just a string', async () => {
    // How it actually arrives from the better-auth client: `{ error: { code, message } }`.
    seedTranslations({ LTNS_0027: NEST_SERVER_ERRORS[0].de });
    const { translateError } = await loadComposable();

    expect(translateError({ error: { code: 'INVALID_TOKEN', message: '#LTNS_0027: Link is invalid or expired' } })).toBe(NEST_SERVER_ERRORS[0].de);
  });

  it('leaves an unmarked message alone instead of mangling it', async () => {
    // Better-Auth codes nest-server deliberately does NOT map (USER_NOT_FOUND, an account
    // enumeration signal) arrive raw. That is a decision upstream, not a defect here.
    const { parseError } = await loadComposable();
    const parsed = parseError('User not found');

    expect(parsed.code).toBeNull();
    expect(parsed.translatedMessage).toBe('User not found');
  });
});

describe('degraded path when translations never loaded', () => {
  beforeEach(() => {
    resetStubRuntimeConfig();
    resetStubReactiveStores();
  });

  it('falls back to the developer message rather than an empty string', async () => {
    const { translateError } = await loadComposable();
    const result = translateError('#LTNS_0027: Link is invalid or expired');

    expect(result).toBe('Link is invalid or expired');
    expect(result).not.toBe('');
    expect(result).toBeTruthy();
  });

  it('a known code with an empty catalogue still yields a sentence', async () => {
    seedTranslations({});
    const { translateError } = await loadComposable();

    expect(translateError('#LTNS_0100: Unauthorized - User is not logged in')).toBe('Unauthorized - User is not logged in');
  });

  it('`translateError(x) || fallback` never reaches the fallback', async () => {
    // The documented trap, asserted so the JSDoc cannot drift away from the behaviour.
    const { translateError } = await loadComposable();

    for (const input of ['#LTNS_0027: Link is invalid or expired', 'Invalid token', 'anything at all']) {
      expect(translateError(input) || 'FALLBACK').not.toBe('FALLBACK');
    }
  });
});

describe('fetch errors carry their marker in the body, not the message', () => {
  beforeEach(() => {
    resetStubRuntimeConfig();
    resetStubReactiveStores();
  });

  /** Shaped like ofetch's `FetchError`: transport line in `message`, parsed body in `data`. */
  class FetchErrorLike extends Error {
    data?: unknown;

    constructor(transport: string, data?: unknown) {
      super(transport);
      this.name = 'FetchError';
      this.data = data;
    }
  }

  const TRANSPORT = '[POST] "/iam/reset-password": 400 Bad Request';

  it('translates the body message instead of the transport line', async () => {
    seedTranslations({ LTNS_0027: NEST_SERVER_ERRORS[0].de });
    const { translateError } = await loadComposable();

    const error = new FetchErrorLike(TRANSPORT, { message: '#LTNS_0027: Link is invalid or expired' });

    expect(translateError(error)).toBe(NEST_SERVER_ERRORS[0].de);
    // The failure this guards against is not an exception — it is the transport line being
    // shown to a user as if it were an explanation.
    expect(translateError(error)).not.toContain('400 Bad Request');
  });

  it('finds the code, so callers can branch on it', async () => {
    const { parseError } = await loadComposable();
    const parsed = parseError(new FetchErrorLike(TRANSPORT, { message: '#LTNS_0027: Link is invalid or expired' }));

    expect(parsed.code).toBe('LTNS_0027');
  });

  it('still uses the thrown message when there is no body', async () => {
    // The ordering change must not swallow ordinary errors, which have no `data` at all.
    const { translateError } = await loadComposable();

    expect(translateError(new Error('Something broke'))).toBe('Something broke');
    expect(translateError(new FetchErrorLike('Network request failed'))).toBe('Network request failed');
  });

  it('ignores a body whose message is missing, empty or not a string', async () => {
    const { translateError } = await loadComposable();

    for (const body of [{}, { message: '' }, { message: 42 }, { message: null }, 'not an object', null]) {
      expect(translateError(new FetchErrorLike(TRANSPORT, body))).toBe(TRANSPORT);
    }
  });
});
