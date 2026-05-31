/**
 * User-facing prompt composable.
 *
 * Any signed-in user can author re-usable prompts ("Vorlagen") for themselves
 * (`scope: 'user'` = private) or for their tenant (`scope: 'tenant'` = public).
 * `load()` returns every prompt the current user is allowed to see (own +
 * tenant), already filtered by the server.
 *
 * Pair this with your own prompt picker / settings UI. The nuxt-base-starter
 * ships a reference picker inside the AI chat and a settings page.
 */

import { readonly, ref } from '#imports';

import type { LtAiPrompt, LtAiPromptInput, UseLtAiPromptsReturn } from '../types/ai';
import { ltAiRequest } from '../lib/ai';

export function useLtAiPrompts(): UseLtAiPromptsReturn {
  const prompts = ref<LtAiPrompt[]>([]);
  const loading = ref(false);
  const error = ref<null | string>(null);

  async function load(): Promise<void> {
    loading.value = true;
    error.value = null;
    try {
      prompts.value = (await ltAiRequest<LtAiPrompt[]>('GET', '/prompts')) || [];
    } catch (err) {
      error.value = (err as Error).message;
      prompts.value = [];
    } finally {
      loading.value = false;
    }
  }

  async function create(input: LtAiPromptInput): Promise<LtAiPrompt> {
    loading.value = true;
    error.value = null;
    try {
      const created = await ltAiRequest<LtAiPrompt>('POST', '/prompts', input);
      await load();
      return created;
    } catch (err) {
      error.value = (err as Error).message;
      throw err;
    } finally {
      loading.value = false;
    }
  }

  async function update(id: string, input: LtAiPromptInput): Promise<LtAiPrompt> {
    loading.value = true;
    error.value = null;
    try {
      const updated = await ltAiRequest<LtAiPrompt>('PUT', `/prompts/${encodeURIComponent(id)}`, input);
      await load();
      return updated;
    } catch (err) {
      error.value = (err as Error).message;
      throw err;
    } finally {
      loading.value = false;
    }
  }

  async function remove(id: string): Promise<LtAiPrompt> {
    loading.value = true;
    error.value = null;
    try {
      const removed = await ltAiRequest<LtAiPrompt>('DELETE', `/prompts/${encodeURIComponent(id)}`);
      await load();
      return removed;
    } catch (err) {
      error.value = (err as Error).message;
      throw err;
    } finally {
      loading.value = false;
    }
  }

  return {
    create,
    error: readonly(error),
    load,
    loading: readonly(loading),
    prompts: readonly(prompts),
    remove,
    update,
  };
}
