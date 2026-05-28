/**
 * Placeholder-list composable. Loads the runtime registry from the backend
 * (`GET /ai/placeholders`) so slot / prompt editors can render a dynamic
 * helper sidebar with the currently supported `{{placeholders}}` — without
 * hard-coding any names in the frontend.
 *
 * Available to any signed-in user (S_USER on the endpoint).
 */

import { readonly, ref } from '#imports';

import type { LtAiPlaceholder, UseLtAiPlaceholdersReturn } from '../types/ai';
import { ltAiRequest } from '../lib/ai';

export function useLtAiPlaceholders(): UseLtAiPlaceholdersReturn {
  const placeholders = ref<LtAiPlaceholder[]>([]);
  const loading = ref(false);
  const error = ref<null | string>(null);

  async function load(): Promise<void> {
    loading.value = true;
    error.value = null;
    try {
      placeholders.value = (await ltAiRequest<LtAiPlaceholder[]>('GET', '/placeholders')) || [];
    } catch (err) {
      error.value = (err as Error).message;
      placeholders.value = [];
    } finally {
      loading.value = false;
    }
  }

  return {
    error: readonly(error),
    load,
    loading: readonly(loading),
    placeholders: readonly(placeholders),
  };
}
