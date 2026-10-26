/**
 * `waitForElement(page, selector)` waits until the element stops animating — `stable` is the
 * default — and must not hang when an animation is cancelled instead of finishing.
 *
 * The cancellation is real browser behaviour, not a hypothesis: `Animation.finished` rejects
 * with an `AbortError` when the animation is cancelled (a transition interrupted by a class
 * change, an element hidden mid-animation). Measured in Chrome 158 on 2026-10-26: the helper's
 * former `Promise.all(...).then(resolve)` never resolved after a cancel, so the test waited
 * for Playwright's timeout; `Promise.allSettled` resolved at once.
 *
 * The page is faked the same way as in `playwright-goto-retry.test.ts`. `locator.evaluate`
 * runs the helper's callback against a stand-in element that exposes only `getAnimations()`,
 * which is the whole surface the callback reads.
 */

import type { Page } from '@playwright/test';
import { describe, expect, it, vi } from 'vitest';

import { waitForElement } from '../src/runtime/testing/playwright-helpers';

const HUNG = Symbol('hung');

function fakePage(finished: Array<Promise<unknown>>) {
  const element = { getAnimations: () => finished.map((promise) => ({ finished: promise })) };
  const locator = {
    evaluate: vi.fn(async (callback: (el: unknown) => Promise<void>) => callback(element)),
    waitFor: vi.fn(async () => undefined),
  };
  return { locator, page: { locator: () => locator } as unknown as Page };
}

/** Resolves with the helper's outcome, or with HUNG once `ms` pass without one. */
function settleWithin<T>(promise: Promise<T>, ms: number): Promise<T | typeof HUNG> {
  return Promise.race([promise, new Promise<typeof HUNG>((resolve) => setTimeout(() => resolve(HUNG), ms))]);
}

describe('waitForElement — stable wait', () => {
  it('returns when an animation is cancelled instead of finishing', async () => {
    const cancelled = Promise.reject(new DOMException('The animation was cancelled', 'AbortError'));
    cancelled.catch(() => undefined); // handled here; the helper must still see it reject
    const { page } = fakePage([cancelled]);

    expect(await settleWithin(waitForElement(page, '.modal'), 500)).toBeUndefined();
  });

  it('still waits while an animation is running', async () => {
    let finish!: () => void;
    const running = new Promise<void>((resolve) => {
      finish = resolve;
    });
    const { page } = fakePage([running]);

    const waiting = waitForElement(page, '.modal');
    expect(await settleWithin(waiting, 50)).toBe(HUNG);

    finish();
    expect(await settleWithin(waiting, 500)).toBeUndefined();
  });

  it('skips the evaluate when `stable` is false', async () => {
    const { locator, page } = fakePage([]);

    await waitForElement(page, '.modal', { stable: false });

    expect(locator.waitFor).toHaveBeenCalledOnce();
    expect(locator.evaluate).not.toHaveBeenCalled();
  });
});
