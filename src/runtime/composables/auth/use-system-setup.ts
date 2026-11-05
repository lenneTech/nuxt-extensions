/**
 * System Setup Composable
 *
 * Checks whether the system needs initial setup (first admin user creation)
 * and provides a method to perform that setup.
 *
 * Uses useState for SSR-compatible state management.
 *
 * URL handling is delegated to {@link buildLtApiUrl} (SSR / proxy / direct).
 */

import type { ComputedRef } from 'vue';

import { computed, useState } from '#imports';
import { ltSha256 } from '../../utils/crypto';
import { buildLtApiUrl, resolveLtApiBaseUrl, warnMissingLtApiUrl } from '../../lib/auth-state';

/**
 * Whether no API URL is configured. Without a runtime-config context
 * `buildLtApiUrl` falls back to the bare path too, so that counts as missing.
 */
function isApiUrlMissing(): boolean {
  try {
    return resolveLtApiBaseUrl().missing;
  } catch {
    return true;
  }
}

/**
 * Header that carries the setup token to `POST /system-setup/init`. The server compares it as
 * given, so it is sent unhashed — unlike the password — and never in the body.
 */
const SETUP_TOKEN_HEADER = 'X-System-Setup-Token';

/** Whether `error` is the API's 403, as `$fetch` (ofetch `FetchError`) reports it */
function isRefusal(error: unknown): boolean {
  const { status, statusCode } = (error ?? {}) as { status?: unknown; statusCode?: unknown };
  return (statusCode ?? status) === 403;
}

/** Response of `GET /system-setup/status`. The two HTTP-init fields exist since nest-server 12.4.0. */
interface SystemSetupStatusResponse {
  httpInitEnabled?: unknown;
  httpInitTokenRequired?: unknown;
  needsSetup: boolean;
}

interface HttpInitState {
  enabled: boolean;
  tokenRequired: boolean;
}

export interface UseSystemSetupReturn {
  /** Whether the system needs initial setup (null = not checked yet) */
  needsSetup: ComputedRef<boolean | null>;
  /**
   * Whether the API accepts the setup over HTTP (null = not checked yet). `false` means the
   * deployment creates its first admin from its configuration, and `initSetup()` would be
   * refused with 403 (`LTNS_0053`): show a notice instead of the form. An API before
   * nest-server 12.4.0 does not report it and accepts the HTTP setup, so it reads as `true`.
   */
  httpInitEnabled: ComputedRef<boolean | null>;
  /** Whether `initSetup()` needs a `token` (null = not checked yet). Only an explicit `true` counts. */
  httpInitTokenRequired: ComputedRef<boolean | null>;
  /** Check setup status from the backend */
  checkSetupStatus: () => Promise<boolean>;
  /**
   * Initialize the system with the first admin user. `token` is the setup token, required when
   * `httpInitTokenRequired` is true. A refusal is rethrown unchanged, so `useLtErrorTranslation()`
   * reads its code (`LTNS_0053` HTTP setup disabled, `LTNS_0054` wrong token) from the body.
   */
  initSetup: (params: { email: string; password: string; name: string; token?: string }) => Promise<void>;
}

/**
 * Composable for system setup flow (first admin user creation)
 *
 * @example
 * ```typescript
 * const { needsSetup, httpInitEnabled, httpInitTokenRequired, checkSetupStatus, initSetup } = useSystemSetup();
 *
 * await checkSetupStatus();
 * if (needsSetup.value && httpInitEnabled.value) {
 *   await initSetup({ email: 'admin@example.com', password: 'secret', name: 'Admin', token });
 * }
 * ```
 */
export function useSystemSetup(): UseSystemSetupReturn {
  const needsSetupState = useState<boolean | null>('lt-needs-setup', () => null);
  const httpInitState = useState<HttpInitState | null>('lt-system-setup-http-init', () => null);

  const needsSetup = computed(() => needsSetupState.value);
  const httpInitEnabled = computed(() => httpInitState.value?.enabled ?? null);
  const httpInitTokenRequired = computed(() => httpInitState.value?.tokenRequired ?? null);

  /**
   * Check if the system needs initial setup
   */
  async function checkSetupStatus(): Promise<boolean> {
    // Without an API URL the path stays relative, and on the server a relative
    // `$fetch` goes to Nitro itself, not to the backend: Nitro renders it as a
    // page, the global setup middleware runs again in that request and fetches
    // again — a recursion that ends in out-of-memory. Leave the status undecided
    // instead, so the client checks once it can resolve the URL.
    if (import.meta.server && isApiUrlMissing()) {
      warnMissingLtApiUrl('server');
      return false;
    }

    try {
      const url = buildLtApiUrl('/system-setup/status');
      const data = await $fetch<SystemSetupStatusResponse>(url);
      httpInitState.value = {
        // Missing or malformed reads as released: an API before 12.4.0 accepts the HTTP setup,
        // and the server's 403 is the boundary, not this flag.
        enabled: typeof data.httpInitEnabled === 'boolean' ? data.httpInitEnabled : true,
        tokenRequired: data.httpInitTokenRequired === true,
      };
      needsSetupState.value = data.needsSetup;
      return data.needsSetup;
    } catch {
      // Error or 404 means the endpoint doesn't exist (backward compatibility)
      needsSetupState.value = false;
      return false;
    }
  }

  /**
   * Initialize the system with the first admin user
   */
  async function initSetup(params: { email: string; password: string; name: string; token?: string }): Promise<void> {
    const url = buildLtApiUrl('/system-setup/init');
    const hashedPassword = await ltSha256(params.password);
    // An HTTP field value carries no surrounding whitespace, and `fetch` throws on a line break,
    // so a token pasted with its newline would abort the request instead of reaching the server.
    const token = params.token?.trim();

    try {
      await $fetch(url, {
        method: 'POST',
        body: {
          email: params.email,
          password: hashedPassword,
          name: params.name,
        },
        ...(token ? { headers: { [SETUP_TOKEN_HEADER]: token } } : {}),
      });
    } catch (error) {
      // A refusal can mean the API was restarted with another configuration since the status was
      // read: the HTTP setup closed (`LTNS_0053`), or a token is now required (`LTNS_0054`).
      // Re-reading the status lets the page and the middleware show the current state.
      if (isRefusal(error)) {
        await checkSetupStatus();
      }
      throw error;
    }

    needsSetupState.value = false;
  }

  return {
    needsSetup,
    httpInitEnabled,
    httpInitTokenRequired,
    checkSetupStatus,
    initSetup,
  };
}
