// =============================================================================
// Library Exports
// =============================================================================

// Auth State utilities
export {
  attemptLtJwtSwitch,
  buildLtPublicApiUrl,
  clearLtAuthCookies,
  createLtAuthFetch,
  getLtApiBase,
  getLtAuthCookieNames,
  getLtAuthMode,
  getLtJwtToken,
  isLtAuthenticated,
  isLtJwtShaped,
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

// Offline sync helpers — for a sign-out flow that does not go through `useLtAuth().signOut()`
export { buildLtSyncUrl, flushLtSyncBeforeSignOut, getLtSyncBasePath, ltSyncObjectId, ltSyncUuidV7 } from './sync';
export { deleteLtSyncDatabase } from './sync-store';
