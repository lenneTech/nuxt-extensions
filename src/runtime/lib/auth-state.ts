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
// API Proxy Detection
// =============================================================================

let _proxyFallbackWarned = false;

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
      if (!_proxyFallbackWarned) {
        _proxyFallbackWarned = true;
        console.warn(
          '\n⚠️  [LtExtensions] API proxy activated implicitly because nuxt dev was detected.\n' +
            '    To make this explicit, add NUXT_PUBLIC_API_PROXY=true to your .env file.\n' +
            '    If you do NOT want the proxy, set NUXT_PUBLIC_API_PROXY=false.\n',
        );
      }
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
 * @param path - The API path (e.g., `/system-setup/status`, `/i18n/errors/de`)
 */
export function buildLtApiUrl(path: string): string {
  try {
    const runtimeConfig = useRuntimeConfig();
    const publicUrl = (runtimeConfig.public as Record<string, string>).apiUrl || '';
    const authBaseURL = (runtimeConfig.public as Record<string, any>)?.ltExtensions?.auth?.baseURL || '';

    if (import.meta.server) {
      const apiUrl = (runtimeConfig as Record<string, string>).apiUrl || publicUrl || authBaseURL;
      if (!apiUrl) {
        console.warn('[LtExtensions] No API URL configured. Set NUXT_API_URL or NUXT_PUBLIC_API_URL.');
      }
      return `${(apiUrl || '').replace(/\/+$/, '')}${path}`;
    }

    if (isLocalDevApiProxy()) {
      return `/api${path}`;
    }

    const apiUrl = publicUrl || authBaseURL;
    if (!apiUrl) {
      console.warn('[LtExtensions] No API URL configured. Set NUXT_PUBLIC_API_URL.');
    }
    return `${(apiUrl || '').replace(/\/+$/, '')}${path}`;
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
 * Get the JWT token from cookie
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
      if (value) {
        return value;
      }
    }
  } catch {
    // Ignore parse errors
  }
  return null;
}

/**
 * Set JWT token in cookie
 */
export function setLtJwtToken(token: string | null): void {
  if (import.meta.server) return;

  const { token: tokenCookieName } = getLtAuthCookieNames();
  const maxAge = 60 * 60 * 24 * 7; // 7 days
  const secure = globalThis.location?.protocol === 'https:' ? '; secure' : '';
  if (token) {
    document.cookie = `${tokenCookieName}=${encodeURIComponent(JSON.stringify(token))}; path=/; max-age=${maxAge}; samesite=lax${secure}`;
  } else {
    document.cookie = `${tokenCookieName}=; path=/; max-age=0; samesite=lax${secure}`;
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
 * Attempt to switch to JWT mode by fetching a token
 *
 * @param basePath - The auth API base path (default: '/iam')
 */
export async function attemptLtJwtSwitch(basePath: string = '/iam'): Promise<boolean> {
  try {
    const apiBase = getLtApiBase(basePath);
    const response = await fetch(`${apiBase}/token`, {
      method: 'GET',
      credentials: 'include',
    });

    if (response.ok) {
      const data = await response.json();
      if (data.token) {
        setLtJwtToken(data.token);
        setLtAuthMode('jwt');
        console.debug('[LtAuth] Switched to JWT mode');
        return true;
      }
    }
    return false;
  } catch {
    return false;
  }
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

/**
 * Custom fetch function that handles Cookie/JWT dual-mode authentication
 *
 * This function:
 * 1. In cookie mode: Uses credentials: 'include'
 * 2. In JWT mode: Adds Authorization header
 * 3. On 401 in cookie mode: Attempts to switch to JWT and retries
 *
 * @param basePath - The auth API base path for JWT switch (default: '/iam')
 */
export function createLtAuthFetch(basePath: string = '/iam') {
  return async function ltAuthFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
    const authMode = getLtAuthMode();
    const jwtToken = getLtJwtToken();

    const headers = new Headers(init?.headers);

    // In JWT mode, add Authorization header
    if (authMode === 'jwt' && jwtToken) {
      headers.set('Authorization', `Bearer ${jwtToken}`);
    }

    // Always include credentials for cookie-based session auth
    // In JWT mode, cookies are sent but ignored by the server (Authorization header is used instead)
    // This is more robust than conditionally omitting cookies
    const response = await fetch(input, {
      ...init,
      headers,
      credentials: 'include',
    });

    // If we get 401 in cookie mode and user is authenticated, try JWT fallback
    if (response.status === 401 && authMode === 'cookie' && isLtAuthenticated()) {
      console.debug('[LtAuth] Cookie auth failed, attempting JWT fallback...');
      const switched = await attemptLtJwtSwitch(basePath);

      if (switched) {
        // Retry the request with JWT
        const newToken = getLtJwtToken();
        if (newToken) {
          headers.set('Authorization', `Bearer ${newToken}`);
          return fetch(input, {
            ...init,
            headers,
            credentials: 'include',
          });
        }
      }
    }

    return response;
  };
}

// Default auth fetch using '/iam' base path
export const ltAuthFetch = createLtAuthFetch('/iam');
