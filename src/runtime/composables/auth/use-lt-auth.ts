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

import type { LtAuthMode, LtAuthState, LtPasskeyAuthResult, LtPasskeyRegisterResult, LtUser, UseLtAuthReturn } from '../../types';

import { useNuxtApp, useCookie, useState, useRequestHeaders, ref, computed, watch } from '#imports';
import { ltArrayBufferToBase64Url, ltBase64UrlToUint8Array } from '../../utils/crypto';
import { clearLtAuthCookies, getLtApiBase, getLtAuthCookieNames, resolveLtAuthState } from '../../lib/auth-state';
import { useLtAuthClient } from '../use-lt-auth-client';

/**
 * Helper function for i18n with German fallback
 *
 * Two-stage fallback strategy:
 * 1. Without i18n installed -> German (for single-language DE projects)
 * 2. With i18n, no translation -> English (international fallback)
 */
function useTranslation() {
  const nuxtApp = useNuxtApp();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
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

  // JWT token storage (used when cookies are not available)
  const jwtToken = useCookie<string | null>(tokenCookieName, {
    maxAge: 60 * 60 * 24 * 7, // 7 days
    sameSite: 'lax',
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

  // Auth mode: 'cookie' (default) or 'jwt' (fallback)
  const authMode = computed(() => resolvedAuthState.value?.authMode || 'cookie');
  const isJwtMode = computed(() => authMode.value === 'jwt');

  // Computed properties based on stored state
  const user = computed<LtUser | null>(() => resolvedAuthState.value?.user ?? null);
  const isAuthenticated = computed<boolean>(() => !!user.value);
  // Admin detection accepts BOTH user shapes:
  //  - `role: 'admin'`      — Better-Auth's admin plugin (single role).
  //  - `roles: ['admin']`   — `@lenne.tech/nest-server`, which registers `roles`
  //                           as a core Better-Auth additionalField (`string[]`).
  //                           Its users carry NO singular `role`, so a `role`-only
  //                           check is permanently false against a nest-server
  //                           backend and the whole admin UI silently disappears.
  // `Array.isArray` guards a malformed `roles` in the (client-writable) auth-state
  // cookie: a non-array value must yield `false`, never throw inside the computed.
  const isAdmin = computed<boolean>(() => {
    const current = user.value;
    if (!current) {
      return false;
    }
    return current.role === 'admin' || (Array.isArray(current.roles) && current.roles.includes('admin'));
  });
  const is2FAEnabled = computed<boolean>(() => user.value?.twoFactorEnabled ?? false);

  // SSR-safe shared features state (useState is isolated per request on server, shared on client)
  const features = useState<Record<string, boolean | number | string[]>>('lt-auth-features', () => ({}));
  const featuresFetched = useState<boolean>('lt-auth-features-fetched', () => false);

  /**
   * Set user data after successful login/signup
   * Also manually writes to browser cookie for SSR compatibility
   */
  function setUser(userData: LtUser | null, mode: LtAuthMode = 'cookie'): void {
    const newState = { user: userData, authMode: mode };

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
   * Switch to JWT mode and fetch a token
   */
  async function switchToJwtMode(): Promise<boolean> {
    try {
      const apiBase = getLtApiBase();
      const response = await fetch(`${apiBase}/token`, {
        method: 'GET',
        credentials: 'include',
      });

      if (response.ok) {
        const data = await response.json();
        if (data.token) {
          jwtToken.value = data.token;
          if (authState.value) {
            authState.value = { ...authState.value, authMode: 'jwt' };
          }
          return true;
        }
      }
      return false;
    } catch {
      return false;
    }
  }

  /**
   * Refresh JWT token before it expires
   */
  async function refreshJwtToken(): Promise<boolean> {
    if (!isJwtMode.value || !jwtToken.value) return false;
    return switchToJwtMode();
  }

  /**
   * Paths that require cookies even in JWT mode.
   * Better-Auth's Passkey and 2FA operations need the session cookie
   * for challenge/verification token handling.
   */
  const PATHS_REQUIRING_COOKIES = ['/passkey/', '/two-factor/', '/2fa/'];

  /**
   * Check if a URL requires cookies (for Passkey/2FA operations)
   */
  function urlRequiresCookies(url: string): boolean {
    return PATHS_REQUIRING_COOKIES.some((path) => url.includes(path));
  }

  /**
   * Authenticated fetch wrapper
   * Uses cookies by default, falls back to JWT if cookies fail
   *
   * In JWT mode, cookies are only sent for Passkey/2FA operations
   * that require the session cookie for challenge handling.
   */
  async function fetchWithAuth(url: string, options: RequestInit = {}): Promise<Response> {
    const headers = new Headers(options.headers);

    // In JWT mode, add Authorization header
    if (isJwtMode.value && jwtToken.value) {
      headers.set('Authorization', `Bearer ${jwtToken.value}`);
    }

    // Determine credentials mode:
    // - Cookie mode: always include credentials
    // - JWT mode: only include for paths that require cookies (passkey, 2FA)
    const needsCookies = !isJwtMode.value || urlRequiresCookies(url);

    const response = await fetch(url, {
      ...options,
      headers,
      credentials: needsCookies ? 'include' : 'omit',
    });

    // If we get 401 in cookie mode, try switching to JWT
    if (response.status === 401 && !isJwtMode.value && isAuthenticated.value) {
      const switched = await switchToJwtMode();

      if (switched) {
        // Retry the request with JWT
        headers.set('Authorization', `Bearer ${jwtToken.value}`);
        const retryNeedsCookies = urlRequiresCookies(url);
        return fetch(url, {
          ...options,
          headers,
          credentials: retryNeedsCookies ? 'include' : 'omit',
        });
      }
    }

    return response;
  }

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
   * never carries `roles`) is a no-op. And nest-server — the reason `roles` is
   * supported at all — registers it as a CORE additionalField (`type: 'string[]'`,
   * `defaultValue: []`), so its get-session always returns `roles`; the worst case is
   * an honest `[]` (= not an admin), never a spurious drop.
   */
  const AUTHZ_KEYS = ['banExpires', 'banReason', 'banned', 'emailVerified', 'role', 'roles', 'twoFactorEnabled'] as const satisfies readonly (keyof LtUser)[];

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
   * Validate session with backend (called on app init)
   * If session is invalid, clear the stored state
   */
  async function validateSession(): Promise<boolean> {
    try {
      // Try to get session from Better Auth
      const session = authClient.useSession();

      // Wait for session to load
      if (session.value.isPending) {
        await new Promise((resolve) => {
          const unwatch = watch(
            () => session.value.isPending,
            (isPending: boolean) => {
              if (!isPending) {
                unwatch();
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
      if (authState.value?.user) {
        // Pre-fetch JWT for fallback
        switchToJwtMode().catch(() => {});
        return true;
      }

      return false;
    } catch {
      return !!authState.value?.user;
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
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    email: async (params: { email: string; password: string; rememberMe?: boolean }, options?: any) => {
      isLoading.value = true;
      try {
        const result = await authClient.signIn.email(params, options);

        // Extract token from response (JWT mode: cookies: false)
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const resultAny = result as any;
        const token = resultAny?.token || resultAny?.data?.token;
        const userData = resultAny?.user || resultAny?.data?.user;

        if (token) {
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
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    email: async (params: { email: string; name: string; password: string } & Record<string, unknown>, options?: any) => {
      isLoading.value = true;
      try {
        const result = await authClient.signUp.email(params, options);

        // Extract token from response (JWT mode: cookies: false)
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const resultAny = result as any;
        const token = resultAny?.token || resultAny?.data?.token;
        const userData = resultAny?.user || resultAny?.data?.user;

        if (token) {
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
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const signOut = async (options?: any) => {
    isLoading.value = true;
    try {
      const result = await authClient.signOut(options);
      // Clear user data on logout
      clearUser();
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

      // Store user data after successful passkey login
      if (result.user) {
        setUser(result.user as LtUser, 'cookie');
        switchToJwtMode().catch(() => {});
      } else if (result.session?.token) {
        // Passkey auth returned session without user data.
        // Store the session token and fetch user via get-session.
        jwtToken.value = result.session.token;
        if (authState.value) {
          authState.value = { ...authState.value, authMode: 'jwt' };
        }

        // Fetch user data via get-session to populate auth state
        try {
          const sessionResponse = await fetchWithAuth(`${apiBase}/get-session`, { method: 'GET' });
          if (sessionResponse.ok) {
            const sessionData = await sessionResponse.json();
            if (sessionData?.user) {
              // Merge onto the cached user so this passkey get-session fallback
              // never drops nest-server-only fields either (see mergeSessionUser).
              const mergedUser = mergeSessionUser(sessionData.user as LtUser);
              result.user = mergedUser;
              setUser(mergedUser, 'cookie');
              switchToJwtMode().catch(() => {});
            }
          }
        } catch {
          // Fallback: user can still be fetched via validateSession in the login page
        }
      }

      return { success: true, user: result.user as LtUser, session: result.session };
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
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          excludeCredentials: (options.excludeCredentials || []).map((cred: any) => ({
            ...cred,
            id: ltBase64UrlToUint8Array(cred.id).buffer as ArrayBuffer,
          })),
        },
      })) as PublicKeyCredential | null;

      if (!credential) {
        return {
          success: false,
          error: t('lt.auth.passkeyCreationAborted', 'Passkey-Erstellung abgebrochen'),
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

  // Auto-fetch features once on first client-side useLtAuth() call
  if (import.meta.client && !featuresFetched.value) {
    featuresFetched.value = true; // Set immediately to prevent duplicate fetches
    fetchFeatures();
  }

  return {
    // Auth state
    authMode,
    isAuthenticated,
    isJwtMode,
    isLoading: computed(() => isLoading.value),
    user,

    // User properties
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
    twoFactor: authClient.twoFactor,
  };
}
