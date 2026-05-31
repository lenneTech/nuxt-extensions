// =============================================================================
// Library Exports
// =============================================================================

// Auth State utilities
export {
  attemptLtJwtSwitch,
  clearLtAuthCookies,
  createLtAuthFetch,
  getLtApiBase,
  getLtAuthCookieNames,
  getLtAuthMode,
  getLtJwtToken,
  isLtAuthenticated,
  LT_AUTH_STATE_COOKIE_DEFAULT,
  LT_JWT_TOKEN_COOKIE_DEFAULT,
  ltAuthFetch,
  setLtAuthMode,
  setLtJwtToken,
} from './auth-state';

// Auth Client Factory & Plugin Registry
export {
  clearLtAuthPluginRegistry,
  createLtAuthClient,
  getOrCreateLtAuthClient,
  getLtAuthPluginRegistry,
  registerLtAuthPlugins,
  resetLtAuthClientSingleton,
  type LtAuthClient,
} from './auth-client';

// AI client helpers (URL builder, JSON request, SSE parser)
export { buildLtAiUrl, getLtAiBasePath, ltAiRequest, ltAiResponseError, parseLtAiSseStream } from './ai';
