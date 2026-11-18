/**
 * An inline image (a `data:` URL) on the user is never stored in the auth state.
 *
 * Better-Auth's Microsoft provider stores the user's 48x48 profile photo as a
 * `data:image/jpeg;base64,...` URL in `user.image` unless the API sets `disableProfilePhoto`
 * (`@better-auth/core`, `social-providers/microsoft-entra-id.mjs`). After a social sign-in the app
 * calls `validateSession()`, and `setUser()` wrote the whole user into the `lt-auth-state` cookie.
 * A browser drops a cookie whose name and value exceed 4096 bytes, without an error. The session
 * was valid, but the next page load found no auth state: the route guard sent the user to the
 * login page, and a login page with a silent sign-in looped through app, API and provider.
 *
 * So every writer of the auth state leaves such an image out, whatever its size. An `http(s)` URL
 * or a path stays. happy-dom keeps cookies of any size, so the tests emulate the browser's limit
 * and record every string written to `document.cookie`: the `useCookie` stub does not write
 * through, and the manual write is the one a reload reads.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { clearAllCookies, readAuthStateUser } from './stubs/cookies';
import { resetStubReactiveStores, resetStubRuntimeConfig, setStubCookieRefsPerCall, setStubRuntimeConfig, useCookie } from './stubs/imports';
import { resetTestRenderScope, setTestRenderScope } from './stubs/render-scope';
import { malformedUser, testUser } from './stubs/users';

/** A browser keeps a cookie only while its name and value together stay within 4096 bytes. */
const BROWSER_COOKIE_LIMIT = 4096;
const JWT = 'eyJhbGciOiJFZERTQSJ9.eyJzdWIiOiJ1c2VyLTEifQ.c2lnbmF0dXJl';

/** A user as Better-Auth's session answer carries it after a sign-in through Microsoft Entra ID. */
const ENTRA_USER = {
  createdAt: '2026-11-18T16:00:00.000Z',
  email: 'erika.mustermann@example.com',
  emailVerified: true,
  id: '6a1f3c2e9b8d7f0011223344',
  name: 'Erika Mustermann',
  roles: [],
  updatedAt: '2026-11-18T16:00:00.000Z',
};

/** A JPEG of `bytes` bytes as a `data:` URL, the way Better-Auth's Microsoft provider stores the photo. */
function inlinePhoto(bytes: number): string {
  const jpegStart = [0xff, 0xd8, 0xff, 0xe0];
  const raw = Array.from({ length: bytes }, (_, i) => String.fromCharCode(jpegStart[i] ?? (i * 37 + 11) % 256)).join('');
  return `data:image/jpeg;base64,${btoa(raw)}`;
}

/** About 3 KB as a URL. */
const PHOTO = inlinePhoto(2250);
/** A photo whose cookie a browser drops: the URL alone is above the limit once encoded. */
const PHOTO_OVER_LIMIT = inlinePhoto(3000);
/** A photo small enough that a cookie written by an earlier version survived in the browser. */
const LEGACY_PHOTO = inlinePhoto(900);

let mockSession: { data: { user: Record<string, unknown> } | null; isPending: boolean } = { data: null, isPending: false };

vi.mock('../src/runtime/composables/use-lt-auth-client', () => ({
  useLtAuthClient: () => ({
    changePassword: () => {},
    passkey: {},
    signIn: { email: vi.fn(), social: vi.fn() },
    signOut: async () => ({}),
    signUp: { email: vi.fn() },
    twoFactor: { verifyBackupCode: vi.fn(), verifyTotp: vi.fn() },
    useSession: () => ({ value: mockSession }),
  }),
}));

/** Every string written to `document.cookie` in this test, in order. */
let written: string[] = [];

/** Records every cookie string written and drops one a browser would drop. Undone by {@link restoreDocumentCookie}. */
function emulateBrowserCookieLimit(): void {
  let owner: null | object = document;
  let native: PropertyDescriptor | undefined;
  while (owner && !native) {
    native = Object.getOwnPropertyDescriptor(owner, 'cookie');
    owner = Object.getPrototypeOf(owner) as null | object;
  }
  if (!native?.get || !native.set) {
    throw new Error('document.cookie has no accessor to wrap');
  }
  const { get, set } = native;
  Object.defineProperty(document, 'cookie', {
    configurable: true,
    get: () => get.call(document) as string,
    set: (value: string) => {
      written.push(value);
      if (new TextEncoder().encode(value.split(';')[0] ?? '').length > BROWSER_COOKIE_LIMIT) {
        return;
      }
      set.call(document, value);
    },
  });
}

function restoreDocumentCookie(): void {
  Reflect.deleteProperty(document, 'cookie');
}

/** The `lt-auth-state` value the last write put into `document.cookie`, still encoded. */
function lastWrittenAuthState(): string | undefined {
  const entry = written.filter((cookie) => cookie.startsWith('lt-auth-state=')).at(-1);
  return entry?.split(';')[0]?.slice('lt-auth-state='.length);
}

function decode(encoded: string | undefined): { authMode?: string; user?: Record<string, unknown> | null } | null {
  return encoded === undefined ? null : JSON.parse(decodeURIComponent(encoded));
}

/** The auth state as the `useCookie` ref holds it; Nuxt serialises the ref into the cookie itself. */
const authStateRef = () => useCookie<{ authMode?: string; user?: Record<string, unknown> | null }>('lt-auth-state');

beforeEach(() => {
  resetStubRuntimeConfig();
  resetStubReactiveStores();
  resetTestRenderScope();
  clearAllCookies();
  setStubRuntimeConfig({ public: { apiUrl: 'https://api.example.com', ltExtensions: { auth: { basePath: '/iam' } } } });
  mockSession = { data: null, isPending: false };
  // The JWT pre-fetch after a sign-in stays in cookie mode unless a test answers with a JWT.
  vi.stubGlobal('fetch', vi.fn(async () => ({ json: async () => ({}), ok: false, status: 401 })));
  written = [];
  emulateBrowserCookieLimit();
});

afterEach(() => {
  restoreDocumentCookie();
  clearAllCookies();
  resetTestRenderScope();
  resetStubReactiveStores();
  vi.unstubAllGlobals();
});

async function auth() {
  const { useLtAuth } = await import('../src/runtime/composables/auth/use-lt-auth');
  return useLtAuth();
}

describe('setUser() leaves an inline image out of the auth state', () => {
  it('writes the cookie without a data: image, keeps every other field, and user equals the stored user', async () => {
    const lt = await auth();

    lt.setUser(testUser({ ...ENTRA_USER, image: PHOTO }));

    // The manual write, as it went into document.cookie
    const encoded = lastWrittenAuthState();
    expect(encoded).toBeDefined();
    expect(encoded!.length).toBeLessThan(1024);
    const stored = decode(encoded);
    expect(stored?.user).not.toHaveProperty('image');
    expect(stored?.user).toEqual(ENTRA_USER);
    expect(stored?.authMode).toBe('cookie');

    // What the browser kept
    expect(readAuthStateUser()).toEqual(ENTRA_USER);

    // The useCookie ref, which Nuxt serialises itself
    const fromRef = authStateRef().value;
    expect(fromRef?.user?.image).toBeUndefined();
    expect(fromRef?.user).toEqual(ENTRA_USER);
    expect(encodeURIComponent(JSON.stringify(fromRef)).length).toBeLessThan(1024);

    // The reactive user is the stored user
    expect(lt.user.value).toEqual(stored?.user);
    expect(lt.user.value?.image).toBeUndefined();
  });

  it.each([
    ['upper case', `DATA:${PHOTO.slice('data:'.length)}`],
    ['mixed case', `Data:${PHOTO.slice('data:'.length)}`],
    ['leading whitespace', ` \n\t${PHOTO}`],
    ['another media type', 'data:image/png;base64,iVBORw0KGgo='],
  ])('leaves out a data: URL in %s', async (_label, image) => {
    const lt = await auth();

    lt.setUser(testUser({ ...ENTRA_USER, image }));

    expect(decode(lastWrittenAuthState())?.user).not.toHaveProperty('image');
    expect(authStateRef().value?.user?.image).toBeUndefined();
    expect(lt.user.value?.image).toBeUndefined();
  });

  it.each([
    ['an https URL', 'https://graph.microsoft.com/v1.0/me/photos/48x48/$value'],
    ['an http URL', 'http://localhost:3000/files/avatar.jpg'],
    ['a path', '/files/6a1f3c2e9b8d7f0011223344/avatar.jpg'],
    ['a URL that only mentions data:', 'https://cdn.example.com/data:avatar.jpg'],
  ])('keeps %s unchanged', async (_label, image) => {
    const lt = await auth();

    lt.setUser(testUser({ ...ENTRA_USER, image }));

    expect(decode(lastWrittenAuthState())?.user?.image).toBe(image);
    expect(authStateRef().value?.user?.image).toBe(image);
    expect(lt.user.value?.image).toBe(image);
  });

  it('still stores image: null as no image', async () => {
    const lt = await auth();

    lt.setUser({ ...ENTRA_USER, image: null });

    expect(decode(lastWrittenAuthState())?.user).not.toHaveProperty('image');
    expect(authStateRef().value?.user?.image).toBeUndefined();
    expect(lt.user.value?.image).toBeUndefined();
  });

  it('matches only strings: a value that is not a string passes as before', async () => {
    const lt = await auth();
    // An array whose string form is a data: URL, so only the type check tells it apart
    const image = ['data:image/png;base64,iVBORw0KGgo='];

    lt.setUser(malformedUser({ ...ENTRA_USER, image }));

    expect(decode(lastWrittenAuthState())?.user?.image).toEqual(image);
  });

  it('leaves it out of the state Nuxt serialises during SSR too', async () => {
    setTestRenderScope('server');
    const lt = await auth();

    lt.setUser(testUser({ ...ENTRA_USER, image: PHOTO }));

    const fromRef = authStateRef().value;
    expect(fromRef?.user).toEqual(ENTRA_USER);
    expect(fromRef?.user?.image).toBeUndefined();
    expect(encodeURIComponent(JSON.stringify(fromRef)).length).toBeLessThan(1024);
    expect(lt.user.value?.image).toBeUndefined();
  });
});

describe('validateSession() after a sign-in through Microsoft Entra ID', () => {
  it('ends with a stored auth state that survives a reload, and the user signed in', async () => {
    // Without the rule this photo alone pushes the cookie over the limit, and the browser drops it.
    expect(encodeURIComponent(PHOTO_OVER_LIMIT).length).toBeGreaterThan(BROWSER_COOKIE_LIMIT);
    mockSession = { data: { user: { ...ENTRA_USER, image: PHOTO_OVER_LIMIT } }, isPending: false };
    const lt = await auth();

    expect(await lt.validateSession()).toBe(true);

    expect(lt.isAuthenticated.value).toBe(true);
    expect(readAuthStateUser()).toEqual(ENTRA_USER);
    expect(lt.user.value).toEqual(ENTRA_USER);

    // The next page load: a fresh instance that knows only what the browser kept
    resetStubReactiveStores();
    setStubCookieRefsPerCall(true);
    const reloaded = await auth();

    expect(reloaded.isAuthenticated.value).toBe(true);
    expect(reloaded.user.value).toEqual(ENTRA_USER);
    expect(reloaded.user.value?.image).toBeUndefined();
  });

  it('drops an inline image the merge carries over from the cached user', async () => {
    // A cookie an earlier version wrote while the photo was small enough to survive.
    document.cookie = `lt-auth-state=${encodeURIComponent(JSON.stringify({ authMode: 'cookie', user: { ...ENTRA_USER, image: LEGACY_PHOTO } }))}; path=/`;
    // The session answer has no `image` key at all, so the merge keeps the cached one.
    mockSession = { data: { user: { ...ENTRA_USER } }, isPending: false };
    const lt = await auth();

    expect(await lt.validateSession()).toBe(true);

    expect(decode(lastWrittenAuthState())?.user).toEqual(ENTRA_USER);
    expect(readAuthStateUser()).toEqual(ENTRA_USER);
    expect(lt.user.value?.image).toBeUndefined();
  });
});

describe('the other writers of the auth state agree', () => {
  /** A cookie an earlier version wrote while the photo was small enough to survive. */
  const legacyState = { authMode: 'cookie', user: { ...ENTRA_USER, image: LEGACY_PHOTO } };

  it('setLtAuthMode() rewrites the cookie without the inline image', async () => {
    document.cookie = `lt-auth-state=${encodeURIComponent(JSON.stringify(legacyState))}; path=/`;
    const { setLtAuthMode } = await import('../src/runtime/lib/auth-state');

    setLtAuthMode('jwt');

    const stored = decode(lastWrittenAuthState());
    expect(stored?.authMode).toBe('jwt');
    expect(stored?.user).toEqual(ENTRA_USER);
    expect(stored?.user).not.toHaveProperty('image');
  });

  it('setLtAuthMode() keeps an https image', async () => {
    const image = 'https://cdn.example.com/avatar.jpg';
    document.cookie = `lt-auth-state=${encodeURIComponent(JSON.stringify({ authMode: 'cookie', user: { ...ENTRA_USER, image } }))}; path=/`;
    const { setLtAuthMode } = await import('../src/runtime/lib/auth-state');

    setLtAuthMode('jwt');

    expect(decode(lastWrittenAuthState())?.user?.image).toBe(image);
  });

  it('useLtAuth() adopts a cookie from the browser into its state without the inline image', async () => {
    document.cookie = `lt-auth-state=${encodeURIComponent(JSON.stringify(legacyState))}; path=/`;

    await auth();

    expect(authStateRef().value?.user).toEqual(ENTRA_USER);
    expect(authStateRef().value?.user?.image).toBeUndefined();
  });

  it('switchToJwtMode() stores the JWT mode without the inline image', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ json: async () => ({ token: JWT }), ok: true, status: 200 })));
    // What Nuxt's useCookie read from a cookie an earlier version wrote.
    authStateRef().value = structuredClone(legacyState);
    const lt = await auth();

    expect(await lt.switchToJwtMode()).toBe(true);

    expect(authStateRef().value?.authMode).toBe('jwt');
    expect(authStateRef().value?.user).toEqual(ENTRA_USER);
    expect(authStateRef().value?.user?.image).toBeUndefined();
  });
});
