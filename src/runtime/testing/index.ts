/**
 * Testing Utilities for @lenne.tech/nuxt-extensions
 *
 * This module exports Playwright test helpers for E2E testing
 * of Nuxt applications using @lenne.tech/nuxt-extensions.
 *
 * @example
 * ```typescript
 * // In your test file
 * import {
 *   waitForHydration,
 *   gotoAndWaitForHydration,
 *   fillInput,
 *   generateTestUser,
 *   generateTOTP,
 * } from '@lenne.tech/nuxt-extensions/testing';
 * ```
 *
 * @packageDocumentation
 */

// Playwright helpers
export {
  // Hydration helpers
  waitForHydration,
  gotoAndWaitForHydration,
  waitForURLAndHydration,
  DEFAULT_HYDRATION_TIMEOUT,
  // Input helpers
  fillInput,
  fillInputs,
  // Test data generators
  generateTestUser,
  generateRandomString,
  // TOTP / 2FA helpers
  generateTOTP,
  extractTOTPSecret,
  parseTOTPUrl,
  // Wait helpers
  waitForElement,
  waitForNetworkIdle,
  // Assertion helpers
  hasText,
  getAllText,
  // Types
  type TestUser,
} from "./playwright-helpers";
