/**
 * Guards for the audit summary — the line a human reads to decide "audit clean".
 *
 * Why this file exists: `scripts/**` sits outside every other gate in this repo. `vitest` only
 * includes `test/**`, `oxlint` and `oxfmt` only scan `src/`, `vue-tsc` does not compile `.mjs`,
 * and CI runs the check steps individually without ever invoking `scripts/check.mjs`. Before this
 * file, reverting the whole audit-reporting change failed 0 of 375 tests.
 *
 * Every assertion below fails if the guard it pins is removed — verified by mutation, not by
 * assumption. Where a test asserts the ABSENCE of something (no dim, no annotation) it also
 * asserts a positive fact about the same return value, because an absence-only assertion passes
 * just as happily when the function never ran.
 */

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  advisoryBulkUrl,
  configuredRegistry,
  auditOutcome,
  countSuppressions,
  countUnlisted,
  countUnlistedBySeverity,
  assessedSeverities,
  isAuditEndpointUnavailable,
  isAuditResultAmbiguous,
  renderVulnLine,
  sumSeverities,
} from '../scripts/lib/audit-report.mjs';
import { stripAnsi } from '../scripts/lib/ansi.mjs';
import {
  npmV2WithCritical,
  pnpmBelowThreshold,
  pnpmClean,
  pnpmMixed,
  pnpmSameTreeUnfiltered,
  pnpmSuppressedHigh,
} from './fixtures/audit-reports';

const RED = '[31m';
const DIM = '[2m';
const YELLOW = '[33m';

/** Is this severity's number rendered in the given colour? */
function coloured(line: string, colour: string, severity: string): boolean {
  return line.includes(`${colour}${severity} `);
}

describe('countUnlistedBySeverity', () => {
  it('reports nothing unlisted when the package manager omits `advisories` entirely', () => {
    // npm 7+ has no `advisories` key. Deriving counts from it would zero out a real critical and
    // file it as suppressed — the exact confusion this accounting prevents, produced in reverse.
    // GUARD: deleting `if (!parsed?.advisories) return empty` breaks this.
    const unlisted = countUnlistedBySeverity(npmV2WithCritical);

    expect(unlisted.critical).toBe(0);
    expect(sumSeverities(unlisted)).toBe(0);
    // The positive half: the raw count is untouched and still says there IS a critical.
    expect(npmV2WithCritical.metadata?.vulnerabilities?.critical).toBe(1);
  });

  it('treats a present-but-empty `advisories` as a real, listable set', () => {
    // pnpm emits `advisories: {}` on every clean run, so "empty" must not be conflated with
    // "absent" — conflating them would break the npm case above.
    expect(countUnlistedBySeverity(pnpmClean)).toEqual({
      critical: 0,
      high: 0,
      info: 0,
      low: 0,
      moderate: 0,
    });
    expect(countUnlistedBySeverity(pnpmBelowThreshold).moderate).toBe(1);
  });

  it('attributes the gap to the severity it actually came from', () => {
    // One critical listed, two moderates not. A scalar cannot say which row is which.
    const unlisted = countUnlistedBySeverity(pnpmMixed);

    expect(unlisted.moderate).toBe(2);
    expect(unlisted.critical).toBe(0);
  });

  it('measures the threshold gap the same way on a real before/after pair', () => {
    // Both fixtures are the same dependency tree and the same command; only `--audit-level high`
    // differs. The counts are identical, so the whole difference is which advisories got listed.
    expect(pnpmBelowThreshold.metadata?.vulnerabilities).toEqual(
      pnpmSameTreeUnfiltered.metadata?.vulnerabilities,
    );
    expect(countUnlisted(pnpmBelowThreshold)).toBe(1);
    expect(countUnlisted(pnpmSameTreeUnfiltered)).toBe(0);
  });

  it('never returns a negative when more is listed than counted', () => {
    // A package manager counting vulnerable PATHS while listing one entry per advisory would
    // produce this. GUARD: dropping `Math.max(0, …)` breaks it.
    const unlisted = countUnlistedBySeverity({
      advisories: { a: { severity: 'high' }, b: { severity: 'high' } },
      metadata: { vulnerabilities: { high: 1 } },
    });

    expect(unlisted.high).toBe(0);
  });

  it('survives malformed and empty input without throwing', () => {
    expect(sumSeverities(countUnlistedBySeverity(null))).toBe(0);
    expect(sumSeverities(countUnlistedBySeverity(undefined))).toBe(0);
    expect(sumSeverities(countUnlistedBySeverity({ advisories: { a: {} } }))).toBe(0);
    expect(countUnlistedBySeverity({ advisories: [] })).toHaveProperty('critical', 0);
  });
});

describe('assessedSeverities', () => {
  const counts = { critical: 0, high: 1, info: 0, low: 0, moderate: 0 };
  const unlisted = { critical: 0, high: 1, info: 0, low: 0, moderate: 0 };

  it('dims a fully-unlisted severity when the gate passed and a suppression is configured', () => {
    expect([...assessedSeverities({ blocking: false, counts, suppressions: 1, unlisted })]).toEqual([
      'high',
    ]);
  });

  it('never dims on a failing gate', () => {
    // Dimming says "you already looked at this"; on a red run that is the wrong thing to say.
    // GUARD: removing the `blocking` term makes this pass a dimmed 'high'.
    const dim = assessedSeverities({ blocking: true, counts, suppressions: 1, unlisted });

    expect(dim.has('high')).toBe(false);
    expect(dim.size).toBe(0);
  });

  it('never dims when nothing is suppressed, because then nobody assessed anything', () => {
    // This is the below-threshold case: the finding is unlisted only because pnpm's default
    // `--audit-level` of `low` excluded it. Dimming it would claim an assessment that never
    // happened. GUARD: removing the `suppressions` term makes this pass a dimmed 'high'.
    const dim = assessedSeverities({ blocking: false, counts, suppressions: 0, unlisted });

    expect(dim.has('high')).toBe(false);
    expect(dim.size).toBe(0);
  });

  it('keeps a severity loud while any of its findings are still listed', () => {
    const dim = assessedSeverities({
      blocking: false,
      counts: { ...counts, high: 2 },
      suppressions: 1,
      unlisted,
    });

    expect(dim.has('high')).toBe(false);
  });
});

describe('renderVulnLine', () => {
  it('calms an assessed finding to yellow, but never hides it in grey', () => {
    // Grey reads as "done" and lets a suppression age out of sight — one sat five weeks obsolete
    // in a sibling repo because its backport shipped the day after the assessment. Yellow removes
    // the alarm (the original defect was a permanent RED next to a green gate) without removing
    // the finding from view.
    // GUARD: rendering assessed severities with C.dim makes the yellow assertion fail.
    const line = renderVulnLine({
      blocking: false,
      counts: pnpmSuppressedHigh.metadata?.vulnerabilities,
      suppressions: 1,
      unlisted: countUnlistedBySeverity(pnpmSuppressedHigh),
    });

    expect(stripAnsi(line)).toContain('(1 high not listed)');
    expect(coloured(line, YELLOW, 'high')).toBe(true);
    expect(coloured(line, DIM, 'high')).toBe(false);
    expect(coloured(line, RED, 'high')).toBe(false);
  });

  it('keeps a below-threshold finding loud and still says it is not listed', () => {
    // The measured document-analyzer case: no suppression configured anywhere.
    const line = renderVulnLine({
      blocking: false,
      counts: pnpmBelowThreshold.metadata?.vulnerabilities,
      suppressions: 0,
      unlisted: countUnlistedBySeverity(pnpmBelowThreshold),
    });

    expect(coloured(line, YELLOW, 'moderate')).toBe(true);
    expect(stripAnsi(line)).toContain('(1 moderate not listed)');
  });

  it('leaves a real critical red when the package manager reports no advisories', () => {
    const line = renderVulnLine({
      blocking: false,
      counts: npmV2WithCritical.metadata?.vulnerabilities,
      suppressions: 3,
      unlisted: countUnlistedBySeverity(npmV2WithCritical),
    });

    expect(coloured(line, RED, 'critical')).toBe(true);
    expect(stripAnsi(line)).not.toContain('not listed');
    expect(stripAnsi(line)).toContain('critical 1');
  });

  it('names the severities so a mixed line cannot be misread', () => {
    // Without attribution this rendered `critical 1 · moderate 2 (2 not listed)`, which invites
    // the reader to conclude the critical is the handled one.
    const line = renderVulnLine({
      blocking: false,
      counts: pnpmMixed.metadata?.vulnerabilities,
      suppressions: 1,
      unlisted: countUnlistedBySeverity(pnpmMixed),
    });

    expect(stripAnsi(line)).toContain('(2 moderate not listed)');
    expect(coloured(line, RED, 'critical')).toBe(true);
  });

  it('appends no annotation at all when nothing is unlisted', () => {
    const line = renderVulnLine({
      blocking: false,
      counts: pnpmClean.metadata?.vulnerabilities,
      suppressions: 0,
      unlisted: countUnlistedBySeverity(pnpmClean),
    });

    expect(stripAnsi(line)).toBe('critical 0 · high 0 · moderate 0 · low 0 · info 0');
  });

  it('does not throw on a missing or partial audit record', () => {
    expect(stripAnsi(renderVulnLine({}))).toContain('critical 0');
    expect(stripAnsi(renderVulnLine({ counts: { high: 2 } }))).toContain('high 2');
    expect(stripAnsi(renderVulnLine({ counts: { bogus: 9, high: 1 } }))).not.toContain('NaN');
  });
});

describe('countSuppressions', () => {
  /** Write a throwaway workspace manifest and count what `countSuppressions` finds in it. */
  function withWorkspace(yaml: string): number {
    const dir = mkdtempSync(join(tmpdir(), 'lt-audit-'));
    try {
      writeFileSync(join(dir, 'pnpm-workspace.yaml'), yaml);
      return countSuppressions(dir);
    } finally {
      rmSync(dir, { force: true, recursive: true });
    }
  }

  it('counts entries nested under `auditConfig:`, which is where every real workspace puts them', () => {
    // REGRESSION: the first implementation searched by character offset, so the `ignoreGhsas:`
    // line itself landed first in the "subsequent lines" scan, failed the entry test, and broke
    // the loop at once — returning 0 for every nested key. It only ever worked when the key sat
    // at the very top of the file, which is the one place it never sits.
    // GUARD: changing `lines.slice(keyIdx + 1)` to `lines.slice(keyIdx)` breaks this.
    expect(
      withWorkspace(
        'auditConfig:\n  ignoreGhsas:\n    - GHSA-aaaa-bbbb-cccc\n    - GHSA-dddd-eeee-ffff\n',
      ),
    ).toBe(2);
  });

  it('counts a block at the top level too', () => {
    expect(withWorkspace('ignoreGhsas:\n  - GHSA-aaaa-bbbb-cccc\n  - GHSA-dddd-eeee-ffff\n')).toBe(
      2,
    );
  });

  it('counts the inline list form', () => {
    expect(withWorkspace('auditConfig:\n  ignoreGhsas: [GHSA-aaaa-bbbb-cccc]\n')).toBe(1);
  });

  it('does not count a retired suppression documented in a comment', () => {
    // The sibling base repos keep the history of a WITHDRAWN suppression right under an empty
    // key. Counting those would claim an assessment that was explicitly taken back — the very
    // inversion this accounting exists to prevent.
    const yaml =
      'auditConfig:\n  ignoreGhsas: []\n  # GHSA-mh99-v99m-4gvg removed 2026-08-22, backport shipped\n';

    expect(withWorkspace(yaml)).toBe(0);
  });

  it('skips comments and blank lines between entries without ending the block', () => {
    const yaml =
      'auditConfig:\n  ignoreGhsas:\n    - GHSA-aaaa-bbbb-cccc\n\n    # why the next one is here\n    - GHSA-dddd-eeee-ffff\n';

    expect(withWorkspace(yaml)).toBe(2);
  });

  it('stops at the first line that is neither an entry nor a comment', () => {
    const yaml =
      'auditConfig:\n  ignoreGhsas:\n    - GHSA-aaaa-bbbb-cccc\noverrides:\n  - GHSA-not-a-suppression\n';

    expect(withWorkspace(yaml)).toBe(1);
  });

  it('reports none for this repo, which declares no auditConfig', () => {
    expect(countSuppressions(new URL('..', import.meta.url).pathname)).toBe(0);
  });

  it('reports none for a directory with no manifest at all', () => {
    expect(countSuppressions('/nonexistent-path-for-test')).toBe(0);
  });
});

describe('isAuditEndpointUnavailable', () => {
  /** pnpm's own error envelope, as `pnpm audit --json` emits it when the request fails. */
  const envelope = (code: number | string, message: string) =>
    JSON.stringify({ error: { code, message } }, null, 2);

  it('degrades the retired legacy endpoint', () => {
    // The cause is returned, not just "yes": "retired" needs a pnpm upgrade, "unreachable" needs
    // patience, and a reader given a neutral message waits forever in the first case.
    expect(isAuditEndpointUnavailable('ERR_PNPM_AUDIT_BAD_RESPONSE  bad response')).toBe('retired');
    expect(isAuditEndpointUnavailable('The audit endpoint has been retired')).toBe('retired');
  });

  it('degrades a transient failure of the working endpoint', () => {
    // OBSERVED 2026-09-04: /-/npm/v1/security/advisories/bulk answered 503 while
    // registry.npmjs.org answered 200. This exact envelope failed the check in this repo.
    expect(isAuditEndpointUnavailable(envelope(23, 'The operation was aborted due to timeout'))).toBe(
      'unreachable',
    );
    expect(isAuditEndpointUnavailable(envelope('ETIMEDOUT', 'connect ETIMEDOUT'))).toBe(
      'unreachable',
    );
    expect(isAuditEndpointUnavailable(envelope(503, 'Service Unavailable'))).toBe('unreachable');
  });

  it('does NOT degrade an auth or registry-config failure', () => {
    // A 401/403 is something the developer can actually fix (token, registry setting), so it has
    // to stay red rather than pass as "outage".
    //
    // Honest note on these three: they would return false even WITHOUT the auth branch, because
    // "401 Unauthorized" matches none of the infrastructure signatures either. They pin the
    // intended behaviour, not the branch. The case below is the one that pins the branch.
    expect(isAuditEndpointUnavailable(envelope(401, 'Unauthorized'))).toBe(false);
    expect(isAuditEndpointUnavailable(envelope(403, 'Forbidden'))).toBe(false);
    expect(isAuditEndpointUnavailable(envelope('E403', 'authentication required'))).toBe(false);
  });

  it('keeps an auth failure fatal even when it also reports an upstream 5xx', () => {
    // THIS is what the auth branch is for, and the only shape where it is load-bearing: a proxy
    // or mirror that rejects the request itself while quoting an upstream status. Without the
    // branch, `\b5\d\d\b` matches the quoted 503 and a fixable credentials problem silently
    // degrades into "infrastructure, not blocking" — the developer never learns their token is
    // wrong, and the audit stops running for good.
    // GUARD: deleting the 401/403/407 branch makes both of these return true.
    expect(isAuditEndpointUnavailable(envelope(403, 'Forbidden: upstream returned 503'))).toBe(
      false,
    );
    expect(
      isAuditEndpointUnavailable(envelope(407, 'Proxy Authentication Required (504 upstream)')),
    ).toBe(false);
  });

  it('accepts a 5xx as a status, not as any number that happens to be 5xx', () => {
    // A bare 5xx is ambiguous in free text. Both of these describe a REAL failure that must stay
    // fatal, and both used to degrade into "infrastructure, not blocking" — turning a genuine
    // audit error into a warning nobody acts on.
    // GUARD: matching \b5\d\d\b anywhere in the message makes these return true.
    expect(isAuditEndpointUnavailable(envelope(1, 'audit failed after auditing 503 packages'))).toBe(
      false,
    );
    expect(isAuditEndpointUnavailable(envelope(1, 'gave up after 504 ms'))).toBe(false);
    expect(isAuditEndpointUnavailable(envelope(1, 'processed 512 advisories then failed'))).toBe(
      false,
    );

    // ...while a 5xx that really is a status still degrades, from the code field or with HTTP
    // context around it. GUARD: reading 5xx from `code` only would lose the last two.
    expect(isAuditEndpointUnavailable(envelope(503, 'Service Unavailable'))).toBe('unreachable');
    expect(isAuditEndpointUnavailable(envelope('ERR_HTTP', '502 Bad Gateway'))).toBe('unreachable');
    expect(isAuditEndpointUnavailable(envelope(1, 'request failed with status 503'))).toBe(
      'unreachable',
    );
  });

  it('does NOT degrade a real finding or an unexplained failure', () => {
    // A report WITH a tally is a real result, whatever else it says.
    expect(
      isAuditEndpointUnavailable(
        JSON.stringify({ advisories: {}, metadata: { vulnerabilities: { critical: 1 } } }),
      ),
    ).toBe(false);
    expect(isAuditEndpointUnavailable('something else went wrong')).toBe(false);
    expect(isAuditEndpointUnavailable('')).toBe(false);
    expect(isAuditEndpointUnavailable(undefined)).toBe(false);
  });
});

describe('auditOutcome', () => {
  const tally = { critical: 0, high: 0, info: 0, low: 0, moderate: 0 };
  const timeout = JSON.stringify({ error: { code: 23, message: 'aborted due to timeout' } });

  it('reports a real tally as ok', () => {
    expect(auditOutcome({ code: 0, counts: tally, out: '{}' })).toBe('ok');
  });

  it('never calls a zero exit without a tally "ok"', () => {
    // THE BUG THIS FUNCTION WAS ADDED FOR. `pnpm audit` exiting 0 while printing something we
    // cannot parse used to fall through every branch: not blocking (exit was 0), not degraded
    // (that required a non-zero exit) — and the step printed a green tick with a literal "0".
    // A tick means "checked, nothing found"; this state is "could not read anything".
    // GUARD: `return counts ? 'ok' : 'unreadable'` collapsing to `return 'ok'` breaks this.
    expect(auditOutcome({ code: 0, counts: null, out: 'npm warn using --force\nnot json' })).toBe(
      'unreadable',
    );
    expect(auditOutcome({ code: 0, counts: null, out: '' })).toBe('unreadable');
  });

  it('keeps a genuine failure blocking', () => {
    // ORDER GUARD: judging `!counts` before the exit code — the obvious simplification — would
    // turn every real audit failure into a warning, because a failed run has no tally either.
    expect(auditOutcome({ code: 1, counts: null, out: 'something broke' })).toBe('blocked');
    expect(auditOutcome({ code: 1, counts: null, out: '{"error":{"code":401}}' })).toBe('blocked');
  });

  it('degrades a failure that carries an outage signature', () => {
    expect(auditOutcome({ code: 1, counts: null, out: timeout })).toBe('unreachable');
  });

  it('keeps a failure fatal even when it did report a tally', () => {
    // A non-zero exit WITH counts is a real finding set — the audit ran and found something.
    expect(auditOutcome({ code: 1, counts: { ...tally, critical: 1 }, out: '{}' })).toBe('blocked');
  });
});

describe('isAuditResultAmbiguous', () => {
  const zero = { critical: 0, high: 0, info: 0, low: 0, moderate: 0 };

  it('flags an all-zero report, because an outage produces exactly that', () => {
    // MEASURED: connection refused, dead DNS and a 502 all make `pnpm audit --json` exit 0 with
    // this exact shape. It is byte-identical to a genuinely clean tree, so the report alone
    // cannot answer the question — the caller has to ask the service.
    expect(isAuditResultAmbiguous({ advisories: {}, metadata: { vulnerabilities: zero } })).toBe(
      true,
    );
  });

  it('never flags a report that carries findings, because findings prove the service answered', () => {
    // GUARD: dropping the `Object.keys(advisories).length > 0` early return makes this true and
    // costs every repo with findings a needless network call on every run.
    expect(
      isAuditResultAmbiguous({
        advisories: { a: { severity: 'high' } },
        metadata: { vulnerabilities: { ...zero, high: 1 } },
      }),
    ).toBe(false);
    // Counts without listed advisories are still findings — suppressed ones. Not ambiguous.
    expect(
      isAuditResultAmbiguous({ advisories: {}, metadata: { vulnerabilities: { ...zero, high: 1 } } }),
    ).toBe(false);
  });

  it('trusts listed advisories over an all-zero tally when the two disagree', () => {
    // The only shape where the `advisories.length > 0` early return is load-bearing: a report
    // that lists an advisory while its tally reads zero. Everything else is already caught by the
    // all-zero test below it — which is exactly why the obvious test for this guard passes with
    // the guard deleted, and this one does not.
    // GUARD: removing `if (Object.keys(advisories).length > 0) return false` makes this true, and
    // a clean-looking run would then pay a needless network call on a report that already proved
    // the service answered.
    expect(
      isAuditResultAmbiguous({
        advisories: { 1158508: { severity: 'moderate' } },
        metadata: { vulnerabilities: zero },
      }),
    ).toBe(false);
  });

  it('is not ambiguous when there is no report to judge', () => {
    expect(isAuditResultAmbiguous(undefined)).toBe(false);
    expect(isAuditResultAmbiguous({ metadata: { vulnerabilities: zero } })).toBe(false);
    expect(isAuditResultAmbiguous({ advisories: {} })).toBe(false);
  });
});

describe('advisoryBulkUrl', () => {
  it('asks the registry pnpm actually uses, not npmjs.org', () => {
    // The false-green the probe exists to prevent, reproduced INSIDE the remedy: behind a private
    // registry, pnpm fails silently against its own while a hard-wired probe asks npmjs.org,
    // npmjs.org answers, and the run prints a green tick. Both sibling repos shipped that bug.
    expect(advisoryBulkUrl('https://npm.internal.example/')).toBe(
      'https://npm.internal.example/-/npm/v1/security/advisories/bulk',
    );
    expect(advisoryBulkUrl('https://npm.internal.example')).toBe(
      'https://npm.internal.example/-/npm/v1/security/advisories/bulk',
    );
  });

  it('falls back to npmjs.org for anything that is not an absolute URL', () => {
    // `pnpm config get registry` can return '', an error, or a scoped-registry line. A malformed
    // value must degrade to the old behaviour — a URL that always throws would report every clean
    // repo as an outage, which is the failure mode inverted.
    for (const bad of ['', '   ', 'undefined', 'not-a-url', undefined, null, 42]) {
      expect(advisoryBulkUrl(bad as never)).toBe(
        'https://registry.npmjs.org/-/npm/v1/security/advisories/bulk',
      );
    }
  });
});

describe('auditOutcome with a silent outage', () => {
  const zero = { critical: 0, high: 0, info: 0, low: 0, moderate: 0 };

  it('reports an unreachable service even though the report looks perfectly healthy', () => {
    // GUARD: dropping the `silentOutage` branch returns 'ok' here — a green tick for a run that
    // verified nothing. This is the deepest false-green of the set.
    expect(auditOutcome({ code: 0, counts: zero, out: '{}', silentOutage: true })).toBe(
      'unreachable',
    );
    expect(auditOutcome({ code: 0, counts: zero, out: '{}', silentOutage: false })).toBe('ok');
  });
});

describe('configuredRegistry', () => {
  it('prefers the environment, because that is what pnpm audit actually honours', () => {
    // MEASURED, and it is why the probe silently did nothing at first: `pnpm audit` honours
    // `npm_config_registry` from the environment while `pnpm config get registry` reports the
    // file/default value instead. A probe built only on `pnpm config get` therefore asks a host
    // the audit never contacted, gets a confident answer, and concludes "no outage" — the same
    // false-green the probe exists to prevent, one layer further in.
    const previous = process.env.npm_config_registry;
    try {
      process.env.npm_config_registry = 'http://127.0.0.1:9/';
      expect(configuredRegistry()).toBe('http://127.0.0.1:9/');
      expect(advisoryBulkUrl(configuredRegistry())).toBe(
        'http://127.0.0.1:9/-/npm/v1/security/advisories/bulk',
      );
    } finally {
      if (previous === undefined) delete process.env.npm_config_registry;
      else process.env.npm_config_registry = previous;
    }
  });

  it('falls back to the resolved config when the environment says nothing', () => {
    const previous = process.env.npm_config_registry;
    try {
      delete process.env.npm_config_registry;
      expect(configuredRegistry()).toMatch(/^https?:\/\//);
    } finally {
      if (previous !== undefined) process.env.npm_config_registry = previous;
    }
  });
});
