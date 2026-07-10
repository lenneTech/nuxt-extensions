/**
 * Test-only control over Nuxt's `import.meta.client` / `import.meta.server` flags.
 *
 * The `nuxtImportMetaShim` plugin in `vitest.config.ts` rewrites both flags to
 * read `globalThis.__ltTestRenderScope`, so a test can select the render scope a
 * runtime source sees. Without this, `import.meta.server` was substituted with the
 * literal `false` and every SSR branch was unreachable from the unit tests.
 *
 * Default (unset) is the client scope — the behaviour every existing test relies on.
 */

declare global {
  var __ltTestRenderScope: 'client' | 'server' | undefined;
}

/** Make runtime sources behave as if they ran in `scope`. */
export function setTestRenderScope(scope: 'client' | 'server'): void {
  globalThis.__ltTestRenderScope = scope;
}

/** Restore the default client scope. Call from `beforeEach` / `afterEach`. */
export function resetTestRenderScope(): void {
  globalThis.__ltTestRenderScope = undefined;
}
