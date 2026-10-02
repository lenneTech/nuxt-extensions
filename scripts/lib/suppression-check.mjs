/**
 * Re-checks every audit suppression (`auditConfig.ignoreGhsas`) against the GitHub Advisory
 * Database, so a suppression cannot outlive its reason unnoticed.
 *
 * Why this exists: pnpm removes a suppressed advisory from `pnpm audit --json` completely. Once a
 * GHSA id is listed, no audit run mentions it again — if upstream ships a fix the next day, the
 * entry silently stops being justified. In nest-server one sat five weeks obsolete for exactly
 * that reason. The approach follows the suppression half of offers' `scripts/check-overrides.mjs`.
 *
 * Verdict per entry:
 *
 *   not-present      no package of the advisory resolves to a vulnerable version any more (read
 *                    from pnpm-lock.yaml), so the entry hides nothing — FAIL. The case a fix check
 *                    alone misses: nuxt-base-starter suppressed two image-size advisories whose fix
 *                    never shipped; the package left the tree instead, and the entries outlived
 *                    their cause by a full release cycle.
 *   unfixable        no npm vulnerability of the advisory names a patched version. Still holds.
 *   fix-unpublished  a patched version is NAMED but not on the npm registry. Still holds: there is
 *                    nothing to install. (node-forge, 2026-10: `pnpm audit` named ">=1.4.1" while
 *                    registry.npmjs.org/node-forge/1.4.1 answered 404.) Failing here would order a
 *                    fix nobody can take.
 *   fix-available    a patched version is installable. The suppression is obsolete — FAIL.
 *   withdrawn        the advisory was withdrawn, so the entry hides nothing any more — FAIL.
 *   unverified       the lookup could not be made: offline, rate-limited, unknown id, no npm
 *                    package in the advisory, registry or lockfile unreadable, a version range it
 *                    cannot parse. NEVER reported as verified (see `exitCodeFor` for when it fails).
 *
 * Network and file access are injected (`fetchAdvisory`, `npmHasVersion`, `lockedVersions`), so
 * every verdict is testable offline. `scripts/check-suppressions.mjs` wires in the real ones.
 */

import { stripAnsi } from "./ansi.mjs";

const ADVISORY_API = "https://api.github.com/advisories/";
const NPM_REGISTRY = "https://registry.npmjs.org/";
const TIMEOUT_MS = 20_000;

/** Verdicts that make the check fail: the suppression is obsolete. */
export const OBSOLETE = new Set(["fix-available", "not-present", "withdrawn"]);

/**
 * The first patched version of one advisory vulnerability, or null when none is named.
 *
 * The REST API returns a plain string; the GraphQL shape (`{ identifier }`) is accepted too, so a
 * captured advisory from either API reads the same.
 */
export function patchedVersionOf(vulnerability) {
  const value = vulnerability?.first_patched_version;
  if (typeof value === "string" && value.trim()) return value.trim();
  if (value && typeof value === "object" && typeof value.identifier === "string" && value.identifier.trim())
    return value.identifier.trim();
  return null;
}

/**
 * Versions of `name` that a pnpm lockfile resolves, read from the `packages:` / `snapshots:` keys:
 * `  node-forge@1.4.0:`, `  '@scope/pkg@1.2.3':`, with an optional peer suffix `(peer@4.0.0)` and
 * the leading slash of lockfile v6 (`  /pkg@1.0.0:`).
 */
export function resolvedVersions(lockText, name) {
  const versions = new Set();
  for (const line of String(lockText).split("\n")) {
    const m = line.match(/^ {2}'?\/?(@?[^@\s'/]+(?:\/[^@\s']+)?)@(\d[^(:'\s]*)/);
    if (m && m[1] === name) versions.add(m[2]);
  }
  return [...versions];
}

function parseVersion(text) {
  const core = String(text).trim().replace(/^v/, "").split(/[-+]/)[0];
  const parts = core.split(".").map((n) => (/^\d+$/.test(n) ? Number(n) : Number.NaN));
  if (!parts.length || parts.length > 3 || parts.some((n) => Number.isNaN(n))) return null;
  while (parts.length < 3) parts.push(0);
  return parts;
}

/**
 * Whether `version` lies in a GitHub `vulnerable_version_range` such as `<= 1.4.0` or
 * `>= 2.0.0, < 2.1.4`. Null when either cannot be read, so the caller can say "not verified"
 * instead of guessing. A pre-release counts as its release (`1.4.0-beta` as `1.4.0`): the
 * conservative direction, it keeps the entry rather than calling it obsolete.
 */
export function inVulnerableRange(version, range) {
  const v = parseVersion(version);
  const constraints = String(range ?? "").split(",").map((c) => c.trim()).filter(Boolean);
  if (!v || constraints.length === 0) return null;
  for (const constraint of constraints) {
    const m = constraint.match(/^(<=|>=|<|>|=)?\s*(\S+)$/);
    const bound = m && parseVersion(m[2]);
    if (!bound) return null;
    let cmp = 0;
    for (let i = 0; i < 3 && cmp === 0; i++) cmp = Math.sign(v[i] - bound[i]);
    const op = m[1] ?? "=";
    const holds = op === "<" ? cmp < 0 : op === "<=" ? cmp <= 0 : op === ">" ? cmp > 0 : op === ">=" ? cmp >= 0 : cmp === 0;
    if (!holds) return false;
  }
  return true;
}

/**
 * Decide whether one suppression still holds.
 *
 * @param {string} id GHSA id as listed in `ignoreGhsas`.
 * @param {{ fetchAdvisory: (id: string) => Promise<{ ok: true, advisory: any } | { ok: false, reason: string }>,
 *           lockedVersions: (name: string) => string[] | null,
 *           npmHasVersion: (name: string, version: string) => Promise<boolean | null> }} deps
 * @returns {Promise<{ detail: string, id: string, status: string }>}
 */
export async function assessSuppression(id, { fetchAdvisory, lockedVersions, npmHasVersion }) {
  const answer = await fetchAdvisory(id);
  if (!answer.ok) return { detail: answer.reason, id, status: "unverified" };

  const advisory = answer.advisory ?? {};
  if (advisory.withdrawn_at) {
    return { detail: `advisory withdrawn on ${String(advisory.withdrawn_at).slice(0, 10)}`, id, status: "withdrawn" };
  }

  const npmVulnerabilities = (advisory.vulnerabilities ?? []).filter(
    (v) => v?.package?.ecosystem === "npm" && typeof v.package.name === "string" && v.package.name,
  );
  if (npmVulnerabilities.length === 0) {
    return { detail: "the advisory names no npm package, so nothing here could be checked", id, status: "unverified" };
  }

  // Still in the tree? Checked before the fix: an entry whose package left the tree is obsolete
  // whether or not a fix exists, and that is the case a fix check alone never reports.
  let stillVulnerable = false;
  const locked = [];
  for (const vulnerability of npmVulnerabilities) {
    const name = vulnerability.package.name;
    const versions = lockedVersions(name);
    if (versions === null) return { detail: "could not read pnpm-lock.yaml", id, status: "unverified" };
    for (const version of versions) {
      const hit = inVulnerableRange(version, vulnerability.vulnerable_version_range);
      if (hit === null) {
        const range = vulnerability.vulnerable_version_range;
        return { detail: `cannot compare ${name}@${version} with the range "${range}"`, id, status: "unverified" };
      }
      if (hit) stillVulnerable = true;
      locked.push(`${name}@${version}`);
    }
  }
  if (!stillVulnerable) {
    const where = locked.length ? `the lockfile resolves only ${locked.join(", ")}` : "the package no longer resolves at all";
    return { detail: `nothing vulnerable left in the tree: ${where}`, id, status: "not-present" };
  }

  const namedButUnpublished = [];
  for (const vulnerability of npmVulnerabilities) {
    const version = patchedVersionOf(vulnerability);
    if (!version) continue;
    const name = vulnerability.package.name;
    const published = await npmHasVersion(name, version);
    if (published === true) return { detail: `${name}@${version} is published`, id, status: "fix-available" };
    if (published !== false) {
      return { detail: `could not ask the npm registry whether ${name}@${version} exists`, id, status: "unverified" };
    }
    namedButUnpublished.push(`${name}@${version}`);
  }

  if (namedButUnpublished.length) {
    return { detail: `${namedButUnpublished.join(", ")} named, but not on the npm registry`, id, status: "fix-unpublished" };
  }
  const names = [...new Set(npmVulnerabilities.map((v) => v.package.name))].join(", ");
  return { detail: `still no patched version of ${names}`, id, status: "unfixable" };
}

/**
 * Exit code for a finished run.
 *
 * An obsolete entry always fails. An unverified one fails only in CI WITH a token: there the
 * lookup was expected to work, and a check that could not run must not look like one that passed.
 * Without a token it stays a loud warning — unauthenticated, GitHub allows 60 requests per hour
 * per IP, and pipelines on a shared runner (lt-runner-01 carries every generated project's GitLab
 * CI) would turn red on a busy day with nothing wrong in the project.
 */
export function exitCodeFor(results, { ci, token }) {
  if (results.some((r) => OBSOLETE.has(r.status))) return 1;
  if (ci && token && results.some((r) => r.status === "unverified")) return 1;
  return 0;
}

/** The one machine-readable line `scripts/check.mjs` renders via `parseSuppressionSummary`. */
export function summaryLine(results) {
  const total = results.length;
  if (total === 0) return "[suppressions] none declared";
  const obsolete = results.filter((r) => OBSOLETE.has(r.status)).length;
  if (obsolete) return `[suppressions] OBSOLETE ${obsolete} of ${total}`;
  const unverified = results.filter((r) => r.status === "unverified").length;
  if (unverified) return `[suppressions] NOT verified ${unverified} of ${total}`;
  return `[suppressions] verified ${total} of ${total}`;
}

/**
 * Read the summary line back out of a step's output, or null when there is none.
 *
 * Null renders as no metric at all — never as "verified". A step that printed nothing readable
 * did not verify anything.
 */
export function parseSuppressionSummary(out) {
  const text = stripAnsi(String(out));
  if (/\[suppressions\] none declared/.test(text)) return { count: 0, state: "none", total: 0 };
  const m = text.match(/\[suppressions\] (OBSOLETE|NOT verified|verified) (\d+) of (\d+)/);
  if (!m) return null;
  const state = m[1] === "OBSOLETE" ? "obsolete" : m[1] === "verified" ? "verified" : "unverified";
  return { count: Number(m[2]), state, total: Number(m[3]) };
}

/**
 * Real GitHub Advisory lookup. Public advisories need no token, but one is sent when given:
 * unauthenticated the quota is 60 requests per hour PER IP, and hosted CI runners share IPs.
 *
 * @param {{ fetchImpl?: typeof fetch, token?: string }} [options]
 */
export function createAdvisoryFetcher({ fetchImpl = globalThis.fetch, token } = {}) {
  return async (id) => {
    let response;
    try {
      response = await fetchImpl(`${ADVISORY_API}${encodeURIComponent(id)}`, {
        headers: {
          Accept: "application/vnd.github+json",
          "User-Agent": "lenne.tech-nuxt-extensions-check",
          "X-GitHub-Api-Version": "2022-11-28",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (error) {
      return { ok: false, reason: `GitHub Advisory API unreachable (${error?.cause?.code ?? error?.name ?? "error"})` };
    }
    if (response.status === 200) {
      try {
        return { advisory: await response.json(), ok: true };
      } catch {
        return { ok: false, reason: "GitHub Advisory API answered with unreadable JSON" };
      }
    }
    if ((response.status === 403 || response.status === 429) && response.headers?.get("x-ratelimit-remaining") === "0") {
      return {
        ok: false,
        reason: token ? "GitHub API rate limit reached" : "GitHub API rate limit reached — set GITHUB_TOKEN or GH_TOKEN",
      };
    }
    if (response.status === 404) return { ok: false, reason: `${id} is not in the GitHub Advisory Database` };
    return { ok: false, reason: `GitHub Advisory API answered HTTP ${response.status}` };
  };
}

/**
 * Real npm lookup: true when `name@version` resolves, false when the registry says it does not
 * exist, null when the registry could not be asked. Uses the version-specific endpoint: it
 * answers the moment a version is published, unlike the CDN-cached packument `npm view` reads.
 *
 * @param {{ fetchImpl?: typeof fetch }} [options]
 */
export function createNpmVersionProbe({ fetchImpl = globalThis.fetch } = {}) {
  return async (name, version) => {
    try {
      const response = await fetchImpl(`${NPM_REGISTRY}${name.replace("/", "%2F")}/${encodeURIComponent(version)}`, {
        headers: { Accept: "application/json" },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (response.status === 200) return true;
      if (response.status === 404) return false;
      return null;
    } catch {
      return null;
    }
  };
}
