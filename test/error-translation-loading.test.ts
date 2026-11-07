import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { computed, resetStubReactiveStores, resetStubRuntimeConfig, setStubRuntimeConfig, useNuxtApp, useState } from './stubs/imports';
import { resetTestRenderScope, setTestRenderScope } from './stubs/render-scope';
import plugin from '../src/runtime/plugins/error-translation.client';

/**
 * How the error translations load (DEV-4078).
 *
 * The plugin used to be an async plugin that awaited the request, so every client start waited
 * for `/i18n/errors/<locale>`, and an API that answered slowly held back the whole app. It now
 * starts the load after the mount and does not wait for it. Until the answer is there,
 * `translateError` returns the developer message.
 *
 * After the mount, not merely without `await`: the server loads no translations, so its HTML
 * carries the developer message. Translations that arrived before hydration made the client
 * render another text than the server (a hydration mismatch), and the awaited plugin did
 * exactly that for every server-rendered message.
 */

const MESSAGE = '#LTNS_0100: Unauthorized - User is not logged in';
const DEVELOPER = 'Unauthorized - User is not logged in';
const GERMAN = 'Sie sind nicht angemeldet.';

type Hooks = Record<string, (() => unknown)[]>;

/** A `nuxtApp` for the plugin that records hooks and provides, so a test fires the mount itself. */
function pluginApp() {
  const hooks: Hooks = {};
  const provided: Record<string, unknown> = {};
  return {
    fire: (name: string) => (hooks[name] ?? []).forEach((fn) => fn()),
    hooks,
    nuxtApp: {
      hook: (name: string, fn: () => unknown) => {
        (hooks[name] ??= []).push(fn);
      },
      provide: (name: string, value: unknown) => {
        provided[name] = value;
      },
      runWithContext: <T>(fn: () => T): T => fn(),
    },
    provided,
  };
}

function runPlugin(app: ReturnType<typeof pluginApp>): unknown {
  return (plugin as unknown as (nuxtApp: unknown) => unknown)(app.nuxtApp);
}

/** A `$fetch` whose answers the test hands out one by one. */
function deferredFetch() {
  const pending: { reject: (error: unknown) => void; resolve: (body: unknown) => void; url: string }[] = [];
  const spy = vi.fn(
    (url: string) =>
      new Promise((resolve, reject) => {
        pending.push({ reject, resolve, url });
      }),
  );
  globalThis.$fetch = spy as unknown as typeof globalThis.$fetch;
  return { pending, spy };
}

async function loadComposable() {
  const { useLtErrorTranslation } = await import('../src/runtime/composables/use-lt-error-translation');
  return useLtErrorTranslation();
}

/** Let the promise callbacks of a settled request run. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

beforeEach(() => {
  resetStubRuntimeConfig();
  resetStubReactiveStores();
  resetTestRenderScope();
  setStubRuntimeConfig({ public: { apiUrl: 'https://api.example.com' } });
  // The locale the composable detects; without it, happy-dom's navigator language decides.
  useNuxtApp().$i18n = { locale: { value: 'de' }, t: (key: string) => key };
});

afterEach(() => {
  resetTestRenderScope();
  vi.restoreAllMocks();
});

describe('error translation plugin — the start', () => {
  it('does not hold back the start: nothing is fetched before the mount, and setup returns at once', () => {
    const { spy } = deferredFetch();
    const app = pluginApp();

    const result = runPlugin(app);

    expect(result).not.toBeInstanceOf(Promise);
    expect(spy).not.toHaveBeenCalled();
    expect(app.provided.ltTranslateError).toBeTypeOf('function');
    expect(app.provided.ltShowErrorToast).toBeTypeOf('function');
  });

  it('loads the current locale once the app is mounted', () => {
    const { spy } = deferredFetch();
    const app = pluginApp();
    runPlugin(app);

    app.fire('app:mounted');

    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0]?.[0]).toContain('/i18n/errors/de');
  });

  it('fetches nothing when the state already carries the locale (for example from an SSR payload)', () => {
    const { spy } = deferredFetch();
    useState<Record<string, Record<string, string>>>('lt-error-translations').value = { de: { LTNS_0100: GERMAN } };
    const app = pluginApp();
    runPlugin(app);

    app.fire('app:mounted');

    expect(spy).not.toHaveBeenCalled();
  });

  it('registers nothing when disabled', () => {
    const { spy } = deferredFetch();
    setStubRuntimeConfig({ public: { apiUrl: 'https://api.example.com', ltExtensions: { errorTranslation: { enabled: false } } } });
    const app = pluginApp();

    runPlugin(app);

    expect(app.hooks['app:mounted']).toBeUndefined();
    expect(app.provided).toEqual({});
    expect(spy).not.toHaveBeenCalled();
  });
});

describe('error translation — the fallback until the translations are there', () => {
  it('returns the developer message while the load is in flight, and the translation once it arrived', async () => {
    const { pending } = deferredFetch();
    const app = pluginApp();
    runPlugin(app);
    const { isLoaded, translateError } = await loadComposable();
    const shown = computed(() => translateError(MESSAGE));

    app.fire('app:mounted');

    expect(shown.value).toBe(DEVELOPER);
    expect(isLoaded.value).toBe(false);

    pending[0]?.resolve({ errors: { LTNS_0100: GERMAN }, locale: 'de' });
    await settle();

    // Reactive: a template rendering `translateError(...)` switches without a reload.
    expect(shown.value).toBe(GERMAN);
    expect(isLoaded.value).toBe(true);
  });

  it('keeps the developer message when the load fails, resolves instead of rejecting, and the next call tries again', async () => {
    const { pending, spy } = deferredFetch();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { loadTranslations, translateError } = await loadComposable();

    const first = loadTranslations('de');
    pending[0]?.reject(new Error('API down'));
    await expect(first).resolves.toBeUndefined();

    expect(warn).toHaveBeenCalledTimes(1);
    expect(translateError(MESSAGE)).toBe(DEVELOPER);

    const second = loadTranslations('de');
    expect(spy).toHaveBeenCalledTimes(2);
    pending[1]?.resolve({ errors: { LTNS_0100: GERMAN }, locale: 'de' });
    await second;

    expect(translateError(MESSAGE)).toBe(GERMAN);
  });
});

describe('error translation — one request per locale for every caller', () => {
  it('shares the request in flight, and a second caller waits for it instead of returning early', async () => {
    const { pending, spy } = deferredFetch();
    const plugin = await loadComposable();
    const component = await loadComposable();

    const fromPlugin = plugin.loadTranslations('de');
    let componentDone = false;
    const fromComponent = component.loadTranslations('de').then(() => {
      componentDone = true;
    });
    await settle();

    expect(spy).toHaveBeenCalledTimes(1);
    expect(componentDone).toBe(false);
    expect(plugin.isLoading.value).toBe(true);
    expect(component.isLoading.value).toBe(true);

    pending[0]?.resolve({ errors: { LTNS_0100: GERMAN }, locale: 'de' });
    await Promise.all([fromPlugin, fromComponent]);

    expect(componentDone).toBe(true);
    expect(component.translateError(MESSAGE)).toBe(GERMAN);
    expect(plugin.isLoading.value).toBe(false);
    expect(component.isLoading.value).toBe(false);
  });

  it('does not swallow a load for another locale while one is in flight', async () => {
    const { pending, spy } = deferredFetch();
    const { isLoading, loadTranslations } = await loadComposable();

    const german = loadTranslations('de');
    const english = loadTranslations('en');

    expect(spy).toHaveBeenCalledTimes(2);
    expect(spy.mock.calls.map((call) => call[0])).toEqual([expect.stringContaining('/i18n/errors/de'), expect.stringContaining('/i18n/errors/en')]);

    pending[0]?.resolve({ errors: { LTNS_0100: GERMAN }, locale: 'de' });
    await german;
    // The English load is still on the way.
    expect(isLoading.value).toBe(true);

    pending[1]?.resolve({ errors: { LTNS_0100: 'You are not signed in.' }, locale: 'en' });
    await english;
    expect(isLoading.value).toBe(false);
    expect(useState<Record<string, Record<string, string>>>('lt-error-translations').value).toEqual({
      de: { LTNS_0100: GERMAN },
      en: { LTNS_0100: 'You are not signed in.' },
    });
  });
});

describe('error translation — during SSR', () => {
  it('loads on the server when a project awaits it there, so its state reaches the client in the payload', async () => {
    setTestRenderScope('server');
    setStubRuntimeConfig({ apiUrl: 'http://api.internal:3000', public: { apiUrl: 'https://api.example.com' } });
    const { pending, spy } = deferredFetch();
    const { loadTranslations, translateError } = await loadComposable();

    const load = loadTranslations();
    pending[0]?.resolve({ errors: { LTNS_0100: GERMAN }, locale: 'de' });
    await load;

    expect(spy.mock.calls[0]?.[0]).toBe('http://api.internal:3000/i18n/errors/de');
    expect(translateError(MESSAGE)).toBe(GERMAN);
  });
});
