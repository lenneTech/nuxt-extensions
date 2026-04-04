---
name: nuxt-extensions project structure
description: Key dependency and build facts about @lenne.tech/nuxt-extensions module
type: project
---

@lenne.tech/nuxt-extensions has only ONE runtime dependency: `@nuxt/kit` (used in src/module.ts). Everything else is devDependencies or peerDependencies.

**Why:** This is a Nuxt module library. Consumers install it as a peer dep; runtime deps must be minimal to avoid bloating consumer installs.

**How to apply:** When doing dependency maintenance, only @nuxt/kit belongs in `dependencies`. All build tools, test frameworks, and peer implementations (better-auth, @better-auth/passkey, tus-js-client, @playwright/test) go in devDependencies.

The `packageManager` field uses pnpm and is tracked in package.json — update it alongside pnpm version bumps.

Build command: `npm run prepack` (runs `nuxt-module-build build`). Tests: `pnpm test` (vitest). No test scripts configured via npm, use pnpm test directly.
