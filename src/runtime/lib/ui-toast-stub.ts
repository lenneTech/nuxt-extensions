/**
 * Build-time stand-in for Nuxt UI's `@nuxt/ui/composables/useToast`.
 *
 * `@nuxt/ui` is an OPTIONAL peer of this module, but `runtime/lib/toast.ts`
 * imports `useToast` at the top level — so the bundler must resolve the
 * specifier even in a project that ships a different UI layer. `module.ts`
 * aliases `@nuxt/ui/composables/useToast` onto this file when the package is
 * absent; without it the build would fail on an unresolved optional peer
 * instead of honouring the optionality (same pattern as `passkey-stub.ts`).
 *
 * The alias rewrites the specifier for the WHOLE consumer app, so this file
 * mirrors every name the real module exports. `test/lt-toast.test.ts` pins that
 * surface against the real package.
 */

/** Mirror of Nuxt UI's injection key for the toaster's `max` prop. */
export const toastMaxInjectionKey = Symbol('nuxt-ui.toast-max');

/**
 * No-op replacement for Nuxt UI's `useToast()`.
 *
 * Returning `undefined` — rather than an object whose `add()` silently swallows
 * the toast — is what lets {@link ltAddToast} report "no toast was shown", so
 * callers keep their console fallback.
 */
export function useToast(): undefined {
  return undefined;
}
