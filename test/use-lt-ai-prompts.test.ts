/**
 * `useLtAiPrompts()` — the user's prompts ("Vorlagen", `GET/POST/PUT/DELETE /ai/prompts`).
 *
 * The chat picker lists active prompts only; a management screen asks for the disabled ones too
 * (`?includeDisabled=true`, nest-server >= 12.7.0), and must keep them after saving one as disabled.
 * `ltAuthFetch` is a controlled stub, as in `use-lt-ai-settings.test.ts`, so the requested URLs can
 * be asserted exactly.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useLtAiPrompts } from '../src/runtime/composables/use-lt-ai-prompts';
import { resetStubReactiveStores, resetStubRuntimeConfig } from './stubs/imports';

const ltAuthFetchMock = vi.fn();

vi.mock('../src/runtime/lib/auth-state', () => ({
  buildLtApiUrl: (path: string) => path,
  ltAuthFetch: (...args: unknown[]) => ltAuthFetchMock(...args),
}));

function answer(status: number, body: unknown): Response {
  return { ok: status >= 200 && status < 300, status, json: async () => body } as unknown as Response;
}

const ACTIVE = { content: 'Fasse {{topic}} zusammen', enabled: true, id: 'p1', name: 'Zusammenfassung', scope: 'user' };
const DISABLED = { content: 'Übersetze ins Englische', enabled: false, id: 'p2', name: 'Übersetzung', scope: 'user' };

function requested(): Array<[string, string]> {
  return ltAuthFetchMock.mock.calls.map(([url, init]) => [init.method, url]);
}

beforeEach(() => {
  resetStubRuntimeConfig();
  resetStubReactiveStores();
  ltAuthFetchMock.mockReset();
});

describe('useLtAiPrompts', () => {
  it('loads the active prompts without a parameter, as the chat picker needs', async () => {
    ltAuthFetchMock.mockResolvedValueOnce(answer(200, [ACTIVE]));
    const ai = useLtAiPrompts();

    await ai.load();

    expect(requested()).toEqual([['GET', '/ai/prompts']]);
    expect(ai.prompts.value).toEqual([ACTIVE]);
    expect(ai.loading.value).toBe(false);
  });

  it('asks for the disabled prompts too with includeDisabled', async () => {
    ltAuthFetchMock.mockResolvedValueOnce(answer(200, [ACTIVE, DISABLED]));
    const ai = useLtAiPrompts();

    await ai.load({ includeDisabled: true });

    expect(requested()).toEqual([['GET', '/ai/prompts?includeDisabled=true']]);
    expect(ai.prompts.value).toEqual([ACTIVE, DISABLED]);
  });

  it('sends no parameter for includeDisabled: false, or for an event passed by @click="load"', async () => {
    ltAuthFetchMock.mockResolvedValue(answer(200, [ACTIVE]));
    const ai = useLtAiPrompts();

    await ai.load({ includeDisabled: false });
    await ai.load({ type: 'click' } as never);

    expect(requested()).toEqual([
      ['GET', '/ai/prompts'],
      ['GET', '/ai/prompts'],
    ]);
  });

  it('keeps a prompt saved as disabled in a management list (reload after update)', async () => {
    ltAuthFetchMock.mockResolvedValueOnce(answer(200, [ACTIVE]));
    const ai = useLtAiPrompts();
    await ai.load({ includeDisabled: true });
    ltAuthFetchMock.mockResolvedValueOnce(answer(200, { ...ACTIVE, enabled: false }));
    ltAuthFetchMock.mockResolvedValueOnce(answer(200, [{ ...ACTIVE, enabled: false }]));

    await ai.update('p1', { enabled: false });

    expect(requested()).toEqual([
      ['GET', '/ai/prompts?includeDisabled=true'],
      ['PUT', '/ai/prompts/p1'],
      ['GET', '/ai/prompts?includeDisabled=true'],
    ]);
    expect(ai.prompts.value).toEqual([{ ...ACTIVE, enabled: false }]);
  });

  it('reloads with the options of the last load() after create and remove', async () => {
    ltAuthFetchMock.mockResolvedValue(answer(200, []));
    const ai = useLtAiPrompts();
    await ai.load({ includeDisabled: true });

    await ai.create({ content: 'x', enabled: false, name: 'Neu', scope: 'user' });
    await ai.remove('p2');

    expect(requested()).toEqual([
      ['GET', '/ai/prompts?includeDisabled=true'],
      ['POST', '/ai/prompts'],
      ['GET', '/ai/prompts?includeDisabled=true'],
      ['DELETE', '/ai/prompts/p2'],
      ['GET', '/ai/prompts?includeDisabled=true'],
    ]);
  });

  it('keeps the chat picker on active prompts after a change, and a later load() resets the option', async () => {
    ltAuthFetchMock.mockResolvedValue(answer(200, []));
    const picker = useLtAiPrompts();
    const management = useLtAiPrompts();
    await management.load({ includeDisabled: true });
    await picker.load();

    await picker.create({ content: 'x', name: 'Neu', scope: 'user' });
    await management.load();
    await management.remove('p1');

    expect(requested()).toEqual([
      ['GET', '/ai/prompts?includeDisabled=true'],
      ['GET', '/ai/prompts'],
      ['POST', '/ai/prompts'],
      ['GET', '/ai/prompts'],
      ['GET', '/ai/prompts'],
      ['DELETE', '/ai/prompts/p1'],
      ['GET', '/ai/prompts'],
    ]);
  });
});
