#!/usr/bin/env node
/**
 * Lint `src/` as nuxt-base-starter lints it once `lt fullstack init` has vendored it into `app/core/`.
 *
 * `check` and the CI run in npm mode, where this package sits in `node_modules` and no project
 * lints it. The starter's lint sees it only in vendor mode, after the release: up to 1.24.0 it
 * reported three `unicorn(no-useless-spread)` warnings in `sync-hints.ts` of every newly generated
 * project, and nothing here had noticed. This step applies the template's current `.oxlintrc.json`
 * with `--deny-warnings` before anything is released. How the core is staged and why the run is not
 * type-aware: `lib/vendored-core-lint.mjs`.
 *
 * Usage:
 *   node scripts/check-vendored-core.mjs
 *   LT_TEMPLATE_OXLINTRC=../nuxt-base-starter/nuxt-base-template/.oxlintrc.json node scripts/check-vendored-core.mjs
 *
 * Without `LT_TEMPLATE_OXLINTRC` the configuration is read from nuxt-base-starter's `main` on GitHub.
 * The variable lints against a local file instead: offline, or to try a template change before it is
 * released.
 *
 * Exit code: 1 when the vendored core has a finding, when oxlint could not lint it, or when the
 * configuration could not be read. Being offline is not a pass: a green step has to mean the core
 * was linted.
 */

import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { lintVendoredCore, TEMPLATE_OXLINTRC_URL } from "./lib/vendored-core-lint.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const TAG = "[vendored-core]";

/** @returns {Promise<{ config: string, source: string }>} */
async function readTemplateConfig() {
  const local = process.env.LT_TEMPLATE_OXLINTRC;
  if (local) {
    const path = resolve(local);
    return { config: readFileSync(path, "utf8"), source: path };
  }
  const response = await fetch(TEMPLATE_OXLINTRC_URL, { signal: AbortSignal.timeout(20_000) });
  if (!response.ok) throw new Error(`HTTP ${response.status} ${response.statusText}`);
  return { config: await response.text(), source: "nuxt-base-template/.oxlintrc.json (main)" };
}

async function main() {
  let template;
  try {
    template = await readTemplateConfig();
  } catch (error) {
    console.error(
      `${TAG} Could not read the template's .oxlintrc.json (${error instanceof Error ? error.message : String(error)}).\n` +
        `  Source: ${process.env.LT_TEMPLATE_OXLINTRC || TEMPLATE_OXLINTRC_URL}\n` +
        "  The vendored core was NOT linted. Re-run with network access, or point LT_TEMPLATE_OXLINTRC\n" +
        "  at a local copy, e.g. ../nuxt-base-starter/nuxt-base-template/.oxlintrc.json.",
    );
    process.exitCode = 1;
    return;
  }

  const result = lintVendoredCore({ config: template.config, root: ROOT, srcDir: join(ROOT, "src") });

  if (result.ok) {
    console.log(`${TAG} app/core clean: ${result.files} files, linted with ${template.source}`);
    return;
  }

  process.exitCode = 1;
  if (result.findings.length === 0) {
    console.error(
      `${TAG} oxlint did not lint the vendored core with ${template.source}.\n` +
        (result.files === 0 && !result.output ? "  No file was linted: nothing reached app/core/.\n" : "") +
        (result.output ? `${result.output}\n` : ""),
    );
    return;
  }

  for (const finding of result.findings) {
    console.error(`  ${finding.file}${finding.line ? `:${finding.line}` : ""}  ${finding.severity} ${finding.rule}  ${finding.message}`);
  }
  const warnings = result.findings.filter((finding) => finding.severity === "warning").length;
  console.error(
    `\n${TAG} Found ${warnings} warnings and ${result.findings.length - warnings} errors in the vendored core (${template.source}).\n` +
      "  Every vendor-mode project generated after the next release reports these. Fix them in src/;\n" +
      "  when the template's configuration is what changed, add what it now applies to app/core/** to\n" +
      "  .oxlintrc.json here as well, so `lint` reports it too.",
  );
}

await main();
