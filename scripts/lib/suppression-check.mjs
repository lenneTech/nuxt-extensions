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
 *   unfixable        no release on the registry would take a vulnerable copy out of the advisory's
 *                    ranges. Still holds.
 *   fix-unpublished  a patched version is NAMED but not on the npm registry. Still holds: there is
 *                    nothing to install. (node-forge, 2026-10: `pnpm audit` named ">=1.4.1" while
 *                    registry.npmjs.org/node-forge/1.4.1 answered 404.) Failing here would order a
 *                    fix nobody can take.
 *   fix-in-quarantine  a fix is on the registry but younger than the `minimumReleaseAge` gate.
 *                    Still holds until the gate clears; the detail says when.
 *   fix-available    every vulnerable copy has a fix past the gate. The suppression is obsolete — FAIL.
 *   withdrawn        the advisory was withdrawn, so the entry hides nothing any more — FAIL.
 *   unverified       the lookup could not be made: offline, rate-limited, unknown id, no npm
 *                    package in the advisory, registry or lockfile unreadable, a version range it
 *                    cannot parse. NEVER reported as verified (see `exitCodeFor` for when it fails).
 *
 * A fix does not have to be NAMED. GitHub leaves `first_patched_version` null on some advisories
 * long after a release outside the vulnerable range shipped: GHSA-86w9-cpqp-85rv still read
 * `<= 1.4.0` / null on 2026-10-28, a day after node-forge 1.4.1 and 1.4.2 were published. Reading
 * only the named field kept such an entry "unfixable" for good, and a project whose lockfile was
 * still on 1.4.0 never heard of the fix. So the fix is read from the registry's version list.
 *
 * Network and file access are injected (`fetchAdvisory`, `npmPackument`, `lockedVersions`, plus
 * `now` and `minimumReleaseAgeMinutes`), so every verdict is testable offline.
 * `scripts/check-suppressions.mjs` wires in the real ones.
 */

import { stripAnsi } from "./ansi.mjs";

const ADVISORY_API = "https://api.github.com/advisories/";
const NPM_REGISTRY = "https://registry.npmjs.org/";
const TIMEOUT_MS = 20_000;

/** Verdicts that make the check fail: the suppression is obsolete. */
export const OBSOLETE = new Set(["fix-available", "not-present", "withdrawn"]);

/** pnpm 11's built-in `minimumReleaseAge` when the workspace sets none: 1440 minutes, 24h. */
export const DEFAULT_MINIMUM_RELEASE_AGE_MINUTES = 1440;

/**
 * The `minimumReleaseAge` gate in minutes a pnpm-workspace.yaml sets, or pnpm 11's 24h default.
 *
 * A fix younger than the gate is not one the project takes yet: pnpm refuses it (strict mode) or
 * installs it only by appending a `minimumReleaseAgeExclude` entry nobody decided on (loose mode,
 * the default). Failing on it would order exactly that entry.
 */
export function minimumReleaseAgeOf(workspaceText) {
  const m = String(workspaceText ?? "").match(/^minimumReleaseAge\s*:\s*(\d+)\s*(?:#.*)?$/m);
  return m ? Number(m[1]) : DEFAULT_MINIMUM_RELEASE_AGE_MINUTES;
}

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

/** Sort order of two versions; NaN when either cannot be read, so every comparison with it fails. */
function compareVersions(a, b) {
  const x = parseVersion(a);
  const y = parseVersion(b);
  if (!x || !y) return Number.NaN;
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return Math.sign(x[i] - y[i]);
  return 0;
}

/**
 * The fix one vulnerable copy in the tree could move to, read from the registry's packument.
 *
 * A candidate is a stable release above the copy that lies outside EVERY range the advisory lists
 * for the package (a later line can be vulnerable too) and, when the advisory names a first patched
 * version, not below it. The smallest candidate past the release-age gate wins.
 *
 * A deprecated release is passed over, not ruled out: it counts only when every candidate is
 * deprecated. node-sass deprecated all 132 of its stable releases, so excluding them turned a fix
 * that pnpm installs with a warning into "unfixable" — and kept the entry for good.
 */
function fixFor(copy, entries, packument, { gateMs, now }) {
  const floor =
    entries
      .filter((e) => inVulnerableRange(copy, e.vulnerable_version_range))
      .map(patchedVersionOf)
      .find(Boolean) ?? null;
  const outside = Object.keys(packument.versions)
    .filter((v) => /^\d+\.\d+\.\d+$/.test(v))
    .filter((v) => compareVersions(v, copy) > 0 && (floor === null || compareVersions(v, floor) >= 0))
    .filter((v) => entries.every((e) => inVulnerableRange(v, e.vulnerable_version_range) === false));
  const current = outside.filter((v) => !packument.versions[v]?.deprecated);
  const deprecated = outside.length > 0 && current.length === 0;
  const candidates = (deprecated ? outside : current)
    .sort(compareVersions)
    .map((version) => ({ published: Date.parse(packument.time?.[version] ?? ""), version }));

  const mature = candidates.find((c) => now - c.published >= gateMs);
  if (mature) return { deprecated, fix: mature.version, kind: "available", named: floor !== null };
  if (candidates.length) return { clears: candidates[0].published + gateMs, fix: candidates[0].version, kind: "quarantine" };
  if (floor !== null && !Object.hasOwn(packument.versions, floor)) return { fix: floor, kind: "unpublished" };
  return { kind: "none" };
}

function formatGate(minutes) {
  if (minutes >= 2880 && minutes % 1440 === 0) return `${minutes / 1440}d`;
  if (minutes % 60 === 0) return `${minutes / 60}h`;
  return `${minutes}min`;
}

function formatTime(ms) {
  return `${new Date(ms).toISOString().slice(0, 16).replace("T", " ")} UTC`;
}

/**
 * Decide whether one suppression still holds.
 *
 * @param {string} id GHSA id as listed in `ignoreGhsas`.
 * @param {{ fetchAdvisory: (id: string) => Promise<{ ok: true, advisory: any } | { ok: false, reason: string }>,
 *           lockedVersions: (name: string) => string[] | null,
 *           minimumReleaseAgeMinutes?: number,
 *           now?: number,
 *           npmPackument: (name: string) => Promise<{ time: Record<string, string>, versions: Record<string, { deprecated?: string }> } | null> }} deps
 * @returns {Promise<{ detail: string, id: string, status: string }>}
 */
export async function assessSuppression(
  id,
  { fetchAdvisory, lockedVersions, minimumReleaseAgeMinutes = DEFAULT_MINIMUM_RELEASE_AGE_MINUTES, now = Date.now(), npmPackument },
) {
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
  const locked = [];
  const vulnerableCopies = new Map();
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
      if (hit) vulnerableCopies.set(`${name}@${version}`, { name, version });
      locked.push(`${name}@${version}`);
    }
  }
  if (vulnerableCopies.size === 0) {
    const where = locked.length ? `the lockfile resolves only ${locked.join(", ")}` : "the package no longer resolves at all";
    return { detail: `nothing vulnerable left in the tree: ${where}`, id, status: "not-present" };
  }

  // One answer per vulnerable copy. The entry is obsolete only when EVERY copy can move off the
  // vulnerable ranges: a single copy that cannot still needs the suppression.
  const gateMs = minimumReleaseAgeMinutes * 60_000;
  const packuments = new Map();
  const answers = [];
  for (const { name, version } of vulnerableCopies.values()) {
    if (!packuments.has(name)) packuments.set(name, await npmPackument(name));
    const packument = packuments.get(name);
    if (!packument) return { detail: `could not read the npm registry entry of ${name}`, id, status: "unverified" };
    const entries = npmVulnerabilities.filter((v) => v.package.name === name);
    answers.push({ name, version, ...fixFor(version, entries, packument, { gateMs, now }) });
  }

  const stuck = answers.find((a) => a.kind === "none");
  if (stuck) {
    const detail = `still no patched version of ${stuck.name}: nothing above ${stuck.version} on the registry is outside the vulnerable range`;
    return { detail, id, status: "unfixable" };
  }
  const unpublished = answers.filter((a) => a.kind === "unpublished");
  if (unpublished.length) {
    const named = unpublished.map((a) => `${a.name}@${a.fix}`).join(", ");
    return { detail: `${named} named, but not on the npm registry`, id, status: "fix-unpublished" };
  }
  const gate = formatGate(minimumReleaseAgeMinutes);
  const maturing = answers.filter((a) => a.kind === "quarantine");
  if (maturing.length) {
    const detail = maturing
      .map((a) =>
        Number.isNaN(a.clears)
          ? `${a.name}@${a.fix} is published, but the registry gives no publish time to hold against the ${gate} minimumReleaseAge gate`
          : `${a.name}@${a.fix} is published, but inside the ${gate} minimumReleaseAge gate until ${formatTime(a.clears)}`,
      )
      .join("; ");
    return { detail, id, status: "fix-in-quarantine" };
  }
  const detail = answers
    .map((a) => {
      const published = a.named
        ? `${a.name}@${a.fix} is published`
        : `${a.name}@${a.fix} is published and outside the vulnerable range (the advisory names no patched version)`;
      return a.deprecated ? `${published}, deprecated like every release outside the vulnerable range` : published;
    })
    .join("; ");
  return { detail, id, status: "fix-available" };
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
 * Real npm lookup of a package's full packument: every version with its `deprecated` notice, and
 * the `time` map of publish dates the release-age gate needs. The abbreviated install document
 * (`application/vnd.npm.install-v1+json`) carries no `time`, so it is not asked for.
 *
 * Resolves to `{ time, versions }`; to an empty one when the registry says the package does not
 * exist (nothing published, nothing installable); to null when the registry could not be asked or
 * answered something that is not a packument.
 *
 * The packument is CDN-cached and can lag a publish by minutes, which is why release checks ask
 * the version-specific endpoint instead. Here the lag is harmless: a version only minutes old is
 * still inside the release-age gate, so it could not turn a verdict red anyway.
 *
 * @param {{ fetchImpl?: typeof fetch }} [options]
 */
export function createNpmPackumentFetcher({ fetchImpl = globalThis.fetch } = {}) {
  return async (name) => {
    try {
      const response = await fetchImpl(`${NPM_REGISTRY}${name.replace("/", "%2F")}`, {
        headers: { Accept: "application/json" },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (response.status === 404) return { time: {}, versions: {} };
      if (response.status !== 200) return null;
      const body = await response.json();
      if (!body?.versions || typeof body.versions !== "object") return null;
      return { time: body.time && typeof body.time === "object" ? body.time : {}, versions: body.versions };
    } catch {
      return null;
    }
  };
}
