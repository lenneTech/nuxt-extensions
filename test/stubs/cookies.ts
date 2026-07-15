/**
 * Shared cookie helpers for the auth test suites.
 *
 * Extracted from the previously-duplicated per-file copies (is-admin,
 * merge-session-user, clear-user, auth-cookie-names, api-url-warnings). Lives
 * under `test/stubs/` so the vitest `include` glob (`test/**\/*.test.ts`) never
 * runs it as a suite.
 */

/** Expire every cookie currently in `document.cookie` (test isolation). */
export function clearAllCookies(): void {
  for (const part of document.cookie.split(';')) {
    const name = part.split('=')[0]?.trim();
    if (name) {
      document.cookie = `${name}=; path=/; max-age=0`;
    }
  }
}

/**
 * Read a single cookie's value out of `document.cookie`. Returns `undefined` when
 * the cookie is absent and `''` when only an expired stub remains (happy-dom keeps
 * the empty form; real browsers drop it).
 */
export function readCookieValue(name: string): string | undefined {
  for (const part of document.cookie.split('; ')) {
    if (!part) continue;
    const eq = part.indexOf('=');
    const key = eq === -1 ? part : part.slice(0, eq);
    if (key === name) {
      return eq === -1 ? '' : part.slice(eq + 1);
    }
  }
  return undefined;
}

/** Parse the `lt-auth-state` cookie and return its `user`, or `null` when absent/malformed. */
export function readAuthStateUser(): Record<string, unknown> | null {
  for (const part of document.cookie.split('; ')) {
    if (!part.startsWith('lt-auth-state=')) continue;
    try {
      const state = JSON.parse(decodeURIComponent(part.slice('lt-auth-state='.length)));
      if (state?.user) return state.user;
    } catch {
      // skip malformed
    }
  }
  return null;
}
