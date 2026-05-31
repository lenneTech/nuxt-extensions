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
  it('reassembles a JSON payload split across chunks', async () => {
    const events: LtAiStreamEvent[] = [];
    const res = sseResponse([
      'data: {"type":"token","token":"He', // JSON split across two chunks
      'llo"}\n\n',
    ]);
    await parseLtAiSseStream(res, (event) => events.push(event));
    expect(events).toEqual([{ token: 'Hello', type: 'token' }]);
  });

  it('skips keep-alive comment lines', async () => {
    const events: LtAiStreamEvent[] = [];
    const res = sseResponse([
      ': keep-alive\n\n',
      'data: {"type":"token","token":"x"}\n\n',
      ': another comment\n\n',
    ]);
    await parseLtAiSseStream(res, (event) => events.push(event));
    expect(events).toEqual([{ token: 'x', type: 'token' }]);
  });

  it('ignores the [DONE] sentinel', async () => {
    const events: LtAiStreamEvent[] = [];
    const res = sseResponse([
      'data: {"type":"token","token":"x"}\n\n',
      'data: [DONE]\n\n',
    ]);
    await parseLtAiSseStream(res, (event) => events.push(event));
    expect(events).toEqual([{ token: 'x', type: 'token' }]);
  });

  it('flushes a trailing buffer with no terminating newline at EOF', async () => {
    const events: LtAiStreamEvent[] = [];
    const res = sseResponse([
      'data: {"type":"final","response":{"text":"Hello"}}\n', // no trailing blank line
    ]);
    await parseLtAiSseStream(res, (event) => events.push(event));
    expect(events).toEqual([{ response: { text: 'Hello' }, type: 'final' }]);
  });

  it('ignores malformed data lines without throwing', async () => {
    const events: LtAiStreamEvent[] = [];
    await parseLtAiSseStream(
      sseResponse(['data: not-json\n\n', 'data: {"type":"token","token":"ok"}\n\n']),
      (e) => events.push(e),
    );
    expect(events).toEqual([{ token: 'ok', type: 'token' }]);
  });

  it('produces zero events for a stream of only keep-alives', async () => {
    const events: LtAiStreamEvent[] = [];
    await parseLtAiSseStream(
      sseResponse([': ping\n\n', ': ping\n\n', ': ping\n\n']),
      (e) => events.push(e),
    );
    expect(events).toEqual([]);
  });

  it('throws when the response has no body', async () => {
    await expect(parseLtAiSseStream({ body: null } as unknown as Response, () => {})).rejects.toThrow(/no body/i);
  });

  it('bails out when a single line exceeds the 1 MiB limit', async () => {
    // 1.1 MB without a newline = will trip the line-size guard
    const huge = 'data: ' + 'x'.repeat(1_100_000);
    await expect(parseLtAiSseStream(sseResponse([huge]), () => {})).rejects.toThrow(/maximum allowed size/i);
  });

  it('honours an AbortSignal and exits cleanly', async () => {
    const controller = new AbortController();
    const events: LtAiStreamEvent[] = [];
    // Build a stream where the second chunk only arrives after the abort
    // signal fires — the parser should stop before reading it.
    const stream = new ReadableStream<Uint8Array>({
      async start(c) {
        const encoder = new TextEncoder();
        c.enqueue(encoder.encode('data: {"type":"token","token":"a"}\n\n'));
        controller.abort();
        // Yield to the event loop so the parser sees the abort before the next read.
        await Promise.resolve();
        c.enqueue(encoder.encode('data: {"type":"token","token":"b"}\n\n'));
        c.close();
      },
    });
    await parseLtAiSseStream(
      { body: stream } as unknown as Response,
      (e) => events.push(e),
      { signal: controller.signal },
    );
    // The 'a' token MAY have been delivered before the abort; the 'b' token must NOT.
    expect(events.find((e) => 'token' in e && e.token === 'b')).toBeUndefined();
  });
});
