/**
 * System Setup Composable
 *
 * Checks whether the system needs initial setup (first admin user creation)
 * and provides a method to perform that setup.
 *
 * Uses useState for SSR-compatible state management.
 */

import type { ComputedRef } from "vue";

import { computed, useRuntimeConfig, useState } from "#imports";
import { getLtApiBase } from "../../lib/auth-state";
import { ltSha256 } from "../../utils/crypto";

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
  const runtimeConfig = useRuntimeConfig();
  const needsSetupState = useState<boolean | null>("lt-needs-setup", () => null);

  const needsSetup = computed(() => needsSetupState.value);

  /**
   * Check if the system needs initial setup
   */
  async function checkSetupStatus(): Promise<boolean> {
    try {
      let url: string;

      if (import.meta.server) {
        // SSR: call backend directly via runtimeConfig.apiUrl
        const apiUrl = (runtimeConfig as Record<string, string>).apiUrl || "http://localhost:3000";
        url = `${apiUrl}/api/system-setup/status`;
      } else {
        // Client: use Vite proxy
        url = "/api/system-setup/status";
      }

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
    const apiBase = getLtApiBase();
    const hashedPassword = await ltSha256(params.password);

    await $fetch(`${apiBase}/system-setup/init`, {
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
