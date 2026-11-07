# Versioning Strategy

## Version Schema: `MAJOR.MINOR.PATCH`

The same scheme in every lenne.Tech base repository, modelled on `@lenne.tech/nest-server` (repo owner,
2026-11-07). In force since 4.0.0.

| Part    | Meaning                                                                                                              |
| ------- | -------------------------------------------------------------------------------------------------------------------- |
| `MAJOR` | Mirrors the Nuxt major version (`4.x.x` = Nuxt 4: `@nuxt/kit ^4`, peer `nuxt ^4.0.0`)                                |
| `MINOR` | A change a project has to act on when it updates (behaviour, code or configuration), always with a migration guide  |
| `PATCH` | Improvements (bugfixes) or additions (new features) a project takes over without doing anything                      |

## Examples

- `4.0.0` -> First release on this scheme, for Nuxt 4. It follows 1.28.0 directly; 2.x and 3.x were skipped on
  purpose and never published (1.x was the Nuxt 4 line with a major that did not say so)
- `4.1.0` -> A change projects have to migrate, with `migration-guides/4.0.x-to-4.1.0.md`
- `4.1.5` -> Bugfix or new feature (drop-in)
- `5.0.0` -> Only for Nuxt 5

## Important Rules

0. **Never promote a breaking change to a MAJOR.** The MAJOR digit states which Nuxt major this module targets and
   moves only when Nuxt does. A changed default, a removed export, a changed signature, a renamed `NUXT_*` variable, a
   peer dependency a project has to add: all of them are MINOR releases here, however big they feel. This is the rule
   most likely to be broken by ordinary semver reflexes, and the moment it happens is exactly when a change feels big
   enough to "deserve" a major.
1. **Every MINOR release ships a migration guide** in `migration-guides/` and names it in its `CHANGELOG.md` section.
   A change that needs no action from a project is a PATCH, not a MINOR.
2. **nuxt-base-starter carries the same version** (repo owner, 2026-11-07: the starter always has the version of the
   base package it builds on). Every version published to npm is followed by a nuxt-base-starter release with the same
   number that pins it exactly, also when the bump is the only change. Starter changes between two releases of this
   module get no version of their own. The starter follows this module, never the other way round.
3. **Consider downstream impact**: projects consume this module via npm and as a vendored copy in `app/core/` (the lt
   CLI copies `src/`). A caret range takes MINOR releases, so the starters pin the exact version.

## Release Process

1. Changes are on `main`; `pnpm run check` passes
2. Bump `version` in `package.json`, then `pnpm run version:sync` (writes `version` in `src/module.ts`;
   `pnpm run version:check` is part of `pnpm run release`)
3. Add `## [<version>] - <date>` as the newest section of `CHANGELOG.md` (`test/module-version-sync.test.ts` fails
   otherwise); for a MINOR add the migration guide (rule 1)
4. `pnpm run release` (format, lint, version check, types, tests, consumer build, pack) and `pnpm run check`
5. Commit `<version>: <summary>` on `main` and push
6. `gh release create <version>` with the bare version as tag (no `v`) and consumer-oriented English notes;
   `.github/workflows/publish.yml` publishes to npm when the release is published, through Trusted Publishing
   (OIDC) with provenance, since 4.0.1 and without a token fallback (DEV-3143). A failed OIDC exchange fails the
   publish: check the Trusted Publisher on npmjs.com (lenneTech / nuxt-extensions / publish.yml), then
   `gh run rerun --failed`. Provenance:
   `https://registry.npmjs.org/-/npm/v1/attestations/@lenne.tech%2fnuxt-extensions@<version>` answers 200
7. Wait until `https://registry.npmjs.org/@lenne.tech/nuxt-extensions/<version>` answers 200, then release
   nuxt-base-starter with the same version (rule 2); `/lt-dev:publish nuxt-extensions` runs steps 2 to 7

### Version Consistency Check

```bash
# Both must print the same version
grep -m1 '"version"' package.json
grep -m1 'export const version' src/module.ts
```

## Package Distribution

- **npm package**: `@lenne.tech/nuxt-extensions`
- **`.`**: `dist/module.mjs`, the Nuxt module and every type
- **`./lib`**: runtime helpers outside the auto-imports (`src/runtime/lib/index.ts`)
- **`./testing`**: Playwright helpers (`src/runtime/testing/index.ts`)
- **Vendored entry**: `src/index.ts`, copied to `app/core/index.ts` by the lt CLI
