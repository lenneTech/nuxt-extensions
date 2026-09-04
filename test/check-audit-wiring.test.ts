/**
 * Contract: `scripts/check.mjs` actually WIRES UP the audit accounting it imports.
 *
 * Why a source-level contract rather than a unit test: `check.mjs` calls `main()` at module scope,
 * so importing it runs the whole check. The accounting itself is unit-tested in
 * `audit-report.test.ts` — what is untestable from there is the three lines that connect it, and
 * those turned out to be the gap. Both of these mutations left all 24 accounting tests green:
 *
 *     suppressions: countSuppressions(ROOT)  ->  suppressions: 0      // nothing is ever dimmed
 *     unlisted = countUnlistedBySeverity(…)  ->  unlisted = {}        // nothing is ever annotated
 *
 * Either one silently disables the feature, and the symptom — "nothing is dimmed" — is also the
 * correct state in every repo today, so nobody would notice until the first real suppression is
 * declared. That is precisely how the offset bug in `countSuppressions` survived its own test
 * suite: the parts were checked, the assembly was assumed.
 *
 * This file follows the same shape as `upstream-dom-contract.test.ts` and
 * `better-auth-contract.test.ts` — pin what must hold, and say what breaks when it does not.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

// `process.cwd()`, matching test/module-version-sync.test.ts — under vitest `import.meta.url` is
// not a file: URL, so `new URL(…, import.meta.url)` throws before a single test runs.
const SOURCE = readFileSync(resolve(process.cwd(), 'scripts/check.mjs'), 'utf8');

/** The source with comments stripped, so a mention in prose cannot satisfy a wiring assertion. */
const CODE = SOURCE.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

describe('check.mjs wires up the audit accounting', () => {
  it('imports the accounting from the extracted module', () => {
    // If this fails, the functions were inlined back into check.mjs and audit-report.test.ts is
    // now testing a copy nobody runs.
    expect(CODE).toMatch(/from\s+["']\.\/lib\/audit-report\.mjs["']/);
    expect(CODE).toMatch(/from\s+["']\.\/lib\/ansi\.mjs["']/);
  });

  it('derives `unlisted` per severity from the parsed report', () => {
    // MUTATION GUARD: `unlisted = {}` passes every accounting test but removes the annotation.
    expect(CODE).toMatch(/unlisted\s*=\s*countUnlistedBySeverity\(\s*parsed\s*\)/);
  });

  it('reads the suppression count from the workspace, not a constant', () => {
    // MUTATION GUARD: `suppressions: 0` passes every accounting test and silently means "never
    // dim", i.e. the whole distinction this accounting exists for stops working.
    expect(CODE).toMatch(/suppressions:\s*countSuppressions\(\s*ROOT\s*\)/);
    expect(CODE).not.toMatch(/suppressions:\s*\d/);
  });

  it('passes the whole audit record to the renderer at every call site', () => {
    // The positional form defaulted `blocking` to false, which fails OPEN: an omitted argument
    // permits dimming on exactly the failing run where it must not happen. Every call site must
    // hand over the record instead.
    const calls = CODE.match(/renderVulnLine\([^)]*\)/g) ?? [];

    expect(calls.length).toBeGreaterThanOrEqual(4);
    for (const call of calls) {
      expect(call).toMatch(/^renderVulnLine\(\s*audit\s*\)$/);
    }
  });

  it('decides the outcome in one testable place, from the exit code and the tally', () => {
    // The decision used to sit inline in `runAudit`, where no test could reach it — which is how
    // the zero-exit-without-a-tally case went unnoticed. It must stay a call to the pure function.
    expect(CODE).toMatch(/auditOutcome\(\s*\{\s*code,\s*counts,\s*out,\s*silentOutage\s*\}\s*\)/);
  });

  it('keeps the gate on the outcome alone, never on the reported numbers', () => {
    // The accounting is display-only. If `blocking` ever derives from counts, unlisted or
    // suppressions, a reporting bug becomes a gate bug.
    expect(CODE).toMatch(/blocking:\s*outcome\s*===\s*["']blocked["']/);
    expect(CODE).not.toMatch(/blocking:[^,\n]*(?:unlisted|suppressions|counts)/);
  });

  it('treats an unreadable result as degraded, not as success', () => {
    // MUTATION GUARD: dropping the `"unreadable"` term restores the original defect — a zero
    // exit with output we could not parse falls through to the success branch and prints a green
    // tick with a literal "0", i.e. "clean" for "we could not read anything".
    // Everything that is neither a clean result nor a blocking failure must degrade — stated as
    // an exclusion so a newly added outcome cannot silently fall through to the success branch.
    expect(CODE).toMatch(
      /degraded:\s*outcome\s*!==\s*["']ok["']\s*&&\s*outcome\s*!==\s*["']blocked["']/,
    );
  });

  it('asks the service when the report cannot answer for itself', () => {
    // An all-zero report is identical whether the tree is clean or the registry was dead, so the
    // ambiguity test must be wired to an actual probe. MUTATION GUARD: deleting either half
    // restores the deepest false-green — a green tick for a run that verified nothing.
    expect(CODE).toMatch(/isAuditResultAmbiguous\(\s*parsed\s*\)/);
    expect(CODE).toMatch(/silentOutage\s*=\s*!\(await advisoryServiceReachable\(\)\)/);
  });

  it('never prints a green tick for an audit that could not run', () => {
    // A ✓ reads as "no vulnerabilities" — a claim not verified when the audit never completed.
    // The degraded branch must therefore come BEFORE the success branch and use a warning glyph.
    const degradedAt = CODE.indexOf('audit.degraded');
    const successAt = CODE.indexOf('C.green("✓")} audit');

    expect(degradedAt).toBeGreaterThan(-1);
    expect(successAt).toBeGreaterThan(-1);
    expect(degradedAt).toBeLessThan(successAt);
    expect(CODE).toMatch(/audit\.degraded[\s\S]{0,400}C\.yellow\("⚠"\)/);
  });
});
