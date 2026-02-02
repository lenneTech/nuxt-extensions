// =============================================================================
// @lenne.tech/nuxt-extensions
// =============================================================================

// Module
export { default, name, version, configKey } from "./module";

// Types
export type {
  // Auth Types
  LtAuthClientConfig,
  LtAuthMode,
  LtAuthResponse,
  LtAuthState,
  LtPasskeyAuthResult,
  LtPasskeyRegisterResult,
  LtUser,
  UseLtAuthReturn,
  // Upload Types
  LtFileInfo,
  LtUploadItem,
  LtUploadOptions,
  LtUploadProgress,
  LtUploadStatus,
  UseLtFileReturn,
  UseLtTusUploadReturn,
  // Module Types
  LtAuthModuleOptions,
  LtErrorTranslationModuleOptions,
  LtExtensionsModuleOptions,
  LtExtensionsPublicRuntimeConfig,
  LtI18nModuleOptions,
  LtTusModuleOptions,
  // Error Translation Types
  LtErrorTranslationResponse,
  LtParsedError,
  UseLtErrorTranslationReturn,
} from "./runtime/types";

// Composables
export {
  // Auth
  useLtAuth,
  useLtAuthClient,
  ltAuthClient,
  // Upload
  useLtTusUpload,
  useLtFile,
  // Share
  useLtShare,
  type UseLtShareReturn,
  // Error Translation
  useLtErrorTranslation,
} from "./runtime/composables";

// Utilities
export { ltArrayBufferToBase64Url, ltBase64UrlToUint8Array, ltSha256, tw } from "./runtime/utils";

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
} from "./runtime/lib";
