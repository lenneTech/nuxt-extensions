/**
 * Keeps `export const version` in src/module.ts in sync with package.json.
 *
 * Nuxt reports this value as the module's `meta.version` (devtools, debug output),
 * so a drifting value misreports which version of the module is running.
 *
 * Modes:
 *   (default)  rewrite src/module.ts to match package.json  — used by `prepack`
 *   --check    verify only, exit 1 on drift                 — used by `check`
 *
 * History: the original pattern only matched double quotes (`version = "..."`)
 * while the oxfmt-formatted source uses single quotes. `String.replace` with a
 * non-matching pattern returns the input unchanged, so the script wrote the file
 * back untouched and reported success — the version silently froze at 1.5.2 for
 * three minor releases. Hence: both quote styles, and a hard failure when the
 * export cannot be found at all, rather than a silent no-op.
 */
import { readFileSync, writeFileSync } from "fs";

const CHECK_ONLY = process.argv.includes("--check");

const version = JSON.parse(readFileSync("package.json", "utf8")).version;
const file = "src/module.ts";
const pattern = /export const version = ['"].*?['"]/;
const content = readFileSync(file, "utf8");

if (!pattern.test(content)) {
  console.error(`[sync-module-version] FAILED: no \`export const version\` found in ${file}.`);
  console.error("[sync-module-version] The export was renamed or removed — update this script.");
  process.exit(1);
}

// Write single quotes to stay oxfmt-clean.
const synced = content.replace(pattern, `export const version = '${version}'`);

if (CHECK_ONLY) {
  if (synced !== content) {
    const current = content.match(pattern)?.[0] ?? "(unknown)";
    console.error(`[sync-module-version] OUT OF SYNC: ${file} has \`${current}\`, package.json has '${version}'.`);
    console.error("[sync-module-version] Fix with: pnpm run version:sync");
    process.exit(1);
  }
  console.log(`[sync-module-version] in sync (${version})`);
  process.exit(0);
}

writeFileSync(file, synced);
console.log(`[sync-module-version] ${version}`);
