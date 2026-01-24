// =============================================================================
// Error Translation Types
// =============================================================================

import type { ComputedRef, Ref } from "vue";

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
  /** Translate an error message or code to user-friendly message */
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
