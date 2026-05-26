/**
 * Multi-turn chat composable built on {@link useLtAi}. Maintains the message
 * list, streams assistant answers token-by-token, tracks the conversation id and
 * the latest budget summary, and handles the confirmation flow for mutating /
 * destructive actions.
 */

import { computed, reactive, readonly, ref, unref } from '#imports';

import type { LtAiBudgetSummary, LtAiMessage, LtAiPromptInput, LtAiResponse, UseLtAiChatOptions, UseLtAiChatReturn } from '../types/ai';
import { useLtAi } from './use-lt-ai';

export function useLtAiChat(options: UseLtAiChatOptions = {}): UseLtAiChatReturn {
  const ai = useLtAi();
  const messages = ref<LtAiMessage[]>([]);
  const conversationId = ref<string | undefined>(options.conversationId);
  const budget = ref<LtAiBudgetSummary | null>(null);
  const contextWindow = ref<{ total: number; used: number } | null>(null);
  const error = ref<null | string>(null);
  let lastPrompt = '';
  let controller: AbortController | undefined;

  const requiresConfirmation = computed(() => {
    const last = messages.value[messages.value.length - 1];
    return !!last && last.role === 'assistant' && !!last.requiresConfirmation;
  });

  function resolveConnectionId(): string | undefined {
    return unref(options.connectionId) ?? undefined;
  }

  /** Apply a final response to the streaming assistant message. */
  function applyFinal(assistant: LtAiMessage, response: LtAiResponse): void {
    assistant.pending = false;
    assistant.content = response.text || assistant.content;
    assistant.actions = response.actions;
    assistant.budget = response.budget;
    assistant.denied = response.denied;
    assistant.requiresConfirmation = response.requiresConfirmation;
    assistant.pendingActions = response.pendingActions;
    if (response.budget) {
      budget.value = response.budget;
    }
    if (response.contextWindow) {
      contextWindow.value = response.contextWindow;
    }
    if (response.conversationId) {
      conversationId.value = response.conversationId;
    }
  }

  /** Run one assistant turn for the given input, streaming into a new message. */
  async function runTurn(input: LtAiPromptInput): Promise<void> {
    error.value = null;
    // Must be reactive: we mutate this object (content/actions/…) while streaming.
    // A plain object pushed into the ref array would be wrapped in a *separate*
    // reactive proxy, so mutating the original reference would not trigger re-renders.
    const assistant = reactive<LtAiMessage>({ content: '', createdAt: new Date().toISOString(), pending: true, role: 'assistant' });
    messages.value.push(assistant);
    controller = new AbortController();
    const useStream = options.stream !== false;
    try {
      if (useStream) {
        const final = await ai.promptStream(
          input,
          {
            onToken: (token) => {
              assistant.content += token;
            },
            onFinal: (response) => applyFinal(assistant, response),
          },
          { signal: controller.signal },
        );
        if (final) {
          applyFinal(assistant, final);
        } else {
          assistant.pending = false;
        }
      } else {
        applyFinal(assistant, await ai.prompt(input));
      }
    } catch (err) {
      assistant.pending = false;
      assistant.error = true;
      error.value = (err as Error).message;
      if (!assistant.content) {
        assistant.content = (err as Error).message;
      }
    } finally {
      controller = undefined;
    }
  }

  /** Send a new user message and stream the assistant's answer. */
  async function send(content: string): Promise<void> {
    const text = content.trim();
    if (!text || ai.streaming.value) {
      return;
    }
    lastPrompt = text;
    messages.value.push({ content: text, createdAt: new Date().toISOString(), role: 'user' });
    await runTurn({
      connectionId: resolveConnectionId(),
      conversationId: conversationId.value,
      metadata: options.metadata?.(),
      mode: options.mode,
      prompt: text,
    });
  }

  /** Confirm the last turn that requires confirmation (re-runs it with `confirm: true`). */
  async function confirm(): Promise<void> {
    if (!requiresConfirmation.value || !lastPrompt) {
      return;
    }
    await runTurn({
      confirm: true,
      connectionId: resolveConnectionId(),
      conversationId: conversationId.value,
      metadata: options.metadata?.(),
      mode: options.mode,
      prompt: lastPrompt,
    });
  }

  /** Abort the current streaming turn. */
  function stop(): void {
    controller?.abort();
    controller = undefined;
  }

  /** Clear the message history (does not delete the server-side conversation). */
  function clear(): void {
    messages.value = [];
    budget.value = null;
    contextWindow.value = null;
    error.value = null;
    lastPrompt = '';
  }

  return {
    budget: readonly(budget),
    contextWindow: readonly(contextWindow),
    clear,
    confirm,
    conversationId: readonly(conversationId),
    error: readonly(error),
    // Returned as a shallow Readonly<Ref> (see UseLtAiChatReturn): consumers cannot
    // reassign the ref but can bind individual messages to child components.
    messages,
    requiresConfirmation,
    send,
    stop,
    streaming: ai.streaming,
  };
}
