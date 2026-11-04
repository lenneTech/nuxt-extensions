/**
 * User self-service for the current user's own AI settings, today whether MCP
 * asks before a destructive or mutating tool runs (a "bypass permissions"
 * switch). Backed by `GET /ai/settings` and `PUT /ai/settings`
 * (nest-server >= 12.3.0).
 *
 * The answer is always the setting as it takes effect. When the server fixes
 * it (`ai.mcp.confirmation.enforced`), `enforced` is true, the switch should be
 * shown disabled, and `update()` is refused with 403 (`#LTNS_0609`).
 */

import { computed, readonly, ref } from '#imports';

import type { LtAiSettings, LtAiSettingsInput, UseLtAiSettingsReturn } from '../types/ai';
import { ltAiRequest } from '../lib/ai';

export function useLtAiSettings(): UseLtAiSettingsReturn {
  const settings = ref<LtAiSettings | null>(null);
  const loading = ref(false);
  const error = ref<null | string>(null);

  const enforced = computed(() => settings.value?.mcpConfirmationEnforced === true);

  async function load(): Promise<void> {
    loading.value = true;
    error.value = null;
    try {
      settings.value = await ltAiRequest<LtAiSettings>('GET', '/settings');
    } catch (err) {
      error.value = (err as Error).message;
    } finally {
      loading.value = false;
    }
  }

  async function update(input: LtAiSettingsInput): Promise<void> {
    loading.value = true;
    error.value = null;
    try {
      settings.value = await ltAiRequest<LtAiSettings>('PUT', '/settings', input);
    } catch (err) {
      error.value = (err as Error).message;
      throw err;
    } finally {
      loading.value = false;
    }
  }

  return { enforced, error: readonly(error), load, loading: readonly(loading), settings: readonly(settings), update };
}
