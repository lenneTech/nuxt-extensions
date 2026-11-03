#!/usr/bin/env node
/**
 * Re-check every audit suppression against the GitHub Advisory Database.
 *
 * `auditConfig.ignoreGhsas` in pnpm-workspace.yaml hides an advisory from `pnpm audit`
 * permanently, and pnpm drops it from the JSON report, so nothing ever says when the reason for
 * an entry has gone away. This step does: it fails as soon as a suppressed advisory gets an
 * installable fix, is withdrawn, or its package no longer resolves to a vulnerable version. A fix
 * younger than the workspace's `minimumReleaseAge` (pnpm 11 default: 24h) is reported as maturing,
 * not as obsolete. A fix declared unusable in `auditConfig.unusableFixConsumers` holds only while
 * the lockfile still matches the declaration. The verdicts are explained in
 * `lib/suppression-check.mjs`.
 *
 * Usage:
 *   node scripts/check-suppressions.mjs
 *
 * A `GITHUB_TOKEN` / `GH_TOKEN` in the environment is sent along when present (higher API quota).
 *
 * Exit code: 1 when a suppression is obsolete, when a declared unusable fix needs a re-test, or when
 * a suppression could not be verified in CI with a token; 0 otherwise. Without that, an unverified entry is a loud warning rather than a failure: being
 * offline, or rate-limited on a shared runner, is not a finding. It is never printed as verified.
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { listSuppressions } from "./lib/audit-report.mjs";
import {
  assessSuppression,
  createAdvisoryFetcher,
  createNpmPackumentFetcher,
  dependentsOf,
  exitCodeFor,
  listUnusableFixConsumers,
  minimumReleaseAgeOf,
  OBSOLETE,
  resolvedVersions,
  summaryLine,
} from "./lib/suppression-check.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const TAG = "[suppressions]";

const LABEL = {
  "fix-available": "✗ FIX AVAILABLE",
  "not-present": "✗ NOT IN TREE   ",
  "fix-in-quarantine": "✓ fix maturing  ",
  "fix-unpublished": "✓ still holds   ",
  "re-test": "✗ RE-TEST       ",
  unfixable: "✓ still holds   ",
  "unusable-fix": "✓ unusable fix  ",
  unverified: "! NOT verified  ",
  withdrawn: "✗ WITHDRAWN     ",
};

const ids = listSuppressions(ROOT);
if (ids.length === 0) {
  console.log(summaryLine([]));
} else {
  const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN || undefined;
  let lockText = null;
  try {
    lockText = readFileSync(join(ROOT, "pnpm-lock.yaml"), "utf8");
  } catch {
    /* reported per entry as "could not read pnpm-lock.yaml" */
  }
  let workspaceText = "";
  try {
    workspaceText = readFileSync(join(ROOT, "pnpm-workspace.yaml"), "utf8");
  } catch {
    /* no workspace file: pnpm's default gate applies */
  }
  const deps = {
    fetchAdvisory: createAdvisoryFetcher({ token }),
    lockedParents: (name, ranges) => (lockText === null ? null : dependentsOf(lockText, name, ranges)),
    lockedVersions: (name) => (lockText === null ? null : resolvedVersions(lockText, name)),
    minimumReleaseAgeMinutes: minimumReleaseAgeOf(workspaceText),
    npmPackument: createNpmPackumentFetcher(),
    unusableFixConsumers: listUnusableFixConsumers(workspaceText),
  };
  const results = await Promise.all(ids.map((id) => assessSuppression(id, deps)));

  for (const r of results) console.log(`  ${LABEL[r.status]} ${r.id}  ${r.detail}`);

  const obsolete = results.some((r) => OBSOLETE.has(r.status));
  if (obsolete) {
    console.log(
      `\n${TAG} A suppression no longer has a reason. Take the fix if there is one (update or\n` +
        "  override), remove the entry from `auditConfig.ignoreGhsas` in pnpm-workspace.yaml, and\n" +
        "  lower the count in test/audit-report.test.ts. `pnpm audit` must stay clean without it." +
        (results.some((r) => r.status === "fix-available")
          ? "\n  If a fix exists that its consumer provably cannot use, work the ladder first (raise the\n" +
            "  consumer, raise the framework, patch it). Only then declare it next to the entry, which\n" +
            "  keeps it re-checked: `auditConfig.unusableFixConsumers.<id>: '<consumer>@<version> cannot use <fix>'`."
          : ""),
    );
  }
  if (results.some((r) => r.status === "re-test")) {
    console.log(
      `\n${TAG} A declared unusable fix needs a second look: something it was assessed against has\n` +
        "  changed. Re-test whether the fix works now. Take it if it does, and remove the entry from\n" +
        "  `auditConfig.ignoreGhsas` and `auditConfig.unusableFixConsumers`; otherwise update the\n" +
        "  declaration in pnpm-workspace.yaml to what you assessed.",
    );
  } else if (!obsolete && results.some((r) => r.status === "unverified")) {
    console.log(
      `\n${TAG} At least one suppression was NOT checked. Its reason may already be gone; nothing\n` +
        "  here says either way. Re-run with network access (and GITHUB_TOKEN when rate-limited).\n" +
        (process.env.CI && !token ? "  CI without a token only warns here: set GITHUB_TOKEN to make this a gate.\n" : ""),
    );
  }

  console.log(summaryLine(results));
  process.exitCode = exitCodeFor(results, { ci: Boolean(process.env.CI), token: Boolean(token) });
}
