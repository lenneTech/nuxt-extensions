import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { resetStubRuntimeConfig, setStubRuntimeConfig } from './stubs/imports';
import plugin from '../src/runtime/plugins/form-label-association.client';

/**
 * The plugin's `setup()` — its option handling and timer lifecycle.
 *
 * Every other test in this suite targets the exported `repairDanglingLabels` and friends, so
 * until 1.14.0 the whole of `setup()` was unobserved: the opt-out, the repair window, the
 * interval and its teardown, the re-entrancy guard, the observer. That is the half of the file
 * that can leak — a `setInterval` outliving its window is not something a DOM fixture can catch.
 */

type Hooks = Record<string, (() => void)[]>;

/** A `nuxtApp` stub that records hook registrations so a test can fire them deliberately. */
function nuxtAppStub(): { fire: (name: string) => void; hooks: Hooks; nuxtApp: { hook: (name: string, fn: () => void) => void } } {
  const hooks: Hooks = {};

  return {
    fire: (name) => (hooks[name] ?? []).forEach((fn) => fn()),
    hooks,
    nuxtApp: {
      hook: (name, fn) => {
        (hooks[name] ??= []).push(fn);
      },
    },
  };
}

/**
 * Run the plugin's `setup()`.
 *
 * `defineNuxtPlugin`'s object form types `setup` as optional, so narrowing it once here beats
 * scattering non-null assertions — and a plugin that lost its setup should fail loudly rather
 * than have every test quietly assert nothing.
 */
function setupPlugin(nuxtApp: { hook: (name: string, fn: () => void) => void }): void {
  if (typeof plugin.setup !== 'function') {
    throw new TypeError('form-label-association plugin exposes no setup()');
  }
  plugin.setup(nuxtApp as never);
}

function configure(formLabelAssociation: Record<string, unknown>): void {
  setStubRuntimeConfig({ public: { ltExtensions: { formLabelAssociation } } });
}

/** A field whose label points at nothing, so any sweep that runs has something to repair. */
function brokenField(): void {
  document.body.innerHTML = `
    <div data-slot="root">
      <label for="stale" data-slot="label">Team name</label>
      <input id="fresh" type="text">
    </div>
  `;
}

const currentFor = (): null | string => document.querySelector('label')!.getAttribute('for');

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal('requestAnimationFrame', (fn: () => void) => setTimeout(fn, 0) as unknown as number);
  resetStubRuntimeConfig();
  brokenField();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('form-label-association plugin — opting out', () => {
  it('registers no hooks at all when disabled', () => {
    configure({ enabled: false });
    const { hooks, nuxtApp } = nuxtAppStub();

    setupPlugin(nuxtApp);

    // Not merely "does nothing" — nothing is even wired up, so a consumer who opts out pays
    // no observer, no interval and no hook.
    expect(Object.keys(hooks)).toHaveLength(0);
  });

  it('repairs on mount when enabled', () => {
    configure({ enabled: true });
    const { fire, nuxtApp } = nuxtAppStub();

    setupPlugin(nuxtApp);
    fire('app:mounted');

    expect(currentFor()).toBe('fresh');
  });
});

describe('form-label-association plugin — the repair window', () => {
  it('sweeps once and starts no interval when maxRepairMs is 0', () => {
    configure({ enabled: true, maxRepairMs: 0 });
    const { fire, nuxtApp } = nuxtAppStub();
    const interval = vi.spyOn(globalThis, 'setInterval');

    setupPlugin(nuxtApp);
    fire('app:mounted');

    expect(currentFor()).toBe('fresh');
    expect(interval).not.toHaveBeenCalled();
  });

  it('clears the interval once the window elapses', () => {
    configure({ enabled: true, maxRepairMs: 1000 });
    const { fire, nuxtApp } = nuxtAppStub();

    const clear = vi.spyOn(globalThis, 'clearInterval');
    setupPlugin(nuxtApp);
    fire('app:mounted');

    vi.advanceTimersByTime(1100);

    // The leak this test exists for: an interval that outlives its window would keep sweeping
    // the whole document for the lifetime of the page.
    expect(clear).toHaveBeenCalled();
  });

  it('does not stack a second window when page:finish lands inside the first', () => {
    configure({ enabled: true, maxRepairMs: 1000 });
    const { fire, nuxtApp } = nuxtAppStub();

    const interval = vi.spyOn(globalThis, 'setInterval');
    setupPlugin(nuxtApp);
    fire('app:mounted');

    for (let i = 0; i < 10; i++) {
      fire('page:finish');
    }
    vi.advanceTimersByTime(1);

    // Ten navigations inside an open window must not leave ten intervals sweeping the document.
    expect(interval).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['a non-finite value', Number.NaN],
    ['a negative value', -1],
  ])('treats %s as "sweep once", never as an immediate-firing timeout', (_label, maxRepairMs) => {
    // A delay past 2^31 overflows setTimeout and fires IMMEDIATELY, so an out-of-range value
    // silently becomes NO window — the opposite of what the author asked for. Clamping makes
    // the degenerate case explicit instead.
    configure({ enabled: true, maxRepairMs });
    const { fire, nuxtApp } = nuxtAppStub();
    const interval = vi.spyOn(globalThis, 'setInterval');

    setupPlugin(nuxtApp);
    fire('app:mounted');

    expect(currentFor()).toBe('fresh');
    expect(interval).not.toHaveBeenCalled();
  });

  it('clamps an over-large window rather than letting setTimeout overflow', () => {
    configure({ enabled: true, maxRepairMs: 2 ** 40 });
    const { fire, nuxtApp } = nuxtAppStub();

    const clear = vi.spyOn(globalThis, 'clearInterval');
    setupPlugin(nuxtApp);
    fire('app:mounted');
    vi.advanceTimersByTime(30_001);

    expect(clear).toHaveBeenCalled();
  });
});

describe('form-label-association plugin — watching deferred hydration', () => {
  it('observes by default and repairs a subtree added after the window closed', () => {
    configure({ enabled: true, maxRepairMs: 100 });
    const { fire, nuxtApp } = nuxtAppStub();
    const observe = vi.spyOn(MutationObserver.prototype, 'observe');

    setupPlugin(nuxtApp);
    fire('app:mounted');

    // `hydrate-on-visible` fires on scroll, which no fixed window can reach — the observer is
    // the only mechanism that still repairs this.
    expect(observe).toHaveBeenCalledTimes(1);
    expect(observe.mock.calls[0]![1]).toMatchObject({ childList: true, subtree: true });
  });

  it('installs no observer when observeDeferred is false', () => {
    configure({ enabled: true, observeDeferred: false });
    const { fire, nuxtApp } = nuxtAppStub();
    const observe = vi.spyOn(MutationObserver.prototype, 'observe');

    setupPlugin(nuxtApp);
    fire('app:mounted');

    expect(observe).not.toHaveBeenCalled();
  });

  it('installs exactly one observer however often app:mounted fires', () => {
    configure({ enabled: true });
    const { fire, nuxtApp } = nuxtAppStub();
    const observe = vi.spyOn(MutationObserver.prototype, 'observe');

    setupPlugin(nuxtApp);
    fire('app:mounted');
    fire('app:mounted');

    expect(observe).toHaveBeenCalledTimes(1);
  });
});

describe('form-label-association plugin — a navigation inside an open window', () => {
  it('restarts the window instead of handing the new page the leftover time', () => {
    // A navigation at t=1400 in a 1500 ms window brings NEW server-rendered content and needs
    // the full window, not the 100 ms left from the previous page. Before 1.14.0 the
    // re-entrancy guard dropped the request entirely, so `maxRepairMs` quietly did not hold
    // for exactly the navigations most likely to need it.
    configure({ enabled: true, maxRepairMs: 1000 });
    const { fire, nuxtApp } = nuxtAppStub();
    const clear = vi.spyOn(globalThis, 'clearInterval');

    setupPlugin(nuxtApp);
    fire('app:mounted');

    vi.advanceTimersByTime(900);
    fire('page:finish');
    vi.advanceTimersByTime(1);

    // Still inside the restarted window: the old deadline (t=1000) must not close it.
    vi.advanceTimersByTime(200);
    expect(clear).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1000);
    expect(clear).toHaveBeenCalled();
  });
});
