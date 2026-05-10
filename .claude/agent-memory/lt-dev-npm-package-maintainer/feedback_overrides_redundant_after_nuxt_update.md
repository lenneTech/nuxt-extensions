---
name: pnpm overrides become redundant after nuxt 4.4.4 update
description: After upgrading to nuxt 4.4.4 and @nuxt/devtools 3.2.4 in nuxt-extensions, all 21 prior pnpm.overrides entries became redundant — parents now require patched versions natively
type: feedback
---

In the 2026-05-10 maintenance run on @lenne.tech/nuxt-extensions, all 21 entries in `pnpm.overrides` (covering brace-expansion, defu, h3, lodash, minimatch, node-forge, picomatch, postcss, rollup, serialize-javascript, simple-git, srvx, svgo, tar, unhead, vite, yaml) were removed cleanly after upgrading nuxt 4.4.2 → 4.4.4 and @nuxt/devtools 3.2.4 stayed pinned. `pnpm audit` reported zero vulnerabilities without any overrides.

**Why:** Once the direct deps (`nuxt`, `@nuxt/devtools`) bump to versions whose dep ranges natively require patched transitives (e.g. nuxt 4.4.4 requires `nitropack: ^2.13.4`, `vite: ^7.3.2`, `@unhead/vue: ^2.1.13`), the overrides are no-ops. Keeping them adds maintenance noise without security value, and the dangerous `>=X` target pattern can silently jump majors.

**How to apply:**
1. After every meaningful update (especially nuxt/nitropack bumps), test override removal: temporarily set `"overrides": {}`, delete `pnpm-lock.yaml`, run `pnpm install`, then `pnpm audit`. If audit is clean, remove the overrides permanently.
2. Always pin override targets to FIXED versions (`"vite": "7.3.3"` not `">=7.3.2"`) — see TurboOps incident in skill instructions.
3. If overrides are needed temporarily, use Form A (range on LEFT, fixed version on RIGHT: `"vite@<7.3.2": "7.3.3"`) so they only kick in for vulnerable versions.
4. Regenerate the lockfile (`rm pnpm-lock.yaml && pnpm install`) before testing override-removal — `pnpm install` alone won't re-resolve since the lockfile already pins the override-influenced versions.
