/**
 * Toast helper
 *
 * Single place where the module talks to Nuxt UI's toaster.
 *
 * Composables used to look the composable up on `nuxtApp` / `globalThis`
 * (`(nuxtApp as any).useToast || (globalThis as any).useToast`). Nuxt UI exposes
 * `useToast` as an auto-import and puts it on neither, so that lookup was always
 * `undefined` and every toast silently degraded to a `console.*` line — users
 * got no visible feedback at all.
 *
 * Importing Nuxt UI's `useToast` directly is what actually works. The specifier
 * resolves to the very same file the auto-import points at, so the toast lands
 * in the `useState('toasts')` array that `<UApp>` / `<UToaster>` renders.
 * `module.ts` aliases it onto {@link ui-toast-stub} when `@nuxt/ui` is not
 * installed, which keeps it an optional peer.
 */

import { useToast } from '@nuxt/ui/composables/useToast';

/** Semantic toast colors — mirrors Nuxt UI's color tokens. */
export type LtToastColor = 'error' | 'info' | 'neutral' | 'primary' | 'secondary' | 'success' | 'warning';

export interface LtToastOptions {
  color?: LtToastColor;
  description?: string;
  title?: string;
}

/**
 * Show a toast, if the app has a toaster.
 *
 * Call it inside `nuxtApp.runWithContext()` when you are past an `await` or
 * outside a component: `useToast()` needs the Nuxt instance for `useState`.
 *
 * @param options - Toast color, title and description
 * @returns `true` when the toast was handed to Nuxt UI, `false` when no toaster
 *   is available (or it threw) — callers use this to fall back to the console
 *   instead of swallowing the message.
 *
 * @example
 * ```typescript
 * if (!ltAddToast({ color: 'error', description: message, title: 'Fehler' })) {
 *   console.error('[MyComposable]', message);
 * }
 * ```
 */
export function ltAddToast(options: LtToastOptions): boolean {
  try {
    const toast = useToast() as undefined | { add?: (options: LtToastOptions) => unknown };
    if (typeof toast?.add !== 'function') {
      return false;
    }
    toast.add(options);
    return true;
  } catch {
    // No Nuxt context, or the toaster itself threw — the caller's console
    // fallback takes over.
    return false;
  }
}
