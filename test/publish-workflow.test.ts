// @vitest-environment node
/**
 * `.github/workflows/publish.yml` publishes through npm Trusted Publishing (OIDC, DEV-3143).
 *
 * The workflow runs once per release, after the tag and the GitHub release exist. A mistake here
 * shows on a release day as a half release: tag and release on GitHub, nothing on npm (1.16.0, an
 * expired NPM_TOKEN). These tests pin what the OIDC path needs, offline:
 *  - `id-token: write`, or npm never sees an OIDC token and the publish fails;
 *  - the npm CLI, because JS-DevTools/npm-publish takes a token and cannot do OIDC;
 *  - an npm >= 11.5.1, pinned to a major, so no new npm major arrives in a release run untried;
 *  - every gate before the publish, and no long-lived token anywhere (4.0.1 proved OIDC).
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const WORKFLOW = readFileSync(resolve(process.cwd(), '.github/workflows/publish.yml'), 'utf8');

// Comments explain the steps and name the old action; only the YAML itself counts.
const CODE = WORKFLOW.split('\n')
  .filter((line) => !/^\s*#/.test(line))
  .join('\n');

const STEPS_MARKER = '\n    steps:\n';
const STEPS = CODE.slice(CODE.indexOf(STEPS_MARKER) + STEPS_MARKER.length)
  .split(/\n(?=      - )/)
  .map((step) => step.trim())
  .filter(Boolean);

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function stepIndex(pattern: RegExp): number {
  return STEPS.findIndex((step) => pattern.test(step));
}

const PUBLISH = stepIndex(/^- name: Publish\n\s+run: npm publish\b/);

describe('publish.yml — npm Trusted Publishing (DEV-3143)', () => {
  it('finds the job steps it checks', () => {
    expect(CODE).toContain(STEPS_MARKER);
    expect(STEPS.length).toBeGreaterThan(8);
  });

  it('lets the job request an OIDC token, and nothing more', () => {
    const block = /^permissions:\n((?: {2}\S[^\n]*\n?)+)/m.exec(CODE)?.[1] ?? '';
    const entries = Object.fromEntries(block.trim().split('\n').map((line) => line.trim().split(/:\s*/)));

    expect(entries).toEqual({ contents: 'read', 'id-token': 'write' });
  });

  it('publishes with the npm CLI as the last step, never with a token-only action', () => {
    expect(CODE).not.toMatch(/JS-DevTools\/npm-publish/);
    expect(PUBLISH).toBe(STEPS.length - 1);
    expect(STEPS.filter((step) => /\bnpm publish\b/.test(step))).toHaveLength(1);
  });

  it('has one job, and that job keeps the workflow-level permissions', () => {
    // A job-level `permissions:` REPLACES the workflow-level block for that job, it does not add
    // to it: one without `id-token` silently drops OIDC, and the publish falls back to the token.
    expect(CODE).not.toMatch(/^ {4}permissions:/m);
    // The steps are read as one list: a second job would run in parallel, without the gates.
    const jobs = CODE.slice(CODE.indexOf('\njobs:\n')).match(/^ {2}[\w-]+:[ \t]*$/gm) ?? [];
    expect(jobs).toEqual(['  publish:']);
  });

  it('publishes the build the gates checked, with no lifecycle script next to the token', () => {
    // npm runs `prepack` (nuxt-module-build) unless told not to: third-party build code in the
    // step that obtains the publish token, and a second build after check:manifest looked at the first.
    expect(STEPS[PUBLISH]).toMatch(/\brun: npm publish\b[^\n]*\s--ignore-scripts\b/);
  });

  it('runs every gate before the publish', () => {
    const gates = ['pnpm install', 'pnpm format:check', 'pnpm run version:check', 'pnpm dev:prepare', 'pnpm lint', 'pnpm test', 'pnpm build', 'pnpm run check:manifest'];
    const indexes = gates.map((gate) => stepIndex(new RegExp(`\\brun: ${escapeRegExp(gate)}$`, 'm')));

    for (const [i, gate] of gates.entries()) {
      expect(indexes[i], gate).toBeGreaterThanOrEqual(0);
      expect(indexes[i], gate).toBeLessThan(PUBLISH);
    }
    expect(indexes).toEqual([...indexes].sort((a, b) => a - b));
  });

  it('installs an npm that can do Trusted Publishing, pinned to a major, before the publish', () => {
    const upgrade = stepIndex(/\brun: npm install -g npm@/);
    const spec = /\brun: npm install -g npm@(\S+)/.exec(STEPS[upgrade] ?? '')?.[1] ?? '';
    const nodeMajor = Number(/node-version: \[(\d+)\.x\]/.exec(CODE)?.[1]);

    expect(upgrade).toBeGreaterThanOrEqual(0);
    expect(upgrade).toBeLessThan(PUBLISH);
    // `latest`, `next` or a caret/tilde range would let a new major in unseen.
    expect(spec).toMatch(/^\d+$/);
    // OIDC needs npm >= 11.5.1, which `npm@11` resolves to; npm 12 needs Node ^24.15.0.
    expect(Number(spec)).toBeGreaterThanOrEqual(11);
    expect(nodeMajor).toBeGreaterThanOrEqual(Number(spec) >= 12 ? 24 : 22);
  });

  it('lets setup-node write the .npmrc entry for registry.npmjs.org', () => {
    const setupNode = STEPS[stepIndex(/uses: actions\/setup-node@/)] ?? '';

    expect(setupNode).toMatch(/^\s+registry-url: https:\/\/registry\.npmjs\.org\/?$/m);
  });

  it('uses no long-lived npm token: OIDC only, since 4.0.1 proved it', () => {
    // With a token configured, npm silently uses it whenever the OIDC exchange fails and
    // publishes without provenance, so a broken Trusted Publisher would go unnoticed.
    expect(CODE).not.toMatch(/secrets\.NPM_TOKEN|NODE_AUTH_TOKEN|NPM_CONFIG_\w*AUTH|_authToken/i);
  });
});
