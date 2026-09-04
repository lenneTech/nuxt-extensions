/**
 * Audit report shapes, OBSERVED rather than invented.
 *
 * The three pnpm shapes below were captured from real `pnpm audit --json` runs on 2026-09-03 and
 * trimmed to the fields the reporter reads. This matters: CLAUDE.md records that the 1.13.0 defect
 * shipped because "a fixture was invented rather than observed, and the invented selector matched
 * the invented fixture". A constructed audit report would have confirmed whatever the code did.
 *
 * The npm shape is included because it is the one the accounting is built to survive, and it is
 * structurally different — no `advisories` key at all.
 */

export interface AuditReport {
  advisories?: Record<string, { severity?: string }> | unknown[];
  auditReportVersion?: number;
  metadata?: { vulnerabilities?: Record<string, number> };
  vulnerabilities?: Record<string, unknown>;
}

const noVulns = { critical: 0, high: 0, info: 0, low: 0, moderate: 0 };

/**
 * This repo, `pnpm audit --json`, pnpm 11.14.0. Note `advisories` is PRESENT and empty — pnpm
 * emits it on every clean run. Distinguishing this from an absent key is what stops a real
 * finding being filed as suppressed.
 */
export const pnpmClean: AuditReport = {
  advisories: {},
  metadata: { vulnerabilities: { ...noVulns } },
};

/**
 * document-analyzer, `pnpm audit --prod --audit-level high --json`, pnpm 11.22.
 * One moderate finding (@tiptap/core, GHSA id 1158508) counted but filtered out of `advisories`
 * by the threshold. NO suppression is configured in that repo — this is the below-threshold
 * cause, on its own, which is the case a suppression-only fixture would never produce.
 */
export const pnpmBelowThreshold: AuditReport = {
  advisories: {},
  metadata: { vulnerabilities: { ...noVulns, moderate: 1 } },
};

/** The same tree and the same command WITHOUT `--audit-level high`: the finding is now listed. */
export const pnpmSameTreeUnfiltered: AuditReport = {
  advisories: { 1158508: { severity: "moderate" } },
  metadata: { vulnerabilities: { ...noVulns, moderate: 1 } },
};

/**
 * npm 7+ (`auditReportVersion: 2`). There is NO `advisories` key — deriving counts from it here
 * would render this real, unassessed critical as `critical 0` and file it under "suppressed".
 */
export const npmV2WithCritical: AuditReport = {
  auditReportVersion: 2,
  metadata: { vulnerabilities: { ...noVulns, critical: 1 } },
  vulnerabilities: {},
};

/** Constructed: an advisory suppressed via `auditConfig.ignoreGhsas` — counted, never listed. */
export const pnpmSuppressedHigh: AuditReport = {
  advisories: {},
  metadata: { vulnerabilities: { ...noVulns, high: 1 } },
};

/** Constructed: one live critical alongside two unlisted moderates. */
export const pnpmMixed: AuditReport = {
  advisories: { 4242: { severity: "critical" } },
  metadata: { vulnerabilities: { ...noVulns, critical: 1, moderate: 2 } },
};
