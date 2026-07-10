/**
 * Config Check Plugin
 *
 * Reports a missing API URL once at app init instead of waiting for whichever
 * code path happens to build the first URL. The condition is read from
 * `runtimeConfig` and is fixed for the module instance, so it belongs in a
 * single boot-time check rather than in the hot `buildLtApiUrl()` path.
 *
 * Universal on purpose: SSR and the browser resolve the base URL from different
 * keys (`NUXT_API_URL` vs `NUXT_PUBLIC_API_URL`) and can be misconfigured
 * independently. On the server the plugin runs per request, but
 * `warnMissingLtApiUrl()` is one-shot, so the warning still appears exactly once
 * per process — and `buildLtApiUrl()` shares the same key, so it never repeats.
 */

import type { ObjectPlugin, Plugin } from '#app';
import { defineNuxtPlugin } from '#imports';
import { resolveLtApiBaseUrl, warnMissingLtApiUrl } from '../lib/auth-state';

export default defineNuxtPlugin(() => {
  try {
    const { missing, scope } = resolveLtApiBaseUrl();
    if (missing) {
      warnMissingLtApiUrl(scope);
    }
  } catch {
    // No runtime-config context available — buildLtApiUrl() still warns lazily.
  }
}) as ObjectPlugin & Plugin;
