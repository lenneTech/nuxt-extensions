// =============================================================================
// Crypto Utilities
// =============================================================================

/**
 * Hashes a string using SHA256
 * Uses the Web Crypto API which is available in all modern browsers
 *
 * @param message - The string to hash
 * @returns The SHA256 hash as a lowercase hex string (64 characters)
 *
 * @example
 * ```typescript
 * const hash = await ltSha256('myPassword');
 * // Returns: 'a5de7...9f' (64 character hex string)
 * ```
 */
export async function ltSha256(message: string): Promise<string> {
  const msgBuffer = new TextEncoder().encode(message);
  const hashBuffer = await crypto.subtle.digest("SHA-256", msgBuffer);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}

// =============================================================================
// WebAuthn/Passkey Utilities
// =============================================================================

/**
 * Converts an ArrayBuffer to a base64url-encoded string
 * Used for WebAuthn credential responses
 *
 * @param buffer - The ArrayBuffer to convert
 * @returns The base64url-encoded string (no padding)
 *
 * @example
 * ```typescript
 * const base64 = ltArrayBufferToBase64Url(credential.rawId);
 * ```
 */
export function ltArrayBufferToBase64Url(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  bytes.forEach((b) => (binary += String.fromCharCode(b)));
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
}

/**
 * Converts a base64url-encoded string to a Uint8Array
 * Used for WebAuthn challenge decoding
 *
 * @param base64url - The base64url-encoded string
 * @returns The decoded Uint8Array
 *
 * @example
 * ```typescript
 * const challenge = ltBase64UrlToUint8Array(options.challenge);
 * ```
 */
export function ltBase64UrlToUint8Array(base64url: string): Uint8Array {
  const base64 = base64url.replace(/-/g, "+").replace(/_/g, "/");
  const paddedBase64 = base64 + "=".repeat((4 - (base64.length % 4)) % 4);
  return Uint8Array.from(atob(paddedBase64), (c) => c.charCodeAt(0));
}
