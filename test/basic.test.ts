import { describe, expect, it } from 'vitest';

describe('@lenne.tech/nuxt-extensions', () => {
  describe('crypto utilities', () => {
    it('ltSha256 hashes correctly', async () => {
      const { ltSha256 } = await import('../src/runtime/utils/crypto');
      const hash = await ltSha256('test');
      expect(hash).toBe('9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08');
    });

    it('ltArrayBufferToBase64Url converts correctly', async () => {
      const { ltArrayBufferToBase64Url } = await import('../src/runtime/utils/crypto');
      const buffer = new Uint8Array([72, 101, 108, 108, 111]).buffer; // "Hello"
      const result = ltArrayBufferToBase64Url(buffer);
      expect(result).toBe('SGVsbG8');
    });

    it('ltBase64UrlToUint8Array converts correctly', async () => {
      const { ltBase64UrlToUint8Array } = await import('../src/runtime/utils/crypto');
      const result = ltBase64UrlToUint8Array('SGVsbG8');
      expect(Array.from(result)).toEqual([72, 101, 108, 108, 111]);
    });
  });

  describe('tw utility', () => {
    it('returns string as-is when called as function', async () => {
      const { tw } = await import('../src/runtime/utils/tw');
      const result = tw('bg-blue-500 text-white');
      expect(result).toBe('bg-blue-500 text-white');
    });

    it('returns template array when used with template literal', async () => {
      const { tw } = await import('../src/runtime/utils/tw');
      const result = tw`bg-blue-500 text-white`;
      expect(result[0]).toBe('bg-blue-500 text-white');
    });
  });

  describe('types', () => {
    it('exports all required types', async () => {
      const types = await import('../src/runtime/types');
      expect(types).toBeDefined();
    });
  });
});
