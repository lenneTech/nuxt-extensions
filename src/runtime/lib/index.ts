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

// Auth Client Factory
export { createLtAuthClient, type LtAuthClient } from "./auth-client";
