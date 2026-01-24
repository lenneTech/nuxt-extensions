/**
 * Error Translation Plugin
 *
 * Automatically loads error translations on app start.
 * Provides global helper methods: $ltTranslateError, $ltShowErrorToast
 */

import { defineNuxtPlugin, useRuntimeConfig } from "#imports";
import { useLtErrorTranslation } from "../composables/use-lt-error-translation";

export default defineNuxtPlugin(async (nuxtApp) => {
  const runtimeConfig = useRuntimeConfig();
  const config = runtimeConfig.public?.ltExtensions?.errorTranslation;

  // Skip if disabled
  if (config?.enabled === false) {
    return;
  }

  // Get composable functions
  const { loadTranslations, translateError, showErrorToast } = useLtErrorTranslation();

  // Load translations on app start
  try {
    await loadTranslations();
  } catch (error) {
    console.warn("[LtErrorTranslation] Initial load failed:", error);
  }

  // Provide helper methods globally
  nuxtApp.provide("ltTranslateError", translateError);
  nuxtApp.provide("ltShowErrorToast", showErrorToast);
});
