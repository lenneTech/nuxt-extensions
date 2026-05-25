/**
 * Core AI composable: one-shot prompts and SSE streaming against the
 * @lenne.tech/nest-server AI module (`/ai/prompt`, `/ai/stream`).
 *
 * Headless — pair it with your own UI, or use the higher-level {@link useLtAiChat}.
 */

import { readonly, ref } from '#imports';

import type { LtAiPromptInput, LtAiResponse, LtAiStreamHandlers, UseLtAiReturn } from '../types/ai';
import { buildLtAiUrl, ltAiRequest, ltAiResponseError, parseLtAiSseStream } from '../lib/ai';
import { ltAuthFetch } from '../lib/auth-state';

export function useLtAi(): UseLtAiReturn {
  const loading = ref(false);
  const streaming = ref(false);
  const error = ref<null | string>(null);

  /** Run a prompt and return the full structured response. */
  async function prompt(input: LtAiPromptInput): Promise<LtAiResponse> {
    loading.value = true;
    error.value = null;
    try {
      return await ltAiRequest<LtAiResponse>('POST', '/prompt', input);
    } catch (err) {
      error.value = (err as Error).message;
      throw err;
    } finally {
      loading.value = false;
    }
  }

  /** Run a prompt and stream the answer; resolves with the final response. */
  async function promptStream(input: LtAiPromptInput, handlers?: LtAiStreamHandlers, options?: { signal?: AbortSignal }): Promise<LtAiResponse | undefined> {
    streaming.value = true;
    error.value = null;
    let final: LtAiResponse | undefined;
    try {
      const response = await ltAuthFetch(buildLtAiUrl('/stream'), {
        body: JSON.stringify(input),
        headers: { Accept: 'text/event-stream', 'Content-Type': 'application/json' },
        method: 'POST',
        signal: options?.signal,
      });
      if (!response.ok) {
        throw await ltAiResponseError(response);
      }
      await parseLtAiSseStream(response, (event) => {
        handlers?.onEvent?.(event);
        switch (event.type) {
          case 'action':
            handlers?.onAction?.(event.action);
            break;
          case 'error':
            error.value = event.message;
            handlers?.onError?.(event.message);
            break;
          case 'final':
            final = event.response;
            handlers?.onFinal?.(event.response);
            break;
          case 'token':
            handlers?.onToken?.(event.token);
            break;
        }
      });
      return final;
    } catch (err) {
      error.value = (err as Error).message;
      throw err;
    } finally {
      streaming.value = false;
    }
  }

  return {
    error: readonly(error),
    loading: readonly(loading),
    prompt,
    promptStream,
    streaming: readonly(streaming),
  };
}
