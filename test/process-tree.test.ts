/**
 * The check wrapper's watchdog kills a deadlocked step's whole process tree.
 *
 * `killTreePlan` decides the method: taskkill on Windows (no `pgrep`, no signals there), a
 * signal elsewhere, and nothing at all for a pid that is not a process we own. `killTreeWith`
 * executes the plan with every effect injected, so these tests prove it is carried out —
 * taskkill with the plan's arguments, the POSIX tree leaves first and each pid once — without
 * touching a real process. Nothing here signals anything real; the signal guard
 * (test/support/signal-guard.ts, a vitest setup file) fails any test that tries.
 *
 * Ported from lt-monorepo `scripts/kill-tree.test.mjs` (f45cb2c).
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import { isKillablePid, killTreePlan, killTreeWith } from '../scripts/lib/process-tree.mjs';

interface KillTreeEffects {
  childrenOf: (pid: number) => number[];
  platform: NodeJS.Platform;
  run: (command: string, args: string[]) => unknown;
  signal: (pid: number, sig: NodeJS.Signals) => unknown;
}

type Calls = { childrenOf: number[]; run: [string, string[]][]; signal: [number, NodeJS.Signals][] };

/** Records every effect instead of performing it. `tree` maps a pid to its direct children. */
function recorder(platform: NodeJS.Platform, tree: Record<number, number[]> = {}): { calls: Calls; deps: KillTreeEffects } {
  const calls: Calls = { childrenOf: [], run: [], signal: [] };
  const deps: KillTreeEffects = {
    childrenOf: (pid) => {
      calls.childrenOf.push(pid);
      return tree[pid] ?? [];
    },
    platform,
    run: (command, args) => calls.run.push([command, args]),
    signal: (pid, sig) => calls.signal.push([pid, sig]),
  };
  return { calls, deps };
}

/** Everything a failed spawn, a corrupt value or a reserved pid can put in `child.pid`. */
const NOT_OURS: unknown[] = [undefined, null, Number.NaN, '4321', 4321.5, -4321, -1, 0, 1];

describe('killTreePlan', () => {
  it('force-kills the whole tree with taskkill on Windows', () => {
    expect(killTreePlan(4321, 'SIGTERM', 'win32')).toEqual({ args: ['/PID', '4321', '/T', '/F'], command: 'taskkill' });
  });

  it('plans the same force-kill for the SIGKILL escalation on Windows', () => {
    expect(killTreePlan(4321, 'SIGKILL', 'win32')).toEqual({ args: ['/PID', '4321', '/T', '/F'], command: 'taskkill' });
  });

  it.each(['darwin', 'linux'] as const)('keeps the signal walk on %s', (platform) => {
    expect(killTreePlan(4321, 'SIGTERM', platform)).toEqual({ signal: 'SIGTERM' });
  });

  it.each(['win32', 'darwin', 'linux'] as const)('plans nothing for a pid that is not ours (%s)', (platform) => {
    for (const pid of NOT_OURS) expect(killTreePlan(pid, 'SIGTERM', platform), `pid ${String(pid)}`).toBeNull();
  });
});

describe('killTreeWith — pid gate', () => {
  it.each(['win32', 'darwin', 'linux'] as const)('reaches no effect for a pid that is not ours (%s)', (platform) => {
    for (const pid of NOT_OURS) {
      const { calls, deps } = recorder(platform, { 1: [4321] });
      killTreeWith(pid, 'SIGTERM', deps);
      expect(calls, `pid ${String(pid)} on ${platform}`).toEqual({ childrenOf: [], run: [], signal: [] });
    }
  });

  it('refuses the Windows System pids 0 and 4, but not 5', () => {
    for (const pid of [0, 4]) {
      const { calls, deps } = recorder('win32');
      killTreeWith(pid, 'SIGKILL', deps);
      expect(calls.run, `pid ${pid}`).toEqual([]);
    }
    const { calls, deps } = recorder('win32');
    killTreeWith(5, 'SIGKILL', deps);
    expect(calls.run).toEqual([['taskkill', ['/PID', '5', '/T', '/F']]]);
  });

  it('draws the POSIX line between 1 and 2', () => {
    expect(isKillablePid(1, 'linux')).toBe(false);
    expect(isKillablePid(2, 'linux')).toBe(true);
  });
});

describe('killTreeWith — Windows', () => {
  it('runs the plan once and asks neither pgrep nor signals', () => {
    const { calls, deps } = recorder('win32', { 4321: [5000] });
    killTreeWith(4321, 'SIGTERM', deps);
    expect(calls).toEqual({ childrenOf: [], run: [['taskkill', ['/PID', '4321', '/T', '/F']]], signal: [] });
  });

  it('swallows a failing taskkill (tree already gone)', () => {
    const { deps } = recorder('win32');
    deps.run = () => {
      throw new Error('ERROR: The process "4321" not found.');
    };
    expect(() => killTreeWith(4321, 'SIGTERM', deps)).not.toThrow();
  });
});

describe('killTreeWith — POSIX', () => {
  it('signals every pid of the tree, leaves before their parent, each once', () => {
    // 100 ─┬─ 200 ─── 400
    //      └─ 300 ─┬─ 500
    //              └─ 600
    const tree: Record<number, number[]> = { 100: [200, 300], 200: [400], 300: [500, 600] };
    const { calls, deps } = recorder('darwin', tree);
    killTreeWith(100, 'SIGTERM', deps);

    const order = calls.signal.map(([pid]) => pid);
    expect([...order].sort((a, b) => a - b)).toEqual([100, 200, 300, 400, 500, 600]);
    expect(new Set(order).size, 'a pid was signalled twice').toBe(order.length);
    for (const [parent, children] of Object.entries(tree)) {
      for (const child of children) expect(order.indexOf(child), `${child} must die before ${parent}`).toBeLessThan(order.indexOf(Number(parent)));
    }
    expect(calls.signal.every(([, sig]) => sig === 'SIGTERM')).toBe(true);
    expect(calls.run).toEqual([]);
  });

  it('passes SIGKILL through unchanged', () => {
    const { calls, deps } = recorder('linux');
    killTreeWith(4321, 'SIGKILL', deps);
    expect(calls.signal).toEqual([[4321, 'SIGKILL']]);
  });

  it('signals a pid once even when the lookup reports it twice', () => {
    // A pid reused between two pgrep calls can show up under two parents, or loop back.
    const { calls, deps } = recorder('linux', { 100: [200, 200], 200: [100] });
    killTreeWith(100, 'SIGTERM', deps);
    expect(calls.signal).toEqual([
      [200, 'SIGTERM'],
      [100, 'SIGTERM'],
    ]);
  });

  it('drops children that are not ours instead of signalling them', () => {
    const { calls, deps } = recorder('linux', { 100: [1, 0, -1, Number.NaN, 200] });
    killTreeWith(100, 'SIGTERM', deps);
    expect(calls.signal).toEqual([
      [200, 'SIGTERM'],
      [100, 'SIGTERM'],
    ]);
  });

  it('keeps going when the lookup or a signal throws', () => {
    const { calls, deps } = recorder('linux', { 100: [200, 300] });
    const lookup = deps.childrenOf;
    deps.childrenOf = (pid) => {
      if (pid === 200) throw new Error('pgrep: exit 1');
      return lookup(pid);
    };
    const send = deps.signal;
    deps.signal = (pid, sig) => {
      send(pid, sig);
      if (pid === 200) throw Object.assign(new Error('kill ESRCH'), { code: 'ESRCH' });
    };
    killTreeWith(100, 'SIGTERM', deps);
    expect(calls.signal.map(([pid]) => pid)).toEqual([200, 300, 100]);
  });
});

describe('killTreeWith — nothing real by omission', () => {
  it.each(['childrenOf', 'platform', 'run', 'signal'] as const)('throws when `%s` is not injected', (name) => {
    const deps: Partial<KillTreeEffects> = recorder('linux').deps;
    delete deps[name];
    expect(() => killTreeWith(4321, 'SIGTERM', deps as KillTreeEffects)).toThrow(new RegExp(`\`${name}\` must be injected`));
  });
});

describe('check.mjs hands the real effects to killTreeWith', () => {
  // Source-level, like check-audit-wiring.test.ts: check.mjs runs main() on import, and killTree
  // is the one caller that passes the REAL effects, so running it is what this file rules out.
  const source = readFileSync(resolve(process.cwd(), 'scripts/check.mjs'), 'utf8');
  const killTree = source.slice(source.indexOf('function killTree('), source.indexOf('function capture('));

  it('delegates to killTreeWith and signals nothing itself', () => {
    expect(killTree).toContain('killTreeWith(child.pid, signal, {');
    expect(killTree.slice(0, killTree.indexOf('killTreeWith('))).not.toMatch(/process\.kill|execFileSync|pgrep/);
  });

  it('passes the real effects: the running platform, pgrep, taskkill and process.kill', () => {
    // Pinned verbatim. Any one of them swapped passes every recorder test above: `platform:
    // 'linux'` brings back the Windows orphaning, a no-op `signal` leaves the watchdog killing
    // nothing, so a wedged step hangs `check` forever.
    expect(killTree).toContain('childrenOf: pgrepChildren,');
    expect(killTree).toContain('platform: process.platform,');
    expect(killTree).toMatch(/run: \(command, args\) => execFileSync\(command, args, \{ stdio: ['"]ignore['"] \}\),/);
    expect(killTree).toContain('signal: (pid, sig) => process.kill(pid, sig),');
  });

  it('looks up children with execFileSync, not a shell string', () => {
    expect(source).toMatch(/execFileSync\("pgrep", \["-P", String\(pid\)\]/);
    expect(source).not.toMatch(/execSync\(`pgrep/);
  });
});
