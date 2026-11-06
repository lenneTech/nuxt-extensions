#!/usr/bin/env node
/**
 * Fail when vendoring this package would raise a version in nuxt-base-template.
 *
 * `lt fullstack init` (vendor mode) raises every version the template shares with this package to
 * this package's version when that is newer. The template's own `check` (type check, lint, tests)
 * never ran with such a version: vue-tsc 3.3.14 broke a template component that way after 1.24.0.
 * Why versions are compared rather than the template type-checked, the rule, and the pending list
 * for the publish order (this package ships before the starter): `lib/template-pins.mjs`.
 *
 * Usage:
 *   node scripts/check-template-pins.mjs
 *   LT_TEMPLATE_PACKAGE_JSON=../nuxt-base-starter/nuxt-base-template/package.json \
 *   LT_STARTER_PACKAGE_JSON=../nuxt-base-starter/package.json node scripts/check-template-pins.mjs
 *
 * Without the variables both files are read from nuxt-base-starter's `main` on GitHub; the starter's
 * version is read only when `template-pins-pending.json` has entries. `LT_TEMPLATE_PINS_PENDING`
 * reads another pending list (to try an entry).
 *
 * Exit code: 1 when vendoring would raise a version no pending entry allows, when a pending entry
 * has expired or is no longer needed, or when a file could not be read (offline is not a pass).
 * A version neither side can compare (`workspace:*`, a URL) is reported and does not fail the step:
 * the CLI skips it as well.
 */

import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { judgePins, pinsVendoringRaises, STARTER_PACKAGE_JSON_URL, TEMPLATE_PACKAGE_JSON_URL } from "./lib/template-pins.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const TAG = "[template-pins]";

/**
 * @param {string | undefined} local a path from the environment, read instead of `url`
 * @param {string} url
 * @param {string} label
 * @returns {Promise<{ pkg: Record<string, any>, source: string }>}
 */
async function readPackage(local, url, label) {
  if (local) {
    const path = resolve(local);
    return { pkg: JSON.parse(readFileSync(path, "utf8")), source: path };
  }
  const response = await fetch(url, { signal: AbortSignal.timeout(20_000) });
  if (!response.ok) throw new Error(`HTTP ${response.status} ${response.statusText}`);
  return { pkg: JSON.parse(await response.text()), source: label };
}

/** @param {string} what @param {string} source @param {unknown} error */
function unreadable(what, source, error) {
  console.error(
    `${TAG} Could not read ${what} (${error instanceof Error ? error.message : String(error)}).\n` +
      `  Source: ${source}\n` +
      "  The versions were NOT compared. Re-run with network access, or point LT_TEMPLATE_PACKAGE_JSON\n" +
      "  (and LT_STARTER_PACKAGE_JSON) at local copies, e.g. ../nuxt-base-starter/nuxt-base-template/package.json.",
  );
  process.exitCode = 1;
}

async function main() {
  let template;
  try {
    template = await readPackage(process.env.LT_TEMPLATE_PACKAGE_JSON, TEMPLATE_PACKAGE_JSON_URL, "nuxt-base-template/package.json (main)");
  } catch (error) {
    unreadable("the template's package.json", process.env.LT_TEMPLATE_PACKAGE_JSON || TEMPLATE_PACKAGE_JSON_URL, error);
    return;
  }

  const pendingFile = resolve(process.env.LT_TEMPLATE_PINS_PENDING || join(ROOT, "scripts/template-pins-pending.json"));
  let pending;
  try {
    pending = JSON.parse(readFileSync(pendingFile, "utf8")).pending ?? {};
  } catch (error) {
    unreadable("the pending list", pendingFile, error);
    return;
  }

  let starterVersion;
  if (Object.keys(pending).length > 0) {
    try {
      starterVersion = (await readPackage(process.env.LT_STARTER_PACKAGE_JSON, STARTER_PACKAGE_JSON_URL, "nuxt-base-starter/package.json (main)")).pkg.version;
    } catch (error) {
      unreadable("the starter's package.json", process.env.LT_STARTER_PACKAGE_JSON || STARTER_PACKAGE_JSON_URL, error);
      return;
    }
  }

  const own = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));
  const { compared, raised, skipped } = pinsVendoringRaises(template.pkg, own);
  const { accepted, failures } = judgePins(raised, pending, starterVersion);

  for (const entry of skipped) {
    console.log(`${TAG} ${entry.section}.${entry.name} is "${entry.current}" in the template: not a version or range, not compared (the CLI skips it too).`);
  }
  for (const { entry, raise } of accepted) {
    console.log(
      `${TAG} pending: ${raise.section}.${raise.name} template ${raise.from} → ${raise.to}, until nuxt-base-starter ${entry.templateFollowsIn} (now ${starterVersion})`,
    );
  }

  if (failures.length === 0) {
    console.log(`${TAG} vendoring raises nothing unexpected: ${compared} shared versions compared with ${template.source}`);
    return;
  }

  process.exitCode = 1;
  for (const failure of failures) console.error(`  ${failure}`);
  console.error(
    `\n${TAG} Vendoring would give a project versions the template's own check never ran with (${template.source}).\n` +
      "  Raise them in nuxt-base-starter (its check runs the type check, lint and tests with them), or keep this\n" +
      "  package on the template's version. When this package has to ship first, add the version to\n" +
      "  scripts/template-pins-pending.json with the starter release that brings the template along.",
  );
}

await main();
