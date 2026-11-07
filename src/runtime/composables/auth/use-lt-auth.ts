/**
 * Better Auth composable with client-side state management
 *
 * This composable manages auth state using:
 * 1. Primary: Session cookies (more secure, HttpOnly)
 * 2. Fallback: JWT tokens (when cookies are not available/working)
 *
 * The auth mode is automatically detected:
 * - If session cookie works -> use cookies
 * - If cookies fail (401) -> switch to JWT mode
 */

import type { LtAuthMode, LtAuthState, LtPasskeyAuthResult, LtPasskeyRegisterResult, LtUser, LtUserInput, UseLtAuthReturn } from '../../types';

import { useNuxtApp, useCookie, useState, useRequestHeaders, useRuntimeConfig, ref, computed, watch } from '#imports';
import { ltArrayBufferToBase64Url, ltBase64UrlToUint8Array } from '../../utils/crypto';
import { clearLtAuthCookies, createLtAuthFetchFor, getLtApiBase, getLtAuthCookieNames, getLtJwtToken, isLtJwtShaped, requestLtJwt, resolveLtAuthState } from '../../lib/auth-state';
import { useLtAuthClient } from '../use-lt-auth-client';

/**
 * Keys of `T` whose property is OPTIONAL — i.e. safe to `delete`. Constrains
 * `AUTHZ_KEYS` so a REQUIRED key (`id` / `email`) can never be listed: the merge's
 * `delete merged[key]` would otherwise strip a required field and break the
 * id-guard on the next session re-validation.
 */
type LtUserOptionalKeys<T> = { [K in keyof T]-?: object extends Pick<T, K> ? K : never }[keyof T];

/**
 * Upper bound for `validateSession()` waiting on Better Auth's session request.
 */
const VALIDATE_SESSION_TIMEOUT_MS = 10_000;

/**
 * How long `signOut()` tries to send unsent offline-sync changes before it deletes them with the
 * rest (decision E3 of DEV-3917): long enough for a connected device, short enough never to hang.
 */
const LT_SYNC_SIGN_OUT_FLUSH_MS = 5000;

/** Whether the app enabled offline sync (`ltExtensions.sync.enabled`); always false on the server */
function isLtSyncEnabled(): boolean {
  if (!import.meta.client) return false;
  try {
    return !!(useRuntimeConfig().public as { ltExtensions?: { sync?: { enabled?: boolean } } }).ltExtensions?.sync?.enabled;
  } catch {
    return false;
  }
}

/**
 * Helper function for i18n with German fallback
 *
 * Two-stage fallback strategy:
 * 1. Without i18n installed -> German (for single-language DE projects)
 * 2. With i18n, no translation -> English (international fallback)
 */
function useTranslation() {
  const nuxtApp = useNuxtApp();
  const i18n = (nuxtApp as any).$i18n;

  return (key: string, germanFallback: string): string => {
    // No i18n installed -> German (for single-language DE projects)
    if (!i18n?.t) {
      return germanFallback;
    }
    // i18n installed -> use i18n (fallback to EN is configured in i18n)
    return i18n.t(key);
  };
}

/**
 * Better Auth composable with Cookie/JWT dual-mode authentication
 *
 * @example
 * ```typescript
 * const { user, isAuthenticated, signIn, signOut } = useLtAuth();
 *
 * // Login
 * await signIn.email({ email, password });
 *
 * // Check auth status
 * if (isAuthenticated.value) {
 *   console.log('Logged in as:', user.value?.name);
 * }
 *
 * // Logout
 * await signOut();
 * ```
 */
export function useLtAuth(): UseLtAuthReturn {
  const authClient = useLtAuthClient();
  const t = useTranslation();

  // Resolve cookie names once per composable invocation (configurable per project)
  const { state: stateCookieName, token: tokenCookieName } = getLtAuthCookieNames();

  // Use useCookie for SSR-compatible persistent state
  // Note: No default value to prevent overwriting existing cookies during hydration
  const authState = useCookie<LtAuthState | null>(stateCookieName, {
    maxAge: 60 * 60 * 24 * 7, // 7 days
    sameSite: 'lax',
  });

  // On client, sync from the browser cookies to ensure we have the latest
  // value. Uses a duplicate-tolerant resolve so a stale `{ user: null }` twin
  // (host-only vs. domain-scoped) can never shadow the real, user-bearing
  // cookie and trigger a hydration mismatch / false "logged out" state.
  if (import.meta.client) {
    try {
      const resolved = resolveLtAuthState(document.cookie, stateCookieName);
      // Only adopt when the browser carries a user but useCookie didn't pick it.
      if (resolved?.user && !authState.value?.user) {
        authState.value = resolved;
      }
    } catch {
      // Ignore parse errors
    }
  }

  // SSR: capture the raw request Cookie header ONCE so the resolved state below
  // can inspect every `lt-auth-state` cookie. We must NOT write a default
  // `{ user: null }` cookie here (the previous behaviour) — assigning to the
  // `useCookie` ref on the server emits a host-only Set-Cookie that actively
  // manufactures the stale twin which then shadows the real session.
  const ssrCookieHeader = import.meta.server ? useRequestHeaders(['cookie']).cookie || '' : '';

  // JWT token storage (used when cookies are not available). Only ever written through `jwtToken`.
  const jwtTokenCookie = useCookie<string | null>(tokenCookieName, {
    maxAge: 60 * 60 * 24 * 7, // 7 days
    sameSite: 'lax',
  });

  // A JWT or nothing. The token cookie is readable by every script on the page; Better-Auth's
  // session token, which turns up in the 2FA and passkey answers, must never land there (see
  // `isLtJwtShaped`). A value that is not a JWT clears the cookie instead of being stored, and
  // reads as `null` (on the server too, where nothing may be written).
  const jwtToken = computed<string | null>({
    get: () => (isLtJwtShaped(jwtTokenCookie.value) ? jwtTokenCookie.value : null),
    set: (value) => {
      jwtTokenCookie.value = isLtJwtShaped(value) ? value : null;
    },
  });

  // Loading state
  const isLoading = ref<boolean>(false);

  // Authoritative, duplicate-tolerant view of the auth state. Prefers the
  // cookie that actually carries a user when host-only + domain-scoped twins
  // disagree — on the client from `document.cookie`, on the server from the raw
  // request Cookie header (`useCookie` collapses duplicates to a single value).
  // Touching `authState.value` keeps it reactive to client login/logout writes.
  const resolvedAuthState = computed<LtAuthState | null>(() => {
    const refVal = authState.value;
    const cookieString = import.meta.client ? document.cookie : ssrCookieHeader;
    return resolveLtAuthState(cookieString, stateCookieName) ?? refVal ?? null;
  });

  // A session token an earlier version (or a hand-written 2FA page) stored in the token cookie
  // stays readable by any script until it expires: delete it on start, together with the JWT mode
  // it came with. The httpOnly session cookie keeps the user signed in.
  if (import.meta.client && jwtTokenCookie.value && !isLtJwtShaped(jwtTokenCookie.value)) {
    jwtTokenCookie.value = null;
    getLtJwtToken(); // expires the document cookie on both slots and resets the stored mode
    const resolved = resolveLtAuthState(document.cookie, stateCookieName) ?? authState.value;
    if (resolved?.authMode === 'jwt') {
      setUser(resolved.user ?? null, 'cookie');
    }
  }

  // Auth mode: 'cookie' (default) or 'jwt' (fallback)
  const authMode = computed(() => resolvedAuthState.value?.authMode || 'cookie');
  const isJwtMode = computed(() => authMode.value === 'jwt');

  // Computed properties based on stored state
  const user = computed<LtUser | null>(() => resolvedAuthState.value?.user ?? null);
  const isAuthenticated = computed<boolean>(() => !!user.value);
  // Role detection accepts BOTH user shapes (a union — either one granting the role
  // is sufficient):
  //  - `role: 'admin'`    — Better-Auth's admin plugin (single role).
  //  - `roles: ['admin']` — `@lenne.tech/nest-server` (see `LtUser.roles` for why
  //                         its users carry `roles` and no singular `role`; a
  //                         `role`-only check was permanently false against it, so
  //                         the whole admin UI silently disappeared).
  // `Array.isArray` guards a malformed `roles` from the client-writable auth-state
  // cookie in TWO ways: a non-array (`roles: 42`) must not throw, AND a bare string
  // (`roles: 'superadmin'`) must not fail open via `String.prototype.includes`
  // substring-matching the wanted role. Both degrade to `false`.
  // UI gate only — NOT an authorization boundary: the cookie is user-editable, so
  // enforce rights server-side (see `LtUser.roles`).
  function hasRole(role: string): boolean {
    const current = user.value;
    if (!current) {
      return false;
    }
    return current.role === role || (Array.isArray(current.roles) && current.roles.includes(role));
  }

  // True when the user has ANY of the given roles. Publishing this (and `hasRole`)
  // keeps consumers off the raw, unguarded `user.value?.roles?.includes(x)` shape —
  // the exact substring-confusion the guard above exists to prevent.
  function hasAnyRole(...roles: string[]): boolean {
    return roles.some((role) => hasRole(role));
  }

  const isAdmin = computed<boolean>(() => hasRole('admin'));
  const is2FAEnabled = computed<boolean>(() => user.value?.twoFactorEnabled ?? false);

  // SSR-safe shared features state (useState is isolated per request on server, shared on client)
  const features = useState<Record<string, boolean | number | string[]>>('lt-auth-features', () => ({}));
  const featuresFetched = useState<boolean>('lt-auth-features-fetched', () => false);

  /**
   * Set user data after successful login/signup
   * Also manually writes to browser cookie for SSR compatibility
   */
  function setUser(userData: LtUserInput | null, requestedMode: LtAuthMode = 'cookie'): void {
    // JWT mode sends the stored JWT instead of the cookies. Without one (a session token handed
    // to `jwtToken` is refused), it would send nothing: stay on the cookie session and fetch the
    // JWT from `/iam/token`. A hand-written 2FA page that stores the body token and then calls
    // `setUser(user, 'jwt')` therefore still signs in, without the session token leaking.
    const mode: LtAuthMode = requestedMode === 'jwt' && !jwtToken.value ? 'cookie' : requestedMode;
    if (mode !== requestedMode && import.meta.client && userData) {
      void switchToJwtMode();
    }

    // Normalise Better Auth's `image: null` to `undefined` at the boundary, so the stored
    // user and every reader keep ONE empty case. See `LtUserInput` for why this is not done
    // by widening `LtUser.image` instead.
    const normalised: LtUser | null = userData ? { ...userData, image: userData.image ?? undefined } : null;
    const newState = { user: normalised, authMode: mode };

    // Cookie-backed state write rules:
    //  - On the CLIENT: always update (login/logout/2FA happen here).
    //  - On the SERVER: only when there IS a user. Assigning a `{ user: null }`
    //    state to a `useCookie` ref during SSR emits a host-only Set-Cookie that
    //    clobbers the real (e.g. SAML-set, domain-scoped) session cookie — the
    //    SSR-write class of bug behind the "random logout". A user-bearing SSR
    //    write is harmless and keeps server-rendered auth state consistent when
    //    a project resolves the user during SSR (e.g. validateSession()).
    if (import.meta.client || userData) {
      authState.value = newState;
    }

    // Manual browser cookie write for immediate same-tick consistency (client only).
    if (import.meta.client) {
      const maxAge = 60 * 60 * 24 * 7; // 7 days
      const secure = globalThis.location?.protocol === 'https:' ? '; secure' : '';
      const encoded = encodeURIComponent(JSON.stringify(newState));
      // Browsers cap a single cookie at ~4096 bytes (name + value + attributes).
      // An oversized `lt-auth-state` is silently rejected on write, so the next
      // reload reads no cookie and the user appears logged out — the very
      // "logout-on-reload" class the SSR-write rules above guard against. Since
      // the session-user merge now keeps nest-server-only fields across reloads,
      // a project stuffing large preference blobs onto the user object can push
      // the cookie over the limit; warn in dev so it is noticed before it bites.
      if (import.meta.dev && encoded.length > 3500) {
        console.warn(
          `[lt-auth] lt-auth-state cookie is ${encoded.length} bytes (encoded), approaching the ~4KB browser limit — an oversized cookie is dropped on write and reads as a logout on reload. Keep the cached user lean: move large preference data off the user object.`,
        );
      }
      document.cookie = `${stateCookieName}=${encoded}; path=/; max-age=${maxAge}; samesite=lax${secure}`;
    }
  }

  /**
   * Clear user data on logout.
   *
   * Resets the reactive auth state and hard-deletes all auth cookies via
   * {@link clearLtAuthCookies} so no orphan "logged out" cookie lingers
   * in the browser. The reactive `authState` ref is set back to the
   * neutral `{ user: null, authMode: 'cookie' }` shape so consumers
   * reading the ref immediately see the logged-out state, while the
   * underlying cookies are removed entirely.
   */
  function clearUser(): void {
    // CLIENT-only: mutating the `useCookie` refs (authState / jwtToken) on the
    // server would emit a `{ user: null }` Set-Cookie that actively manufactures
    // the stale "logged out" twin — the SSR-write class of bug. Logout is a
    // client action; SSR auth state is derived from the request Cookie header.
    if (import.meta.client) {
      authState.value = { user: null, authMode: 'cookie' as const };
      jwtToken.value = null;

      // Hard-delete the cookies in the browser (no payload, max-age=0).
      // Centralised in `clearLtAuthCookies` so the helper-based call sites
      // (e.g. session-expired interceptors) and the composable agree on the
      // exact attributes the browser needs to actually evict the cookies.
      clearLtAuthCookies();
    }
  }

  /**
   * Store a freshly fetched JWT in this instance's refs and switch to JWT mode.
   *
   * Every `useLtAuth()` call owns its own `useCookie` ref, and Nuxt brings the other refs of the
   * same name up to date only on a later task (cookieStore / BroadcastChannel). An instance that
   * joined another instance's JWT fetch would otherwise read its own ref in the same tick, find the
   * expired token still in it, and retry with that.
   */
  function adoptJwt(token: string): void {
    if (jwtToken.value !== token) {
      jwtToken.value = token;
    }
    if (authState.value && authState.value.authMode !== 'jwt') {
      authState.value = { ...authState.value, authMode: 'jwt' };
    }
  }

  /**
   * Switch to JWT mode and fetch a token
   */
  async function switchToJwtMode(): Promise<boolean> {
    const token = await requestLtJwt();
    if (!token) {
      return false;
    }
    adoptJwt(token);
    return true;
  }

  /**
   * Refresh JWT token before it expires
   */
  async function refreshJwtToken(): Promise<boolean> {
    if (!isJwtMode.value || !jwtToken.value) return false;
    return switchToJwtMode();
  }

  /**
   * Authenticated fetch wrapper: the same implementation as `ltAuthFetch` (`createLtAuthFetchFor`
   * in lib/auth-state.ts), on this instance's refs. Uses cookies by default; on a 401 while signed
   * in it fetches a JWT once per burst and retries once (cookie mode: switch to JWT; JWT mode: the
   * bearer had expired).
   *
   * In JWT mode, cookies are only sent to the paths that the backend resolves from the session
   * cookie rather than from the bearer token (passkey, 2FA, `/get-session`).
   */
  const fetchWithAuth: UseLtAuthReturn['fetchWithAuth'] = createLtAuthFetchFor({
    cookiesInJwtMode: 'auth-paths',
    state: {
      adoptJwt,
      isAuthenticated: () => isAuthenticated.value,
      jwtToken: () => jwtToken.value,
      mode: () => (isJwtMode.value ? 'jwt' : 'cookie'),
    },
  });

  /**
   * Authorization-relevant keys the Better-Auth session owns and is the source of
   * truth for. The merge below must never keep a stale cached value for one of
   * these: if the session omits it (e.g. a backend-side role removal or a fresh
   * ban), keeping the old value would be fail-open and mask a downgrade. So any
   * AUTHZ key absent from the session user is dropped from the merge result
   * (fail-closed). A project that adds its OWN nest-server-only authorization
   * field MUST either register it as a Better-Auth additionalField (so
   * get-session returns it) or add it here — otherwise it could persist stale in
   * the client cache. See the module CLAUDE.md "Authentication Cookie Rules".
   *
   * `roles` belongs here for the same reason `role` does: `isAdmin` reads it, so a
   * stale cached `roles: ['admin']` would keep the admin UI alive after the backend
   * revoked admin — the exact fail-open this list exists to prevent. Fail-closing it
   * costs nothing for backends that never send `roles`: the key is only dropped when
   * the CACHE has it and the session omits it, so a `roles`-less backend (whose cache
   * never carries `roles`) is a no-op. And nest-server registers `roles` with
   * `defaultValue: []` (see `LtUser.roles`), so its get-session returns `roles` for
   * any user created under it; the worst case is an honest `[]` (= not an admin),
   * never a spurious drop.
   */
  const AUTHZ_KEYS = ['banExpires', 'banReason', 'banned', 'emailVerified', 'role', 'roles', 'twoFactorEnabled'] as const satisfies readonly LtUserOptionalKeys<LtUser>[];

  /**
   * Merge a Better-Auth session user (partial) onto the cached user of the SAME
   * identity. Better-Auth's get-session returns only the fields Better-Auth owns
   * (id/email/name + registered additionalFields), NOT nest-server-only user
   * fields (e.g. custom preference fields). Overwriting the cached user with the
   * session user therefore drops those fields on every session re-validation
   * (app init / hard reload); merging keeps them.
   *
   * Guarded by a truthy, matching id: a different / absent / id-less cached
   * identity (including two id-less objects) falls back to the session user
   * verbatim, so one user's fields never leak onto another.
   *
   * Authorization keys ({@link AUTHZ_KEYS}) always reflect the session — any such
   * key the session omits is dropped rather than kept, so a backend downgrade is
   * never masked by a stale cached value. Reads the duplicate-tolerant
   * `resolvedAuthState` (consistent with `user`/`isAdmin`), never a raw cookie twin.
   */
  function mergeSessionUser(sessionUser: LtUser): LtUser {
    const cached = resolvedAuthState.value?.user;
    if (!cached?.id || !sessionUser?.id || cached.id !== sessionUser.id) {
      return sessionUser;
    }
    const merged = { ...cached, ...sessionUser } as Record<string, unknown>;
    for (const key of AUTHZ_KEYS) {
      if (!(key in sessionUser)) {
        delete merged[key];
      }
    }
    return merged as unknown as LtUser;
  }

  /**
   * Validate session with backend (called on app init).
   *
   * If get-session returns a user, it is merged onto the cached user (see
   * `mergeSessionUser`) so authorization keys are re-derived from the session. If
   * get-session returns NO user but a cached `lt-auth-state` user exists (e.g. just
   * after a 2FA step the session endpoint hasn't caught up on), this deliberately
   * trusts the client-side cache and returns `true` WITHOUT re-validating
   * authorization — that branch never runs `mergeSessionUser`, so `AUTHZ_KEYS`
   * cannot fail-close it. Intentional and self-healing (the next authenticated
   * request 401s a dead session), but it is exactly why `isAdmin` must remain a UI
   * gate: authorization is the backend's job, not this cache's.
   *
   * During SSR this does NOT contact the backend and answers from the request's
   * `lt-auth-state` cookie alone. Better Auth's session atom never fetches when
   * `window` is undefined (`client/query.mjs`: `if (isServer()) return;`), so
   * `isPending` stays `true` for the whole server run and waiting on it used to
   * hang the call — and with it the SSR response of any project that awaited it
   * in setup, a middleware or `useAsyncData`. The client re-validates on mount.
   * The server answer therefore means "the cookie claims a user", never "the
   * session is valid": `lt-auth-state` is client-writable, so a forged value may
   * shape the server-rendered UI but must never gate a decision.
   *
   * On the client the wait is bounded by `VALIDATE_SESSION_TIMEOUT_MS`; a session
   * request that never settles then counts as "no session returned" and falls
   * through to the cached-user branch (a slow line is not a logout), instead of
   * leaving the caller pending.
   *
   * Both cached-user fallbacks read the duplicate-tolerant `resolvedAuthState`, not
   * the raw `useCookie` ref: when host-only and domain-scoped twins disagree the ref
   * may hold the empty one, and on the server nothing reconciles the two.
   */
  async function validateSession(): Promise<boolean> {
    if (import.meta.server) {
      return !!resolvedAuthState.value?.user;
    }

    try {
      // Try to get session from Better Auth
      const session = authClient.useSession();

      // Wait for session to load, but never longer than the timeout
      if (session.value.isPending) {
        await new Promise((resolve) => {
          let unwatch: (() => void) | undefined;
          const timer = setTimeout(() => {
            unwatch?.();
            resolve(false);
          }, VALIDATE_SESSION_TIMEOUT_MS);
          unwatch = watch(
            () => session.value.isPending,
            (isPending: boolean) => {
              if (!isPending) {
                clearTimeout(timer);
                unwatch?.();
                resolve(true);
              }
            },
            { immediate: true },
          );
        });
      }

      // If session has user data, update our state. Merge onto the cached user
      // so a re-validation never drops nest-server-only fields (see mergeSessionUser).
      if (session.value.data?.user) {
        setUser(mergeSessionUser(session.value.data.user as LtUser), 'cookie');
        // Pre-fetch JWT for fallback
        switchToJwtMode().catch(() => {});
        return true;
      }

      // Session not found from Better Auth API
      // Trust the stored auth-state if user exists (e.g., after 2FA verification)
      // The auth-state cookie is set by our application after successful login/2FA
      if (resolvedAuthState.value?.user) {
        // Pre-fetch JWT for fallback
        switchToJwtMode().catch(() => {});
        return true;
      }

      return false;
    } catch {
      return !!resolvedAuthState.value?.user;
    }
  }

  /**
   * Fetch enabled features from the backend
   *
   * Returns feature flags like signUpChecks, emailVerification, passkey, etc.
   * Results are cached globally and shared across all useLtAuth() instances.
   * Automatically called once on first useLtAuth() usage (client-side only).
   */
  async function fetchFeatures(): Promise<Record<string, boolean | number | string[]>> {
    try {
      const apiBase = getLtApiBase();
      const result = await $fetch<Record<string, boolean | number | string[]>>(`${apiBase}/features`);
      if (result) {
        features.value = result;
        featuresFetched.value = true;
      }
      return features.value;
    } catch {
      return features.value;
    }
  }

  /**
   * Sign in with email and password
   */
  const signIn = {
    ...authClient.signIn,
    email: async (params: { email: string; password: string; rememberMe?: boolean }, options?: any) => {
      isLoading.value = true;
      try {
        const result = await authClient.signIn.email(params, options);

        // Extract token from response (JWT mode: cookies: false). Only a JWT counts: nest-server
        // converts the body token to one in JWT mode and removes it in cookie mode, and anything
        // else is a session token that must not reach the readable token cookie.
        const resultAny = result as any;
        const token = resultAny?.token || resultAny?.data?.token;
        const userData = resultAny?.user || resultAny?.data?.user;

        if (isLtJwtShaped(token)) {
          // JWT mode: Token is in the response
          jwtToken.value = token;
          if (userData) {
            setUser(userData as LtUser, 'jwt');
          }
        } else if (userData) {
          // Cookie mode: No token in response, use cookies
          setUser(userData as LtUser, 'cookie');
          // Try to get JWT token for fallback
          switchToJwtMode().catch(() => {});
        }

        return result;
      } finally {
        isLoading.value = false;
      }
    },
  };

  /**
   * Sign up with email and password
   */
  const signUp = {
    ...authClient.signUp,
    email: async (params: { email: string; name: string; password: string } & Record<string, unknown>, options?: any) => {
      isLoading.value = true;
      try {
        const result = await authClient.signUp.email(params, options);

        // Extract token from response (JWT mode: cookies: false). Only a JWT counts: nest-server
        // converts the body token to one in JWT mode and removes it in cookie mode, and anything
        // else is a session token that must not reach the readable token cookie.
        const resultAny = result as any;
        const token = resultAny?.token || resultAny?.data?.token;
        const userData = resultAny?.user || resultAny?.data?.user;

        if (isLtJwtShaped(token)) {
          // JWT mode: Token is in the response
          jwtToken.value = token;
          if (userData) {
            setUser(userData as LtUser, 'jwt');
          }
        } else if (userData) {
          // Cookie mode: No token in response, use cookies
          setUser(userData as LtUser, 'cookie');
          switchToJwtMode().catch(() => {});
        }

        return result;
      } finally {
        isLoading.value = false;
      }
    },
  };

  /**
   * Sign out
   *
   * With offline sync enabled (`ltExtensions.sync.enabled`) it first sends what is still unsent,
   * for at most a few seconds, and once signed out deletes every local sync record, cursor and
   * unsent change: the device holds personal data the server no longer controls (nest-server
   * `SECURITY.md`). An expired session does NOT come through here and deletes nothing.
   */
  const signOut = async (options?: any) => {
    isLoading.value = true;
    try {
      // Loaded on demand: an app without offline sync carries none of it
      const sync = isLtSyncEnabled() ? await import('../../lib/sync') : null;
      // Only the signing-out user's own changes: a previous user's are deleted unsent, never pushed under this session
      await sync?.flushLtSyncBeforeSignOut(user.value?.id ? String(user.value.id) : undefined, LT_SYNC_SIGN_OUT_FLUSH_MS);
      const result = await authClient.signOut(options);
      // Clear user data on logout
      clearUser();
      if (sync) {
        const { deleteLtSyncDatabase } = await import('../../lib/sync-store');
        await deleteLtSyncDatabase().catch((error: unknown) => console.error('[LtAuth] Could not delete the local offline-sync data on sign-out:', error));
      }
      return result;
    } finally {
      isLoading.value = false;
    }
  };

  /**
   * Authenticate with a passkey (WebAuthn)
   *
   * This function handles the complete WebAuthn authentication flow:
   * 1. Fetches authentication options from the server
   * 2. Prompts the user to select a passkey via the browser's WebAuthn API
   * 3. Sends the signed credential to the server for verification
   * 4. Stores user data on successful authentication
   *
   * @returns Result with success status, user data, or error message
   */
  async function authenticateWithPasskey(): Promise<LtPasskeyAuthResult> {
    isLoading.value = true;

    try {
      const apiBase = getLtApiBase();

      // Step 1: Get authentication options from server
      const optionsResponse = await fetchWithAuth(`${apiBase}/passkey/generate-authenticate-options`, {
        method: 'GET',
      });

      if (!optionsResponse.ok) {
        return {
          success: false,
          error: t('lt.auth.passkeyError', 'Konnte Passkey-Optionen nicht laden'),
        };
      }

      const options = await optionsResponse.json();

      // Step 2: Convert challenge from base64url to ArrayBuffer
      const challengeBuffer = ltBase64UrlToUint8Array(options.challenge).buffer as ArrayBuffer;

      // Step 3: Get credential from browser's WebAuthn API
      const credential = (await navigator.credentials.get({
        publicKey: {
          challenge: challengeBuffer,
          rpId: options.rpId,
          allowCredentials: options.allowCredentials || [],
          userVerification: options.userVerification,
          timeout: options.timeout,
        },
      })) as PublicKeyCredential | null;

      if (!credential) {
        return { success: false, error: t('lt.auth.noPasskeySelected', 'Kein Passkey ausgewählt') };
      }

      // Step 4: Convert credential response to base64url format
      const response = credential.response as AuthenticatorAssertionResponse;
      const credentialBody = {
        id: credential.id,
        rawId: ltArrayBufferToBase64Url(credential.rawId),
        type: credential.type,
        response: {
          authenticatorData: ltArrayBufferToBase64Url(response.authenticatorData),
          clientDataJSON: ltArrayBufferToBase64Url(response.clientDataJSON),
          signature: ltArrayBufferToBase64Url(response.signature),
          userHandle: response.userHandle ? ltArrayBufferToBase64Url(response.userHandle) : null,
        },
        clientExtensionResults: credential.getClientExtensionResults?.() || {},
      };

      // Step 5: Verify with server
      // Note: The server expects { response: credentialData } format (matching @simplewebauthn/browser output)
      // Include challengeId for JWT mode (database challenge storage)
      const authResponse = await fetchWithAuth(`${apiBase}/passkey/verify-authentication`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ challengeId: options.challengeId, response: credentialBody }),
      });

      const result = await authResponse.json();

      if (!authResponse.ok) {
        return {
          success: false,
          error: result.message || t('lt.auth.passkeyFailed', 'Passkey-Anmeldung fehlgeschlagen'),
        };
      }

      // Better-Auth answers `{ session, user }` and has set the httpOnly session cookie. The
      // session token in `session.token` is never stored or handed on: in the readable token
      // cookie (or in the caller's hands) it would be one XSS away from an attacker. The cookie
      // session signs in, and `switchToJwtMode()` fetches a real JWT.
      let signedInUser = result.user as LtUser | undefined;
      if (!signedInUser && result.session) {
        // An answer without the user (older plugin versions): read it through the cookie session.
        try {
          const sessionResponse = await fetchWithAuth(`${apiBase}/get-session`, { method: 'GET' });
          if (sessionResponse.ok) {
            const sessionData = await sessionResponse.json();
            if (sessionData?.user) {
              // Merge onto the cached user so this passkey get-session fallback
              // never drops nest-server-only fields either (see mergeSessionUser).
              signedInUser = mergeSessionUser(sessionData.user as LtUser);
            }
          }
        } catch {
          // Fallback: user can still be fetched via validateSession in the login page
        }
      }

      if (signedInUser) {
        setUser(signedInUser, 'cookie');
        switchToJwtMode().catch(() => {});
      }

      return { success: true, user: signedInUser };
    } catch (err: unknown) {
      // Handle WebAuthn-specific errors
      if (err instanceof Error && err.name === 'NotAllowedError') {
        return {
          success: false,
          error: t('lt.auth.passkeyAborted', 'Passkey-Authentifizierung wurde abgebrochen'),
        };
      }
      return {
        success: false,
        error: err instanceof Error ? err.message : t('lt.auth.passkeyFailed', 'Passkey-Anmeldung fehlgeschlagen'),
      };
    } finally {
      isLoading.value = false;
    }
  }

  /**
   * Register a new passkey for the current user
   *
   * This function handles the complete WebAuthn registration flow:
   * 1. Fetches registration options from the server
   * 2. Prompts the user to create a passkey via the browser's WebAuthn API
   * 3. Sends the credential to the server for storage
   *
   * @param name - Optional name for the passkey
   * @returns Result with success status or error message
   */
  async function registerPasskey(name?: string): Promise<LtPasskeyRegisterResult> {
    isLoading.value = true;

    try {
      const apiBase = getLtApiBase();

      // Step 1: Get registration options from server
      const optionsResponse = await fetchWithAuth(`${apiBase}/passkey/generate-register-options`, {
        method: 'GET',
      });

      if (!optionsResponse.ok) {
        const error = await optionsResponse.json().catch(() => ({}));
        return {
          success: false,
          error: error.message || t('lt.auth.registerOptionsError', 'Konnte Registrierungsoptionen nicht laden'),
        };
      }

      const options = await optionsResponse.json();

      // Step 2: Convert challenge from base64url to ArrayBuffer
      const challengeBuffer = ltBase64UrlToUint8Array(options.challenge).buffer as ArrayBuffer;

      // Step 3: Convert user.id from base64url to ArrayBuffer
      const userIdBuffer = ltBase64UrlToUint8Array(options.user.id).buffer as ArrayBuffer;

      // Step 4: Create credential via browser's WebAuthn API
      const credential = (await navigator.credentials.create({
        publicKey: {
          challenge: challengeBuffer,
          rp: options.rp,
          user: {
            ...options.user,
            id: userIdBuffer,
          },
          pubKeyCredParams: options.pubKeyCredParams,
          timeout: options.timeout,
          attestation: options.attestation,
          authenticatorSelection: options.authenticatorSelection,
          excludeCredentials: (options.excludeCredentials || []).map((cred: any) => ({
            ...cred,
            id: ltBase64UrlToUint8Array(cred.id).buffer as ArrayBuffer,
          })),
        },
      })) as PublicKeyCredential | null;

      if (!credential) {
        return {
          success: false,
          error: t('lt.auth.passkeyCreationAborted', 'Passkey-Erstellung wurde abgebrochen'),
        };
      }

      // Step 5: Convert credential response to base64url format
      const attestationResponse = credential.response as AuthenticatorAttestationResponse;
      const credentialBody = {
        name,
        // Include challengeId for JWT mode (database challenge storage)
        challengeId: options.challengeId,
        response: {
          id: credential.id,
          rawId: ltArrayBufferToBase64Url(credential.rawId),
          type: credential.type,
          response: {
            attestationObject: ltArrayBufferToBase64Url(attestationResponse.attestationObject),
            clientDataJSON: ltArrayBufferToBase64Url(attestationResponse.clientDataJSON),
            transports: attestationResponse.getTransports?.() || [],
          },
          clientExtensionResults: credential.getClientExtensionResults?.() || {},
        },
      };

      // Step 6: Send to server for verification and storage
      const registerResponse = await fetchWithAuth(`${apiBase}/passkey/verify-registration`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(credentialBody),
      });

      const result = await registerResponse.json();

      if (!registerResponse.ok) {
        return {
          success: false,
          error: result.message || t('lt.auth.passkeyRegisterFailed', 'Passkey-Registrierung fehlgeschlagen'),
        };
      }

      return { success: true, passkey: result };
    } catch (err: unknown) {
      if (err instanceof Error) {
        // User cancelled the operation
        if (err.name === 'NotAllowedError') {
          return {
            success: false,
            error: t('lt.auth.passkeyCreationAborted', 'Passkey-Erstellung wurde abgebrochen'),
          };
        }

        // Authenticator already has a credential for this user
        // Some authenticators only allow one passkey per website per user
        if (err.name === 'InvalidStateError' || err.message.includes('already registered') || err.message.includes('credentials already registered')) {
          return {
            success: false,
            error: t(
              'lt.auth.passkeyAlreadyRegistered',
              'Du hast bereits einen Passkey für diese Website registriert. Lösche ihn zuerst oder verwende einen anderen Authenticator.',
            ),
          };
        }

        return {
          success: false,
          error: err.message,
        };
      }
      return {
        success: false,
        error: t('lt.auth.passkeyRegisterFailed', 'Passkey-Registrierung fehlgeschlagen'),
      };
    } finally {
      isLoading.value = false;
    }
  }

  /**
   * Completes a sign-in that stopped at the second factor.
   *
   * Better-Auth answers `verify-totp` / `verify-backup-code` with `{ token, user }`, the token
   * being its session token, and has set the httpOnly session cookie. That token is never stored:
   * the user is signed in on the cookie session and the JWT comes from `/iam/token`. Only a JWT a
   * server already put into the body (JWT mode, `cookies: false`) is taken as it is.
   */
  async function completeTwoFactorSignIn(result: unknown): Promise<void> {
    const answer = result as null | undefined | { data?: null | { token?: unknown; user?: LtUserInput }; error?: unknown };
    const data = answer?.data;
    if (answer?.error || !data?.user) {
      return;
    }
    if (isLtJwtShaped(data.token)) {
      jwtToken.value = data.token;
      setUser(data.user, 'jwt');
      return;
    }
    setUser(data.user, 'cookie');
    await switchToJwtMode();
  }

  // The client's two-factor methods; the two that finish a sign-in also put the user into the
  // auth state, the safe way (see `completeTwoFactorSignIn`).
  const verifyingTwoFactor =
    (method: 'verifyBackupCode' | 'verifyTotp') =>
    async <T extends { code: string }>(params: T, options?: unknown): Promise<unknown> => {
      isLoading.value = true;
      try {
        const result = await authClient.twoFactor[method](params, options as Parameters<typeof authClient.twoFactor.verifyTotp>[1]);
        await completeTwoFactorSignIn(result);
        return result;
      } finally {
        isLoading.value = false;
      }
    };
  const twoFactor = {
    ...authClient.twoFactor,
    verifyBackupCode: verifyingTwoFactor('verifyBackupCode'),
    verifyTotp: verifyingTwoFactor('verifyTotp'),
  };

  // Auto-fetch features once on first client-side useLtAuth() call
  if (import.meta.client && !featuresFetched.value) {
    featuresFetched.value = true; // Set immediately to prevent duplicate fetches
    void fetchFeatures();
  }

  return {
    // Auth state
    authMode,
    isAuthenticated,
    isJwtMode,
    isLoading: computed(() => isLoading.value),
    user,

    // User properties
    hasAnyRole,
    hasRole,
    is2FAEnabled,
    isAdmin,

    // Feature detection
    features: computed(() => features.value),
    fetchFeatures,

    // Auth actions
    authenticateWithPasskey,
    changePassword: authClient.changePassword,
    clearUser,
    registerPasskey,
    // The reset pair, exposed so no project has to reach for `useLtAuthClient()` or hand-roll
    // the flow — the one that did forgot the client-side hashing and desynchronised the two
    // credential stores. The full contract, including why `redirectTo` must be absolute and
    // must never come from user input, lives on `UseLtAuthReturn` in `runtime/types/auth.ts`:
    // that is the surface consumers read, and one copy cannot drift from itself.
    //
    // `params` is forwarded WHOLE and stays fully type-checked. Only `options` is cast, and
    // only because `UseLtAuthReturn` declares it `unknown` while Better-Auth wants its own
    // `ClientFetchOption`. Casting the METHOD instead — which is what this used to do — would
    // throw away the checking on `params` as collateral, on the one argument that carries a
    // credential. The `Parameters<>` here reads the client's option type INSIDE the
    // implementation; it never reaches the published declarations, so it does not recreate
    // the better-auth coupling that 1.15.1 had to revert.
    requestPasswordReset: <T extends { email: string }>(params: T, options?: unknown) =>
      authClient.requestPasswordReset(params, options as Parameters<typeof authClient.requestPasswordReset>[1]),
    resetPassword: <T extends { newPassword: string; token: string }>(params: T, options?: unknown) =>
      authClient.resetPassword(params, options as Parameters<typeof authClient.resetPassword>[1]),
    setUser,
    signIn,
    signOut,
    signUp,
    validateSession,

    // JWT management
    fetchWithAuth,
    jwtToken,
    refreshJwtToken,
    switchToJwtMode,

    // Better Auth client passthrough
    passkey: authClient.passkey,
    twoFactor,
  };
}
