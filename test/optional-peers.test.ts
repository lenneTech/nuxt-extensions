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

// ---------------------------------------------------------------------------
// Stub-vs-real contract
//
// Everything above asserts the stub in ISOLATION. That is exactly the gap
// `upstream-dom-contract.test.ts` was written to close for reka-ui/@nuxt/ui, and
// exactly the lesson CLAUDE.md records: the 1.13.0 defect shipped because a fixture
// was invented rather than observed. The stub was an invented fixture of a package
// that is a devDependency and therefore observable in-process.
//
// It matters because `src/module.ts` installs the alias into `nuxt.options.alias` AND
// `nuxt.options.nitro.alias` — rewriting the specifier for the WHOLE consumer app, not
// just for our `auth-client.ts`. Any name the real package exports and the stub does
// not becomes an unresolved-export build failure in a consumer:
//
//   "PASSKEY_ERROR_CODES" is not exported by …/passkey-stub
//
// which is the same class of error the stub exists to prevent, merely relocated.
// ---------------------------------------------------------------------------
describe('passkey stub mirrors the real package', () => {
  it('exports every name the real @better-auth/passkey/client exports', async () => {
    const real = await import('@better-auth/passkey/client');
    const stub = await import('../src/runtime/lib/passkey-stub');

    const realNames = Object.keys(real).sort();
    expect(realNames.length, 'expected the real package to export something').toBeGreaterThan(0);

    for (const name of realNames) {
      expect(Object.keys(stub), `stub is missing "${name}", which the aliased specifier promises`).toContain(name);
    }
  });

  it('keeps the same export kinds as the real package', async () => {
    const real = (await import('@better-auth/passkey/client')) as Record<string, unknown>;
    const stub = (await import('../src/runtime/lib/passkey-stub')) as unknown as Record<string, unknown>;

    for (const name of Object.keys(real)) {
      expect(typeof stub[name], `stub export "${name}" should be a ${typeof real[name]}`).toBe(typeof real[name]);
    }
  });

  it('covers every error code the real package defines', async () => {
    const real = await import('@better-auth/passkey/client');
    const stub = await import('../src/runtime/lib/passkey-stub');

    for (const code of Object.keys(real.PASSKEY_ERROR_CODES)) {
      expect(Object.keys(stub.PASSKEY_ERROR_CODES), `error code "${code}" is missing from the stub`).toContain(code);
    }
  });

  it('does NOT claim the real plugin id', async () => {
    // The one place the stub must deliberately DIFFER: claiming `'passkey'` would make
    // Better-Auth expose passkey actions that cannot possibly work.
    const real = await import('@better-auth/passkey/client');
    const stub = await import('../src/runtime/lib/passkey-stub');

    expect(stub.passkeyClient().id).not.toBe(real.passkeyClient().id);
    expect(stub.passkeyClient().id).toBe('lt-passkey-unavailable');
  });

  it('rejects rather than silently succeeding when an action is called', async () => {
    // A passkey ceremony that resolves without the package would leave the caller
    // believing a credential exists.
    const stub = await import('../src/runtime/lib/passkey-stub');
    const actions = stub.getPasskeyActions();

    await expect(actions.signInPasskey()).rejects.toThrow(/not installed/);
    await expect(actions.addPasskey()).rejects.toThrow(/not installed/);
  });
});
