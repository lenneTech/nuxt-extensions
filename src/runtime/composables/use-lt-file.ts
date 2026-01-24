/**
 * File Utilities Composable
 *
 * Provides helper functions for working with files:
 * - File info fetching from server
 * - URL generation for file access
 * - File size and duration formatting
 */

import type { LtFileInfo, UseLtFileReturn } from "../types";

import { useRuntimeConfig } from "#imports";

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
   */
  function getFileApiBase(): string {
    // Try to get from runtime config, fall back to current host
    return config.public.ltExtensions?.tus?.defaultEndpoint?.replace("/upload", "") || "/files";
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
      const apiBase = getFileApiBase();
      const response = await $fetch<LtFileInfo>(`${apiBase}/info/${id}`, {
        credentials: "include",
        method: "GET",
      });
      return response;
    } catch (error) {
      console.error("Error fetching file info:", error);
      return null;
    }
  }

  /**
   * Get the direct URL to view/access a file
   *
   * @param id - The file ID
   * @returns The file URL
   */
  function getFileUrl(id: string): string {
    const apiBase = getFileApiBase();
    return `${apiBase}/${id}`;
  }

  /**
   * Get the download URL for a file
   *
   * @param id - The file ID
   * @param filename - Optional filename for the download
   * @returns The download URL
   */
  function getDownloadUrl(id: string, filename?: string): string {
    const apiBase = getFileApiBase();
    const base = `${apiBase}/download/${id}`;
    return filename ? `${base}?filename=${encodeURIComponent(filename)}` : base;
  }

  /**
   * Format bytes to human readable string
   *
   * @param bytes - Number of bytes
   * @returns Formatted string (e.g., "1.5 MB")
   */
  function formatFileSize(bytes: number): string {
    if (bytes === 0) return "0 B";
    const k = 1024;
    const sizes = ["B", "KB", "MB", "GB", "TB"];
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
