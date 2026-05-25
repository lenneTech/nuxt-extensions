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

/** Resolve the AI base path from runtime config (default `/ai`). */
export function getLtAiBasePath(): string {
  try {
    const rc = useRuntimeConfig();
    return (rc.public as Record<string, any>)?.ltExtensions?.ai?.basePath || '/ai';
  } catch {
    return '/ai';
  }
}

/** Build a full URL for an AI endpoint path (e.g. `/prompt`, `/connections/available`). */
export function buildLtAiUrl(path: string): string {
  return buildLtApiUrl(`${getLtAiBasePath()}${path}`);
}

/** Turn a non-ok AI response into an Error using the backend's (translated) message. */
export async function ltAiResponseError(response: Response): Promise<Error> {
  let message = `HTTP ${response.status}`;
  try {
    const body: any = await response.json();
    const detail = body?.message ?? body?.error;
    if (detail) {
      message = Array.isArray(detail) ? detail.join(', ') : String(detail);
    }
  } catch {
    // keep the status-based message
  }
  const error = new Error(message);
  (error as any).status = response.status;
  return error;
}

/**
 * Authenticated JSON request against an AI endpoint. Throws {@link ltAiResponseError}
 * on a non-2xx response, otherwise returns the parsed body (or `undefined` for 204).
 */
export async function ltAiRequest<T>(method: string, path: string, body?: unknown, options?: { signal?: AbortSignal }): Promise<T> {
  const init: RequestInit = { method, signal: options?.signal };
  if (body !== undefined) {
    init.headers = { 'Content-Type': 'application/json' };
    init.body = JSON.stringify(body);
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
 */
export async function parseLtAiSseStream(response: Response, onEvent: (event: LtAiStreamEvent) => void): Promise<void> {
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
    for (;;) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
      for (const line of lines) {
        handleLine(line);
      }
    }
    if (buffer) {
      handleLine(buffer);
    }
  } finally {
    reader.releaseLock?.();
  }
}
