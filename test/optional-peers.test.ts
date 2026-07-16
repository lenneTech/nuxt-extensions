import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

// Guards the contract behind `peerDependenciesMeta.<pkg>.optional: true`:
// a project that does not install the package must still be able to BUILD.
//
// The bug this prevents (found in 1.9.1 by building a real consumer project):
// `auth-client.ts` imported `passkeyClient` from the optional `@better-auth/passkey`
// as a static VALUE import. A bundler must resolve such a specifier no matter which
// code path runs, so Vite substituted its optional-peer placeholder and Rollup died:
//
//   "passkeyClient" is not exported by
//   "__vite-optional-peer-dep:@better-auth/passkey/client"
//
// The playground never caught it — it installs every devDependency, so the
// specifier always resolved. Only a consumer install surfaces it.
//
// Three import styles, only one of which is a problem:
//   `import type { Page } from 'peer'`        -> erased at compile time, fine
//   `await import('peer')` / `typeof import(...)` -> lazy, fine (see use-lt-tus-upload)
//   `import { thing } from 'peer'`            -> VALUE import, bundler must resolve it
//
// A static value import is therefore only allowed when src/module.ts aliases the
// specifier onto a stub for absent installs.

const ROOT = process.cwd();
const SRC = resolve(ROOT, 'src');

// `src/runtime/testing/**` is a separate opt-in entry point (`@lenne.tech/nuxt-extensions/testing`).
// It is never pulled into the module's own bundle, so a value import of a test-only
// peer is legitimate there — importing that entry implies you installed the peer.
const OPT_IN_ENTRIES = [join('runtime', 'testing')];

const pkg = JSON.parse(readFileSync(resolve(ROOT, 'package.json'), 'utf8'));

function optionalPeers(): string[] {
  const meta: Record<string, { optional?: boolean }> = pkg.peerDependenciesMeta ?? {};
  return Object.keys(meta).filter((name) => meta[name]?.optional === true);
}

function bundledSources(): string[] {
  return readdirSync(SRC, { recursive: true })
    .map(String)
    .filter((file) => file.endsWith('.ts') || file.endsWith('.vue'))
    .filter((file) => !OPT_IN_ENTRIES.some((entry) => file.startsWith(entry)));
}

/** Static VALUE imports of `peer` (bare or subpath). Type-only imports are excluded. */
function staticValueImports(source: string, peer: string): string[] {
  const spec = peer.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = new RegExp(String.raw`^\s*import\s+(?!type\s)[^;]*?['"]${spec}(?:/[^'"]*)?['"]`, 'gm');
  return source.match(pattern) ?? [];
}

describe('optional peer dependencies', () => {
  const peers = optionalPeers();
  const moduleSource = readFileSync(resolve(SRC, 'module.ts'), 'utf8');

  it('package.json actually declares optional peers (guard is not vacuous)', () => {
    expect(peers.length).toBeGreaterThan(0);
  });

  for (const peer of peers) {
    describe(peer, () => {
      const offenders = bundledSources()
        .map((file) => ({ file, hits: staticValueImports(readFileSync(resolve(SRC, file), 'utf8'), peer) }))
        .filter(({ hits }) => hits.length > 0);

      it('is either lazily imported, or statically imported AND aliased onto a stub', () => {
        if (offenders.length === 0) {
          return; // type-only or dynamic — nothing for the bundler to resolve
        }

        // Statically imported into the bundle: module.ts must make the specifier
        // resolvable for consumers who did not install it.
        const spec = peer.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        expect(moduleSource, `${peer} is statically imported by ${offenders.map((o) => o.file).join(', ')}`)
          .toMatch(new RegExp(String.raw`tryResolveModule\(\s*['"]${spec}`));
        expect(moduleSource, `${peer} needs a stub alias for consumers without the package`)
          .toMatch(new RegExp(String.raw`alias\[['"]${spec}`));
      });
    });
  }
});

describe('@better-auth/passkey stub', () => {
  it('returns a no-op plugin that does not claim the real passkey id', async () => {
    vi.resetModules();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { passkeyClient } = await import('../src/runtime/lib/passkey-stub');

    // Claiming 'passkey' would make Better-Auth surface passkey actions that
    // cannot possibly work without the package.
    expect(passkeyClient().id).toBe('lt-passkey-unavailable');
    warn.mockRestore();
  });

  it('warns once instead of on every call', async () => {
    vi.resetModules();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { passkeyClient } = await import('../src/runtime/lib/passkey-stub');

    passkeyClient();
    passkeyClient();
    passkeyClient();

    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]?.[0]).toContain('@better-auth/passkey');
    warn.mockRestore();
  });

  it('does not throw, so the direct createLtAuthClient() entry point keeps working', async () => {
    vi.resetModules();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { passkeyClient } = await import('../src/runtime/lib/passkey-stub');

    // createLtAuthClient() defaults enablePasskey to true, so a consumer calling
    // it directly (outside the Nuxt module) would hit the stub.
    expect(() => passkeyClient()).not.toThrow();
    warn.mockRestore();
  });

  it('module forces enablePasskey off when the package is absent', () => {
    expect(readFileSync(resolve(SRC, 'module.ts'), 'utf8')).toMatch(/const enablePasskey = .*&& passkeyAvailable/);
  });
});
