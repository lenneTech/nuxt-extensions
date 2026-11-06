#!/usr/bin/env node
/**
 * Fail when vendoring this package would raise a version in nuxt-base-template.
 *
 * `lt fullstack init` (vendor mode) raises every version the template shares with this package to
 * this package's version when that is newer. The template's own `check` (type check, lint, tests)
 * never ran with such a version: vue-tsc 3.3.14 broke a template component that way after 1.24.0.
 * Why versions are compared rather than the template type-checked, and the rule itself:
 * `lib/template-pins.mjs`.
 *
 * Usage:
 *   node scripts/check-template-pins.mjs
 *   LT_TEMPLATE_PACKAGE_JSON=../nuxt-base-starter/nuxt-base-template/package.json node scripts/check-template-pins.mjs
 *
 * Without `LT_TEMPLATE_PACKAGE_JSON` the template's package.json is read from nuxt-base-starter's
 * `main` on GitHub. The variable compares against a local file instead: offline, or to check a
 * template bump before it is released.
 *
 * Exit code: 1 when vendoring would raise a version, or when the template's package.json could not
 * be read (offline is not a pass). A version neither side can compare (`workspace:*`, a URL) is
 * reported and does not fail the step: the CLI skips it as well.
 */

import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { pinsVendoringRaises, TEMPLATE_PACKAGE_JSON_URL } from "./lib/template-pins.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const TAG = "[template-pins]";

/** @returns {Promise<{ pkg: Record<string, any>, source: string }>} */
async function readTemplatePackage() {
  const local = process.env.LT_TEMPLATE_PACKAGE_JSON;
  if (local) {
    const path = resolve(local);
    return { pkg: JSON.parse(readFileSync(path, "utf8")), source: path };
  }
  const response = await fetch(TEMPLATE_PACKAGE_JSON_URL, { signal: AbortSignal.timeout(20_000) });
  if (!response.ok) throw new Error(`HTTP ${response.status} ${response.statusText}`);
  return { pkg: JSON.parse(await response.text()), source: "nuxt-base-template/package.json (main)" };
}

async function main() {
  let template;
  try {
    template = await readTemplatePackage();
  } catch (error) {
    console.error(
      `${TAG} Could not read the template's package.json (${error instanceof Error ? error.message : String(error)}).\n` +
        `  Source: ${process.env.LT_TEMPLATE_PACKAGE_JSON || TEMPLATE_PACKAGE_JSON_URL}\n` +
        "  The versions were NOT compared. Re-run with network access, or point LT_TEMPLATE_PACKAGE_JSON\n" +
        "  at a local copy, e.g. ../nuxt-base-starter/nuxt-base-template/package.json.",
    );
    process.exitCode = 1;
    return;
  }

  const own = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));
  const { compared, raised, skipped } = pinsVendoringRaises(template.pkg, own);

  for (const entry of skipped) {
    console.log(`${TAG} ${entry.section}.${entry.name} is "${entry.current}" in the template: not a version or range, not compared (the CLI skips it too).`);
  }

  if (raised.length === 0) {
    console.log(`${TAG} vendoring raises nothing: ${compared} shared versions compared with ${template.source}`);
    return;
  }

  process.exitCode = 1;
  for (const entry of raised) {
    console.error(`  ${entry.section}.${entry.name}: template ${entry.from} → ${entry.to}`);
  }
  console.error(
    `\n${TAG} Vendoring would raise ${raised.length} version(s) in the template (${template.source}).\n` +
      "  A vendor-mode project would get versions the template's own check never ran with. Raise them in\n" +
      "  nuxt-base-starter first (its check runs the type check, lint and tests with them), or keep this\n" +
      "  package on the template's version until it has.",
  );
}

await main();
