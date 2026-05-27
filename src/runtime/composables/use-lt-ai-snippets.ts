/**
 * User-facing prompt snippet ("Vorlage") composable.
 *
 * Any signed-in user can author snippets for themselves, for their tenant, or —
 * with admin role — globally. `load()` returns every snippet the current user is
 * allowed to see (own + tenant + global), already filtered by the server.
 *
 * Pair this with your own snippet picker / settings UI. The nuxt-base-starter
 * ships a reference picker inside the AI chat and a settings page.
 */

import { readonly, ref } from '#imports';

import type { LtAiPromptSnippet, LtAiPromptSnippetInput, UseLtAiSnippetsReturn } from '../types/ai';
import { ltAiRequest } from '../lib/ai';

export function useLtAiSnippets(): UseLtAiSnippetsReturn {
  const snippets = ref<LtAiPromptSnippet[]>([]);
  const loading = ref(false);
  const error = ref<null | string>(null);

  async function load(): Promise<void> {
    loading.value = true;
    error.value = null;
    try {
      snippets.value = (await ltAiRequest<LtAiPromptSnippet[]>('GET', '/snippets')) || [];
    } catch (err) {
      error.value = (err as Error).message;
      snippets.value = [];
    } finally {
      loading.value = false;
    }
  }

  async function create(input: LtAiPromptSnippetInput): Promise<LtAiPromptSnippet> {
    const created = await ltAiRequest<LtAiPromptSnippet>('POST', '/snippets', input);
    await load();
    return created;
  }

  async function update(id: string, input: LtAiPromptSnippetInput): Promise<LtAiPromptSnippet> {
    const updated = await ltAiRequest<LtAiPromptSnippet>('PUT', `/snippets/${id}`, input);
    await load();
    return updated;
  }

  async function remove(id: string): Promise<LtAiPromptSnippet> {
    const removed = await ltAiRequest<LtAiPromptSnippet>('DELETE', `/snippets/${id}`);
    await load();
    return removed;
  }

  return {
    create,
    remove,
    error: readonly(error),
    load,
    loading: readonly(loading),
    snippets: readonly(snippets),
    update,
  };
}
