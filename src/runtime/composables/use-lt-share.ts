/**
 * Web Share API Composable
 *
 * Provides a unified sharing API with:
 * - Native Web Share API on supported devices
 * - Clipboard fallback with toast notification
 * - i18n support with German fallback
 */

import { useNuxtApp, useRoute } from "#imports";

/**
 * Return type for useLtShare composable
 */
export interface UseLtShareReturn {
  /** Share content using native API or clipboard fallback */
  share: (title?: string, text?: string, url?: string) => Promise<void>;
}

/**
 * Web Share composable with clipboard fallback
 *
 * @returns Share function
 *
 * @example
 * ```typescript
 * const { share } = useLtShare();
 *
 * // Share current page
 * await share('Check this out!', 'Amazing content', window.location.href);
 *
 * // Share with defaults (uses current URL)
 * await share();
 * ```
 */
export function useLtShare(): UseLtShareReturn {
  const route = useRoute();
  const nuxtApp = useNuxtApp();

  /**
   * Helper function for i18n with German fallback
   */
  function t(key: string, germanFallback: string): string {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const i18n = (nuxtApp as any).$i18n;

    // No i18n installed -> German (for single-language DE projects)
    if (!i18n?.t) {
      return germanFallback;
    }
    // i18n installed -> use i18n (fallback to EN is configured in i18n)
    return i18n.t(key);
  }

  /**
   * Share content using Web Share API or clipboard fallback
   *
   * @param title - Title of the content to share
   * @param text - Text/description to share
   * @param url - URL to share (defaults to current page)
   */
  async function share(title?: string, text?: string, url?: string): Promise<void> {
    if (!import.meta.client) {
      return;
    }

    if (window?.navigator?.share) {
      try {
        await window.navigator.share({
          text: text ?? window.location.origin,
          title: title,
          url: url ?? route.fullPath,
        });
      } catch (error) {
        console.error("Error sharing:", error);
      }
    } else {
      // Fallback: Copy to clipboard
      try {
        await navigator.clipboard.writeText(url ?? window.location.origin);

        // Try to use toast notification if available (Nuxt UI)
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const useToast = (nuxtApp as any).$useToast || (globalThis as any).useToast;
        if (typeof useToast === "function") {
          try {
            const toast = useToast();
            toast.add({
              color: "success",
              description: t(
                "lt.share.copiedDescription",
                "Der Link wurde in die Zwischenablage kopiert.",
              ),
              title: t("lt.share.copied", "Link kopiert"),
            });
          } catch {
            // Toast failed, log to console
            console.debug("Link copied to clipboard");
          }
        } else {
          // Nuxt UI not installed
          console.debug("Link copied to clipboard");
        }
      } catch (error) {
        console.error("Error copying to clipboard:", error);
      }
    }
  }

  return {
    share,
  };
}
