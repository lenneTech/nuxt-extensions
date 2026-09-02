// =============================================================================
// Error Translation Types
// =============================================================================

import type { ComputedRef, Ref } from 'vue';

/**
 * Backend error translation response format
 * Matches the response from GET /api/i18n/errors/:locale
 */
export interface LtErrorTranslationResponse {
  errors: Record<string, string>;
}

/**
 * Parsed error from backend
 * Contains both the original and translated messages
 */
export interface LtParsedError {
  /** Raw error code (e.g., LTNS_0100) or null if no code found */
  code: string | null;
  /** Original developer message from the backend */
  developerMessage: string;
  /** Translated user-friendly message */
  translatedMessage: string;
}

/**
 * Error translation module options
 */
export interface LtErrorTranslationModuleOptions {
  /** Enable error translation feature (default: true) */
  enabled?: boolean;
  /** Default locale if not detected (default: 'de') */
  defaultLocale?: string;
}

/**
 * Return type for useLtErrorTranslation composable
 */
export interface UseLtErrorTranslationReturn {
  /**
   * Translate an error message or code to a user-friendly message.
   *
   * ALWAYS returns a usable string, which has two consequences worth knowing before you
   * write the call.
   *
   * **`translateError(x) || 'Fallback'` never reaches the fallback.** When the message
   * carries no `#CODE:` marker, the original message is returned unchanged — non-empty,
   * therefore truthy. Only an error with no message at all can produce `''`. The `||`
   * reads like a safety net, catches nothing, and hides that the untranslated English text
   * is what the user actually sees. Six pages in one starter had it before anyone noticed.
   * If you want a fallback, decide on {@link LtParsedError.code} being `null`.
   *
   * **Branch on the code, not on the message.** Backends give one message per situation
   * but not one situation per status: Better Auth answers `POST /reset-password` with five
   * different errors under the same `400`. Only the code separates them, and only codes
   * the backend has mapped arrive with a `#LTNS_` marker at all — anything unmapped falls
   * through as raw English, by design rather than by omission.
   *
   * **A raw `$fetch` error can be passed straight in.** ofetch's `FetchError` keeps the
   * transport line in `message` (`[POST] "/iam/reset-password": 400 Bad Request`) and the
   * parsed response body in `data`; extraction reads `data.message` first, so the
   * backend's own message is what gets translated. Unwrapping it at the call site
   * (`err.data?.message ?? err`) is therefore no longer necessary — it stays harmless, but
   * a helper built for it can go.
   */
  translateError: (errorOrMessage: unknown) => string;
  /** Parse a backend error to extract code and messages */
  parseError: (errorOrMessage: unknown) => LtParsedError;
  /** Show translated error as toast notification */
  showErrorToast: (errorOrMessage: unknown, title?: string) => void;
  /** Manually load translations for a locale */
  loadTranslations: (locale?: string) => Promise<void>;
  /** Check if translations are loaded for current locale */
  isLoaded: ComputedRef<boolean>;
  /** Check if translations are currently loading */
  isLoading: Ref<boolean>;
  /** Current detected locale */
  currentLocale: ComputedRef<string>;
}
