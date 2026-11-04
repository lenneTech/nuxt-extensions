/**
 * Whether the API's AI module is on, and whether it serves MCP. Backed by the
 * public `GET /ai/status` of nest-server: 200 `{ mcp }` while the module is on,
 * 404 while it is off (the route does not exist then).
 *
 * The state is shared app-wide (`useState`) and travels from SSR to the client,
 * so layout, route middleware and pages together cause one request per app
 * start. It is sent without credentials: the endpoint is public, and the
 * auth-aware fetch would start its 401 handling for nothing.
 *
 * Fails closed: anything but a well-formed 200 leaves `enabled` false. A 404 is
 * an answer ("AI is off") and sets no `error`; a network error, a timeout, any
 * other status or a malformed body sets `error`.
 */

import { computed, useNuxtApp, useState } from '#imports';

import type { LtAiStatus, UseLtAiStatusReturn } from '../types/ai';
import { buildLtAiUrl } from '../lib/ai';

const LT_AI_STATUS_KEY = 'lt-ai-status';

/** Upper bound for the request, so a hanging API cannot stall every server render of the layout. */
const LT_AI_STATUS_TIMEOUT_MS = 5000;

// The request in flight, per Nuxt app (on the server: per request), never module-wide.
const inflight = new WeakMap<object, Promise<void>>();

async function fetchLtAiStatus(): Promise<LtAiStatus> {
  const failed = (error: string): LtAiStatus => ({ enabled: false, error, loaded: true, mcp: false });
  let response: Response;
  try {
    response = await fetch(buildLtAiUrl('/status'), {
      credentials: 'omit',
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(LT_AI_STATUS_TIMEOUT_MS),
    });
  } catch (err) {
    // Never the thrown message: on the server this state is serialized into every visitor's HTML, and
    // Node's fetch puts the whole request URL (the private NUXT_API_URL, credentials included) into
    // its URL-parse and URL-with-credentials errors.
    return failed((err as Error)?.name === 'TimeoutError' ? 'AI status request timed out' : 'AI status request failed');
  }
  if (response.status === 404) {
    return { enabled: false, error: null, loaded: true, mcp: false };
  }
  if (!response.ok) {
    return failed(`HTTP ${response.status}`);
  }
  try {
    const body = (await response.json()) as { mcp?: unknown } | null;
    if (typeof body?.mcp === 'boolean') {
      return { enabled: true, error: null, loaded: true, mcp: body.mcp };
    }
  } catch {
    // not JSON, e.g. an HTML page from a misrouted proxy
  }
  return failed('Unexpected AI status response');
}

export function useLtAiStatus(): UseLtAiStatusReturn {
  const state = useState<LtAiStatus>(LT_AI_STATUS_KEY, () => ({ enabled: false, error: null, loaded: false, mcp: false }));
  const nuxtApp = useNuxtApp();

  function load(options?: { force?: boolean }): Promise<void> {
    if (state.value.loaded && !options?.force) {
      return Promise.resolve();
    }
    const running = inflight.get(nuxtApp);
    if (running) {
      return running;
    }
    const request = fetchLtAiStatus()
      .then((status) => {
        state.value = status;
      })
      .finally(() => inflight.delete(nuxtApp));
    inflight.set(nuxtApp, request);
    return request;
  }

  return {
    enabled: computed(() => state.value.enabled),
    error: computed(() => state.value.error),
    load,
    loaded: computed(() => state.value.loaded),
    mcp: computed(() => state.value.mcp),
  };
}
