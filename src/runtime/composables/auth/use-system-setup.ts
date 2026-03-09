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

import type { ComputedRef } from "vue";

import { computed, useState } from "#imports";
import { ltSha256 } from "../../utils/crypto";
import { buildLtApiUrl } from "../../lib/auth-state";

export interface UseSystemSetupReturn {
  /** Whether the system needs initial setup (null = not checked yet) */
  needsSetup: ComputedRef<boolean | null>;
  /** Check setup status from the backend */
  checkSetupStatus: () => Promise<boolean>;
  /** Initialize the system with the first admin user */
  initSetup: (params: { email: string; password: string; name: string }) => Promise<void>;
}

/**
 * Composable for system setup flow (first admin user creation)
 *
 * @example
 * ```typescript
 * const { needsSetup, checkSetupStatus, initSetup } = useSystemSetup();
 *
 * await checkSetupStatus();
 * if (needsSetup.value) {
 *   await initSetup({ email: 'admin@example.com', password: 'secret', name: 'Admin' });
 * }
 * ```
 */
export function useSystemSetup(): UseSystemSetupReturn {
  const needsSetupState = useState<boolean | null>("lt-needs-setup", () => null);

  const needsSetup = computed(() => needsSetupState.value);

  /**
   * Check if the system needs initial setup
   */
  async function checkSetupStatus(): Promise<boolean> {
    try {
      const url = buildLtApiUrl("/system-setup/status");
      const data = await $fetch<{ needsSetup: boolean }>(url);
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
  async function initSetup(params: {
    email: string;
    password: string;
    name: string;
  }): Promise<void> {
    const url = buildLtApiUrl("/system-setup/init");
    const hashedPassword = await ltSha256(params.password);

    await $fetch(url, {
      method: "POST",
      body: {
        email: params.email,
        password: hashedPassword,
        name: params.name,
      },
    });

    needsSetupState.value = false;
  }

  return {
    needsSetup,
    checkSetupStatus,
    initSetup,
  };
}
