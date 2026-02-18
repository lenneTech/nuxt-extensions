// =============================================================================
// Type Exports
// =============================================================================

// Auth Types
export type {
  LtAuthClientConfig,
  LtAuthMode,
  LtAuthResponse,
  LtAuthState,
  LtPasskeyAuthResult,
  LtPasskeyRegisterResult,
  LtUser,
  UseLtAuthReturn,
} from "./auth";

// Upload Types
export type {
  LtFileInfo,
  LtUploadItem,
  LtUploadOptions,
  LtUploadProgress,
  LtUploadStatus,
  UseLtFileReturn,
  UseLtTusUploadReturn,
} from "./upload";

// Module Types
export type {
  LtAuthModuleOptions,
  LtErrorTranslationModuleOptions,
  LtExtensionsModuleOptions,
  LtExtensionsPublicRuntimeConfig,
  LtI18nModuleOptions,
  LtSystemSetupModuleOptions,
  LtTusModuleOptions,
} from "./module";

// Error Translation Types
export type {
  LtErrorTranslationResponse,
  LtParsedError,
  UseLtErrorTranslationReturn,
} from "./error";
