/**
 * User self-service for AI connections: list the connections the current
 * user/tenant may use and pick a personal default. Backed by
 * `GET /ai/connections/available` and `POST /ai/connections/select`.
 */

import { computed, readonly, ref } from '#imports';

import type { LtAiAvailableConnection, UseLtAiConnectionsReturn } from '../types/ai';
import { ltAiRequest } from '../lib/ai';

export function useLtAiConnections(): UseLtAiConnectionsReturn {
  const connections = ref<LtAiAvailableConnection[]>([]);
  const loading = ref(false);
  const error = ref<null | string>(null);

  const selected = computed(() => connections.value.find((c) => c.selected));
  // `locked` is a property of the resolution as a whole (a mandatory layer applies).
  const locked = computed(() => connections.value.some((c) => c.locked));

  async function load(): Promise<void> {
    loading.value = true;
    error.value = null;
    try {
      connections.value = await ltAiRequest<LtAiAvailableConnection[]>('GET', '/connections/available');
    } catch (err) {
      error.value = (err as Error).message;
    } finally {
      loading.value = false;
    }
  }

  async function select(connectionId: string): Promise<void> {
    loading.value = true;
    error.value = null;
    try {
      connections.value = await ltAiRequest<LtAiAvailableConnection[]>('POST', '/connections/select', { connectionId });
    } catch (err) {
      error.value = (err as Error).message;
      throw err;
    } finally {
      loading.value = false;
    }
  }

  return { connections: readonly(connections), error: readonly(error), load, loading: readonly(loading), locked, select, selected };
}
