// =============================================================================
// @lenne.tech/nuxt-extensions
// =============================================================================

// Module
export { default, name, version, configKey } from './module';

// Types — single source of truth in src/runtime/types/. See note in src/module.ts.
export type * from './runtime/types';

// Composables
export {
  // Auth
  useLtAuth,
  useLtAuthClient,
  ltAuthClient,
  // System Setup
  useSystemSetup,
  // Upload
  useLtTusUpload,
  useLtFile,
  // Share
  useLtShare,
  type UseLtShareReturn,
  // Error Translation
  useLtErrorTranslation,
  // AI
  useLtAi,
  useLtAiChat,
  useLtAiConnections,
  useLtAiUsage,
  useLtAiAdmin,
  useLtAiPrompts,
  useLtAiPlaceholders,
} from './runtime/composables';

// Utilities
export { ltArrayBufferToBase64Url, ltBase64UrlToUint8Array, ltSha256, tw } from './runtime/utils';

// Library (Auth State utilities & Plugin Registry)
export {
  // Auth Client Factory
  clearLtAuthPluginRegistry,
  createLtAuthClient,
  getLtAuthPluginRegistry,
  registerLtAuthPlugins,
  type LtAuthClient,
  // Auth State
  attemptLtJwtSwitch,
  createLtAuthFetch,
  getLtApiBase,
  getLtAuthMode,
  getLtJwtToken,
  isLtAuthenticated,
  ltAuthFetch,
  setLtAuthMode,
  setLtJwtToken,
  // AI client helpers
  buildLtAiUrl,
  getLtAiBasePath,
  ltAiRequest,
  ltAiResponseError,
  parseLtAiSseStream,
} from './runtime/lib';
