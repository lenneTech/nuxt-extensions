---
name: TS2742 build errors in middleware and plugins
description: Pre-existing TS2742 mkdist type generation errors in middleware/setup.ts and plugins/error-translation.client.ts
type: feedback
---

TS2742 "inferred type of 'default' cannot be named without a reference to nuxt/app" errors existed in the build BEFORE any maintenance changes. They are pre-existing bugs.

**Why:** `defineNuxtPlugin` and `defineNuxtRouteMiddleware` return types reference `nuxt/app` internals via pnpm's `.pnpm/` path which TypeScript cannot make portable in .d.ts files.

**How to apply:**
- For `defineNuxtPlugin`: Add `import type { NuxtApp } from "#app"` and type the nuxtApp parameter as `NuxtApp`
- For `defineNuxtRouteMiddleware`: Cast the export as `ReturnType<typeof defineNuxtRouteMiddleware>` — e.g., `export default defineNuxtRouteMiddleware(fn) as ReturnType<typeof defineNuxtRouteMiddleware>`

The middleware approach (type cast) works when the plugin approach (typing the argument) does not fully resolve the issue for middleware. Both should be applied together when fixing the build.
