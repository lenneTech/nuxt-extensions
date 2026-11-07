/**
 * Error Translation Plugin
 *
 * Loads the error translations for the current locale once the app is mounted, and provides
 * the global helpers $ltTranslateError and $ltShowErrorToast.
 *
 * The load does not hold back the start (DEV-4078). Until it is done, `translateError`
 * returns the developer message, and every template that renders it switches to the
 * translation when it arrives, because the translations live in shared state.
 *
 * It starts after the mount on purpose, not merely without `await`: server-rendered HTML
 * carries the developer message, since the server loads no translations. Translations that
 * arrived before hydration would make the client render a different text than the server
 * did (a hydration mismatch). After the mount, hydration has already seen the server's text.
 * How a project translates messages during SSR: README, "Error Translation".
 */

import type { ObjectPlugin, Plugin } from '#app';
import { defineNuxtPlugin, useRuntimeConfig } from '#imports';
import { useLtErrorTranslation } from '../composables/use-lt-error-translation';

export default defineNuxtPlugin((nuxtApp) => {
  const runtimeConfig = useRuntimeConfig();
  const config = runtimeConfig.public?.ltExtensions?.errorTranslation;

  // Skip if disabled
  if (config?.enabled === false) {
    return;
  }

  const { loadTranslations, translateError, showErrorToast } = useLtErrorTranslation();

  // Started, not awaited: `loadTranslations` logs a failure itself and never rejects.
  nuxtApp.hook('app:mounted', () => {
    void nuxtApp.runWithContext(() => loadTranslations());
  });

  // Provide helper methods globally
  nuxtApp.provide('ltTranslateError', translateError);
  nuxtApp.provide('ltShowErrorToast', showErrorToast);
}) as Plugin & ObjectPlugin;
