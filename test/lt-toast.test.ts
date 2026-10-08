import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createApp, nextTick } from 'vue';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { resetStubReactiveStores, resetStubRuntimeConfig, useState } from './stubs/imports';

/**
 * `showErrorToast` and `useLtShare().share()` never showed a toast.
 *
 * Both looked Nuxt UI's `useToast` up on `nuxtApp` / `globalThis`
 * (`(nuxtApp as any).useToast || (globalThis as any).useToast`). Nuxt UI registers it
 * as an AUTO-IMPORT and attaches it to neither, so the lookup was always `undefined`,
 * the toast branch was dead code, and every error routed through `showErrorToast`
 * reached the user as a `console.error` line and nothing else.
 *
 * These tests run against the REAL `@nuxt/ui/composables/useToast` (a devDependency),
 * not an invented fake: the assertion is that the toast lands in the very
 * `useState('toasts')` array `<UApp>` / `<UToaster>` renders. A fake `useToast` would
 * have passed against the broken lookup's intent and proven nothing.
 */

// `nuxtApp.runWithContext` backed by a real Vue app, as in production. Nuxt UI's
// `useToast()` calls `inject()`, which only resolves inside an app or component context.
const vueApp = createApp({});
const nuxtApp: Record<string, unknown> = {
  runWithContext: <T>(fn: () => T): T => vueApp.runWithContext(fn),
};

vi.mock('#imports', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./stubs/imports')>()),
  useNuxtApp: () => nuxtApp,
  useRoute: () => ({ fullPath: '/current' }),
}));

interface RenderedToast {
  color?: string;
  description?: string;
  title?: string;
}

/** What `<UToaster>` would render: Nuxt UI's shared toast state. */
async function renderedToasts(): Promise<RenderedToast[]> {
  // Nuxt UI queues `add()` and flushes it on the next tick.
  await nextTick();
  await nextTick();
  return useState<RenderedToast[]>('toasts').value ?? [];
}

beforeEach(() => {
  resetStubRuntimeConfig();
  resetStubReactiveStores();
  delete nuxtApp.$i18n;
});

afterEach(() => {
  vi.doUnmock('@nuxt/ui/composables/useToast');
  vi.resetModules();
  vi.restoreAllMocks();
});

describe('ltAddToast()', () => {
  it('hands the toast to Nuxt UI and reports that it did', async () => {
    const { ltAddToast } = await import('../src/runtime/lib/toast');

    const shown = vueApp.runWithContext(() => ltAddToast({ color: 'success', description: 'Saved', title: 'Done' }));

    expect(shown).toBe(true);
    expect(await renderedToasts()).toEqual([expect.objectContaining({ color: 'success', description: 'Saved', title: 'Done' })]);
  });

  it('reports false when the specifier resolves to the no-op stub (Nuxt UI not installed)', async () => {
    vi.doMock('@nuxt/ui/composables/useToast', () => import('../src/runtime/lib/ui-toast-stub'));
    const { ltAddToast } = await import('../src/runtime/lib/toast');

    expect(ltAddToast({ color: 'error', title: 'x' })).toBe(false);
  });

  it('reports false instead of throwing when the toaster itself throws', async () => {
    vi.doMock('@nuxt/ui/composables/useToast', () => ({
      useToast: () => {
        throw new Error('[nuxt] instance unavailable');
      },
    }));
    const { ltAddToast } = await import('../src/runtime/lib/toast');

    expect(() => ltAddToast({ color: 'error', title: 'x' })).not.toThrow();
    expect(ltAddToast({ color: 'error', title: 'x' })).toBe(false);
  });
});

describe('useLtErrorTranslation().showErrorToast()', () => {
  it('shows a visible error toast and does not fall back to the console', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { useLtErrorTranslation } = await import('../src/runtime/composables/use-lt-error-translation');

    useLtErrorTranslation().showErrorToast('Something broke', 'Speichern fehlgeschlagen');

    expect(await renderedToasts()).toEqual([
      expect.objectContaining({ color: 'error', description: 'Something broke', title: 'Speichern fehlgeschlagen' }),
    ]);
    expect(consoleError).not.toHaveBeenCalledWith('[LtErrorTranslation]', expect.anything());
  });

  it('defaults the title to the German "Fehler" without i18n', async () => {
    const { useLtErrorTranslation } = await import('../src/runtime/composables/use-lt-error-translation');

    useLtErrorTranslation().showErrorToast('Something broke');

    expect(await renderedToasts()).toEqual([expect.objectContaining({ title: 'Fehler' })]);
  });

  it('still logs the message when no toaster exists, so the error is never swallowed', async () => {
    vi.doMock('@nuxt/ui/composables/useToast', () => import('../src/runtime/lib/ui-toast-stub'));
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { useLtErrorTranslation } = await import('../src/runtime/composables/use-lt-error-translation');

    useLtErrorTranslation().showErrorToast('Something broke');

    expect(consoleError).toHaveBeenCalledWith('[LtErrorTranslation]', 'Something broke');
  });
});

describe('useLtShare().share() clipboard fallback', () => {
  afterEach(() => {
    // Drop the own-property shadow `withoutWebShare()` installs.
    Reflect.deleteProperty(window.navigator, 'share');
  });

  // The fallback is the branch for browsers without the Web Share API.
  function withoutWebShare(): ReturnType<typeof vi.fn> {
    Object.defineProperty(window.navigator, 'share', { configurable: true, value: undefined });
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.spyOn(navigator, 'clipboard', 'get').mockReturnValue({ writeText } as unknown as Clipboard);
    return writeText;
  }

  it('confirms the copied link with a success toast', async () => {
    const writeText = withoutWebShare();
    const { useLtShare } = await import('../src/runtime/composables/use-lt-share');

    await useLtShare().share('Title', 'Text', 'https://example.test/page');

    expect(writeText).toHaveBeenCalledWith('https://example.test/page');
    expect(await renderedToasts()).toEqual([expect.objectContaining({ color: 'success', title: 'Link kopiert' })]);
  });

  it('logs instead when no toaster exists', async () => {
    vi.doMock('@nuxt/ui/composables/useToast', () => import('../src/runtime/lib/ui-toast-stub'));
    withoutWebShare();
    const consoleDebug = vi.spyOn(console, 'debug').mockImplementation(() => {});
    const { useLtShare } = await import('../src/runtime/composables/use-lt-share');

    await useLtShare().share('Title', 'Text', 'https://example.test/page');

    expect(consoleDebug).toHaveBeenCalledWith('Link copied to clipboard');
  });
});

// ---------------------------------------------------------------------------
// Stub-vs-real contract — same reasoning as the passkey stub in
// `optional-peers.test.ts`: `module.ts` installs the alias for the WHOLE consumer
// app, so every name the real module exports must exist on the stub too.
// ---------------------------------------------------------------------------
describe('ui-toast stub mirrors the real @nuxt/ui/composables/useToast', () => {
  it('exports every name the real module exports, with the same kinds', async () => {
    const real = (await import('@nuxt/ui/composables/useToast')) as Record<string, unknown>;
    const stub = (await import('../src/runtime/lib/ui-toast-stub')) as Record<string, unknown>;

    const realNames = Object.keys(real).sort();
    expect(realNames).toContain('useToast');

    for (const name of realNames) {
      expect(Object.keys(stub), `stub is missing "${name}", which the aliased specifier promises`).toContain(name);
      expect(typeof stub[name], `stub export "${name}" should be a ${typeof real[name]}`).toBe(typeof real[name]);
    }
  });

  it('returns no toaster, so ltAddToast can report that nothing was shown', async () => {
    const { useToast } = await import('../src/runtime/lib/ui-toast-stub');

    expect(useToast()).toBeUndefined();
  });
});

describe('module.ts wiring', () => {
  const moduleSource = readFileSync(resolve(process.cwd(), 'src/module.ts'), 'utf8');

  it('resolves @nuxt/ui from the consumer root too, not only from this package', () => {
    // Resolving only against `import.meta.url` finds nothing under a strict pnpm install,
    // where @nuxt/ui sits in the consumer's tree. The module would then alias the stub
    // although Nuxt UI is installed, and every toast would silently go to the console —
    // the defect this fix exists for, back by another route.
    expect(moduleSource).toMatch(
      /tryResolveModule\(\s*'@nuxt\/ui\/composables\/useToast',\s*\[new URL\(import\.meta\.url\),\s*pathToFileURL\(`\$\{nuxt\.options\.rootDir\}\/`\)\]/,
    );
  });

  it('aliases the specifier onto the stub for both the app and the Nitro bundle', () => {
    // `@nuxt/ui` is not a declared peer, so `optional-peers.test.ts` does not cover this
    // static import. Without the alias, every consumer without Nuxt UI fails to build.
    expect(moduleSource).toMatch(/nuxt\.options\.alias\['@nuxt\/ui\/composables\/useToast'\] = uiToastStub/);
    expect(moduleSource).toMatch(/nuxt\.options\.nitro\.alias = \{[^}]*'@nuxt\/ui\/composables\/useToast': uiToastStub/);
  });
});
