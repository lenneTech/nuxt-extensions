import { describe, expect, it } from 'vitest';

import type { LtAiStreamEvent } from '../src/runtime/types/ai';
import { parseLtAiSseStream } from '../src/runtime/lib/ai';

/** Build a Response-like object streaming the given raw SSE chunks. */
function sseResponse(chunks: string[]): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(encoder.encode(chunk));
      }
      controller.close();
    },
  });
  return { body: stream } as unknown as Response;
}

describe('parseLtAiSseStream', () => {
  it('parses data events, tolerates split JSON, keep-alives and [DONE]', async () => {
    const events: LtAiStreamEvent[] = [];
    const res = sseResponse([
      'data: {"type":"token","token":"He', // JSON split across two chunks
      'llo"}\n\n',
      ': keep-alive\n\n', // comment line → ignored
      'data: {"type":"action","action":{"name":"x","success":true}}\n\n',
      'data: [DONE]\n\n', // sentinel → ignored
      'data: {"type":"final","response":{"text":"Hello"}}\n', // no trailing blank line
    ]);

    await parseLtAiSseStream(res, (event) => events.push(event));

    expect(events).toEqual([
      { token: 'Hello', type: 'token' },
      { action: { name: 'x', success: true }, type: 'action' },
      { response: { text: 'Hello' }, type: 'final' },
    ]);
  });

  it('ignores malformed data lines without throwing', async () => {
    const events: LtAiStreamEvent[] = [];
    await parseLtAiSseStream(sseResponse(['data: not-json\n\n', 'data: {"type":"token","token":"ok"}\n\n']), (e) =>
      events.push(e),
    );
    expect(events).toEqual([{ token: 'ok', type: 'token' }]);
  });

  it('throws when the response has no body', async () => {
    await expect(parseLtAiSseStream({ body: null } as unknown as Response, () => {})).rejects.toThrow(/no body/i);
  });
});
