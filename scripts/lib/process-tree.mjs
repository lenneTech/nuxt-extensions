/**
 * How to kill a process tree on this platform.
 *
 * Windows has neither `pgrep` nor signals: `process.kill(pid, 'SIGTERM')` there ends the one
 * process and orphans its children, and `taskkill /T` alone was measured to leave the tree
 * running ("Die Beendigung dieses Prozesses muss erzwungen werden") with the port still held.
 * `/F` is what actually frees it, so the whole tree is force-killed in one call.
 *
 * The consequence is worth stating, because it is a behaviour difference and not an
 * implementation detail: on Windows there is no graceful stage. The SIGTERM call already
 * terminates, so a child's graceful-shutdown hook does not run — a server gets no chance to
 * close connections or flush. The SIGKILL escalation five seconds later then finds nothing.
 *
 * Split out as a pure function so both branches can be tested from either platform.
 *
 * Taken verbatim from lt-monorepo `scripts/check.mjs` (origin/main, 3.13.1), where it lives inline.
 * Here it is a module of its own because this repo's `check.mjs` runs `main()` on import, so a
 * function inside it cannot be unit-tested.
 */
export function killTreePlan(pid, signal, platform = process.platform) {
  return platform === "win32" ? { args: ["/PID", String(pid), "/T", "/F"], command: "taskkill" } : { signal };
}
