/**
 * System Setup Middleware
 *
 * Global middleware that redirects to the setup page when the system
 * needs initial setup (no admin user exists yet).
 *
 * - needsSetup === null -> calls checkSetupStatus()
 * - needsSetup === true AND route != setupPath -> redirect to setupPath
 * - needsSetup === false AND route === setupPath -> redirect to loginPath
 */

import { defineNuxtRouteMiddleware, navigateTo, useRuntimeConfig } from "#imports";
import { useSystemSetup } from "../composables/auth/use-system-setup";

export default defineNuxtRouteMiddleware(async (to) => {
  const runtimeConfig = useRuntimeConfig();
  const authConfig = runtimeConfig.public?.ltExtensions?.auth;
  const setupPath = authConfig?.systemSetup?.setupPath || "/auth/setup";
  const loginPath = authConfig?.loginPath || "/auth/login";

  const { needsSetup, checkSetupStatus } = useSystemSetup();

  try {
    // First check: fetch status if not yet determined
    if (needsSetup.value === null) {
      await checkSetupStatus();
    }

    if (needsSetup.value === true && to.path !== setupPath) {
      return navigateTo(setupPath);
    }

    if (needsSetup.value === false && to.path === setupPath) {
      return navigateTo(loginPath);
    }
  } catch {
    // On error, do not redirect (backward compatibility)
  }
});
