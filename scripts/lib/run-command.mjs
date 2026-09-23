/**
 * Run an npm-installed command (`npm`, `pnpm`, `npx`) synchronously, on every platform.
 *
 * On Windows those commands are `.cmd` shims. `execFileSync("npm", …)` does not resolve
 * PATHEXT and fails with ENOENT; `execFileSync("npm.cmd", …)` is refused with EINVAL since the
 * CVE-2024-27980 fix; `shell: true` concatenates the arguments unescaped (Node DEP0190). Measured
 * on the Windows CI runner, Node 24.20.0. cross-spawn resolves the shim and escapes the arguments,
 * and on macOS/Linux it is a plain `spawnSync` — the same answer the lenne.tech CLI uses
 * (`src/lib/platform.ts`, `spawnCmdSync`).
 *
 * Throws on a spawn error or a non-zero exit. The error message always names the command and why
 * it failed (spawn error code or exit status), and carries `stdout` / `stderr` — so a caller that
 * prints `error.message` can never print an empty reason. The previous callers printed only
 * `stdout + stderr`, which are both empty when the process never started.
 */

import crossSpawn from "cross-spawn";

/**
 * @param {string} command
 * @param {readonly string[]} args
 * @param {import("node:child_process").SpawnSyncOptions} [options]
 * @returns {string} stdout
 */
export function runCommandSync(command, args = [], options = {}) {
  const result = crossSpawn.sync(command, [...args], { encoding: "utf8", ...options });
  const line = [command, ...args].join(" ");
  const stdout = String(result.stdout ?? "");
  const stderr = String(result.stderr ?? "");

  let reason;
  if (result.error) reason = `could not start (${result.error.code ?? result.error.message})`;
  else if (result.signal) reason = `was killed by ${result.signal}`;
  else if (result.status !== 0) reason = `exited with status ${result.status}`;
  if (!reason) return stdout;

  const error = new Error(`\`${line}\` ${reason}`);
  error.code = result.error?.code;
  error.status = result.status;
  error.stdout = stdout;
  error.stderr = stderr;
  error.cause = result.error;
  throw error;
}

/**
 * Human-readable failure report: the reason line, then the tail of the command's own output.
 *
 * @param {unknown} error
 * @param {number} [tailLines]
 */
export function describeCommandFailure(error, tailLines = 10) {
  const e = /** @type {{ message?: string, stdout?: string, stderr?: string }} */ (error);
  const output = `${e?.stdout ?? ""}${e?.stderr ?? ""}`.trim();
  const tail = output ? `\n${output.split("\n").slice(-tailLines).join("\n")}` : "";
  return `${e?.message ?? String(error)}${tail}`;
}
