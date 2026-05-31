/**
 * AI module client helpers: URL building, authenticated JSON requests, and a
 * robust SSE stream parser for `POST /ai/stream`.
 *
 * All requests go through {@link ltAuthFetch} (Cookie/JWT dual-mode, 401 fallback)
 * and {@link buildLtApiUrl} (SSR/proxy/direct URL resolution), so the AI client
 * behaves exactly like the rest of the library.
 */

import { useRuntimeConfig } from '#imports';

import type { LtAiStreamEvent } from '../types/ai';
import { buildLtApiUrl, ltAuthFetch } from './auth-state';

/** Hard cap on an SSE line buffer (1 MiB). Bails out on a malformed stream that never emits `\n`. */
const LT_AI_SSE_LINE_LIMIT = 1024 * 1024;

/** Hard cap on the user-facing error message extracted from a backend response (~1 KiB). */
const LT_AI_ERROR_MESSAGE_LIMIT = 1024;

/** Resolve the AI base path from runtime config (default `/ai`). */
export function getLtAiBasePath(): string {
  try {
    const rc = useRuntimeConfig();
    const ext = (rc.public as { ltExtensions?: { ai?: { basePath?: string } } }).ltExtensions;
    return ext?.ai?.basePath || '/ai';
  } catch {
    return '/ai';
  }
}

/** Build a full URL for an AI endpoint path (e.g. `/prompt`, `/connections/available`). */
export function buildLtAiUrl(path: string): string {
  return buildLtApiUrl(`${getLtAiBasePath()}${path}`);
}

/**
 * Turn a non-ok AI response into an Error using the backend's (translated) message.
 *
 * The resulting Error carries a numeric `status` field (the HTTP status code) so
 * consumers can branch on response codes without re-parsing the message. The
 * message is capped at ~1 KiB to bound downstream UI rendering / logging.
 *
 * Consumers should pipe the message through `useLtErrorTranslation()` for the
 * user-facing localisation step — this helper preserves the raw backend string.
 */
export async function ltAiResponseError(response: Response): Promise<Error & { status: number }> {
  let message = `HTTP ${response.status}`;
  try {
    const body = (await response.json()) as { error?: unknown; message?: unknown };
    const detail = body?.message ?? body?.error;
    if (detail) {
      const raw = Array.isArray(detail) ? detail.join(', ') : String(detail);
      message = raw.length > LT_AI_ERROR_MESSAGE_LIMIT ? `${raw.slice(0, LT_AI_ERROR_MESSAGE_LIMIT)}…` : raw;
    }
  } catch {
    // keep the status-based message
  }
  const error = new Error(message) as Error & { status: number };
  error.status = response.status;
  return error;
}

/**
 * Authenticated JSON request against an AI endpoint. Throws {@link ltAiResponseError}
 * on a non-2xx response, otherwise returns the parsed body (or `undefined` for 204).
 */
export async function ltAiRequest<T>(method: string, path: string, body?: unknown, options?: { signal?: AbortSignal }): Promise<T> {
  const init: RequestInit = { method, signal: options?.signal };
  if (body !== undefined) {
    init.headers = { Accept: 'application/json', 'Content-Type': 'application/json' };
    init.body = JSON.stringify(body);
  } else {
    init.headers = { Accept: 'application/json' };
  }
  const response = await ltAuthFetch(buildLtAiUrl(path), init);
  if (!response.ok) {
    throw await ltAiResponseError(response);
  }
  if (response.status === 204) {
    return undefined as T;
  }
  return (await response.json()) as T;
}

/**
 * Parse a `text/event-stream` AI response, invoking `onEvent` for each parsed
 * {@link LtAiStreamEvent}. Buffers partial lines across chunks and tolerates
 * malformed/keep-alive lines.
 *
 * `options.signal` lets the caller stop parsing without cancelling the
 * underlying fetch — useful for component-unmount races. When the signal fires
 * the reader is cancelled and the function resolves cleanly.
 *
 * Throws when a single line exceeds `LT_AI_SSE_LINE_LIMIT` (1 MiB) — guards
 * against a misbehaving proxy/backend that never delivers a newline.
 */
export async function parseLtAiSseStream(response: Response, onEvent: (event: LtAiStreamEvent) => void, options?: { signal?: AbortSignal }): Promise<void> {
  const body = response.body;
  if (!body) {
    throw new Error('AI stream response has no body');
  }
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  const handleLine = (line: string): void => {
    const trimmed = line.trim();
    if (!trimmed.startsWith('data:')) {
      return;
    }
    const payload = trimmed.slice(5).trim();
    if (!payload || payload === '[DONE]') {
      return;
    }
    try {
      onEvent(JSON.parse(payload) as LtAiStreamEvent);
    } catch {
      // ignore a malformed event line
    }
  };

  try {
    while (!options?.signal?.aborted) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      buffer += decoder.decode(value, { stream: true });
      if (buffer.length > LT_AI_SSE_LINE_LIMIT) {
        throw new Error('AI stream line exceeds maximum allowed size');
      }
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
      for (const line of lines) {
        handleLine(line);
      }
    }
    if (options?.signal?.aborted) {
      reader.cancel().catch(() => {});
    } else if (buffer) {
      handleLine(buffer);
    }
  } finally {
    reader.releaseLock?.();
  }
}
