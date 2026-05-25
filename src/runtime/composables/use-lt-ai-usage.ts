/**
 * Token/prompt usage for the current user (and tenant), from `GET /ai/usage`.
 * The compact per-response budget is also available on every prompt response
 * (see {@link useLtAiChat}); this composable loads the full breakdown on demand.
 */

import { readonly, ref } from '#imports';

import type { LtAiUsageInfo, UseLtAiUsageReturn } from '../types/ai';
import { ltAiRequest } from '../lib/ai';

export function useLtAiUsage(): UseLtAiUsageReturn {
  const usage = ref<LtAiUsageInfo | null>(null);
  const loading = ref(false);
  const error = ref<null | string>(null);

  async function load(): Promise<void> {
    loading.value = true;
    error.value = null;
    try {
      usage.value = await ltAiRequest<LtAiUsageInfo>('GET', '/usage');
    } catch (err) {
      error.value = (err as Error).message;
    } finally {
      loading.value = false;
    }
  }

  return { error: readonly(error), load, loading: readonly(loading), usage: readonly(usage) };
}
