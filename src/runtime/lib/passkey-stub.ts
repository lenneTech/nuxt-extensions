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
 */

let warned = false;

/**
 * No-op replacement for the real `passkeyClient()` Better-Auth client plugin.
 *
 * Returns a plugin with a deliberately distinct `id`: claiming `'passkey'` would
 * make Better-Auth expose passkey actions that cannot work without the package.
 */
export function passkeyClient() {
  if (!warned) {
    warned = true;
    console.warn(
      '[@lenne.tech/nuxt-extensions] Passkey support is unavailable: the optional peer dependency "@better-auth/passkey" is not installed. ' +
        'Install it to use passkeys, or pass `enablePasskey: false` to createLtAuthClient() to silence this warning.',
    );
  }

  return { id: 'lt-passkey-unavailable' as const };
}
