/**
 * File Utilities Composable
 *
 * Provides helper functions for working with files:
 * - File info fetching from server
 * - URL generation for file access
 * - File size and duration formatting
 */

import type { LtFileInfo, UseLtFileReturn } from '../types';

import { useRuntimeConfig } from '#imports';
import { buildLtApiUrl, buildLtPublicApiUrl } from '../lib/auth-state';

/** `https:` and friends, or protocol-relative `//host`: a file base that names its own origin. */
const ABSOLUTE_URL = /^(?:[a-z][a-z\d+.-]*:|\/\/)/i;

/**
 * File utilities composable
 *
 * @returns File utility functions
 *
 * @example
 * ```typescript
 * const { formatFileSize, getFileUrl, getDownloadUrl } = useLtFile();
 *
 * // Format file size
 * console.log(formatFileSize(1024)); // "1 KB"
 *
 * // Get file URLs
 * const viewUrl = getFileUrl('abc123');
 * const downloadUrl = getDownloadUrl('abc123', 'document.pdf');
 * ```
 */
export function useLtFile(): UseLtFileReturn {
  const config = useRuntimeConfig();

  /**
   * Get the base URL for file operations
   *
   * Derived from the TUS endpoint only when that ends in `/upload` (`'/files/upload'` → `'/files'`).
   * nest-server serves TUS at `/tus`, which says nothing about where the file routes are — cutting
   * `/upload` out of it left `'/tus'`, and every file link pointed into the upload route.
   */
  function getFileApiBase(): string {
    const endpoint = config.public.ltExtensions?.tus?.defaultEndpoint;
    return (endpoint?.endsWith('/upload') ? endpoint.slice(0, -'/upload'.length) : '') || '/files';
  }

  /**
   * A file route on the API, by the rule of the auth, AI and TUS requests (DEV-4073): the file
   * routes are API routes, and a path relative to the app only reached them behind a same-origin
   * proxy. `tus.resolveAgainstApi: false` (exactly that proxy setup) keeps the path relative; an
   * absolute file base is used as it is.
   *
   * @param path - The path below the file base, e.g. `/download/abc`
   * @param scope - `'link'` for URLs the browser follows (public URL, also during SSR), `'request'`
   *   for the request this composable makes itself (during SSR the server-side API URL)
   */
  function fileApiUrl(path: string, scope: 'link' | 'request'): string {
    const url = `${getFileApiBase()}${path}`;
    if (config.public.ltExtensions?.tus?.resolveAgainstApi === false || ABSOLUTE_URL.test(url)) {
      return url;
    }
    return scope === 'link' ? buildLtPublicApiUrl(url) : buildLtApiUrl(url);
  }

  /**
   * Check if a string is a valid MongoDB ObjectId
   */
  function isValidMongoID(id: string): boolean {
    return /^[a-f\d]{24}$/i.test(id);
  }

  /**
   * Fetch file info from the server by ID
   *
   * @param id - The file ID or URL
   * @returns File info, the original string if not a valid ID, or null on error
   */
  async function getFileInfo(id: string | undefined): Promise<LtFileInfo | null | string> {
    if (!id) {
      return null;
    }

    if (!isValidMongoID(id)) {
      return id;
    }

    try {
      const response = await $fetch<LtFileInfo>(fileApiUrl(`/info/${id}`, 'request'), {
        credentials: 'include',
        method: 'GET',
      });
      return response;
    } catch (error) {
      console.error('Error fetching file info:', error);
      return null;
    }
  }

  /**
   * Get the URL of a file by its id: nest-server's `GET /files/id/:id` (since 11.8.0), which streams
   * the file. `/files/:id` would be read as a file NAME (`GET /files/:filename`) and answer 404.
   *
   * @param id - The file ID
   * @returns The file URL
   */
  function getFileUrl(id: string): string {
    return fileApiUrl(`/id/${encodeURIComponent(id)}`, 'link');
  }

  /**
   * Get the download URL for a file: the same route as {@link getFileUrl}. nest-server sends
   * `Content-Disposition: attachment` with the stored filename there and has no rename parameter,
   * so `filename` is accepted for compatibility and ignored (as in ng-base). There is no
   * `/files/download/:id` route.
   *
   * @param id - The file ID
   * @param _filename - Ignored; the server names the download after the stored file
   * @returns The download URL
   */
  function getDownloadUrl(id: string, _filename?: string): string {
    return getFileUrl(id);
  }

  /**
   * Format bytes to human readable string
   *
   * @param bytes - Number of bytes
   * @returns Formatted string (e.g., "1.5 MB")
   */
  function formatFileSize(bytes: number): string {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`;
  }

  /**
   * Format duration in seconds to human readable string
   *
   * @param seconds - Duration in seconds
   * @returns Formatted string (e.g., "2m 30s" or "1h 15m")
   */
  function formatDuration(seconds: number): string {
    if (seconds < 60) return `${seconds}s`;
    if (seconds < 3600) return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    return `${hours}h ${minutes}m`;
  }

  return {
    formatDuration,
    formatFileSize,
    getDownloadUrl,
    getFileInfo,
    getFileUrl,
    isValidMongoID,
  };
}
