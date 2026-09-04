/**
 * Audit summary accounting and rendering.
 *
 * Lives in its own module so a test can import these functions. `check.mjs` calls `main()` at
 * module scope, so importing IT would run the whole check as a side effect. The alternative —
 * exporting from `check.mjs` behind an `import.meta.url === argv[1]` entry-point guard — was
 * rejected deliberately: when such a guard mis-fires (a symlinked bin, a `realpath` difference)
 * `check.mjs` becomes a silent no-op that exits 0, which is a permanently green gate that runs
 * nothing. A wrong display is worth less than a wrong gate.
 */

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { C } from "./ansi.mjs";

export const SEVERITIES = ["critical", "high", "moderate", "low", "info"];

/**
 * The audit could not RUN — as opposed to running and finding vulnerabilities.
 *
 * Blocking `check` on an outage is wrong twice over: it is not a finding, and nothing the
 * developer does fixes it. It just paints `check` red until somebody else's service recovers,
 * which trains people to ignore a red audit — and that is the real hazard, the same one the
 * `unlisted` accounting above exists to prevent, arriving from the other side.
 *
 * Two signatures, both observed:
 *
 *   1. The retired legacy endpoint. npm withdrew `/security/audits/quick` and `/audits` (410) and
 *      older pnpm still calls them, so `pnpm audit` fails without reporting anything.
 *   2. The WORKING bulk endpoint failing transiently. On 2026-09-04
 *      `/-/npm/v1/security/advisories/bulk` answered 503 while `registry.npmjs.org` itself
 *      answered 200 in 0.12s; it hit nest-server, nest-server-starter and this repo within the
 *      same hour. pnpm surfaces it as its own JSON error envelope:
 *          {"error":{"code":23,"message":"The operation was aborted due to timeout"}}
 *
 * Deliberately a SIGNATURE match, never "no parseable metadata". The loose rule would also
 * swallow a genuine audit failure whose output merely happens not to parse — we degrade specific
 * infrastructure signatures, never "audit failed for some reason". Note especially that an HTTP
 * 401/403 must NOT degrade: an auth or registry-config problem is something the developer can
 * actually fix, so it has to stay red. That is the line where the looser rule turns dangerous.
 *
 * Returns WHICH cause matched, not merely that one did — because the two demand different
 * actions from the reader. On "unreachable", waiting and re-running fixes it. On "retired",
 * waiting fixes nothing: it needs a pnpm upgrade, so anyone who reads a neutral "could not run"
 * waits forever. A single sentence for both takes away the one fact that decides what to do next.
 *
 * Shared shape with `@lenne.tech/nest-server`'s `scripts/check.mjs`, agreed across both repos on
 * 2026-09-04. Keep them in step; if you change the rule here, say so there.
 *
 * @returns `"retired"` | `"unreachable"`, or `false` when the output shows no outage signature
 */
export function isAuditEndpointUnavailable(out) {
  const text = String(out ?? "");

  // 1. Retired legacy endpoint.
  if (/ERR_PNPM_AUDIT_BAD_RESPONSE/.test(text) || (/\baudit\b/i.test(text) && /\bretired\b/i.test(text))) {
    return "retired";
  }

  // 2. Working endpoint failing transiently, via pnpm's own error envelope.
  let envelope;
  try {
    envelope = JSON.parse(text.slice(text.indexOf("{")))?.error;
  } catch {
    envelope = undefined;
  }
  if (!envelope) return false;

  const codeText = String(envelope.code ?? "");
  const messageText = String(envelope.message ?? "");
  const both = `${codeText} ${messageText}`;

  // Actionable failures stay fatal even when they look like infrastructure. Checked FIRST, so a
  // proxy that refuses the request while quoting an upstream 5xx does not read as an outage: a
  // wrong token is something the developer can fix, and degrading it would hide that forever.
  if (/\b(?:401|403|407)\b|unauthor|forbidden|authenticat/i.test(both)) return false;

  // Named network conditions are unambiguous wherever they appear.
  // `fetch failed` is what pnpm reports when the configured registry refuses the connection —
  // observed here with a dead registry in `.npmrc`. Without it that case BLOCKS rather than
  // degrading, which is the wrong answer for an outage nobody can act on.
  if (/\btimeout\b|\baborted\b|fetch failed|ETIMEDOUT|ECONNRESET|ENOTFOUND|EAI_AGAIN/i.test(both))
    return "unreachable";

  // A bare 5xx is NOT unambiguous in free text: "audited 503 packages" and "gave up after 504 ms"
  // both contain one, and both describe a real failure that must stay fatal. So accept it from the
  // `code` field, where it can only be a status — and from the message only with HTTP context
  // around it. (Found by nest-server-5f, whose own free-text match hit `audited 503 packages`.)
  if (/^\s*5\d\d\s*$/.test(codeText)) return "unreachable";
  return /\b(?:HTTP|status(?:\s*code)?|responded\s+with)\b\D{0,12}5\d\d\b|\b5\d\d\s+(?:bad\s+gateway|service\s+unavailable|gateway\s+time|internal\s+server)/i.test(
    messageText,
  )
    ? "unreachable"
    : false;
}

/**
 * Is a CLEAN audit result indistinguishable from a broken one?
 *
 * The worst failure this gate can have. When the advisory service is unreachable, `pnpm audit`
 * exits **0** with `advisories: {}` and every count at zero — byte-identical to the report of a
 * genuinely clean repository. There is no error envelope, so `isAuditEndpointUnavailable` is never
 * even consulted, and the run prints
 *
 *     ✓ audit  critical 0 · high 0 · moderate 0 · low 0 · info 0
 *
 * having verified nothing. Measured here on 2026-09-04 against three real outage modes (connection
 * refused, dead DNS, 502): all three produce that exact report. The obvious cheaper discriminator
 * was measured and is dead — an outage and a real audit both take ~825 ms, because pnpm does not
 * treat the advisory call as blocking and `metadata` is filled from the lockfile regardless.
 *
 * This says only "ambiguous", never "broken" — the caller then asks the service itself. A run WITH
 * findings is never ambiguous: findings prove the service answered.
 */
export function isAuditResultAmbiguous(parsed) {
  const advisories = parsed?.advisories;
  const raw = parsed?.metadata?.vulnerabilities;
  if (!advisories || !raw) return false;
  if (Object.keys(advisories).length > 0) return false;
  return SEVERITIES.every((severity) => !raw[severity]);
}

/**
 * Build the bulk-advisory URL for a registry.
 *
 * Separate and exported so the resolution rule is testable without a network call. A probe pointed
 * at the wrong host answers confidently about a service nobody asked — which is the false-green
 * the probe exists to prevent, reproduced inside the remedy. Both sibling repos hit exactly that:
 * the probe was hard-wired to npmjs.org while pnpm used the CONFIGURED registry, so behind a
 * private registry pnpm failed silently, npmjs.org answered, and the run printed a green tick.
 *
 * Anything that is not an absolute http(s) URL falls back to npmjs.org: `pnpm config get registry`
 * can return an empty string, an error, or a scoped-registry line, and a malformed value must
 * degrade to the previous behaviour rather than build a URL that always throws — a probe that
 * always fails would report every clean repo as an outage.
 */
export function advisoryBulkUrl(registry) {
  const fallback = "https://registry.npmjs.org/";
  let base = typeof registry === "string" ? registry.trim() : "";
  if (!/^https?:\/\//i.test(base)) base = fallback;
  return `${base.replace(/\/+$/, "")}/-/npm/v1/security/advisories/bulk`;
}

/**
 * What actually happened when the audit ran — the one decision that must never read "clean"
 * unless a tally was genuinely obtained.
 *
 *   "ok"          a tally was parsed; report it.
 *   "blocked"     the command failed and the failure is not a known outage; fatal.
 *   "unreachable" the command failed with an infrastructure signature; warn, do not block.
 *   "unreadable"  the command SUCCEEDED but produced no tally we could read.
 *
 * The last one is the case this function exists for. Before it, exit 0 with unparseable or empty
 * output fell through every branch — not blocking (exit was 0), not degraded (that required a
 * non-zero exit) — and the step printed a green ✓ with a literal "0" beside it. A tick that means
 * "we checked and found nothing" was being printed for "we could not read anything", which is the
 * worst of the three possible lies: it is the half of the report people actually read.
 *
 * Order matters and is load-bearing. A non-zero exit is judged FIRST, so a genuine audit failure
 * stays fatal; only then is a zero exit examined for a missing tally. Folding both into a single
 * `!counts` test — the obvious simplification — would silently turn every real audit failure into
 * a warning. (Credit: nest-server-5f, who found this branch missing here after the same class of
 * bug turned up on their side.)
 */
export function auditOutcome({ code, counts, out, silentOutage = false }) {
  // A silent outage is checked FIRST because it is the only case where the report looks healthy:
  // exit 0, a full tally of zeros, no signature to match. Everything below reasons about output
  // that at least admits something went wrong.
  if (silentOutage) return "unreachable";
  if (code !== 0) return isAuditEndpointUnavailable(out) || "blocked";
  return counts ? "ok" : "unreadable";
}

/** Sum a `metadata.vulnerabilities`-shaped object across the severities we report. */
export function sumSeverities(counts) {
  return SEVERITIES.reduce((n, s) => n + (counts?.[s] || 0), 0);
}

/**
 * Per severity: how many findings are counted in `metadata.vulnerabilities` but absent from
 * `advisories`.
 *
 * Two causes produce this gap, and the report cannot tell them apart:
 *   1. advisories suppressed via `auditConfig.ignoreGhsas` — somebody assessed those.
 *   2. findings below pnpm's `--audit-level` — nobody has looked at those.
 * Which is why the number is called "unlisted" and never "ignored": it is an observation
 * ("counted, but not in the list"), not a claim about anyone's judgement. `assessedSeverities`
 * below is where that distinction is finally acted on.
 *
 * Cause 2 is NOT hypothetical and NOT opt-in. pnpm's default `--audit-level` is `low`, not
 * `info` (`AUDIT_LEVEL_NUMBER = { info: 0, low: 1, ... }`, filter `severity >= auditLevel`), so
 * `info` findings are dropped from `advisories` while still being counted — under a bare
 * `pnpm audit`, with no flag and no config. Any repo can hit this today.
 *
 * Returns all-zero when `advisories` is ABSENT rather than deriving from it. npm 7+ emits
 * `auditReportVersion: 2` with a `vulnerabilities` map and no `advisories` key at all, so
 * deriving the counts there would make every finding — including a real, unassessed critical —
 * look suppressed. That is the confusion this accounting exists to prevent, produced in reverse,
 * which is why the raw tally stays authoritative and this is reported beside it.
 *
 * Note `advisories: {}` (present, empty) is NOT the same as absent: pnpm emits it on every clean
 * run and on every run where the threshold filtered everything out. Only `undefined` means "this
 * package manager does not report advisories at all".
 */
export function countUnlistedBySeverity(parsed) {
  const empty = Object.fromEntries(SEVERITIES.map((s) => [s, 0]));
  if (!parsed?.advisories) return empty;

  const counts = parsed?.metadata?.vulnerabilities ?? null;
  const listed = { ...empty };
  for (const advisory of Object.values(parsed.advisories)) {
    const severity = advisory?.severity;
    if (severity in listed) listed[severity] += 1;
  }

  // Clamped per severity: a package manager that counts vulnerable PATHS while listing one entry
  // per advisory would otherwise produce negatives. pnpm counts one per advisory (verified: 25
  // counted = 25 listed across 29 paths), and performs this same subtraction itself.
  return Object.fromEntries(
    SEVERITIES.map((s) => [s, Math.max(0, (counts?.[s] || 0) - listed[s])]),
  );
}

/** Total across severities — the single number the summary line annotates. */
export function countUnlisted(parsed) {
  return sumSeverities(countUnlistedBySeverity(parsed));
}

/**
 * How many advisories this workspace suppresses via `auditConfig.ignoreGhsas`.
 *
 * This is the ONLY evidence that an unlisted finding was actually assessed by a human, and it is
 * what separates cause 1 from cause 2 above. It cannot be recovered from the audit report: a
 * suppressed advisory disappears from `advisories` completely, leaving nothing that says who
 * removed it or why.
 *
 * Deliberately narrow. It counts GHSA ids that appear as list entries under an `ignoreGhsas:`
 * key, and ignores commented-out lines — the sibling base repos document RETIRED suppressions in
 * comments right below that key, and counting those would claim an assessment that was withdrawn.
 * Anything it cannot parse returns 0, which renders the numbers loud: the safe direction.
 */
export function countSuppressions(root) {
  for (const file of ["pnpm-workspace.yaml", "package.json"]) {
    let text;
    try {
      text = readFileSync(join(root, file), "utf8");
    } catch {
      continue;
    }
    // Line-indexed, NOT by character offset. A `/(^|\n).../` search returns the index of the
    // preceding newline, so slicing from it puts the `ignoreGhsas:` line itself first in the
    // list of "subsequent" lines — where it is neither a comment nor an entry, so the block
    // scan below breaks immediately and reports 0. That only ever worked for a key at the very
    // top of the file; under `auditConfig:`, which is where every real workspace puts it, the
    // count silently stayed 0 and nothing was ever dimmed.
    const lines = text.split("\n");
    const keyIdx = lines.findIndex((l) => /^\s*"?ignoreGhsas"?\s*:/.test(l));
    if (keyIdx === -1) continue;

    // Inline form: `ignoreGhsas: [GHSA-x, GHSA-y]` or the JSON equivalent.
    const inline = lines[keyIdx].match(/ignoreGhsas"?\s*:\s*\[([^\]]*)\]/);
    if (inline) return (inline[1].match(/GHSA-[0-9a-z]+(?:-[0-9a-z]+)*/gi) || []).length;

    // Block form: subsequent `- GHSA-...` lines, stopping at the first line that is neither a
    // list entry nor a comment.
    let found = 0;
    for (const line of lines.slice(keyIdx + 1)) {
      if (/^\s*#/.test(line) || !line.trim()) continue;
      const entry = line.match(/^\s*-\s*"?(GHSA-[0-9a-z]+(?:-[0-9a-z]+)*)"?/i);
      if (!entry) break;
      found += 1;
    }
    return found;
  }
  return 0;
}

/**
 * Which severities are ASSESSED — every finding in them is suppressed by a human decision.
 *
 * Naming a severity "assessed" is a claim about human judgement, so it requires evidence of human
 * judgement. Three conditions, all necessary:
 *
 *   - The gate passed. On a FAILING run, "somebody already looked at this" is exactly the wrong
 *     thing to say, whatever the derivation suggests.
 *   - At least one suppression is configured. Without one, every unlisted finding is below the
 *     threshold and nobody has assessed anything — marking it assessed produces the very "teaches
 *     the reader to ignore the number" failure this accounting exists to prevent, pointed the
 *     other way. This is the condition that keeps the label honest.
 *   - The severity is ENTIRELY unlisted. A row with one listed and two unlisted findings still
 *     holds something live, so it stays loud.
 *
 * Per severity rather than all-or-nothing, because a single scalar cannot say WHICH row was
 * assessed: `critical 3 · moderate 1 (3 not listed)` reads as "the criticals are handled" whether
 * or not that is true.
 */
export function assessedSeverities({ blocking = false, counts, suppressions = 0, unlisted }) {
  if (blocking || suppressions <= 0) return new Set();
  return new Set(
    SEVERITIES.filter((s) => (counts?.[s] || 0) > 0 && (unlisted?.[s] || 0) >= (counts?.[s] || 0)),
  );
}

/**
 * The vulnerability summary line.
 *
 * Takes the whole audit record rather than positional arguments: every call site already has one,
 * and a defaulted `blocking` parameter fails OPEN — an omitted argument is `undefined`, `!undefined`
 * is true, and dimming would be permitted on exactly the failing run the rules above forbid it on.
 * (Dropping the default would not help; `undefined` is still falsy.)
 *
 * Note what `blocking` does and does not suppress: it gates the DIMMING only. The annotation is
 * appended either way, because "3 of these are not in the list" stays true and useful on a failing
 * run — it is the colour that would be making the false claim there, not the count.
 */
export function renderVulnLine(audit) {
  const counts = audit?.counts ?? {};
  const unlisted = audit?.unlisted ?? {};
  const assessed = assessedSeverities({
    blocking: audit?.blocking,
    counts,
    suppressions: audit?.suppressions,
    unlisted,
  });

  const line = SEVERITIES.map((s) => {
    const n = counts[s] || 0;
    const txt = `${s} ${n}`;
    if (n === 0) return C.dim(txt);
    // An assessed finding is YELLOW, never grey. Grey reads as "done" and lets a suppression age
    // out of sight — one sat five weeks obsolete in a sibling repo because its backport shipped
    // the day after the assessment and nothing ever showed it again. Yellow still calms the line
    // (the original defect was a permanent RED next to a green gate), but it keeps saying "there
    // is something here". Same choice as nest-server-starter: "never hide a suppression".
    if (assessed.has(s)) return C.yellow(txt);
    if (s === "critical" || s === "high") return C.red(txt);
    return C.yellow(txt);
  }).join(C.dim(" · "));

  // "not listed", never "assessed": half the findings this number covers are below `--audit-level`
  // and nobody has looked at them, so a label claiming assessment would be wrong for them — and it
  // would contradict the docblock above, which is the whole reason the value is called `unlisted`.
  // Same wording as lt-monorepo: this line is read by people, and one thing must not have two
  // names across the base repos.
  const total = sumSeverities(unlisted);
  if (total === 0) return line;

  // Name the severities when that is shorter than the reader guessing. A bare "(3 not listed)"
  // next to a red row invites the wrong row to be read as the handled one.
  const named = SEVERITIES.filter((s) => (unlisted[s] || 0) > 0)
    .map((s) => `${unlisted[s]} ${s}`)
    .join(", ");
  return `${line}${C.dim(` (${named} not listed)`)}`;
}

/**
 * The registry pnpm ACTUALLY uses.
 *
 * The environment is consulted FIRST, and that order was measured, not assumed: `pnpm audit`
 * honours `npm_config_registry` from the environment, while `pnpm config get registry` does NOT
 * report it — it answers with the file/default value. So a probe built only on `pnpm config get`
 * asks a host the audit never contacted, gets a confident answer, and concludes "no outage". That
 * is the same false-green the probe exists to prevent, one layer further in; it is how this
 * function's first version failed its own end-to-end test.
 *
 * `.npmrc` and the built-in default are then covered by `pnpm config get`, which resolves both.
 */
export function configuredRegistry() {
  const fromEnv = process.env.npm_config_registry ?? process.env.NPM_CONFIG_REGISTRY;
  if (typeof fromEnv === "string" && fromEnv.trim()) return fromEnv.trim();
  try {
    return execFileSync("pnpm", ["config", "get", "registry"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return "";
  }
}

/**
 * Ask the advisory service directly whether it is answering.
 *
 * Only called when the report is ambiguous, so a repo WITH findings never pays for it and a clean
 * repo pays about half a second. That cost is real and accepted: a clean repo IS the ambiguous
 * shape, so every healthy run makes one call. There is no cheaper discriminator — see
 * `isAuditResultAmbiguous`.
 *
 * Any transport failure counts as unreachable: the question is "did anybody answer", not "what did
 * they say". A 5xx is the service failing to answer; anything else means it spoke to us.
 *
 * Note what this changes for offline work: it now reports "vulnerabilities NOT checked" where it
 * used to print a green tick. That is the correction, not a regression — offline, nothing WAS
 * checked, and pnpm's all-zero report is simply wrong.
 */
export async function advisoryServiceReachable() {
  try {
    const response = await fetch(advisoryBulkUrl(configuredRegistry()), {
      body: "{}",
      headers: { "content-type": "application/json" },
      method: "POST",
      signal: AbortSignal.timeout(8000),
    });
    return response.status < 500;
  } catch {
    return false;
  }
}
