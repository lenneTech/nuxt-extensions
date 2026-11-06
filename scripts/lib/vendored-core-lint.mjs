/**
 * Lint this repository's source the way nuxt-base-starter lints it once it is vendored.
 *
 * `lt fullstack init` copies `src/module.ts`, `src/index.ts` and `src/runtime/` into `app/core/` of
 * the new project, and the project's `.oxlintrc.json` (from `nuxt-base-template`) then lints that
 * folder through overrides on `app/core/**`. Only in that layout do those overrides apply, so the
 * source is copied into a temporary `app/core/` next to the template's configuration and linted
 * there. A finding here is a finding in every vendor-mode project after the next release: the smoke
 * test after 1.24.0 found three `unicorn(no-useless-spread)` warnings exactly like that.
 *
 * Without `--type-aware`: the template switches the type-aware rules off for `app/core/**`, a copy
 * outside a Nuxt project has no types to run them with, and this repository's own `lint` runs them
 * with the real types. The starter's own contract test (`oxlint-vendor-core-contract.test.ts`) lints
 * `app/core/` without it as well.
 */

import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

/** The configuration a new project gets, on the branch new projects are created from. */
export const TEMPLATE_OXLINTRC_URL =
  "https://raw.githubusercontent.com/lenneTech/nuxt-base-starter/main/nuxt-base-template/.oxlintrc.json";

/** What `lt fullstack init` copies from `src/` into `app/core/` (cli: `src/extensions/frontend-helper.ts`), minus LICENSE. */
export const VENDORED_ENTRIES = ["module.ts", "index.ts", "runtime"];

/**
 * The part of a reported file name from `app/core/` on, with forward slashes, or `null` outside it.
 *
 * oxlint prints paths relative to its working directory, but in a JetBrains terminal
 * (`TERMINAL_EMULATOR=JetBrains-JediTerm`) it prints `file:///<absolute path>` instead, and on
 * Windows the separators are backslashes. Only the end of the path is stable.
 *
 * @param {string} filename
 * @returns {string | null}
 */
export function corePath(filename) {
  const match = /(?:^|[/\\])(app[/\\]core[/\\].+)$/.exec(String(filename));
  return match ? match[1].replaceAll("\\", "/") : null;
}

/**
 * Copies the vendored entries of `srcDir` into `<projectDir>/app/core/` and writes the configuration
 * next to it as `.oxlintrc.json`.
 *
 * @param {string} srcDir
 * @param {string} projectDir
 * @param {string} config the template's `.oxlintrc.json`, as text (it is JSONC)
 */
export function stageVendoredCore(srcDir, projectDir, config) {
  const coreDir = join(projectDir, "app", "core");
  mkdirSync(coreDir, { recursive: true });
  for (const entry of VENDORED_ENTRIES) {
    const from = join(srcDir, entry);
    if (existsSync(from)) cpSync(from, join(coreDir, entry), { recursive: true });
  }
  writeFileSync(join(projectDir, ".oxlintrc.json"), config);
}

/**
 * @typedef {object} VendoredLintFinding
 * @property {string} file path from `app/core/` on
 * @property {number | null} line
 * @property {string} rule e.g. `unicorn(no-useless-spread)`
 * @property {string} severity `warning` or `error`
 * @property {string} message
 */

/**
 * @typedef {object} VendoredLintResult
 * @property {boolean} ok exit code 0 and nothing reported
 * @property {number} files how many files oxlint linted
 * @property {VendoredLintFinding[]} findings
 * @property {string} output what oxlint printed when its output was not a report (a broken config, a crash)
 */

/**
 * Lints `srcDir` as a vendored `app/core/` with `config`, `--deny-warnings`.
 *
 * @param {{ config: string, env?: NodeJS.ProcessEnv, root: string, srcDir: string }} options
 *   `root` is the repository whose `oxlint` runs (resolved from its `node_modules`).
 * @returns {VendoredLintResult}
 */
export function lintVendoredCore({ config, env = process.env, root, srcDir }) {
  const oxlint = join(dirname(createRequire(join(root, "package.json")).resolve("oxlint/package.json")), "bin", "oxlint");
  const projectDir = mkdtempSync(join(tmpdir(), "lt-vendored-core-"));
  try {
    stageVendoredCore(srcDir, projectDir, config);
    const run = spawnSync(process.execPath, [oxlint, "--deny-warnings", "--format", "json", "app/"], {
      cwd: projectDir,
      encoding: "utf8",
      env,
      maxBuffer: 64 * 1024 * 1024,
    });
    if (run.error) throw run.error;

    let report;
    try {
      report = JSON.parse(run.stdout);
    } catch {
      // Not a report: oxlint stopped before linting (a configuration it cannot parse, an unknown plugin).
      return { files: 0, findings: [], ok: false, output: `${run.stdout}${run.stderr}`.trim() };
    }

    const findings = (report.diagnostics ?? []).map((diagnostic) => ({
      file: corePath(diagnostic.filename) ?? String(diagnostic.filename),
      line: diagnostic.labels?.[0]?.span?.line ?? null,
      message: String(diagnostic.message ?? ""),
      rule: String(diagnostic.code ?? "unknown"),
      severity: String(diagnostic.severity ?? "error"),
    }));
    const files = Number(report.number_of_files ?? 0);
    // Fail closed. oxlint 1.90 already exits 1 and prints "No files found to lint" before its report when
    // app/ is empty or ignored, which lands in the branch above; these two keep a version that reports
    // zero files, or fails, as plain JSON from reading as clean.
    return { files, findings, ok: run.status === 0 && findings.length === 0 && files > 0, output: run.stderr.trim() };
  } finally {
    rmSync(projectDir, { force: true, recursive: true });
  }
}
