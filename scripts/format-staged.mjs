#!/usr/bin/env node
/**
 * Pre-commit step: format the staged content under src/ in the index, and nothing else.
 * Why it is not `oxfmt --write src/ && git add -u`, and not lint-staged: `lib/format-staged.mjs`.
 *
 * Runs in the repository being committed (the hook's working directory); oxfmt comes from this
 * script's own repository.
 *
 * Exit code: 1 when a staged file cannot be formatted (nothing is changed then), 0 otherwise.
 */

import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { formatStaged, oxfmtFormatter } from "./lib/format-staged.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

const { errors, formatted } = formatStaged({ cwd: process.cwd(), env: process.env, format: oxfmtFormatter(ROOT) });

if (errors.length > 0) {
  for (const { message, path } of errors) console.error(`${path}\n${message}\n`);
  console.error("pre-commit: these staged files could not be formatted. Nothing was changed; fix them and commit again.");
  process.exitCode = 1;
} else if (formatted.length > 0) {
  console.log(`pre-commit: formatted ${formatted.length} staged file(s): ${formatted.join(", ")}`);
}
