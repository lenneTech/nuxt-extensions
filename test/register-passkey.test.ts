/**
 * `registerPasskey()` and a second passkey for the same account (DEV-1368).
 *
 * Apple's iCloud Keychain holds one passkey per account and website. The server lists the
 * account's passkeys in `excludeCredentials`, the keychain finds one of them and refuses with
 * `InvalidStateError`. 1Password is a separate authenticator and accepts, which is why the defect
 * looked like "multiple passkeys only work with 1Password". The refusal is WebAuthn behaviour and
 * cannot be lifted; what this library owes the user is a message saying why, and no request that
 * stores anything.
 *
 * `excludeCredentials` has to reach the authenticator: without it the keychain would overwrite its
 * passkey for the account and leave the server with one that no longer signs in.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { clearAllCookies } from './stubs/cookies';
import { resetStubReactiveStores, resetStubRuntimeConfig, setStubRuntimeConfig } from './stubs/imports';

vi.mock('../src/runtime/composables/use-lt-auth-client', () => ({
  useLtAuthClient: () => ({
    changePassword: () => {},
    passkey: {},
    signIn: { email: async () => ({}) },
    signOut: async () => ({}),
    signUp: { email: async () => ({}) },
    twoFactor: {},
    useSession: () => ({ value: { data: null, isPending: false } }),
  }),
}));

const EXISTING_CREDENTIAL = 'Y3JlZC0x';

const registerOptions = {
  attestation: 'none',
  challenge: 'Y2hhbGxlbmdl',
  excludeCredentials: [{ id: EXISTING_CREDENTIAL, transports: ['internal'], type: 'public-key' }],
  pubKeyCredParams: [{ alg: -7, type: 'public-key' }],
  rp: { id: 'example.com', name: 'Example' },
  timeout: 60000,
  user: { displayName: 'someone@example.com', id: 'dXNlci0x', name: 'someone@example.com' },
};

let fetchSpy: ReturnType<typeof vi.fn>;
let create: ReturnType<typeof vi.fn>;

/** Requests that reached the server's verify step, i.e. would have stored a passkey */
const verifyRequests = () => fetchSpy.mock.calls.filter(([url]) => String(url).endsWith('/passkey/verify-registration'));

beforeEach(() => {
  resetStubRuntimeConfig();
  resetStubReactiveStores();
  clearAllCookies();
  setStubRuntimeConfig({ public: { apiUrl: 'https://api.example.com', ltExtensions: { auth: { basePath: '/iam' } } } });
  fetchSpy = vi.fn(async (url: string) => ({
    json: async () => (url.endsWith('/passkey/generate-register-options') ? registerOptions : { id: 'pk-2' }),
    ok: true,
    status: 200,
  }));
  globalThis.fetch = fetchSpy as unknown as typeof globalThis.fetch;
  create = vi.fn();
  Object.defineProperty(navigator, 'credentials', { configurable: true, value: { create } });
});

afterEach(() => {
  clearAllCookies();
  vi.restoreAllMocks();
});

describe('registerPasskey — a second passkey for the same account', () => {
  it('hands the account’s passkeys to the authenticator as excludeCredentials', async () => {
    create.mockRejectedValue(new DOMException('The authenticator was previously registered', 'InvalidStateError'));
    const { useLtAuth } = await import('../src/runtime/composables/auth/use-lt-auth');

    await useLtAuth().registerPasskey('MacBook');

    const excluded = create.mock.calls[0]![0].publicKey.excludeCredentials;
    expect(excluded).toHaveLength(1);
    expect(new Uint8Array(excluded[0].id)).toEqual(new TextEncoder().encode('cred-1'));
  });

  it('says why when the authenticator already holds one (iCloud Keychain), and stores nothing', async () => {
    create.mockRejectedValue(new DOMException('The authenticator was previously registered', 'InvalidStateError'));
    const { useLtAuth } = await import('../src/runtime/composables/auth/use-lt-auth');

    const result = await useLtAuth().registerPasskey('MacBook');

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/bereits einen Passkey/);
    expect(verifyRequests()).toHaveLength(0);
  });

  it('stores the passkey another authenticator creates (1Password, another device), under the name given', async () => {
    const buffer = (text: string) => new TextEncoder().encode(text).buffer;
    create.mockResolvedValue({
      getClientExtensionResults: () => ({}),
      id: 'cred-2',
      rawId: buffer('cred-2'),
      response: { attestationObject: buffer('attestation'), clientDataJSON: buffer('{}'), getTransports: () => ['hybrid'] },
      type: 'public-key',
    });
    const { useLtAuth } = await import('../src/runtime/composables/auth/use-lt-auth');

    const result = await useLtAuth().registerPasskey('iPhone');

    expect(result.success).toBe(true);
    expect(verifyRequests()).toHaveLength(1);
    expect(JSON.parse(verifyRequests()[0]![1].body)).toMatchObject({ name: 'iPhone', response: { id: 'cred-2' } });
  });
});
