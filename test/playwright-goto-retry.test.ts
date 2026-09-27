/**
 * `gotoAndWaitForHydration` re-issues a `page.goto` that the page aborted by
 * navigating on its own — and nothing else.
 *
 * The abort is real Chromium behaviour, not a hypothesis: after a Playwright
 * `click()`, a `location.reload()` the page starts cancels the test's pending
 * `page.goto`. Measured with Playwright 1.62.1 and 1.63.0 against a local server: the bare
 * goto failed 3/3, the helper reached its target 5/5 with exactly one retry.
 * The error text below is copied from that run — the matcher is only as good as
 * the text it matches, so it must stay an observed one, never an invented one.
 *
 * Each guard fails a case here when removed: dropping the retry fails the first,
 * dropping the `ERR_ABORTED` filter fails the third, changing the bound fails
 * the second.
 */

import type { Page } from '@playwright/test';
import { describe, expect, it, vi } from 'vitest';

import { gotoAndWaitForHydration } from '../src/runtime/testing/playwright-helpers';

const TARGET = 'http://localhost:3001/app/spaces';
const aborted = () => new Error(`page.goto: net::ERR_ABORTED at ${TARGET}`);

function fakePage(gotoOutcomes: Array<Error | null>) {
  const goto = vi.fn(async () => {
    const outcome = gotoOutcomes.shift();
    if (outcome) throw outcome;
    return null;
  });
  const waitForFunction = vi.fn(async () => undefined);
  return { goto, page: { goto, waitForFunction } as unknown as Page, waitForFunction };
}

describe('gotoAndWaitForHydration — navigation aborted by the page', () => {
  it('re-issues an aborted goto, then waits for hydration', async () => {
    const { goto, page, waitForFunction } = fakePage([aborted(), null]);

    await gotoAndWaitForHydration(page, TARGET);

    expect(goto).toHaveBeenCalledTimes(2);
    expect(goto).toHaveBeenLastCalledWith(TARGET);
    expect(waitForFunction).toHaveBeenCalledOnce();
  });

  it('gives up after three attempts and rethrows the abort', async () => {
    const lastAbort = aborted();
    const { goto, page, waitForFunction } = fakePage([aborted(), aborted(), lastAbort, null]);

    await expect(gotoAndWaitForHydration(page, TARGET)).rejects.toBe(lastAbort);

    expect(goto).toHaveBeenCalledTimes(3);
    expect(waitForFunction).not.toHaveBeenCalled();
  });

  it('propagates any other navigation error on the first attempt', async () => {
    const refused = new Error(`page.goto: net::ERR_CONNECTION_REFUSED at ${TARGET}`);
    const { goto, page, waitForFunction } = fakePage([refused, null]);

    await expect(gotoAndWaitForHydration(page, TARGET)).rejects.toBe(refused);

    expect(goto).toHaveBeenCalledOnce();
    expect(waitForFunction).not.toHaveBeenCalled();
  });
});
