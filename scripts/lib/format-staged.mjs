/**
 * Format what is staged, in the index, and touch nothing else.
 *
 * The pre-commit hook used to run `oxfmt --write src/` and then `git add -u`, so every modified
 * tracked file went into the commit: in a checkout another session works in too, that session's
 * unfinished work. lint-staged, tried next, still works across the whole working tree: it diffs
 * every file before and after its tasks and stages each one whose diff changed (a file another
 * session wrote while it ran went into the commit), and on a failed task it runs
 * `git reset --hard HEAD` (a file another session wrote meanwhile was lost). Both reproduced in
 * the review of DEV-4043.
 *
 * So this reads the staged blob of each file under the given paths, formats exactly that content
 * with oxfmt, and writes the result back to the index with `git update-index`. No stash, no reset,
 * no checkout, no `git add`, and no other file is read or written:
 *
 * - A partially staged file gets its staged part formatted in the index; its working tree, with
 *   the unstaged lines, stays as it is.
 * - A fully staged file is also rewritten in the working tree, but only while it still holds
 *   exactly the staged content.
 * - One file oxfmt cannot format stops the commit, and then nothing is changed at all.
 */

import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";

const MAX_BUFFER = 256 * 1024 * 1024;
/** Symlinks and submodules have no content to format. */
const NOT_FORMATTABLE_MODES = new Set(["120000", "160000"]);

/**
 * @param {readonly string[]} args
 * @param {{ cwd: string, env: NodeJS.ProcessEnv, input?: Buffer }} options
 * @returns {Buffer}
 */
function git(args, { cwd, env, input }) {
  const run = spawnSync("git", args, { cwd, env, input, maxBuffer: MAX_BUFFER });
  if (run.error) throw run.error;
  if (run.status !== 0) throw new Error(`git ${args.join(" ")} exited with status ${run.status}: ${String(run.stderr).trim()}`);
  return run.stdout;
}

/**
 * Staged files (added, copied, modified, renamed) under `paths`, from `git diff --cached --raw -z`.
 *
 * @param {{ cwd: string, env: NodeJS.ProcessEnv, paths: readonly string[] }} options
 * @returns {{ mode: string, path: string, sha: string }[]}
 */
export function stagedEntries({ cwd, env, paths }) {
  const fields = String(git(["diff", "--cached", "--raw", "-z", "--no-renames", "--diff-filter=ACMR", "--", ...paths], { cwd, env }))
    .split("\0")
    .filter(Boolean);
  const entries = [];
  for (let i = 0; i + 1 < fields.length; i += 2) {
    // ":100644 100644 <old sha> <new sha> M", then the path
    const [, mode, , sha] = fields[i].split(" ");
    entries.push({ mode, path: fields[i + 1], sha });
  }
  return entries;
}

/**
 * @typedef {{ output: Buffer } | { skipped: true } | { error: string }} FormatResult
 * @typedef {(path: string, content: Buffer, context: { cwd: string, env: NodeJS.ProcessEnv }) => FormatResult} Formatter
 */

/**
 * oxfmt from `root`'s node_modules, fed through stdin. It reads the config of the repository it
 * runs in and honours its `ignorePatterns` (an ignored path comes back unchanged). Started by its
 * absolute path, so nothing is looked up on PATH.
 *
 * @param {string} root
 * @returns {Formatter}
 */
export function oxfmtFormatter(root) {
  const bin = join(dirname(createRequire(join(root, "package.json")).resolve("oxfmt/package.json")), "bin", "oxfmt");
  return (path, content, { cwd, env }) => {
    const run = spawnSync(process.execPath, [bin, `--stdin-filepath=${path}`], { cwd, env, input: content, maxBuffer: MAX_BUFFER });
    if (run.error) return { error: run.error.message };
    if (run.status === 0) return { output: run.stdout };
    const stderr = String(run.stderr).trim();
    // An image or a font: oxfmt says so, and `oxfmt --write src/` would skip it as well.
    if (/Unsupported file type/i.test(stderr)) return { skipped: true };
    return { error: stderr || `oxfmt exited with status ${run.status}` };
  };
}

/**
 * Formats the staged content of every staged file under `paths` and writes it back to the index.
 *
 * @param {{ cwd: string, env: NodeJS.ProcessEnv, format: Formatter, paths?: readonly string[] }} options
 * @returns {{ errors: { message: string, path: string }[], formatted: string[] }}
 */
export function formatStaged({ cwd, env, format, paths = ["src"] }) {
  /** @type {{ mode: string, output: Buffer, path: string, staged: Buffer }[]} */
  const changes = [];
  const errors = [];

  for (const entry of stagedEntries({ cwd, env, paths })) {
    if (NOT_FORMATTABLE_MODES.has(entry.mode)) continue;
    const staged = git(["cat-file", "blob", entry.sha], { cwd, env });
    const result = format(entry.path, staged, { cwd, env });
    if ("skipped" in result) continue;
    if ("error" in result) {
      errors.push({ message: result.error, path: entry.path });
      continue;
    }
    if (!result.output.equals(staged)) changes.push({ mode: entry.mode, output: result.output, path: entry.path, staged });
  }

  // All or nothing: a commit that is refused leaves the index and the working tree as they were.
  if (errors.length > 0) return { errors, formatted: [] };

  const indexes = indexFiles({ cwd, env });
  for (const change of changes) {
    const sha = String(git(["hash-object", "-w", "--stdin", "--no-filters"], { cwd, env, input: change.output })).trim();
    for (const indexFile of indexes) {
      git(["update-index", "--cacheinfo", `${change.mode},${sha},${change.path}`], {
        cwd,
        env: indexFile ? { ...env, GIT_INDEX_FILE: indexFile } : env,
      });
    }
    writeIfUnchanged(join(cwd, change.path), change.staged, change.output);
  }
  return { errors, formatted: changes.map((change) => change.path) };
}

/**
 * The index files to update: the one git hands the hook, and for `git commit <path>` also the
 * default index. Git commits such a pathspec from a temporary index and writes the default index
 * separately (as `index.lock`); updating only the temporary one would leave the committed file
 * showing as modified afterwards. `undefined` means git's default resolution.
 *
 * @param {{ cwd: string, env: NodeJS.ProcessEnv }} options
 * @returns {(string | undefined)[]}
 */
function indexFiles({ cwd, env }) {
  const active = env.GIT_INDEX_FILE ? resolve(cwd, env.GIT_INDEX_FILE) : undefined;
  if (!active?.endsWith(".lock")) return [active];
  const defaultLock = resolve(cwd, String(git(["rev-parse", "--path-format=absolute", "--git-path", "index.lock"], { cwd, env })).trim());
  return defaultLock === active ? [active] : [active, defaultLock];
}

/**
 * Writes `output` to `file` only while it still holds exactly `expected`. A partially staged file
 * (its unstaged lines) and a file somebody changed since it was staged are left alone.
 *
 * @param {string} file
 * @param {Buffer} expected
 * @param {Buffer} output
 */
function writeIfUnchanged(file, expected, output) {
  let current;
  try {
    current = readFileSync(file);
  } catch {
    return; // staged, but no longer in the working tree
  }
  if (current.equals(expected)) writeFileSync(file, output);
}
