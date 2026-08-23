/**
 * Build-time stand-in for the OPTIONAL `@better-auth/passkey` peer dependency.
 *
 * `auth-client.ts` imports `passkeyClient` as a static top-level import, so a
 * bundler has to resolve the specifier even in projects that never enable
 * passkeys. Without a resolvable module the build dies on an unresolved
 * optional peer, which contradicts `peerDependenciesMeta.optional: true`.
 *
 * The module aliases `@better-auth/passkey/client` onto this file when the real
 * package is absent, and forces `auth.enablePasskey` to `false` in that case —
 * so the factory below is normally never called. It stays a no-op (rather than
 * throwing) to keep the direct `createLtAuthClient()` entry point working, whose
 * own `enablePasskey` default is `true`.
 *
 * WHY this file exports more than `passkeyClient`:
 * the alias is installed into `nuxt.options.alias` and `nuxt.options.nitro.alias`,
 * which rewrites the specifier for the WHOLE consumer app — not just for our
 * `auth-client.ts`. A consumer (or another dependency) importing any other name
 * from `@better-auth/passkey/client` would then hit
 * `"PASSKEY_ERROR_CODES" is not exported by …/passkey-stub` — the same class of
 * unresolved-export build failure this stub exists to prevent, merely relocated.
 * So the stub mirrors the real package's full export surface.
 * `test/optional-peers.test.ts` pins that surface against the real package.
 */

let warned = false;

function warnOnce(entryPoint: string) {
  if (warned) {
    return;
  }
  warned = true;
  console.warn(
    '[@lenne.tech/nuxt-extensions] Passkey support is unavailable: the optional peer dependency "@better-auth/passkey" is not installed. ' +
      `Install it to use passkeys, or pass \`enablePasskey: false\` to createLtAuthClient() to silence this warning. (reached via ${entryPoint})`,
  );
}

/**
 * No-op replacement for the real `passkeyClient()` Better-Auth client plugin.
 *
 * Returns a plugin with a deliberately distinct `id`: claiming `'passkey'` would
 * make Better-Auth expose passkey actions that cannot work without the package.
 */
export function passkeyClient() {
  warnOnce('passkeyClient()');

  return { id: 'lt-passkey-unavailable' as const };
}

/**
 * Mirror of the real package's error-code table.
 *
 * Frozen and value-complete so a consumer that reads a code for a message or an
 * equality check still gets a defined value instead of a `TypeError` on
 * `undefined`. The codes are the contract; the messages are best-effort copies.
 */
export const PASSKEY_ERROR_CODES = Object.freeze({
  AUTH_CANCELLED: { code: 'AUTH_CANCELLED', message: 'Auth cancelled' },
  AUTHENTICATION_FAILED: { code: 'AUTHENTICATION_FAILED', message: 'Authentication failed' },
  CHALLENGE_NOT_FOUND: { code: 'CHALLENGE_NOT_FOUND', message: 'Challenge not found' },
  FAILED_TO_UPDATE_PASSKEY: { code: 'FAILED_TO_UPDATE_PASSKEY', message: 'Failed to update passkey' },
  FAILED_TO_VERIFY_REGISTRATION: { code: 'FAILED_TO_VERIFY_REGISTRATION', message: 'Failed to verify registration' },
  PASSKEY_NOT_FOUND: { code: 'PASSKEY_NOT_FOUND', message: 'Passkey not found' },
  PREVIOUSLY_REGISTERED: { code: 'PREVIOUSLY_REGISTERED', message: 'Previously registered' },
  REGISTRATION_CANCELLED: { code: 'REGISTRATION_CANCELLED', message: 'Registration cancelled' },
  RESOLVE_USER_REQUIRED: {
    code: 'RESOLVE_USER_REQUIRED',
    message: 'Passkey registration requires either an authenticated session or a resolveUser callback when requireSession is false',
  },
  RESOLVED_USER_INVALID: { code: 'RESOLVED_USER_INVALID', message: 'Resolved user is invalid' },
  SESSION_REQUIRED: { code: 'SESSION_REQUIRED', message: 'Passkey registration requires an authenticated session' },
  UNABLE_TO_CREATE_SESSION: { code: 'UNABLE_TO_CREATE_SESSION', message: 'Unable to create session' },
  UNKNOWN_ERROR: { code: 'UNKNOWN_ERROR', message: 'Unknown error' },
  USER_NOT_FOUND: { code: 'USER_NOT_FOUND', message: 'User not found' },
  YOU_ARE_NOT_ALLOWED_TO_REGISTER_THIS_PASSKEY: {
    code: 'YOU_ARE_NOT_ALLOWED_TO_REGISTER_THIS_PASSKEY',
    message: 'You are not allowed to register this passkey',
  },
});

/**
 * No-op replacement for the real `getPasskeyActions()`.
 *
 * Every action rejects rather than resolving falsely: a passkey ceremony that
 * silently "succeeds" without the package would leave the caller believing a
 * credential exists. The rejection names the missing dependency.
 */
export function getPasskeyActions(..._args: unknown[]) {
  warnOnce('getPasskeyActions()');

  const unavailable = async () => {
    throw new Error('[@lenne.tech/nuxt-extensions] Passkey action unavailable: the optional peer dependency "@better-auth/passkey" is not installed.');
  };

  return {
    addPasskey: unavailable,
    deletePasskey: unavailable,
    listUserPasskeys: unavailable,
    signInPasskey: unavailable,
    updatePasskey: unavailable,
  };
}
