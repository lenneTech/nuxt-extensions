import { createError, defineEventHandler, getRequestHost, setResponseHeader, useRuntimeConfig } from '#imports';

import { resolveSecurityTxt } from '../lib/security-txt';

/**
 * Serves `/.well-known/security.txt` (RFC 9116). Registered by the module only when
 * `ltExtensions.securityTxt.enabled` is set.
 *
 * Registered without a method on purpose: scanners probe with HEAD as well as GET, and a
 * GET-only handler would answer HEAD with the 404 catch-all.
 */
export default defineEventHandler((event) => {
  const config = useRuntimeConfig(event);
  // Declared by nuxt-base-starter (`NUXT_PUBLIC_SITE_URL`); without it, Canonical comes from `hosts` only.
  const siteUrl = config.public?.siteUrl;
  const body = resolveSecurityTxt({
    config: config.ltExtensions?.securityTxt,
    now: new Date(),
    requestHost: getRequestHost(event, { xForwardedHost: true }),
    siteUrl: typeof siteUrl === 'string' ? siteUrl : undefined,
  });

  // A runtime override can blank the contact. A file without `Contact` is invalid, and
  // scanners treat an invalid file worse than a missing one.
  if (!body) {
    throw createError({ statusCode: 404, statusMessage: 'Not Found' });
  }

  setResponseHeader(event, 'content-type', 'text/plain; charset=utf-8');
  // `Expires` moves with the clock, so no cache may hold an old copy.
  setResponseHeader(event, 'cache-control', 'no-store');
  return body;
});
