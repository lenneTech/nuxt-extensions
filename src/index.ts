// =============================================================================
// @lenne.tech/nuxt-extensions
// =============================================================================

// Module
export { default, name, version, configKey } from './module';

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
  LtSystemSetupModuleOptions,
  LtTusModuleOptions,
  // Error Translation Types
  LtErrorTranslationResponse,
  LtParsedError,
  UseLtErrorTranslationReturn,
  // AI Types
  LtAiAction,
  LtAiAvailableConnection,
  LtAiBudgetLimit,
  LtAiBudgetSummary,
  LtAiConnection,
  LtAiConnectionInput,
  LtAiConnectionPreference,
  LtAiEffectiveSlot,
  LtAiInteraction,
  LtAiMessage,
  LtAiMode,
  LtAiPlaceholder,
  LtAiPrompt,
  LtAiPromptHint,
  LtAiPromptHintInput,
  LtAiPromptInput,
  LtAiPromptRunInput,
  LtAiResponse,
  LtAiSlot,
  LtAiSlotInput,
  LtAiStreamEvent,
  LtAiStreamHandlers,
  LtAiUsage,
  LtAiUsageInfo,
  LtAiUsageScope,
  UseLtAiAdminReturn,
  UseLtAiChatOptions,
  UseLtAiChatReturn,
  UseLtAiConnectionsReturn,
  UseLtAiPlaceholdersReturn,
  UseLtAiPromptsReturn,
  UseLtAiReturn,
  UseLtAiUsageReturn,
} from './runtime/types';

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
