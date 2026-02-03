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
  getLtAuthPluginRegistry,
  registerLtAuthPlugins,
  setResetAuthClientCallback,
  type LtAuthClient,
} from "./auth-client";
