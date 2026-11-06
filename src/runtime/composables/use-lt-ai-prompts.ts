/**
 * User-facing prompt composable.
 *
 * Any signed-in user can author re-usable prompts ("Vorlagen") for themselves
 * (`scope: 'user'` = private) or for their tenant (`scope: 'tenant'` = public).
 * `load()` returns every active prompt the current user is allowed to see (own +
 * tenant), already filtered by the server. That is what a chat picker offers.
 * A management screen calls `load({ includeDisabled: true })` (nest-server >= 12.7.0),
 * so a prompt switched off stays in the list and can be switched on again.
 *
 * Pair this with your own prompt picker / settings UI. The nuxt-base-starter
 * ships a reference picker inside the AI chat and a settings page.
 */

import { readonly, ref } from '#imports';

import type { LtAiPrompt, LtAiPromptInput, LtAiPromptsLoadOptions, UseLtAiPromptsReturn } from '../types/ai';
import { ltAiRequest } from '../lib/ai';

export function useLtAiPrompts(): UseLtAiPromptsReturn {
  const prompts = ref<LtAiPrompt[]>([]);
  const loading = ref(false);
  const error = ref<null | string>(null);
  // The reload after create/update/remove asks for the same list as the last load(): a management
  // screen would otherwise lose a prompt the moment it is saved as disabled.
  let includeDisabled = false;

  async function load(options?: LtAiPromptsLoadOptions): Promise<void> {
    // Strictly `true`: `@click="load"` passes the event as options
    includeDisabled = options?.includeDisabled === true;
    await fetchPrompts();
  }

  async function fetchPrompts(): Promise<void> {
    loading.value = true;
    error.value = null;
    try {
      const path = includeDisabled ? '/prompts?includeDisabled=true' : '/prompts';
      prompts.value = (await ltAiRequest<LtAiPrompt[]>('GET', path)) || [];
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
      await fetchPrompts();
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
      await fetchPrompts();
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
      await fetchPrompts();
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
