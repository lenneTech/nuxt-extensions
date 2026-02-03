// =============================================================================
// Library Exports
// =============================================================================

// Auth State utilities
export {
  attemptLtJwtSwitch,
  createLtAuthFetch,
  getLtApiBase,
  getLtAuthMode,
  getLtJwtToken,
  isLtAuthenticated,
  ltAuthFetch,
  setLtAuthMode,
  setLtJwtToken,
} from "./auth-state";

// Auth Client Factory & Plugin Registry
export {
  clearLtAuthPluginRegistry,
  createLtAuthClient,
  getOrCreateLtAuthClient,
  getLtAuthPluginRegistry,
  registerLtAuthPlugins,
  resetLtAuthClientSingleton,
  type LtAuthClient,
} from "./auth-client";
