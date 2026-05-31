/**
 * Multi-turn chat composable built on {@link useLtAi}. Maintains the message
 * list, streams assistant answers token-by-token, tracks the conversation id and
 * the latest budget summary, and handles the confirmation flow for mutating /
 * destructive actions.
 */

import { computed, getCurrentScope, onScopeDispose, reactive, readonly, ref, unref } from '#imports';

import type { LtAiBudgetSummary, LtAiMessage, LtAiPromptRunInput, LtAiResponse, UseLtAiChatOptions, UseLtAiChatReturn } from '../types/ai';
import { useLtAi } from './use-lt-ai';

export function useLtAiChat(options: UseLtAiChatOptions = {}): UseLtAiChatReturn {
  const ai = useLtAi();
  const messages = ref<LtAiMessage[]>([]);
  const conversationId = ref<string | undefined>(options.conversationId);
  const budget = ref<LtAiBudgetSummary | null>(null);
  const contextWindow = ref<{ total: number; used: number } | null>(null);
  const error = ref<null | string>(null);
  const maxMessages = options.maxMessages;
  let lastPrompt = '';
  let controller: AbortController | undefined;

  const requiresConfirmation = computed(() => {
    const last = messages.value[messages.value.length - 1];
    return !!last && last.role === 'assistant' && !!last.requiresConfirmation;
  });

  function resolveConnectionId(): string | undefined {
    return unref(options.connectionId) ?? undefined;
  }

  function trimMessageHistory(): void {
    if (maxMessages && messages.value.length > maxMessages) {
      messages.value.splice(0, messages.value.length - maxMessages);
    }
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
  async function runTurn(input: LtAiPromptRunInput): Promise<void> {
    error.value = null;
    // Must be reactive: we mutate this object (content/actions/…) while streaming.
    // A plain object pushed into the ref array would be wrapped in a *separate*
    // reactive proxy, so mutating the original reference would not trigger re-renders.
    const assistant = reactive<LtAiMessage>({ content: '', createdAt: new Date().toISOString(), pending: true, role: 'assistant' });
    messages.value.push(assistant);
    trimMessageHistory();
    controller = new AbortController();
    const useStream = options.stream !== false;
    try {
      if (useStream) {
        // applyFinal runs from the onFinal callback so consumers see budget /
        // contextWindow / conversationId mutations the moment the backend emits
        // the final event — not only after promptStream resolves. The post-await
        // branch only handles the edge case where the stream closes WITHOUT a
        // final event (older backends, premature disconnect).
        await ai.promptStream(
          input,
          {
            onToken: (token) => {
              assistant.content += token;
            },
            onFinal: (response) => applyFinal(assistant, response),
          },
          { signal: controller.signal },
        );
        if (assistant.pending) {
          assistant.pending = false;
        }
      } else {
        applyFinal(assistant, await ai.prompt(input));
      }
    } catch (err) {
      assistant.pending = false;
      // A user-initiated stop() aborts the underlying fetch and throws AbortError —
      // that is NOT an error condition for the assistant turn: keep the streamed
      // content as-is and do not surface a message to the user.
      if ((err as Error).name === 'AbortError') {
        return;
      }
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
    trimMessageHistory();
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
    // Abort an in-flight stream so it does not keep writing to an orphaned
    // assistant message after the consumer has already cleared the UI.
    stop();
    messages.value = [];
    budget.value = null;
    contextWindow.value = null;
    error.value = null;
    lastPrompt = '';
  }

  // Abort an in-flight stream when the consuming component unmounts so the
  // underlying fetch / SSE reader stops writing into a now-detached message.
  if (getCurrentScope()) {
    onScopeDispose(() => stop());
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
