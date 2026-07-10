import { fileURLToPath } from 'node:url';

import { defineConfig, type Plugin } from 'vitest/config';

/**
 * Replace Nuxt's `import.meta.client` / `import.meta.server` injection in source
 * files so the runtime code paths that gate on those flags are reachable under
 * happy-dom. Vitest's standard `define` option does not handle `import.meta.X`
 * substitutions, so we do it via a tiny transform plugin.
 *
 * The flags resolve against a mutable global rather than a literal, so a test can
 * exercise the SSR branch via `setTestRenderScope('server')` (see
 * `test/stubs/render-scope.ts`). Substituting the literal `false` for
 * `import.meta.server` — as this shim used to — made every server branch dead code
 * that no test could ever reach. Unset defaults to the client scope, matching the
 * previous behaviour.
 */
function nuxtImportMetaShim(): Plugin {
  return {
    name: 'nuxt-import-meta-shim',
    enforce: 'pre',
    transform(code: string, id: string) {
      if (!id.includes('/src/runtime/')) return null;
      if (!code.includes('import.meta.client') && !code.includes('import.meta.server')) return null;
      const transformed = code
        .replace(/import\.meta\.client\b/g, '(globalThis.__ltTestRenderScope !== "server")')
        .replace(/import\.meta\.server\b/g, '(globalThis.__ltTestRenderScope === "server")');
      return { code: transformed, map: null };
    },
  };
}

export default defineConfig({
  plugins: [nuxtImportMetaShim()],
  resolve: {
    alias: {
      // Stub Nuxt's virtual `#imports` module so unit tests can import runtime
      // sources directly without spinning up a Nuxt context.
      '#imports': fileURLToPath(new URL('./test/stubs/imports.ts', import.meta.url)),
    },
  },
  test: {
    environment: 'happy-dom',
    include: ['test/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.d.ts', 'src/runtime/types/**'],
    },
  },
});
