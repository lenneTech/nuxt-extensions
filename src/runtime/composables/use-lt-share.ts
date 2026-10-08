/**
 * Web Share API Composable
 *
 * Provides a unified sharing API with:
 * - Native Web Share API on supported devices
 * - Clipboard fallback with toast notification
 * - i18n support with German fallback
 */

import { useNuxtApp, useRoute } from '#imports';
import { ltAddToast } from '../lib/toast';

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
        console.error('Error sharing:', error);
      }
    } else {
      // Fallback: Copy to clipboard
      try {
        await navigator.clipboard.writeText(url ?? window.location.origin);

        // Confirm via Nuxt UI's toaster; `runWithContext` keeps the Nuxt
        // instance available after the awaited clipboard write.
        const shown = nuxtApp.runWithContext(() =>
          ltAddToast({
            color: 'success',
            description: t('lt.share.copiedDescription', 'Der Link wurde in die Zwischenablage kopiert.'),
            title: t('lt.share.copied', 'Link kopiert'),
          }),
        );

        // No toaster in this app (Nuxt UI not installed).
        if (!shown) {
          console.debug('Link copied to clipboard');
        }
      } catch (error) {
        console.error('Error copying to clipboard:', error);
      }
    }
  }

  return {
    share,
  };
}
