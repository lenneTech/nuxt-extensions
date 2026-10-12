import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';

import { resetStubRuntimeConfig, setStubRuntimeConfig } from './stubs/imports';
import { resetLtWarnOnceState } from '../src/runtime/lib/auth-state';
import { useLtTusUpload } from '../src/runtime/composables/use-lt-tus-upload';

/**
 * `useLtTusUpload(options)` — what the composable hands to tus-js-client, and what it reads back.
 *
 * Three defects this pins:
 *
 * 1. The options were spread over the defaults as they came, so a key that was present but
 *    `undefined` erased its default. That is exactly what a component forwards for an unset prop —
 *    the template's `TusFileUpload.vue` passes `endpoint: props.endpoint` — and the result was an
 *    upload with no endpoint at all. tus-js-client rejected it before opening a request ("tus:
 *    neither an endpoint or an upload URL is provided"). `autoStart: undefined` silently turned
 *    auto-start off the same way.
 *
 * 2. A relative endpoint went to the APP origin. TUS is served by the API (nest-server: `/tus`), so
 *    the upload answered 404 unless the project had put its own proxy in front. Auth and AI requests
 *    resolve their paths against the API base (`buildLtApiUrl`); the upload endpoint now does the
 *    same, switchable via `ltExtensions.tus.resolveAgainstApi` (default `true`).
 *
 * 3. After the upload the only identifier was `url`, the TUS upload resource. Projects took its last
 *    segment as the file id, but that is the TUS upload id, so every file link built from it was a
 *    404. nest-server (11.42.13+) names the stored file in the `X-File-Id` header of the response
 *    that completes the upload; it is exposed as `fileId`.
 */

interface FakeResponse {
  getHeader: (name: string) => null | string | undefined;
}

interface CreatedUpload {
  file: File;
  options: {
    endpoint?: string;
    onAfterResponse?: (req: unknown, res: FakeResponse) => Promise<void> | void;
    onSuccess?: (payload?: { lastResponse: FakeResponse }) => void;
  };
  started: boolean;
}

const created: CreatedUpload[] = [];
let warnSpy: MockInstance<(...args: unknown[]) => void>;

vi.mock('tus-js-client', () => ({
  Upload: class {
    url = null;
    private readonly record: CreatedUpload;

    constructor(file: File, options: CreatedUpload['options']) {
      this.record = { file, options, started: false };
      created.push(this.record);
    }

    abort(): Promise<void> {
      return Promise.resolve();
    }

    findPreviousUploads(): Promise<never[]> {
      return Promise.resolve([]);
    }

    resumeFromPreviousUpload(): void {}

    start(): void {
      this.record.started = true;
    }
  },
}));

beforeEach(() => {
  resetStubRuntimeConfig();
  // `buildLtApiUrl` warns once per module instance when no API URL is configured; reset that
  // state so each test sees the same warning behaviour regardless of order.
  resetLtWarnOnceState();
  warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
  created.length = 0;
});

afterEach(() => {
  warnSpy.mockRestore();
  resetStubRuntimeConfig();
});

/** A response as tus-js-client hands it to its hooks; `null` is what XHR returns for a missing header. */
function response(headers: Record<string, string> = {}): FakeResponse {
  return { getHeader: (name) => headers[name] ?? null };
}

/**
 * Replay what tus-js-client does around a finished upload: `onAfterResponse` for every response
 * (creation POST, then the PATCHes), then `onSuccess`. From 4.2.0 `onSuccess` receives
 * `{ lastResponse }`; 4.0 and 4.1 — inside the `>=4.0.0` peer range — call it with no argument.
 */
function finishUpload(upload: CreatedUpload | undefined, responses: FakeResponse[], { payload = true } = {}): void {
  for (const res of responses) {
    void upload?.options.onAfterResponse?.({}, res);
  }
  upload?.options.onSuccess?.(payload ? { lastResponse: responses.at(-1)! } : undefined);
}

async function endpointFor(options: Parameters<typeof useLtTusUpload>[0] = {}): Promise<string | undefined> {
  const { addFiles } = useLtTusUpload({ autoStart: false, ...options });
  await addFiles(new File(['a'], 'a.txt'));
  return created.at(-1)?.options.endpoint;
}

describe('useLtTusUpload option defaults', () => {
  it('keeps the default endpoint when the caller passes endpoint: undefined', async () => {
    const { addFiles } = useLtTusUpload({ autoStart: false, endpoint: undefined });

    await addFiles(new File(['a'], 'a.txt'));

    expect(created[0]?.options.endpoint).toBe('/files/upload');
  });

  it('keeps the configured module endpoint when the caller passes endpoint: undefined', async () => {
    setStubRuntimeConfig({ public: { ltExtensions: { tus: { defaultEndpoint: '/api/files/upload' } } } });
    const { addFiles } = useLtTusUpload({ autoStart: false, endpoint: undefined });

    await addFiles(new File(['a'], 'a.txt'));

    expect(created[0]?.options.endpoint).toBe('/api/files/upload');
  });

  it('still lets an explicit endpoint win', async () => {
    const { addFiles } = useLtTusUpload({ autoStart: false, endpoint: '/uploads' });

    await addFiles(new File(['a'], 'a.txt'));

    expect(created[0]?.options.endpoint).toBe('/uploads');
  });

  it('keeps auto-start on when the caller passes autoStart: undefined', async () => {
    const { addFiles, uploads } = useLtTusUpload({ autoStart: undefined });

    await addFiles(new File(['a'], 'a.txt'));
    // `startUpload` resolves `findPreviousUploads()` before calling `start()`.
    await Promise.resolve();

    expect(uploads.value[0]?.status).toBe('uploading');
    expect(created[0]?.started).toBe(true);
  });
});

describe('useLtTusUpload endpoint resolution', () => {
  const API = 'https://api.example.com';

  it('resolves the module default endpoint against NUXT_PUBLIC_API_URL', async () => {
    setStubRuntimeConfig({ public: { apiUrl: API, ltExtensions: { tus: { defaultEndpoint: '/tus' } } } });

    expect(await endpointFor()).toBe(`${API}/tus`);
  });

  it('resolves a relative endpoint passed by the caller the same way', async () => {
    setStubRuntimeConfig({ public: { apiUrl: API } });

    expect(await endpointFor({ endpoint: '/tus' })).toBe(`${API}/tus`);
  });

  it('routes through the dev proxy prefix in proxy mode, like the auth requests', async () => {
    setStubRuntimeConfig({ public: { apiProxy: true, apiUrl: 'http://localhost:3000' } });

    expect(await endpointFor({ endpoint: '/tus' })).toBe('/api/tus');
  });

  it('treats a path without a leading slash as a path on the API', async () => {
    setStubRuntimeConfig({ public: { apiUrl: `${API}/` } });

    expect(await endpointFor({ endpoint: 'tus' })).toBe(`${API}/tus`);
  });

  it('leaves an absolute endpoint unchanged', async () => {
    setStubRuntimeConfig({ public: { apiUrl: API } });

    expect(await endpointFor({ endpoint: 'https://uploads.example.com/tus' })).toBe('https://uploads.example.com/tus');
  });

  it('leaves a protocol-relative endpoint unchanged', async () => {
    setStubRuntimeConfig({ public: { apiUrl: API } });

    expect(await endpointFor({ endpoint: '//uploads.example.com/tus' })).toBe('//uploads.example.com/tus');
  });

  it('keeps a relative endpoint on the app origin when resolveAgainstApi is false', async () => {
    setStubRuntimeConfig({ public: { apiUrl: API, ltExtensions: { tus: { defaultEndpoint: '/files/upload', resolveAgainstApi: false } } } });

    expect(await endpointFor()).toBe('/files/upload');
    expect(await endpointFor({ endpoint: '/tus' })).toBe('/tus');
  });

  it('keeps the relative path and warns once when no API URL is configured', async () => {
    expect(await endpointFor({ endpoint: '/tus' })).toBe('/tus');
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(String(warnSpy.mock.calls[0]?.[0])).toContain('NUXT_PUBLIC_API_URL');
  });
});

describe('useLtTusUpload fileId', () => {
  it('reads the stored file id from the X-File-Id header of the completing response', async () => {
    const { addFiles, uploads } = useLtTusUpload({ autoStart: false });
    await addFiles(new File(['a'], 'a.txt'));

    // Only the response that completes the upload carries the header — not the creation POST.
    finishUpload(created[0], [response(), response({ 'X-File-Id': '6650a1b2c3d4e5f6a7b8c9d0' })]);

    expect(uploads.value[0]?.status).toBe('completed');
    expect(uploads.value[0]?.fileId).toBe('6650a1b2c3d4e5f6a7b8c9d0');
  });

  it('reads it with tus-js-client 4.0 and 4.1 too, which call onSuccess without a payload', async () => {
    const { addFiles, uploads } = useLtTusUpload({ autoStart: false });
    await addFiles(new File(['a'], 'a.txt'));

    finishUpload(created[0], [response(), response({ 'X-File-Id': 'file-4-0' })], { payload: false });

    expect(uploads.value[0]?.status).toBe('completed');
    expect(uploads.value[0]?.fileId).toBe('file-4-0');
  });

  it('hands the item with its fileId to the onSuccess callback', async () => {
    const onSuccess = vi.fn();
    const { addFiles } = useLtTusUpload({ autoStart: false, onSuccess });
    await addFiles(new File(['a'], 'a.txt'));

    finishUpload(created[0], [response({ 'X-File-Id': 'file-1' })]);

    expect(onSuccess).toHaveBeenCalledWith(expect.objectContaining({ fileId: 'file-1', status: 'completed' }));
  });

  it('leaves fileId undefined when the backend sends no X-File-Id header', async () => {
    const { addFiles, uploads } = useLtTusUpload({ autoStart: false });
    await addFiles(new File(['a'], 'a.txt'));

    finishUpload(created[0], [response(), response()]);

    expect(uploads.value[0]?.status).toBe('completed');
    expect(uploads.value[0]?.fileId).toBeUndefined();
  });
});
