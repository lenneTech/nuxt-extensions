#!/usr/bin/env node
/**
 * Re-check every audit suppression against the GitHub Advisory Database.
 *
 * `auditConfig.ignoreGhsas` in pnpm-workspace.yaml hides an advisory from `pnpm audit`
 * permanently, and pnpm drops it from the JSON report, so nothing ever says when the reason for
 * an entry has gone away. This step does: it fails as soon as a suppressed advisory gets an
 * installable fix, is withdrawn, or its package no longer resolves to a vulnerable version. The
 * verdicts are explained in `lib/suppression-check.mjs`.
 *
 * Usage:
 *   node scripts/check-suppressions.mjs
 *
 * A `GITHUB_TOKEN` / `GH_TOKEN` in the environment is sent along when present (higher API quota).
 *
 * Exit code: 1 when a suppression is obsolete, or could not be verified in CI with a token; 0
 * otherwise. Without that, an unverified entry is a loud warning rather than a failure: being
 * offline, or rate-limited on a shared runner, is not a finding. It is never printed as verified.
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { listSuppressions } from "./lib/audit-report.mjs";
import {
  assessSuppression,
  createAdvisoryFetcher,
  createNpmVersionProbe,
  exitCodeFor,
  OBSOLETE,
  resolvedVersions,
  summaryLine,
} from "./lib/suppression-check.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const TAG = "[suppressions]";

const LABEL = {
  "fix-available": "✗ FIX AVAILABLE",
  "not-present": "✗ NOT IN TREE   ",
  "fix-unpublished": "✓ still holds   ",
  unfixable: "✓ still holds   ",
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
  const deps = {
    fetchAdvisory: createAdvisoryFetcher({ token }),
    lockedVersions: (name) => (lockText === null ? null : resolvedVersions(lockText, name)),
    npmHasVersion: createNpmVersionProbe(),
  };
  const results = await Promise.all(ids.map((id) => assessSuppression(id, deps)));

  for (const r of results) console.log(`  ${LABEL[r.status]} ${r.id}  ${r.detail}`);

  if (results.some((r) => OBSOLETE.has(r.status))) {
    console.log(
      `\n${TAG} A suppression no longer has a reason. Take the fix if there is one (update or\n` +
        "  override), remove the entry from `auditConfig.ignoreGhsas` in pnpm-workspace.yaml, and\n" +
        "  lower the count in test/audit-report.test.ts. `pnpm audit` must stay clean without it.",
    );
  } else if (results.some((r) => r.status === "unverified")) {
    console.log(
      `\n${TAG} At least one suppression was NOT checked. Its reason may already be gone; nothing\n` +
        "  here says either way. Re-run with network access (and GITHUB_TOKEN when rate-limited).\n" +
        (process.env.CI && !token ? "  CI without a token only warns here: set GITHUB_TOKEN to make this a gate.\n" : ""),
    );
  }

  console.log(summaryLine(results));
  process.exitCode = exitCodeFor(results, { ci: Boolean(process.env.CI), token: Boolean(token) });
}
