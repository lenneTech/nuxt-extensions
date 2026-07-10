/**
 * Test-only stub of Nuxt's virtual `#imports` module.
 *
 * The stub exposes the small surface used by `auth-state.ts` and the
 * `useLtAuth()` composable so unit tests can import runtime sources directly
 * without spinning up a Nuxt context. The runtimeConfig store is mutable, so
 * each test can configure it via `setStubRuntimeConfig()` and reset it via
 * `resetStubRuntimeConfig()` (called in `beforeEach`).
 *
 * Reactive primitives (`ref`, `computed`, `watch`) are re-exported from `vue`
 * — that's what the real `#imports` resolves to in production. The
 * Nuxt-specific helpers (`useCookie`, `useState`, `useNuxtApp`) are lightweight
 * stubs sufficient for unit testing.
 */

import { computed, getCurrentScope, onScopeDispose, reactive, readonly, ref, shallowReadonly, unref, watch, type Ref } from 'vue';

interface StubRuntimeConfig {
  app?: Record<string, unknown>;
  public: Record<string, any>;
  [key: string]: any;
}

let runtimeConfig: StubRuntimeConfig = { public: {} };

// When set, `useRuntimeConfig()` throws — lets tests exercise the documented
// "swallow errors" contracts (buildLtApiUrl catch, the lt-config-check plugin
// catch, getLtAuthCookieNames catch) that are otherwise unreachable because the
// stub never fails. Reset alongside the config.
let runtimeConfigError: Error | null = null;

// Per-test isolated stores. Reset via the helpers below.
const cookieRefs = new Map<string, Ref<unknown>>();
const stateRefs = new Map<string, Ref<unknown>>();

export function setStubRuntimeConfig(next: StubRuntimeConfig): void {
  runtimeConfig = next;
}

export function resetStubRuntimeConfig(): void {
  runtimeConfig = { public: {} };
  runtimeConfigError = null;
}

/** Make the next `useRuntimeConfig()` calls throw, simulating a missing Nuxt context. */
export function setStubRuntimeConfigThrows(error: Error = new Error('no runtime config')): void {
  runtimeConfigError = error;
}

/** Reset the in-memory cookie / state ref stores between tests. */
export function resetStubReactiveStores(): void {
  cookieRefs.clear();
  stateRefs.clear();
}

export function useRuntimeConfig(): StubRuntimeConfig {
  if (runtimeConfigError) {
    throw runtimeConfigError;
  }
  return runtimeConfig;
}

/**
 * Minimal `defineNuxtPlugin` stub — a pass-through that returns the setup
 * function unchanged, so a test can import a plugin's default export and invoke
 * it directly (the real Nuxt wrapper adds lifecycle metadata the unit test does
 * not need). Mirrors how `#imports` resolves `defineNuxtPlugin` in production.
 */
export function defineNuxtPlugin<T extends (...args: any[]) => any>(setup: T): T {
  return setup;
}

// Mutable store for the SSR request-headers stub so tests can simulate the
// server-side raw `Cookie` header read (use-lt-auth.ts `resolvedAuthState`).
let requestHeaders: Record<string, string> = {};

export function setStubRequestHeaders(next: Record<string, string>): void {
  requestHeaders = next;
}

export function resetStubRequestHeaders(): void {
  requestHeaders = {};
}

/**
 * Minimal `useRequestHeaders` stub. Production code calls this (server-only) to
 * read the raw `Cookie` header for duplicate-tolerant SSR auth resolution.
 * Returns only the requested keys, mirroring Nuxt's signature.
 */
export function useRequestHeaders(keys?: string[]): Record<string, string> {
  if (!keys) {
    return { ...requestHeaders };
  }
  const picked: Record<string, string> = {};
  for (const key of keys) {
    if (requestHeaders[key] !== undefined) {
      picked[key] = requestHeaders[key];
    }
  }
  return picked;
}

/**
 * Minimal `useCookie` stub. Returns a cached reactive ref keyed by name so
 * repeated calls within the same composable hand back the same handle. The
 * stub does not write through to `document.cookie` — production code does
 * that explicitly via `document.cookie = ...` for SSR-immediate sync, which
 * already runs in happy-dom and is what the tests assert against.
 */
export function useCookie<T = unknown>(name: string, _options?: Record<string, unknown>): Ref<T | null> {
  let cookie = cookieRefs.get(name);
  if (!cookie) {
    cookie = ref<T | null>(null) as Ref<unknown>;
    cookieRefs.set(name, cookie);
  }
  return cookie as Ref<T | null>;
}

/**
 * Minimal `useState` stub — caches a ref by key with the supplied initialiser.
 */
export function useState<T = unknown>(key: string, init?: () => T): Ref<T> {
  let state = stateRefs.get(key);
  if (!state) {
    state = ref(init ? init() : (undefined as unknown as T)) as Ref<unknown>;
    stateRefs.set(key, state);
  }
  return state as Ref<T>;
}

/**
 * Minimal `useNuxtApp` stub — returns an empty object so optional `$i18n`
 * lookups fall through to the German fallback path in `useTranslation()`.
 */
export function useNuxtApp(): Record<string, unknown> {
  return {};
}

export { computed, getCurrentScope, onScopeDispose, reactive, readonly, ref, shallowReadonly, unref, watch };
