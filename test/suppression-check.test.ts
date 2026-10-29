/**
 * `scripts/check-suppressions.mjs` — every `auditConfig.ignoreGhsas` entry is re-checked against
 * the GitHub Advisory Database, so a suppression cannot outlive its reason unnoticed. pnpm drops
 * suppressed advisories from `pnpm audit --json`, so without this nothing ever says so.
 *
 * Network access is injected, so every verdict runs offline. The advisory shapes are the REST
 * API's (`GET /advisories/{ghsa_id}`): `withdrawn_at`, and `vulnerabilities[]` with
 * `package.{ ecosystem, name }` and `first_patched_version` as a string or null. The node-forge
 * advisory GHSA-86w9-cpqp-85rv returned exactly that shape on 2026-10-02, with
 * `first_patched_version: null`, while `pnpm audit` named ">=1.4.1" and the registry answered 404
 * for 1.4.1 — the case `fix-unpublished` exists for. On 2026-10-28 it still read null, a day after
 * 1.4.1 and 1.4.2 were published — the case the registry-derived fix exists for. The registry
 * shape is the full packument's (`GET registry.npmjs.org/{name}`): `versions` with an optional
 * `deprecated`, and `time` with ISO publish dates.
 *
 * Each guard has a case here that fails when the guard is removed.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

import { listSuppressions } from '../scripts/lib/audit-report.mjs';
import {
  assessSuppression,
  createAdvisoryFetcher,
  createNpmPackumentFetcher,
  exitCodeFor,
  inVulnerableRange,
  minimumReleaseAgeOf,
  parseSuppressionSummary,
  patchedVersionOf,
  resolvedVersions,
  summaryLine,
} from '../scripts/lib/suppression-check.mjs';

const ID = 'GHSA-86w9-cpqp-85rv';

/** When the suite pretends to run: 2026-10-28 12:00 UTC, the day GHSA-86w9 still named no fix. */
const NOW = Date.parse('2026-10-28T12:00:00Z');

/** node-forge's real publish times, read from registry.npmjs.org/node-forge on 2026-10-28. */
const FORGE_TIME = {
  '1.4.0': '2026-03-24T21:44:34.668Z',
  '1.4.1': '2026-10-27T04:44:07.718Z',
  '1.4.2': '2026-10-27T14:09:15.471Z',
};

function npm(name: string, firstPatched: unknown, range = '<= 1.4.0') {
  return { first_patched_version: firstPatched, package: { ecosystem: 'npm', name }, vulnerable_version_range: range };
}

/** A packument with `versions`, each published in 2020 unless `time` says otherwise. */
function registry(versions: string[], { deprecated = [], time = {} }: { deprecated?: string[]; time?: Record<string, string> } = {}) {
  return {
    time: Object.fromEntries(versions.map((v) => [v, time[v] ?? '2020-01-01T00:00:00Z'])),
    versions: Object.fromEntries(versions.map((v) => [v, deprecated.includes(v) ? { deprecated: 'do not use' } : {}])),
  };
}

function deps({
  advisory,
  fetchFails,
  gate = 1440,
  locked = ['1.4.0'],
  now = NOW,
  packument = registry(['1.4.0']),
}: {
  advisory?: unknown;
  fetchFails?: string;
  gate?: number;
  locked?: string[] | null;
  now?: number;
  packument?: ReturnType<typeof registry> | null;
}) {
  const npmPackument = vi.fn(async (_name: string) => packument);
  const fetchAdvisory = vi.fn(async () => (fetchFails ? { ok: false as const, reason: fetchFails } : { advisory, ok: true as const }));
  const lockedVersions = vi.fn(() => locked);
  return { fetchAdvisory, lockedVersions, minimumReleaseAgeMinutes: gate, now, npmPackument };
}

describe('assessSuppression', () => {
  it('still holds while no release on the registry lies outside the vulnerable range', async () => {
    const d = deps({ advisory: { vulnerabilities: [npm('node-forge', null)], withdrawn_at: null }, packument: registry(['1.3.3', '1.4.0']) });
    const r = await assessSuppression(ID, d);
    expect(r.status).toBe('unfixable');
  });

  it('still holds while the named fix is not on the registry (the node-forge 1.4.1 case)', async () => {
    const d = deps({ advisory: { vulnerabilities: [npm('node-forge', '1.4.1')] } });
    const r = await assessSuppression(ID, d);
    expect(r).toMatchObject({ detail: expect.stringContaining('node-forge@1.4.1'), status: 'fix-unpublished' });
    expect(d.npmPackument).toHaveBeenCalledWith('node-forge');
  });

  it('fails once the named fix is published', async () => {
    const d = deps({ advisory: { vulnerabilities: [npm('node-forge', '1.4.1')] }, packument: registry(['1.4.0', '1.4.1']) });
    const r = await assessSuppression(ID, d);
    expect(r).toMatchObject({ detail: 'node-forge@1.4.1 is published', status: 'fix-available' });
  });

  it('fails when the advisory was withdrawn, fix or not', async () => {
    const r = await assessSuppression(ID, deps({ advisory: { vulnerabilities: [npm('node-forge', null)], withdrawn_at: '2026-11-01T00:00:00Z' } }));
    expect(r.status).toBe('withdrawn');
  });

  it('is unverified, never "still holds", when the advisory cannot be fetched', async () => {
    const r = await assessSuppression(ID, deps({ fetchFails: 'GitHub Advisory API unreachable (ENOTFOUND)' }));
    expect(r).toMatchObject({ detail: 'GitHub Advisory API unreachable (ENOTFOUND)', status: 'unverified' });
  });

  it('is unverified when the registry cannot be asked', async () => {
    const r = await assessSuppression(ID, deps({ advisory: { vulnerabilities: [npm('node-forge', '1.4.1')] }, packument: null }));
    expect(r).toMatchObject({ detail: expect.stringContaining('node-forge'), status: 'unverified' });
  });

  it('ignores vulnerabilities of other ecosystems', async () => {
    const pip = { first_patched_version: '9.9.9', package: { ecosystem: 'pip', name: 'forge' } };
    const d = deps({ advisory: { vulnerabilities: [pip, npm('node-forge', null)] } });
    const r = await assessSuppression(ID, d);
    expect(r.status).toBe('unfixable');
    expect(d.npmPackument.mock.calls).toEqual([['node-forge']]);
  });

  it('fails when the vulnerable package no longer resolves in the vulnerable range (the image-size case)', async () => {
    const r = await assessSuppression(ID, deps({ advisory: { vulnerabilities: [npm('node-forge', null)] }, locked: ['1.5.0'] }));
    expect(r).toMatchObject({ detail: expect.stringContaining('node-forge@1.5.0'), status: 'not-present' });
  });

  it('fails when the package left the tree altogether, even without any fix', async () => {
    const r = await assessSuppression(ID, deps({ advisory: { vulnerabilities: [npm('node-forge', null)] }, locked: [] }));
    expect(r.status).toBe('not-present');
  });

  it('is unverified when the lockfile cannot be read', async () => {
    const r = await assessSuppression(ID, deps({ advisory: { vulnerabilities: [npm('node-forge', null)] }, locked: null }));
    expect(r).toMatchObject({ detail: 'could not read pnpm-lock.yaml', status: 'unverified' });
  });

  it('is unverified when the vulnerable range cannot be read', async () => {
    const odd = { ...npm('node-forge', null), vulnerable_version_range: 'some day' };
    const r = await assessSuppression(ID, deps({ advisory: { vulnerabilities: [odd] } }));
    expect(r.status).toBe('unverified');
  });

  it('is unverified when the advisory names no npm package at all', async () => {
    const pip = { first_patched_version: null, package: { ecosystem: 'pip', name: 'forge' } };
    const r = await assessSuppression(ID, deps({ advisory: { vulnerabilities: [pip] } }));
    expect(r.status).toBe('unverified');
  });
});

describe('assessSuppression — a fix the advisory does not name, and the release-age gate', () => {
  const forge = { vulnerabilities: [npm('node-forge', null)] };

  it('fails on a published fix although first_patched_version is null (GHSA-86w9, 2026-10-28)', async () => {
    const d = deps({ advisory: forge, packument: registry(['1.4.0', '1.4.1', '1.4.2'], { time: FORGE_TIME }) });
    const r = await assessSuppression(ID, d);
    expect(r).toMatchObject({ detail: expect.stringContaining('node-forge@1.4.1'), status: 'fix-available' });
    expect(r.detail).toContain('names no patched version');
  });

  it('still holds while the fix is younger than the gate, and says when it clears', async () => {
    // 2026-10-27 10:00 UTC: 1.4.1 was five hours old and 1.4.2 not yet published.
    const now = Date.parse('2026-10-27T10:00:00Z');
    const d = deps({ advisory: forge, now, packument: registry(['1.4.0', '1.4.1'], { time: FORGE_TIME }) });
    const r = await assessSuppression(ID, d);
    expect(r).toMatchObject({ detail: expect.stringContaining('until 2026-10-28 04:44 UTC'), status: 'fix-in-quarantine' });
    expect(r.detail).toContain('24h minimumReleaseAge gate');
    expect(exitCodeFor([r], { ci: true, token: true })).toBe(0);
  });

  it('honours the configured gate in both directions', async () => {
    const packument = registry(['1.4.0', '1.4.1', '1.4.2'], { time: FORGE_TIME });
    const week = await assessSuppression(ID, deps({ advisory: forge, gate: 10_080, packument }));
    expect(week).toMatchObject({ detail: expect.stringContaining('7d'), status: 'fix-in-quarantine' });

    const none = await assessSuppression(ID, deps({ advisory: forge, gate: 0, now: Date.parse('2026-10-27T05:00:00Z'), packument }));
    expect(none.status).toBe('fix-available');
  });

  it('holds a named fix to the same gate', async () => {
    const now = Date.parse('2026-10-27T10:00:00Z');
    const d = deps({ advisory: { vulnerabilities: [npm('node-forge', '1.4.1')] }, now, packument: registry(['1.4.0', '1.4.1'], { time: FORGE_TIME }) });
    expect((await assessSuppression(ID, d)).status).toBe('fix-in-quarantine');
  });

  it('skips pre-releases, and passes over a deprecated release while a current one fixes it', async () => {
    const packument = registry(['1.4.0', '1.4.1-rc.1', '1.4.1', '1.4.2'], { deprecated: ['1.4.1'] });
    const r = await assessSuppression(ID, deps({ advisory: forge, packument }));
    expect(r).toMatchObject({ detail: expect.stringContaining('node-forge@1.4.2'), status: 'fix-available' });
  });

  it('takes a deprecated release when every release that fixes it is deprecated (the node-sass case)', async () => {
    // node-sass, 2026-10-29: all 132 stable releases deprecated, GHSA-r8f7-9pfq-mjmv fixed in 7.0.0.
    const sass = { vulnerabilities: [npm('node-sass', '7.0.0', '>= 2.0.0, < 7.0.0')] };
    const packument = registry(['6.0.1', '7.0.0', '9.0.0'], { deprecated: ['6.0.1', '7.0.0', '9.0.0'] });
    const r = await assessSuppression(ID, deps({ advisory: sass, locked: ['6.0.1'], packument }));
    expect(r).toMatchObject({ detail: expect.stringContaining('node-sass@7.0.0 is published'), status: 'fix-available' });
    expect(r.detail).toContain('deprecated');
  });

  it('takes only a release outside EVERY range of the package', async () => {
    const twoLines = { vulnerabilities: [npm('node-forge', null, '< 1.4.2'), npm('node-forge', null, '>= 1.5.0, < 1.5.3')] };
    const r = await assessSuppression(ID, deps({ advisory: twoLines, packument: registry(['1.4.0', '1.5.0', '1.5.3']) }));
    expect(r).toMatchObject({ detail: expect.stringContaining('node-forge@1.5.3'), status: 'fix-available' });
  });

  it('never goes below a named first patched version', async () => {
    const named = { vulnerabilities: [npm('node-forge', '1.4.2')] };
    const r = await assessSuppression(ID, deps({ advisory: named, packument: registry(['1.4.0', '1.4.1', '1.4.2']) }));
    expect(r).toMatchObject({ detail: 'node-forge@1.4.2 is published', status: 'fix-available' });
  });

  it('keeps the entry while one vulnerable copy has no fix, even when another has', async () => {
    const twoLines = { vulnerabilities: [npm('node-forge', null), npm('node-forge', null, '>= 2.0.0, < 2.0.5')] };
    const d = deps({ advisory: twoLines, locked: ['1.4.0', '2.0.1'], packument: registry(['1.4.0', '1.4.1', '2.0.1']) });
    const r = await assessSuppression(ID, d);
    expect(r).toMatchObject({ detail: expect.stringContaining('above 2.0.1'), status: 'unfixable' });
    expect(d.npmPackument).toHaveBeenCalledTimes(1);
  });
});

describe('resolvedVersions', () => {
  // Keys as pnpm writes them: plain, quoted with a scope, with a peer suffix, in the snapshots
  // section, and lockfile v6's leading slash. Copied from this repo's own pnpm-lock.yaml shapes.
  const LOCK = [
    'packages:',
    '',
    '  node-forge@1.4.0:',
    "  '@nuxt/kit@4.5.2':",
    '  /left-pad@1.3.0:',
    '',
    'snapshots:',
    '',
    "  '@nuxt/kit@4.5.2(magic-string@1.4.2)(rolldown@1.2.11)':",
    '  node-forge@1.4.0: {}',
    '  node-forge-extra@9.9.9: {}',
    '    node-forge: 1.4.0',
  ].join('\n');

  it('reads every version of the named package, and only of that package', () => {
    expect(resolvedVersions(LOCK, 'node-forge')).toEqual(['1.4.0']);
    expect(resolvedVersions(LOCK, '@nuxt/kit')).toEqual(['4.5.2']);
    expect(resolvedVersions(LOCK, 'left-pad')).toEqual(['1.3.0']);
    expect(resolvedVersions(LOCK, 'absent')).toEqual([]);
  });

  it('finds deepmerge 4.3.1 (the suppressed package) in this repo\'s real lockfile', () => {
    const lock = readFileSync(resolve(process.cwd(), 'pnpm-lock.yaml'), 'utf8');
    expect(resolvedVersions(lock, 'deepmerge')).toContain('4.3.1');
  });
});

describe('inVulnerableRange', () => {
  it('honours every operator at its boundary', () => {
    expect(inVulnerableRange('1.4.0', '<= 1.4.0')).toBe(true);
    expect(inVulnerableRange('1.4.1', '<= 1.4.0')).toBe(false);
    expect(inVulnerableRange('1.4.0', '< 1.4.0')).toBe(false);
    expect(inVulnerableRange('2.1.3', '>= 2.0.0, < 2.1.4')).toBe(true);
    expect(inVulnerableRange('2.1.4', '>= 2.0.0, < 2.1.4')).toBe(false);
    expect(inVulnerableRange('1.9.9', '>= 2.0.0, < 2.1.4')).toBe(false);
    expect(inVulnerableRange('1.2.3', '= 1.2.3')).toBe(true);
    expect(inVulnerableRange('0.9.0', '< 1.0')).toBe(true);
  });

  it('counts a pre-release as its release, the direction that keeps the entry', () => {
    expect(inVulnerableRange('1.4.0-beta.1', '<= 1.4.0')).toBe(true);
  });

  it('says it cannot tell instead of guessing', () => {
    expect(inVulnerableRange('1.0.0', 'some day')).toBeNull();
    expect(inVulnerableRange('latest', '< 1.0.0')).toBeNull();
    expect(inVulnerableRange('1.0.0', '')).toBeNull();
  });
});

describe('patchedVersionOf', () => {
  it('reads the REST string and the GraphQL { identifier } shape, and nothing else', () => {
    expect(patchedVersionOf({ first_patched_version: '1.4.1' })).toBe('1.4.1');
    expect(patchedVersionOf({ first_patched_version: { identifier: '1.4.1' } })).toBe('1.4.1');
    expect(patchedVersionOf({ first_patched_version: null })).toBeNull();
    expect(patchedVersionOf({ first_patched_version: '  ' })).toBeNull();
  });
});

describe('exitCodeFor', () => {
  const holds = { detail: '', id: ID, status: 'unfixable' };
  const unverified = { detail: '', id: ID, status: 'unverified' };

  it('fails on an obsolete suppression, locally and in CI, with or without a token', () => {
    for (const status of ['fix-available', 'not-present', 'withdrawn']) {
      expect(exitCodeFor([holds, { detail: '', id: ID, status }], { ci: false, token: false })).toBe(1);
      expect(exitCodeFor([holds, { detail: '', id: ID, status }], { ci: true, token: false })).toBe(1);
    }
  });

  it('fails an unverified entry only in CI with a token, where the lookup should have worked', () => {
    expect(exitCodeFor([unverified], { ci: true, token: true })).toBe(1);
    // Shared-runner IP quota: without a token, rate limits are expected and must not red a pipeline.
    expect(exitCodeFor([unverified], { ci: true, token: false })).toBe(0);
    expect(exitCodeFor([unverified], { ci: false, token: true })).toBe(0);
  });

  it('passes when every entry still holds, including an unpublished or a maturing fix', () => {
    expect(exitCodeFor([holds, { detail: '', id: ID, status: 'fix-unpublished' }], { ci: true, token: true })).toBe(0);
    expect(exitCodeFor([holds, { detail: '', id: ID, status: 'fix-in-quarantine' }], { ci: true, token: true })).toBe(0);
    expect(exitCodeFor([], { ci: true, token: true })).toBe(0);
  });
});

describe('summaryLine / parseSuppressionSummary', () => {
  it('round-trips every state', () => {
    const r = (status: string) => ({ detail: '', id: ID, status });
    expect(parseSuppressionSummary(summaryLine([]))).toEqual({ count: 0, state: 'none', total: 0 });
    expect(parseSuppressionSummary(summaryLine([r('unfixable'), r('fix-unpublished')]))).toEqual({ count: 2, state: 'verified', total: 2 });
    expect(parseSuppressionSummary(summaryLine([r('fix-in-quarantine')]))).toEqual({ count: 1, state: 'verified', total: 1 });
    expect(parseSuppressionSummary(summaryLine([r('unfixable'), r('unverified')]))).toEqual({ count: 1, state: 'unverified', total: 2 });
    expect(parseSuppressionSummary(summaryLine([r('unverified'), r('withdrawn')]))).toEqual({ count: 1, state: 'obsolete', total: 2 });
  });

  it('reads nothing as verified when the summary line is missing', () => {
    expect(parseSuppressionSummary('Error: something else entirely')).toBeNull();
  });

  it('survives ANSI colour around the line', () => {
    expect(parseSuppressionSummary('\x1b[2m[suppressions] verified 1 of 1\x1b[22m')).toEqual({ count: 1, state: 'verified', total: 1 });
  });
});

type FetchCall = [url: string, init: { headers: Record<string, string> }];

/** A stand-in for `fetch` that records its calls and answers with a minimal Response. */
function fakeFetch(status: number, body: unknown = {}, headers: Record<string, string> = {}) {
  const calls: FetchCall[] = [];
  const impl = (async (url: string, init: { headers: Record<string, string> }) => {
    calls.push([url, init]);
    return { headers: new Headers(headers), json: async () => body, status };
  }) as unknown as typeof fetch;
  return { calls, impl };
}

/** A `fetch` that fails the way Node's does offline: TypeError with the errno on `cause`. */
const offlineFetch = (async () => {
  throw Object.assign(new TypeError('fetch failed'), { cause: { code: 'ENOTFOUND' } });
}) as unknown as typeof fetch;

describe('createAdvisoryFetcher', () => {
  it('returns the advisory on 200 and sends the token only when given', async () => {
    const f = fakeFetch(200, { ghsa_id: ID });
    expect(await createAdvisoryFetcher({ fetchImpl: f.impl })(ID)).toEqual({ advisory: { ghsa_id: ID }, ok: true });
    expect(f.calls[0]?.[0]).toBe(`https://api.github.com/advisories/${ID}`);
    expect(f.calls[0]?.[1].headers.Authorization).toBeUndefined();

    await createAdvisoryFetcher({ fetchImpl: f.impl, token: 't0k' })(ID);
    expect(f.calls[1]?.[1].headers.Authorization).toBe('Bearer t0k');
  });

  it('names an exhausted rate limit and how to lift it', async () => {
    const f = fakeFetch(403, {}, { 'x-ratelimit-remaining': '0' });
    expect(await createAdvisoryFetcher({ fetchImpl: f.impl })(ID)).toEqual({ ok: false, reason: expect.stringMatching(/rate limit.*GITHUB_TOKEN/) });
  });

  it('reports an unknown id and an unreachable API as failures, not as advisories', async () => {
    expect(await createAdvisoryFetcher({ fetchImpl: fakeFetch(404).impl })(ID)).toMatchObject({ ok: false });
    expect(await createAdvisoryFetcher({ fetchImpl: offlineFetch })(ID)).toEqual({ ok: false, reason: expect.stringContaining('ENOTFOUND') });
  });
});

describe('createNpmPackumentFetcher', () => {
  it('returns versions and publish times on 200, nothing published on 404, null otherwise', async () => {
    const body = { name: 'node-forge', time: FORGE_TIME, versions: { '1.4.0': {}, '1.4.1': {} } };
    expect(await createNpmPackumentFetcher({ fetchImpl: fakeFetch(200, body).impl })('node-forge')).toEqual({
      time: FORGE_TIME,
      versions: body.versions,
    });
    expect(await createNpmPackumentFetcher({ fetchImpl: fakeFetch(404).impl })('node-forge')).toEqual({ time: {}, versions: {} });
    expect(await createNpmPackumentFetcher({ fetchImpl: fakeFetch(503).impl })('node-forge')).toBeNull();
    expect(await createNpmPackumentFetcher({ fetchImpl: fakeFetch(200, { error: 'not a packument' }).impl })('node-forge')).toBeNull();
    expect(await createNpmPackumentFetcher({ fetchImpl: offlineFetch })('node-forge')).toBeNull();
  });

  it('asks for the full packument, the one that carries `time`, with the scope slash encoded', async () => {
    const f = fakeFetch(200, { versions: {} });
    await createNpmPackumentFetcher({ fetchImpl: f.impl })('@scope/pkg');
    expect(f.calls[0]?.[0]).toBe('https://registry.npmjs.org/@scope%2Fpkg');
    // The abbreviated install document (application/vnd.npm.install-v1+json) has no `time`.
    expect(f.calls[0]?.[1].headers.Accept).toBe('application/json');
  });
});

describe('minimumReleaseAgeOf', () => {
  it('reads a top-level minimumReleaseAge and falls back to pnpm 11\'s 24h default', () => {
    expect(minimumReleaseAgeOf('minimumReleaseAge: 10080')).toBe(10_080);
    expect(minimumReleaseAgeOf('packages:\n  - .\nminimumReleaseAge: 0 # off\n')).toBe(0);
    expect(minimumReleaseAgeOf('')).toBe(1440);
    expect(minimumReleaseAgeOf('# minimumReleaseAge: 5')).toBe(1440);
    expect(minimumReleaseAgeOf('nested:\n  minimumReleaseAge: 5')).toBe(1440);
  });

  it('reads this repo\'s workspace as the 24h default, since it sets no gate', () => {
    expect(minimumReleaseAgeOf(readFileSync(resolve(process.cwd(), 'pnpm-workspace.yaml'), 'utf8'))).toBe(1440);
  });
});

describe('listSuppressions', () => {
  it('returns the ids this repo suppresses, in file order', () => {
    // `process.cwd()`, as in check-audit-wiring.test.ts (see the note in audit-report.test.ts).
    expect(listSuppressions(process.cwd())).toEqual(['GHSA-gcqx-w48m-w2h4']);
  });
});

describe('wiring', () => {
  // Source-level, like check-audit-wiring.test.ts: check.mjs runs main() on import.
  const pkg = JSON.parse(readFileSync(resolve(process.cwd(), 'package.json'), 'utf8'));
  const CHECK = readFileSync(resolve(process.cwd(), 'scripts/check.mjs'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
  const BUILD = readFileSync(resolve(process.cwd(), '.github/workflows/build.yml'), 'utf8');

  it('runs the re-check right after the audit in both check chains', () => {
    expect(pkg.scripts['check:suppressions']).toBe('node scripts/check-suppressions.mjs');
    expect(pkg.scripts['check:raw']).toContain('pnpm audit && pnpm run check:suppressions &&');
    expect(pkg.scripts['check:fix']).toContain('pnpm audit --fix && pnpm run check:suppressions &&');
  });

  it('gives the step its own kind in check.mjs, so an unverified run is not a plain tick', () => {
    expect(CHECK).toMatch(/kind:\s*"suppressions"/);
    expect(CHECK).toMatch(/r\.suppressions\s*=\s*parseSuppressionSummary\(out\)/);
    expect(CHECK).toMatch(/r\.kind === "suppressions"/);
  });

  it('runs in CI with a token, non-blocking like the audit next to it', () => {
    const step = BUILD.slice(BUILD.indexOf('pnpm run check:suppressions') - 200, BUILD.indexOf('pnpm run check:suppressions') + 200);
    expect(step).toContain('continue-on-error: true');
    expect(step).toContain('GITHUB_TOKEN: ${{ github.token }}');
  });
});
