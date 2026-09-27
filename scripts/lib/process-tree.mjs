/**
 * The watchdog's process-tree kill, minus the real effects.
 *
 * `isKillablePid`, `killTreePlan` and `killTreeWith` are taken from lt-monorepo
 * `scripts/check.mjs` (f45cb2c), where they live inline. Here they are a module of their own
 * because this repo's `check.mjs` runs `main()` on import, so a function inside it cannot be
 * unit-tested. The one caller that passes the REAL effects (`killTree` in check.mjs) stays
 * there, so importing this module can never reach a real `taskkill`, `pgrep` or signal.
 */

/**
 * Whether a number may become a kill target at all.
 *
 * A spawn that failed leaves `child.pid` undefined. On POSIX that only made `pgrep` and
 * `process.kill` throw, but on Windows it became `taskkill /PID undefined /T /F` — a kill
 * command built from a word that is not a pid. And the small numbers are not processes you
 * own: POSIX pid 1 is init/launchd, and 0 and -1 are the group and the kill(2) broadcast to
 * every process of the user (the shape that rebooted a Mac on 2026-09-23). Windows reserves
 * 0 (System Idle) and 4 (System). Nothing a check step spawns can have any of these pids.
 */
export function isKillablePid(pid, platform = process.platform) {
  return Number.isInteger(pid) && pid > (platform === "win32" ? 4 : 1);
}

/**
 * How to kill a process tree on this platform, or null when `pid` must not be touched.
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
 */
export function killTreePlan(pid, signal, platform = process.platform) {
  if (!isKillablePid(pid, platform)) return null;
  return platform === "win32" ? { args: ["/PID", String(pid), "/T", "/F"], command: "taskkill" } : { signal };
}

/**
 * Kill `pid` and its whole process tree, with every effect injected.
 *
 * Injecting the platform alone is not enough: the effects would still run for real, against
 * this machine, with whatever pid the test chose. So all four are required and nothing
 * defaults — a test cannot reach a real `taskkill`, `pgrep` or `process.kill` by leaving one
 * out. `killTree` below is the only caller that passes the real ones.
 *
 * - `run(command, args)` executes the Windows plan.
 * - `childrenOf(pid)` returns the direct children of `pid` (POSIX).
 * - `signal(pid, sig)` delivers `sig` to `pid` (POSIX).
 *
 * POSIX order is leaves first, so a parent cannot respawn a child that was just killed, and
 * each pid is signalled at most once. Pids a lookup returns pass the same check as the root —
 * a stray 1 in `pgrep` output must not become a signal to init.
 */
export function killTreeWith(pid, sig, { childrenOf, platform, run, signal }) {
  for (const [name, fn] of Object.entries({ childrenOf, run, signal })) {
    if (typeof fn !== "function") throw new TypeError(`killTreeWith: \`${name}\` must be injected`);
  }
  if (typeof platform !== "string") throw new TypeError("killTreeWith: `platform` must be injected");
  const plan = killTreePlan(pid, sig, platform);
  if (!plan) return;
  if (plan.command) {
    try {
      run(plan.command, plan.args);
    } catch {
      /* already gone, or taskkill refused — nothing further to try */
    }
    return;
  }
  const seen = new Set();
  const order = [];
  const collect = (p) => {
    if (seen.has(p) || !isKillablePid(p, platform)) return;
    seen.add(p);
    let children = [];
    try {
      children = childrenOf(p);
    } catch {
      /* no children */
    }
    for (const c of children) collect(c);
    order.push(p);
  };
  collect(pid);
  for (const p of order) {
    try {
      signal(p, plan.signal);
    } catch {
      /* already gone */
    }
  }
}
