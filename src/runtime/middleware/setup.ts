/**
 * System Setup Middleware
 *
 * Global middleware that redirects to the setup page when the system
 * needs initial setup (no admin user exists yet).
 *
 * - needsSetup === null -> calls checkSetupStatus()
 * - needsSetup === true AND HTTP init released AND route != setupPath -> redirect to setupPath
 * - needsSetup === true AND HTTP init NOT released -> no redirect
 * - needsSetup === false AND route === setupPath -> redirect to loginPath
 *
 * Without the HTTP init (nest-server >= 12.4.0 closes it outside `local`, `ci` and `e2e`), the
 * API refuses `POST /system-setup/init` with 403 and the deployment creates its first admin from
 * its configuration. A redirect would then hold every visitor on a page whose only action fails,
 * with the login out of reach. So nothing is redirected; the setup page stays reachable and shows
 * its notice there (`useSystemSetup().httpInitEnabled === false`).
 */

import type { RouteMiddleware } from '#app';
import { defineNuxtRouteMiddleware, navigateTo, useRuntimeConfig } from '#imports';
import { useSystemSetup } from '../composables/auth/use-system-setup';

export default defineNuxtRouteMiddleware(async (to) => {
  const runtimeConfig = useRuntimeConfig();
  const authConfig = runtimeConfig.public?.ltExtensions?.auth;
  const setupPath = authConfig?.systemSetup?.setupPath || '/auth/setup';
  const loginPath = authConfig?.loginPath || '/auth/login';

  const { needsSetup, httpInitEnabled, checkSetupStatus } = useSystemSetup();

  try {
    // First check: fetch status if not yet determined
    if (needsSetup.value === null) {
      await checkSetupStatus();
    }

    // Only an explicit "not released" changes the redirect; anything else keeps the old behaviour.
    if (needsSetup.value === true && httpInitEnabled.value !== false && to.path !== setupPath) {
      return navigateTo(setupPath);
    }

    if (needsSetup.value === false && to.path === setupPath) {
      return navigateTo(loginPath);
    }
  } catch {
    // On error, do not redirect (backward compatibility)
  }
}) as RouteMiddleware;
