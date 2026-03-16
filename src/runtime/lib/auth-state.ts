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

import { useRuntimeConfig } from "#imports";
import type { LtAuthMode } from "../types";

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
    if (apiProxy !== undefined && apiProxy !== null && apiProxy !== "") {
      return apiProxy === true || apiProxy === "true";
    }

    // Fallback: activate proxy under `nuxt dev` with a warning
    const buildId =
      (runtimeConfig as Record<string, unknown>)?.app &&
      ((runtimeConfig as Record<string, unknown>).app as Record<string, unknown>)?.buildId;
    if (buildId === "dev") {
      if (!_proxyFallbackWarned) {
        _proxyFallbackWarned = true;
        console.warn(
          "\n⚠️  [LtExtensions] API proxy activated implicitly because nuxt dev was detected.\n" +
            "    To make this explicit, add NUXT_PUBLIC_API_PROXY=true to your .env file.\n" +
            "    If you do NOT want the proxy, set NUXT_PUBLIC_API_PROXY=false.\n",
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
    const publicUrl = (runtimeConfig.public as Record<string, string>).apiUrl || "";
    const authBaseURL =
      (runtimeConfig.public as Record<string, any>)?.ltExtensions?.auth?.baseURL || "";

    if (import.meta.server) {
      const apiUrl = (runtimeConfig as Record<string, string>).apiUrl || publicUrl || authBaseURL;
      if (!apiUrl) {
        console.warn(
          "[LtExtensions] No API URL configured. Set NUXT_API_URL or NUXT_PUBLIC_API_URL.",
        );
      }
      return `${(apiUrl || "").replace(/\/+$/, "")}${path}`;
    }

    if (isLocalDevApiProxy()) {
      return `/api${path}`;
    }

    const apiUrl = publicUrl || authBaseURL;
    if (!apiUrl) {
      console.warn("[LtExtensions] No API URL configured. Set NUXT_PUBLIC_API_URL.");
    }
    return `${(apiUrl || "").replace(/\/+$/, "")}${path}`;
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
  if (import.meta.server) return "cookie";

  try {
    const cookie = document.cookie.split("; ").find((row) => row.startsWith("lt-auth-state="));
    if (cookie) {
      const parts = cookie.split("=");
      const value = parts.length > 1 ? decodeURIComponent(parts.slice(1).join("=")) : "";
      const state = JSON.parse(value);
      return state?.authMode || "cookie";
    }
  } catch {
    // Ignore parse errors
  }
  return "cookie";
}

/**
 * Get the JWT token from cookie
 */
export function getLtJwtToken(): string | null {
  if (import.meta.server) return null;

  try {
    const cookie = document.cookie.split("; ").find((row) => row.startsWith("lt-jwt-token="));
    if (cookie) {
      const parts = cookie.split("=");
      const value = parts.length > 1 ? decodeURIComponent(parts.slice(1).join("=")) : "";
      // Handle JSON-encoded string (useCookie stores as JSON)
      if (value.startsWith('"') && value.endsWith('"')) {
        return JSON.parse(value);
      }
      return value || null;
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

  const maxAge = 60 * 60 * 24 * 7; // 7 days
  const secure = globalThis.location?.protocol === "https:" ? "; secure" : "";
  if (token) {
    document.cookie = `lt-jwt-token=${encodeURIComponent(JSON.stringify(token))}; path=/; max-age=${maxAge}; samesite=lax${secure}`;
  } else {
    document.cookie = `lt-jwt-token=; path=/; max-age=0`;
  }
}

/**
 * Update auth mode in the lt-auth-state cookie
 */
export function setLtAuthMode(mode: LtAuthMode): void {
  if (import.meta.server) return;

  try {
    const cookie = document.cookie.split("; ").find((row) => row.startsWith("lt-auth-state="));

    let state = { user: null, authMode: mode };
    if (cookie) {
      const parts = cookie.split("=");
      const value = parts.length > 1 ? decodeURIComponent(parts.slice(1).join("=")) : "";
      state = { ...JSON.parse(value), authMode: mode };
    }

    const maxAge = 60 * 60 * 24 * 7; // 7 days
    const secure = globalThis.location?.protocol === "https:" ? "; secure" : "";
    document.cookie = `lt-auth-state=${encodeURIComponent(JSON.stringify(state))}; path=/; max-age=${maxAge}; samesite=lax${secure}`;
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
  return buildLtApiUrl(basePath || "/iam");
}

/**
 * Attempt to switch to JWT mode by fetching a token
 *
 * @param basePath - The auth API base path (default: '/iam')
 */
export async function attemptLtJwtSwitch(basePath: string = "/iam"): Promise<boolean> {
  try {
    const apiBase = getLtApiBase(basePath);
    const response = await fetch(`${apiBase}/token`, {
      method: "GET",
      credentials: "include",
    });

    if (response.ok) {
      const data = await response.json();
      if (data.token) {
        setLtJwtToken(data.token);
        setLtAuthMode("jwt");
        console.debug("[LtAuth] Switched to JWT mode");
        return true;
      }
    }
    return false;
  } catch {
    return false;
  }
}

/**
 * Check if user is authenticated (has lt-auth-state with user)
 */
export function isLtAuthenticated(): boolean {
  if (import.meta.server) return false;

  try {
    const cookie = document.cookie.split("; ").find((row) => row.startsWith("lt-auth-state="));
    if (cookie) {
      const parts = cookie.split("=");
      const value = parts.length > 1 ? decodeURIComponent(parts.slice(1).join("=")) : "";
      const state = JSON.parse(value);
      return !!state?.user;
    }
  } catch {
    // Ignore parse errors
  }
  return false;
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
export function createLtAuthFetch(basePath: string = "/iam") {
  return async function ltAuthFetch(
    input: RequestInfo | URL,
    init?: RequestInit,
  ): Promise<Response> {
    const authMode = getLtAuthMode();
    const jwtToken = getLtJwtToken();

    const headers = new Headers(init?.headers);

    // In JWT mode, add Authorization header
    if (authMode === "jwt" && jwtToken) {
      headers.set("Authorization", `Bearer ${jwtToken}`);
    }

    // Always include credentials for cookie-based session auth
    // In JWT mode, cookies are sent but ignored by the server (Authorization header is used instead)
    // This is more robust than conditionally omitting cookies
    const response = await fetch(input, {
      ...init,
      headers,
      credentials: "include",
    });

    // If we get 401 in cookie mode and user is authenticated, try JWT fallback
    if (response.status === 401 && authMode === "cookie" && isLtAuthenticated()) {
      console.debug("[LtAuth] Cookie auth failed, attempting JWT fallback...");
      const switched = await attemptLtJwtSwitch(basePath);

      if (switched) {
        // Retry the request with JWT
        const newToken = getLtJwtToken();
        if (newToken) {
          headers.set("Authorization", `Bearer ${newToken}`);
          return fetch(input, {
            ...init,
            headers,
            credentials: "include",
          });
        }
      }
    }

    return response;
  };
}

// Default auth fetch using '/iam' base path
export const ltAuthFetch = createLtAuthFetch("/iam");
