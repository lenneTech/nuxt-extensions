/**
 * The check wrapper's watchdog kills a deadlocked step's whole process tree. On Windows there is
 * neither `pgrep` nor signals, so the old `pgrep -P` walk ended only the shell and orphaned the
 * test workers. `killTreePlan` decides the method; it is pure, so both branches are asserted here
 * from any platform. Nothing in this file sends a signal or starts `taskkill`.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import { killTreePlan } from '../scripts/lib/process-tree.mjs';

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
});

describe('check.mjs uses the plan', () => {
  // Source-level, like check-audit-wiring.test.ts: check.mjs runs main() on import.
  const source = readFileSync(resolve(process.cwd(), 'scripts/check.mjs'), 'utf8');
  const killTree = source.slice(source.indexOf('function killTree('), source.indexOf('function capture('));

  it('asks killTreePlan before walking the tree', () => {
    expect(killTree).toMatch(/const plan = killTreePlan\(child\.pid, signal\);/);
    expect(killTree.indexOf('killTreePlan(')).toBeLessThan(killTree.indexOf('pgrep -P'));
  });

  it('runs the planned command and returns instead of falling through to pgrep', () => {
    expect(killTree).toMatch(/if \(plan\.command\) \{[\s\S]*?execFileSync\(plan\.command, plan\.args,[\s\S]*?return;\s*\}/);
  });
});
