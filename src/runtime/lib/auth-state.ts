/**
 * Shared authentication state for Cookie/JWT dual-mode authentication
 *
 * This module provides a reactive state that is shared between:
 * - auth-client.ts (uses it for customFetch)
 * - use-lt-auth.ts (manages the state)
 *
 * Auth Mode Strategy:
 * 1. Primary: Session cookies (more secure, HttpOnly)
 * 2. Fallback: JWT tokens (when cookies are not available/working)
 *
 * The state is persisted in cookies for SSR compatibility.
 */

import { useRuntimeConfig } from '#imports';
import type { LtAuthMode, LtAuthState } from '../types';

// =============================================================================
// Cookie Name Resolution
// =============================================================================

/** Default name of the auth-state cookie. Used when the module config has not been resolved yet. */
export const LT_AUTH_STATE_COOKIE_DEFAULT = 'lt-auth-state';
/** Default name of the JWT-token cookie. Used when the module config has not been resolved yet. */
export const LT_JWT_TOKEN_COOKIE_DEFAULT = 'lt-jwt-token';

/**
 * Sanitise a raw prefix into a valid cookie-name token. Only RFC 6265
 * token characters survive (`[A-Za-z0-9._-]`); surrounding whitespace and any
 * illegal character (space, `;`, `=`, …) are stripped so a typo can never
 * produce a malformed `Set-Cookie` name. Returns `''` for non-strings / empties.
 */
function sanitizeCookiePrefix(raw: unknown): string {
  if (typeof raw !== 'string') {
    return '';
  }
  return raw.trim().replace(/[^A-Za-z0-9._-]/g, '');
}

/**
 * Resolve the cookie prefix that drives the auth cookie names.
 *
 * A single, dedicated, OPT-IN knob with a safe default:
 *   - **`cookiePrefix`** (`NUXT_PUBLIC_COOKIE_PREFIX` →
 *     `runtimeConfig.public.cookiePrefix`) → `<prefix>-auth-state` /
 *     `<prefix>-jwt-token`. Lets a project run with its own cookie namespace —
 *     e.g. several lenne.tech apps on a shared host during development, where
 *     cookies collide by host (not port) and would otherwise read each other's
 *     `lt-auth-state` (a "ghost" user from the other project).
 *   - otherwise `''` → the default `lt-auth-state` / `lt-jwt-token`.
 *
 * `storagePrefix` deliberately does NOT influence the cookie name. It is a
 * localStorage-namespacing convention; coupling it to cookies would silently
 * rename auth cookies on a mere upgrade (logging every user out, bouncing valid
 * sessions in custom middleware that reads `lt-auth-state` directly) and force
 * frontend/backend to be deployed in lockstep. Cookie naming is therefore
 * controlled ONLY by this explicit, opt-in knob → fully backward compatible.
 *
 * IMPORTANT: when you set `cookiePrefix`, mirror it on the backend
 * (`COOKIE_PREFIX` env — see nest-server `resolveBetterAuthCookiePrefix`) so
 * both sides always agree on the cookie name.
 */
export function resolveLtCookiePrefix(pub: null | Record<string, any> | undefined): string {
  return sanitizeCookiePrefix(pub?.cookiePrefix);
}

/**
 * Resolve the configured auth cookie names from runtime config.
 *
 * **Per-project isolation (collision avoidance).** Cookies are scoped by
 * host+path, NOT by port. Two lenne.tech apps sharing a host during development
 * (e.g. both on `localhost`) would otherwise read each other's `lt-auth-state`
 * cookie — surfacing a "ghost" user from the other project. The cookie name is
 * therefore derived from a per-project prefix (see {@link resolveLtCookiePrefix}).
 *
 * Resolution order:
 *   1. an explicitly configured `cookieNames.state/token` (exact name) always wins;
 *   2. otherwise `<prefix>-auth-state` / `<prefix>-jwt-token` where `prefix`
 *      comes from {@link resolveLtCookiePrefix} (the opt-in `cookiePrefix`);
 *   3. otherwise fall back to the legacy `lt-auth-state` / `lt-jwt-token`
 *      (backward compatible — no behaviour change for apps without a prefix).
 *
 * Falls back to the defaults so callers keep working even outside a Nuxt
 * context (tests, edge SSR boots).
 */
export function getLtAuthCookieNames(): { state: string; token: string } {
  try {
    const runtimeConfig = useRuntimeConfig();
    const pub = runtimeConfig.public as Record<string, any>;
    const configured = pub?.ltExtensions?.auth?.cookieNames;
    const prefix = resolveLtCookiePrefix(pub);

    // An explicit config value (anything other than the module default) wins;
    // otherwise derive from the resolved prefix; otherwise keep the legacy name.
    const state = configured?.state && configured.state !== LT_AUTH_STATE_COOKIE_DEFAULT ? configured.state : prefix ? `${prefix}-auth-state` : LT_AUTH_STATE_COOKIE_DEFAULT;
    const token = configured?.token && configured.token !== LT_JWT_TOKEN_COOKIE_DEFAULT ? configured.token : prefix ? `${prefix}-jwt-token` : LT_JWT_TOKEN_COOKIE_DEFAULT;
    return { state, token };
  } catch {
    return { state: LT_AUTH_STATE_COOKIE_DEFAULT, token: LT_JWT_TOKEN_COOKIE_DEFAULT };
  }
}

/**
 * Resolve the authoritative auth state from a raw `Cookie` header /
 * `document.cookie` string, tolerating **multiple** auth-state cookies with the
 * same name.
 *
 * A deployed setup can end up with TWO auth-state cookies in parallel — a
 * host-only one (written by `useCookie` / `setUser`) and a domain-scoped one
 * (e.g. set by a backend SAML callback with `Domain=<appHost>` so it is
 * readable across `app` and `api.app`). They can disagree: one carries the
 * signed-in user, the other a stale `{ user: null }` left behind by a partial
 * clear. A naive single-value read (`useCookie`, or `document.cookie.find`)
 * may pick the stale twin and wrongly report the user as logged out — which
 * makes SSR auth guards bounce a perfectly valid session to the login page.
 *
 * This scans ALL matching entries and prefers the one that actually carries a
 * `user`; only when none do does it return the (user-less) fallback state.
 *
 * SECURITY NOTE: preferring the user-bearing twin is intentional and required —
 * preferring the `{ user: null }` twin is exactly what caused the random logout.
 * `lt-auth-state` is a NON-authoritative client convenience cache for the app
 * shell, NOT the session identifier (that is the httpOnly session cookie, e.g.
 * `iam.session_token`). A forged/injected user-bearing cookie therefore yields
 * at most UI spoofing ("looks logged in") — every real API/server call still
 * authenticates against the httpOnly session and 401s. This trust boundary is
 * unchanged by the duplicate-tolerant read; it only decides which twin wins.
 */
export function resolveLtAuthState(cookieString: string, stateCookieName?: string): LtAuthState | null {
  const name = stateCookieName || getLtAuthCookieNames().state;
  const prefix = `${name}=`;
  let fallback: LtAuthState | null = null;
  for (const entry of (cookieString || '').split('; ')) {
    if (!entry.startsWith(prefix)) continue;
    try {
      const state = JSON.parse(decodeURIComponent(entry.slice(prefix.length))) as LtAuthState;
      if (state?.user) {
        return state;
      }
      if (state) {
        fallback = state;
      }
    } catch {
      // Skip malformed cookie entries
    }
  }
  return fallback;
}

// =============================================================================
// One-shot Warnings
// =============================================================================

/**
 * Keys of the warnings this module instance has already emitted.
 *
 * The conditions behind these warnings (missing API URL, implicit dev proxy) are
 * read from `runtimeConfig` and are therefore constant for the lifetime of the
 * module instance — repeating a warning per call carries no new information and
 * drowns surrounding output. One module instance means once per page load in the
 * client bundle, once per process in the server bundle.
 */
const warnedKeys = new Set<string>();

/** Emit `message` the first time `key` is seen; ignore every later call. */
function warnOnce(key: string, message: string): void {
  if (warnedKeys.has(key)) {
    return;
  }
  warnedKeys.add(key);
  console.warn(message);
}

/**
 * Clear the one-shot warning state.
 *
 * INTERNAL — test-only. Module-scope state survives every test in a file that
 * does not call `vi.resetModules()`, which would make assertions on these
 * warnings depend on test order. Production code must never call this.
 */
export function resetLtWarnOnceState(): void {
  warnedKeys.clear();
}

// =============================================================================
// API Proxy Detection
// =============================================================================

/**
 * Determines if HTTP requests should use the Nuxt Vite dev proxy.
 *
 * When `true`, client-side requests are prefixed with `/api/` so the
 * Vite dev server can forward them to the backend. The proxy strips
 * the `/api/` prefix before forwarding, so the backend receives the
 * original path (e.g., `/iam/sign-in`, `/i18n/errors/de`).
 *
 * **Why a proxy?**
 * In local development the frontend (localhost:3001) and backend
 * (localhost:3000) run on different ports. Browsers enforce same-origin
 * policy for cookies, which breaks session-based authentication.
 * The Vite proxy makes all requests appear same-origin.
 *
 * **How is this controlled?**
 * Set `NUXT_PUBLIC_API_PROXY=true` in your `.env` file to enable the proxy.
 * Nuxt auto-maps this to `runtimeConfig.public.apiProxy`.
 * This should ONLY be enabled for local development (`nuxt dev`).
 * On deployed stages (develop, test, preview, production) the proxy
 * must NOT be enabled — requests go directly to the backend.
 *
 * **Fallback:** If `apiProxy` is not configured, the function checks
 * whether the app runs under `nuxt dev` (buildId === 'dev'). If so,
 * the proxy is activated with a prominent console warning so the
 * implicit activation is immediately visible.
 *
 * **SSR never uses the proxy** — server-side requests call the backend
 * directly via `runtimeConfig.apiUrl`.
 *
 * @returns true if the `/api/` proxy prefix should be used for client requests
 *
 * @see https://github.com/lenneTech/nuxt-base-starter — Vite proxy configuration
 */
export function isLocalDevApiProxy(): boolean {
  // SSR: always call backend directly — no proxy needed
  if (import.meta.server) {
    return false;
  }
  return isLtApiProxyConfigured();
}

/**
 * Whether the browser's requests use the dev-proxy prefix, read from the runtime config alone.
 *
 * Same answer during SSR and in the browser, unlike {@link isLocalDevApiProxy}, which is `false` on
 * the server because the server itself never goes through the proxy. For URLs the server renders
 * and the browser follows (see {@link buildLtPublicApiUrl}).
 */
function isLtApiProxyConfigured(): boolean {
  try {
    const runtimeConfig = useRuntimeConfig();
    const apiProxy = (runtimeConfig.public as Record<string, unknown>)?.apiProxy;

    // Explicit configuration: NUXT_PUBLIC_API_PROXY=true
    if (apiProxy !== undefined && apiProxy !== null && apiProxy !== '') {
      return apiProxy === true || apiProxy === 'true';
    }

    // Fallback: activate proxy under `nuxt dev` with a warning
    const buildId = (runtimeConfig as Record<string, unknown>)?.app && ((runtimeConfig as Record<string, unknown>).app as Record<string, unknown>)?.buildId;
    if (buildId === 'dev') {
      warnOnce(
        'api-proxy-fallback',
        '\n⚠️  [LtExtensions] API proxy activated implicitly because nuxt dev was detected.\n' +
          '    To make this explicit, add NUXT_PUBLIC_API_PROXY=true to your .env file.\n' +
          '    If you do NOT want the proxy, set NUXT_PUBLIC_API_PROXY=false.\n',
      );
      return true;
    }

    return false;
  } catch {
    return false;
  }
}

// =============================================================================
// API URL Builder
// =============================================================================

/**
 * The warning emitted when no API URL is configured, per render scope.
 *
 * Keyed by scope rather than passed in by the caller: the wording and the env
 * var to set follow from the scope alone, so a lookup makes a caller/message
 * mismatch (telling a browser to set the server-only `NUXT_API_URL`) impossible.
 */
const MISSING_API_URL_WARNING: Record<'client' | 'server', string> = {
  client:
    '[LtExtensions] No API URL configured. Set NUXT_PUBLIC_API_URL. ' +
    'API paths stay relative and resolve against the app origin, so auth and setup calls ' +
    '404 unless the app is served behind a same-origin reverse proxy.',
  server:
    '[LtExtensions] No API URL configured for SSR. Set NUXT_API_URL or NUXT_PUBLIC_API_URL. ' +
    'API paths stay relative, so server-side requests never reach the backend: $fetch ' +
    'sends them to this Nitro server itself and global fetch rejects them as an invalid URL.',
};

/** Strip any trailing slashes so `${baseUrl}${path}` never produces a double slash. */
function stripTrailingSlashes(url: string): string {
  return url.replace(/\/+$/, '');
}

/**
 * Outcome of resolving the API base URL for the current render scope.
 *
 * INTERNAL — plumbing for {@link buildLtApiUrl} and the `lt-config-check` plugin.
 * Not part of the public API (absent from the package barrels and auto-imports);
 * reachable only via a deep path import. Shape may change without a major bump.
 */
export interface LtApiUrlResolution {
  /** Base URL to prefix onto API paths. `'/api'` in proxy mode, `''` when unresolved. */
  baseUrl: string;
  /** `true` when no API URL is configured for {@link scope}. */
  missing: boolean;
  /** `true` when the Vite dev proxy prefix is in use (see {@link isLocalDevApiProxy}). */
  proxy: boolean;
  /** The render scope the resolution was performed for. */
  scope: 'client' | 'server';
}

/**
 * Resolve the API base URL for the current render scope.
 *
 * INTERNAL — plumbing shared by {@link buildLtApiUrl} and the `lt-config-check`
 * plugin; not part of the public API (absent from the barrels and auto-imports).
 *
 * Pure: it reads `runtimeConfig` and reports what it found, but never logs and
 * never mutates. The `missing` flag lets callers decide how to surface the
 * misconfiguration — {@link buildLtApiUrl} warns lazily, the `lt-config-check`
 * plugin warns eagerly at app init. Both funnel through the same one-shot key,
 * so the user sees exactly one warning either way.
 *
 * Throws when called outside a Nuxt runtime-config context; callers catch.
 */
export function resolveLtApiBaseUrl(): LtApiUrlResolution {
  const runtimeConfig = useRuntimeConfig();
  const publicUrl = (runtimeConfig.public as Record<string, string>).apiUrl || '';
  const authBaseURL = (runtimeConfig.public as Record<string, any>)?.ltExtensions?.auth?.baseURL || '';

  if (import.meta.server) {
    const apiUrl = (runtimeConfig as Record<string, string>).apiUrl || publicUrl || authBaseURL;
    return { baseUrl: stripTrailingSlashes(apiUrl), missing: !apiUrl, proxy: false, scope: 'server' };
  }

  if (isLocalDevApiProxy()) {
    return { baseUrl: '/api', missing: false, proxy: true, scope: 'client' };
  }

  const apiUrl = publicUrl || authBaseURL;
  return { baseUrl: stripTrailingSlashes(apiUrl), missing: !apiUrl, proxy: false, scope: 'client' };
}

/**
 * Warn — at most once per module instance — that no API URL is configured.
 *
 * INTERNAL — shared by {@link buildLtApiUrl} and the `lt-config-check` plugin so
 * an eager boot-time check and a lazy first-URL check never double-report. Not
 * part of the public API (absent from the barrels and auto-imports).
 */
export function warnMissingLtApiUrl(scope: 'client' | 'server'): void {
  warnOnce(`missing-api-url:${scope}`, MISSING_API_URL_WARNING[scope]);
}

/**
 * Build a full API URL for a given path, handling SSR, proxy, and direct modes.
 *
 * ## Resolution Strategy
 *
 * All environment variables are resolved **at runtime** by Nuxt's built-in
 * `NUXT_*` → `runtimeConfig` mapping. The module only declares empty default
 * keys at build time so Nuxt knows which keys to override.
 *
 * ### SSR (Server-Side Rendering)
 * Fallback chain: `NUXT_API_URL` → `NUXT_PUBLIC_API_URL` → `auth.baseURL` → `""` (warns)
 *
 * `NUXT_API_URL` allows using an internal network address (e.g., `http://api.svc.cluster.local`)
 * that is never exposed to the client bundle. If not set, the public URL is used.
 *
 * ### Client + Proxy (`NUXT_PUBLIC_API_PROXY=true`)
 * Returns `/api{path}` — the Vite dev proxy forwards to the backend and strips `/api`.
 * This ensures same-origin requests for cookies/WebAuthn. **Only for local development.**
 *
 * ### Client direct (deployed instances)
 * Fallback chain: `NUXT_PUBLIC_API_URL` → `auth.baseURL` → `""` (warns)
 *
 * ## Deployment Scenarios
 *
 * | Scenario                 | Env Vars                                      | SSR Result              | Client Result           |
 * |--------------------------|-----------------------------------------------|-------------------------|-------------------------|
 * | Local dev + proxy        | `PUBLIC_API_URL=localhost:3000, API_PROXY=true`| `localhost:3000{path}`  | `/api{path}` (proxy)    |
 * | Production (simple)      | `PUBLIC_API_URL=api.example.com`               | `api.example.com{path}` | `api.example.com{path}` |
 * | Production (internal)    | `PUBLIC_API_URL=..., API_URL=api-internal:3000`| `api-internal:3000{path}` | `api.example.com{path}` |
 * | Legacy (nuxt.config only)| `auth.baseURL` in config                       | `{baseURL}{path}`       | `{baseURL}{path}`       |
 *
 * Trailing slashes on the base URL are automatically stripped.
 *
 * A missing API URL is reported at most once per module instance — the condition
 * is constant for the process, so repeating it per call only drowns other output.
 *
 * @param path - The API path (e.g., `/system-setup/status`, `/i18n/errors/de`)
 */
export function buildLtApiUrl(path: string): string {
  try {
    const { baseUrl, missing, scope } = resolveLtApiBaseUrl();
    if (missing) {
      warnMissingLtApiUrl(scope);
    }
    return `${baseUrl}${path}`;
  } catch {
    return path;
  }
}

/**
 * The URL the browser uses for an API path, built the same way during SSR.
 *
 * For links and `src` attributes the server renders and the browser then follows (file links of
 * `useLtFile()`): {@link buildLtApiUrl} would put the server-only `NUXT_API_URL` (an internal
 * cluster address) into the HTML during SSR, and behind the dev proxy the server and the browser
 * would render different strings, a hydration mismatch. Requests the server makes itself keep
 * using {@link buildLtApiUrl}.
 *
 * `/api` + path while the dev proxy is on, otherwise `NUXT_PUBLIC_API_URL` (or `auth.baseURL`) +
 * path; relative (with the one-shot warning) when neither is configured.
 *
 * @param path - The API path (e.g. `/files/abc`)
 */
export function buildLtPublicApiUrl(path: string): string {
  try {
    if (isLtApiProxyConfigured()) {
      return `/api${path}`;
    }
    const pub = useRuntimeConfig().public as Record<string, any>;
    const publicUrl = pub.apiUrl || pub.ltExtensions?.auth?.baseURL || '';
    if (!publicUrl) {
      warnMissingLtApiUrl('client');
    }
    return `${stripTrailingSlashes(publicUrl)}${path}`;
  } catch {
    return path;
  }
}

// =============================================================================
// Auth State Functions
// =============================================================================

/**
 * Get the current auth mode from cookie
 */
export function getLtAuthMode(): LtAuthMode {
  if (import.meta.server) return 'cookie';

  // Duplicate-tolerant read (prefers the user-bearing cookie when a stale twin
  // exists) so the auth mode is not read off a `{ user: null }` shadow.
  return resolveLtAuthState(document.cookie)?.authMode || 'cookie';
}

/**
 * Whether `value` has the shape of a JWT: three dot-separated segments, the header starting with
 * `eyJ` (base64url of `{"`). The same test as nest-server's `isJwtShaped`
 * (`core-better-auth-token.helper.ts`), so client and server agree about one token.
 *
 * The token cookie (`lt-jwt-token`) is readable by every script on the page, so it may hold a JWT
 * and nothing else. Better-Auth's opaque session token (what the API keeps in the httpOnly
 * `iam.session_token` cookie) also turns up in response bodies: `two-factor/verify-totp` and
 * `verify-backup-code` answer `{ token, user }`, `passkey/verify-authentication` answers
 * `{ session, user }`. Stored as the "JWT", it was one XSS away from the attacker, for the
 * session's whole lifetime.
 */
export function isLtJwtShaped(value: unknown): value is string {
  return typeof value === 'string' && value.startsWith('eyJ') && value.split('.').length === 3;
}

/** Expires the token cookie on both slots (host-only and domain-scoped), as `clearLtAuthCookies()` does. */
function expireLtJwtTokenCookie(tokenCookieName: string): void {
  const secure = globalThis.location?.protocol === 'https:' ? '; secure' : '';
  const host = globalThis.location?.hostname;
  document.cookie = `${tokenCookieName}=; path=/; max-age=0; samesite=lax${secure}`;
  if (host) {
    document.cookie = `${tokenCookieName}=; path=/; max-age=0; samesite=lax${secure}; domain=${host}`;
  }
}

/**
 * Get the JWT token from cookie.
 *
 * Anything in the token cookie that is not a JWT is deleted, not returned: a session token an
 * earlier version (or a hand-written 2FA page) stored there stays readable by any script until
 * it expires, so it is removed on the first read.
 */
export function getLtJwtToken(): string | null {
  if (import.meta.server) return null;

  try {
    const { token: tokenCookieName } = getLtAuthCookieNames();
    const cookiePrefix = `${tokenCookieName}=`;
    // Duplicate-tolerant: when host-only + domain-scoped twins coexist, prefer
    // the first NON-EMPTY token instead of whatever `.find()` happens to return
    // (which could be an empty/cleared twin) — mirrors resolveLtAuthState.
    for (const row of document.cookie.split('; ')) {
      if (!row.startsWith(cookiePrefix)) continue;
      const raw = decodeURIComponent(row.slice(cookiePrefix.length));
      // Handle JSON-encoded string (useCookie stores as JSON)
      const value = raw.startsWith('"') && raw.endsWith('"') ? (JSON.parse(raw) as string) : raw;
      if (!value) continue;
      if (!isLtJwtShaped(value)) {
        expireLtJwtTokenCookie(tokenCookieName);
        if (getLtAuthMode() === 'jwt') setLtAuthMode('cookie');
        return null;
      }
      return value;
    }
  } catch {
    // Ignore parse errors
  }
  return null;
}

/**
 * Set JWT token in cookie. A value that is not a JWT is refused and clears the cookie instead
 * (see {@link isLtJwtShaped}).
 */
export function setLtJwtToken(token: string | null): void {
  if (import.meta.server) return;

  const { token: tokenCookieName } = getLtAuthCookieNames();
  const maxAge = 60 * 60 * 24 * 7; // 7 days
  const secure = globalThis.location?.protocol === 'https:' ? '; secure' : '';
  if (token && isLtJwtShaped(token)) {
    document.cookie = `${tokenCookieName}=${encodeURIComponent(JSON.stringify(token))}; path=/; max-age=${maxAge}; samesite=lax${secure}`;
  } else {
    expireLtJwtTokenCookie(tokenCookieName);
  }
}

/**
 * Hard-delete all auth cookies on logout.
 *
 * This is the single source of truth for "remove every auth cookie this
 * module owns". It expires:
 * - the configured auth-state cookie (default `lt-auth-state`)
 * - the configured JWT token cookie (default `lt-jwt-token`)
 * - the Better-Auth session fallbacks the client may have set
 *
 * Browsers only delete a cookie when the path / sameSite / secure
 * attributes match the ones used when it was written, so we mirror the
 * attributes from `setUser()` / `setLtJwtToken()`. The Better-Auth
 * session cookies are httpOnly when set by the API and cannot be touched
 * from JS — clearing them here is best-effort for any non-httpOnly
 * variant the framework might have written client-side.
 */
export function clearLtAuthCookies(): void {
  if (import.meta.server) return;

  const { state: stateCookieName, token: tokenCookieName } = getLtAuthCookieNames();
  const secure = globalThis.location?.protocol === 'https:' ? '; secure' : '';
  // Domain-scoped twin attribute. A backend SAML callback may set the
  // auth-state cookie with `Domain=<appHost>` so it is shared across `app` and
  // `api.app`. The browser stores that as a SEPARATE cookie slot from the
  // host-only one `useCookie`/`setUser` write — clearing only host-only leaves
  // the domain-scoped twin behind, which then shadows a fresh login and was the
  // root cause of the "random session loss" loop. So we expire BOTH slots.
  const host = globalThis.location?.hostname;
  const domainAttr = host ? `; domain=${host}` : '';

  // Hard-delete the auth-state cookie on BOTH slots: max-age=0 with the same
  // attributes used by setUser() so the browser actually drops it.
  document.cookie = `${stateCookieName}=; path=/; max-age=0; samesite=lax${secure}`;
  if (domainAttr) {
    document.cookie = `${stateCookieName}=; path=/; max-age=0; samesite=lax${secure}${domainAttr}`;
  }

  // JWT token cookie — mirror setLtJwtToken's clear branch (both slots).
  document.cookie = `${tokenCookieName}=; path=/; max-age=0; samesite=lax${secure}`;
  if (domainAttr) {
    document.cookie = `${tokenCookieName}=; path=/; max-age=0; samesite=lax${secure}${domainAttr}`;
  }

  // Best-effort: clear Better-Auth client-side session cookies. These are
  // usually httpOnly (set by the API) and unreachable from JS, but covering
  // all known variants keeps stale entries out of the jar when a project
  // disables httpOnly for local debugging.
  const sessionCookieNames = ['better-auth.session_token', 'better-auth.session', '__Secure-better-auth.session_token', 'session_token', 'session'];
  for (const name of sessionCookieNames) {
    for (const path of ['/', '/api', '/api/iam', '/iam']) {
      document.cookie = `${name}=; path=${path}; max-age=0`;
      if (domainAttr) {
        document.cookie = `${name}=; path=${path}; max-age=0${domainAttr}`;
      }
    }
  }
}

/**
 * Update auth mode in the auth-state cookie
 */
export function setLtAuthMode(mode: LtAuthMode): void {
  if (import.meta.server) return;

  try {
    const { state: stateCookieName } = getLtAuthCookieNames();
    // Duplicate-tolerant read so we merge `authMode` INTO the user-bearing twin
    // instead of a stale `{ user: null }` shadow (which would drop the user).
    const existing = resolveLtAuthState(document.cookie, stateCookieName);
    const state = { ...(existing ?? { user: null }), authMode: mode };

    const maxAge = 60 * 60 * 24 * 7; // 7 days
    const secure = globalThis.location?.protocol === 'https:' ? '; secure' : '';
    document.cookie = `${stateCookieName}=${encodeURIComponent(JSON.stringify(state))}; path=/; max-age=${maxAge}; samesite=lax${secure}`;
  } catch {
    // Ignore errors
  }
}

/**
 * Get the API base URL for auth (IAM) requests.
 *
 * Uses {@link isLocalDevApiProxy} to determine the URL strategy:
 * - **Proxy mode** (`NUXT_PUBLIC_API_PROXY=true`): Returns `/api{basePath}`
 *   (e.g., `/api/iam`) so the Vite dev proxy forwards the request to the backend.
 * - **Direct mode** (proxy disabled or not set): Returns `{baseURL}{basePath}`
 *   (e.g., `https://api.example.com/iam`) for direct backend calls.
 *
 * @param basePath - The auth API base path. If not provided, reads from runtime config (default: '/iam')
 */
export function getLtApiBase(basePath?: string): string {
  if (!basePath) {
    try {
      const runtimeConfig = useRuntimeConfig();
      basePath = (runtimeConfig.public as Record<string, any>)?.ltExtensions?.auth?.basePath;
    } catch {
      // Ignore — use default
    }
  }
  return buildLtApiUrl(basePath || '/iam');
}

/**
 * `GET <auth>/token` with the session cookie: a fresh JWT, or `null` (refused, not JWT-shaped, offline).
 *
 * INTERNAL — the one place a JWT is fetched: {@link attemptLtJwtSwitch}, the 401 recovery of
 * {@link createLtAuthFetch} and `useLtAuth().switchToJwtMode()` all go through it. Not part of the
 * public API (absent from the barrels and auto-imports).
 *
 * @param basePath - The auth API base path; `auth.basePath` from the runtime config when omitted
 */
export async function requestLtJwt(basePath?: string): Promise<null | string> {
  try {
    const response = await fetch(`${getLtApiBase(basePath)}/token`, {
      credentials: 'include',
      method: 'GET',
    });
    if (!response.ok) {
      return null;
    }
    const data = (await response.json()) as null | { token?: unknown };
    const token = data?.token;
    return isLtJwtShaped(token) ? token : null;
  } catch {
    return null;
  }
}

/**
 * Attempt to switch to JWT mode by fetching a token
 *
 * @param basePath - The auth API base path; `auth.basePath` from the runtime config when omitted
 */
export async function attemptLtJwtSwitch(basePath?: string): Promise<boolean> {
  const token = await requestLtJwt(basePath);
  if (!token) {
    return false;
  }
  ltCookieAuthFetchState.adoptJwt(token);
  console.debug('[LtAuth] Switched to JWT mode');
  return true;
}

/**
 * Check if user is authenticated (has auth-state with user)
 */
export function isLtAuthenticated(): boolean {
  if (import.meta.server) return false;

  // Duplicate-tolerant read: true when ANY auth-state cookie carries a user,
  // so a stale `{ user: null }` twin can't mask a valid session.
  return !!resolveLtAuthState(document.cookie)?.user;
}

// =============================================================================
// Authenticated Fetch
// =============================================================================

/**
 * Paths that need the session cookie even in JWT mode, for a fetch that otherwise omits cookies
 * there (`cookiesInJwtMode: 'auth-paths'`, which `useLtAuth().fetchWithAuth` uses).
 *
 * Better-Auth's Passkey and 2FA operations need the session cookie for challenge/verification
 * token handling.
 *
 * `/get-session` belongs here for a different reason: it reads the session COOKIE and nothing
 * else. The JWT handed out by `/token` is not a session token, so a bearer-only request does not
 * fail loudly — Better Auth answers `200` with a `null` body, exactly as it would for a signed-out
 * visitor. Callers that probe this endpoint to find out whether a session is still alive (the auth
 * interceptor does, before logging anyone out) would read that as "session is dead" for every
 * authenticated user in JWT mode, and a single 401 from a mere permission error would end the
 * session. That was effectively every user: each successful login pre-fetches a JWT, and
 * `switchToJwtMode()` flips `authMode` to `'jwt'` when it succeeds.
 */
const LT_PATHS_REQUIRING_COOKIES = ['/passkey/', '/two-factor/', '/2fa/', '/get-session'];

/** Whether `url` needs the session cookie even in JWT mode (see {@link LT_PATHS_REQUIRING_COOKIES}). */
function ltUrlRequiresCookies(url: string): boolean {
  return LT_PATHS_REQUIRING_COOKIES.some((path) => url.includes(path));
}

/** The path of an absolute or relative URL (`https://api.example.com/iam/x?y` → `/iam/x`). */
function ltUrlPath(url: string): string {
  try {
    return new URL(url, 'http://lt.invalid').pathname;
  } catch {
    return url;
  }
}

/**
 * Whether `url` is one of Better-Auth's own routes (under the auth API base, e.g. `/iam/sign-in/email`).
 *
 * Compared by path: behind the dev proxy the auth base is the relative `/api/iam`, while the
 * Better-Auth client, built without a baseURL, sends absolute URLs on `window.location.origin`.
 */
function isLtAuthRoute(url: string, basePath?: string): boolean {
  const base = ltUrlPath(getLtApiBase(basePath)).replace(/\/+$/, '');
  const path = ltUrlPath(url);
  return path === base || path.startsWith(`${base}/`);
}

/**
 * Where a caller of the authenticated fetch keeps its auth mode and its JWT.
 *
 * INTERNAL — `useLtAuth()` hands in its own `useCookie` refs, so its `fetchWithAuth` reads and
 * writes what the composable shows; every other caller uses the browser cookies. Not part of the
 * public API.
 */
export interface LtAuthFetchState {
  /** Store a freshly fetched JWT and switch to JWT mode. */
  adoptJwt: (token: string) => void;
  isAuthenticated: () => boolean;
  jwtToken: () => null | string;
  mode: () => LtAuthMode;
}

/** INTERNAL — options of {@link createLtAuthFetchFor}. */
export interface LtAuthFetchOptions {
  /** The auth API base path for the JWT; `auth.basePath` from the runtime config when omitted. */
  basePath?: string;
  /**
   * Cookies in JWT mode. `'always'` (default): the session cookie rides along, and nest-server
   * (>= 11.13.1) falls back to it when the bearer fails; Better-Auth's own routes read the session
   * from it. `'auth-paths'`: only {@link LT_PATHS_REQUIRING_COOKIES} get it, as in
   * `useLtAuth().fetchWithAuth` (and ng-base's auth fetch).
   */
  cookiesInJwtMode?: 'always' | 'auth-paths';
  state: LtAuthFetchState;
}

/** The auth state in the browser cookies: what `ltAuthFetch` and the Better-Auth client use. */
const ltCookieAuthFetchState: LtAuthFetchState = {
  adoptJwt: (token) => {
    setLtJwtToken(token);
    setLtAuthMode('jwt');
  },
  isAuthenticated: isLtAuthenticated,
  jwtToken: getLtJwtToken,
  mode: getLtAuthMode,
};

/**
 * In-flight JWT fetch after a 401 (client only), shared by every authenticated fetch, so a burst of
 * parallel 401s costs one `/token` request: the switch from cookie to JWT and the renewal of an
 * expired JWT alike. Resolves to the token itself, which each caller then stores where it keeps its
 * own (see {@link LtAuthFetchState.adoptJwt}). On the server the module scope is shared across
 * requests, so a shared promise would hand one request another request's token: each fetches its own.
 */
let ltJwtAfter401: null | Promise<null | string> = null;

function requestLtJwtAfter401(basePath?: string): Promise<null | string> {
  if (!import.meta.client) {
    return requestLtJwt(basePath);
  }
  if (!ltJwtAfter401) {
    ltJwtAfter401 = requestLtJwt(basePath).finally(() => {
      ltJwtAfter401 = null;
    });
  }
  return ltJwtAfter401;
}

/**
 * The authenticated fetch, one implementation for every caller.
 *
 * INTERNAL — `useLtAuth().fetchWithAuth` builds itself from it with its own state; everyone else
 * uses {@link createLtAuthFetch} / {@link ltAuthFetch}. Not part of the public API.
 *
 * 1. JWT mode adds `Authorization: Bearer <jwt>`; cookies follow `cookiesInJwtMode`.
 * 2. A 401 while signed in fetches a JWT once (shared by the burst, see {@link requestLtJwtAfter401})
 *    and retries the request once with it. In cookie mode that is the switch to JWT; in JWT mode the
 *    bearer was most likely expired: the JWT lives 15 minutes, the session behind it 7 days, and
 *    nothing renews it while the user works.
 * 3. A 401 that survives the fresh token, or one no token can be fetched for, reaches the caller
 *    unchanged. So does a 401 in JWT mode that the bearer did not cause: with `'auth-paths'` on a
 *    cookie-bound path (the cookie failed there), with `'always'` on Better-Auth's own routes, where
 *    the cookie rides along anyway and a 401 is the flow's verdict. A wrong password or 2FA code
 *    sent a second time would count twice against the rate limit.
 */
export function createLtAuthFetchFor(options: LtAuthFetchOptions) {
  const { basePath, cookiesInJwtMode = 'always', state } = options;
  const credentialsFor = (url: string, jwtMode: boolean): RequestCredentials => (jwtMode && cookiesInJwtMode === 'auth-paths' && !ltUrlRequiresCookies(url) ? 'omit' : 'include');
  /** Whether a 401 in JWT mode can be the bearer's fault, so a fresh token may fix it (see 3. above). */
  const bearerMayHaveFailed = (url: string): boolean => (cookiesInJwtMode === 'auth-paths' ? !ltUrlRequiresCookies(url) : !isLtAuthRoute(url, basePath));

  return async function ltAuthFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    const jwtMode = state.mode() === 'jwt';
    const headers = new Headers(init?.headers);
    const sentToken = jwtMode ? state.jwtToken() : null;
    if (sentToken) {
      headers.set('Authorization', `Bearer ${sentToken}`);
    }

    const response = await fetch(input, { ...init, credentials: credentialsFor(url, jwtMode), headers });

    if (response.status !== 401 || !state.isAuthenticated()) {
      return response;
    }
    if (jwtMode && !bearerMayHaveFailed(url)) {
      return response;
    }
    if (!jwtMode) {
      console.debug('[LtAuth] Cookie auth failed, attempting JWT fallback...');
    }

    const token = await requestLtJwtAfter401(basePath);
    if (!token) {
      return response;
    }
    state.adoptJwt(token);
    const retryHeaders = new Headers(headers);
    retryHeaders.set('Authorization', `Bearer ${token}`);
    return fetch(input, { ...init, credentials: credentialsFor(url, true), headers: retryHeaders });
  };
}

/**
 * Custom fetch function that handles Cookie/JWT dual-mode authentication
 *
 * This function:
 * 1. Always sends the cookies (`credentials: 'include'`)
 * 2. In JWT mode: Adds the Authorization header
 * 3. On 401 while signed in: fetches a JWT once (cookie mode: switch to JWT; JWT mode: renew the
 *    expired one) and retries the request once
 *
 * @param basePath - The auth API base path for the JWT; `auth.basePath` from the runtime config when omitted
 */
export function createLtAuthFetch(basePath?: string) {
  return createLtAuthFetchFor({ basePath, state: ltCookieAuthFetchState });
}

/** Default auth fetch; fetches its JWT from `auth.basePath` (default `/iam`). */
export const ltAuthFetch = createLtAuthFetch();
