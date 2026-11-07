// =============================================================================
// @lenne.tech/nuxt-extensions: entry point of the VENDORED core
// =============================================================================
//
// npm mode does not publish this file. The module builder builds `src/module.ts`, so the
// package's `.` entry is `dist/module.mjs`: the module and every type. Runtime values come
// from auto-imports or from `@lenne.tech/nuxt-extensions/lib`.
//
// Vendor mode uses it. `lt fullstack init` and `convert-mode` copy it to `app/core/index.ts`
// and rewrite `from '@lenne.tech/nuxt-extensions'` to the relative `app/core`, which resolves
// here. Without this file every type import of a vendored project breaks.
//
// It re-exports whole barrels so it cannot fall behind them again: the hand-written list it
// replaced missed useLtAiSettings, useLtAiStatus and useLtOfflineSync.
// `test/package-exports.test.ts` holds both.

// Module
export { default, name, version, configKey } from './module';

// Types (single source of truth in src/runtime/types/; module.ts exports the same set)
export type * from './runtime/types';

// Composables, library helpers, utilities
export * from './runtime/composables';
export * from './runtime/lib';
export * from './runtime/utils';
