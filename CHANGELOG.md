# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.9.0] - 2026-07-15

### Fixed

- **`isAdmin` was permanently `false` against a nest-server backend.** The computed only checked Better-Auth's singular `role: 'admin'` (the admin-plugin shape). But `@lenne.tech/nest-server` registers `roles` as a *core* Better-Auth additionalField (`type: 'string[]'`, `defaultValue: []`) and issues users with `roles: ['admin']` and **no** singular `role` — so against a nest-server backend `isAdmin` was false for every user, real admins included, and the entire admin UI silently disappeared: no error, no warning, a `v-if="isAdmin"` block simply never rendered. `isAdmin` now accepts BOTH shapes: `role === 'admin'` OR `roles` containing `'admin'`. The `roles` read is `Array.isArray`-guarded, because the `lt-auth-state` cookie it reads is client-writable — a malformed value must degrade to `false` rather than throw inside the computed (`roles: 42`) or fail open via `String.prototype.includes` (a bare string `roles: 'superadmin'` would otherwise substring-match `'admin'`).

### Added

- **`LtUser.roles?: string[]`** — the multi-role shape, alongside the existing single-role `LtUser.role?: string`. Purely additive: `role` is untouched, so a Better-Auth admin-plugin backend behaves exactly as before.
- **`useLtAuth().hasRole(role)` / `.hasAnyRole(...roles)`** — guarded role checks that accept BOTH user shapes (Better-Auth `role` and nest-server `roles`), so consuming projects no longer hand-roll the unguarded `user.value?.roles?.includes(x)` — which is open to the same string-`roles` substring-confusion the guard prevents (`roles: 'superadmin'` must not grant `'admin'`). `isAdmin` is now defined as `hasRole('admin')`, so the union + `Array.isArray` guard live in exactly one place.

### Changed

- **`roles` is fail-closed on session merge.** `'roles'` joins the internal `AUTHZ_KEYS` (`banExpires`, `banReason`, `banned`, `emailVerified`, `role`, `roles`, `twoFactorEnabled`), so a cached `roles` array the session omits is dropped from the merge instead of kept — a backend-side admin revocation closes the admin UI on the next session re-validation rather than being masked by a stale array. This costs nothing for backends that never send `roles`: a key is only dropped when the cache carries it and the session omits it, so a `roles`-less backend is a no-op. And nest-server's `defaultValue: []` means its get-session returns `roles` for any user created under it, so the worst case is an honest `[]` (= not an admin), never a spurious drop.
- **Consumer-visible: a nest-server-backed app will now show admin UI where it previously showed none.** This is the fix, not a regression — those users always *were* admins (the backend authorized them as such; only the client-side check was blind), and frontend `isAdmin` gating was never the authorization boundary. If your project papered over the bug with its own `user.roles?.includes('admin')` check, that workaround is now redundant and can be retired. `isAdmin` remains a UX gate only — always enforce admin rights server-side.

### Tests

- Added `test/is-admin.test.ts`: both shapes (`roles: ['admin']` with no singular `role`, `'admin'` among several roles, `role: 'admin'` unchanged), the negatives (non-admin `roles`, empty `roles` array = nest-server's `defaultValue`, non-admin `role`, no user, neither field present), the malformed non-array `roles` guard and its fail-open twin (a bare string `roles`), case-sensitivity, runtime reactivity (promote/demote/logout), the `role`/`roles` union semantics, and the SSR scope (state resolved from the request `Cookie` header).
- Extended `test/merge-session-user.test.ts`: `roles` is dropped when the session omits it (fail-closed → admin UI closes), downgraded when the session sends a lesser array, emptied when the session sends `roles: []` (nest-server's full-demotion shape), kept when the session still grants admin (no spurious drop on re-validation), and the `role`-shape preservation twin for Better-Auth-admin-plugin consumers.

## [1.8.4] - 2026-07-13

### Fixed

- **A 401 no longer triggers a false logout for mislabeled permission errors.** The auth interceptor cleared the session and redirected to login on every 401. But a 401 from a domain endpoint is not proof of an expired session: backends may mislabel permission errors (authenticated user, missing right — semantically 403) as 401, which kicked a logged-in user out of the app over a mere missing right. `handleUnauthorized()` now verifies against `/get-session` before logging out: session alive → treat as a permission error, no logout; session dead → clear state + redirect (real expiry); probe undecided (API unreachable) → keep the user logged in (unreachable ≠ logged out). The probe is recursion-safe via the existing `isHandling401` guard, and an unverifiable probe never logs the user out — so the change is fail-safe (worst case: a dead session is logged out one request late).

### Tests

- Added `test/auth-interceptor.test.ts`: covers all four 401 verdicts (session alive / empty session / session endpoint rejects / probe unreachable), plus the auth-endpoint skip and the unauthenticated no-op.

## [1.8.3] - 2026-07-11

### Fixed

- **Session re-validation no longer drops nest-server-only user fields.** `useLtAuth().validateSession()` (app init / hard reload) and the passkey get-session fallback overwrote the cached user with Better-Auth's get-session payload, which only carries Better-Auth-owned fields (id/email/name + registered additionalFields). Any nest-server-only field (e.g. custom preferences like `leadTableColumns`) was therefore wiped on every reload. Both call sites now route the session user through an id-guarded `mergeSessionUser()` that merges onto the cached user of the SAME identity, so those fields survive. A different / absent / id-less cached identity falls back to the session user verbatim, so one user's fields never leak onto another.

### Changed

- **Authorization fields stay fail-closed across the merge.** `role`, `banned`, `banExpires`, `banReason`, `emailVerified` and `twoFactorEnabled` always reflect the session: any of these the session omits is dropped from the merge result rather than kept, so a backend-side downgrade/revocation is never masked by a stale cached value. A project that adds its own nest-server-only authorization field must register it as a Better-Auth additionalField (so get-session returns it) or add it to the internal `AUTHZ_KEYS` list.
- **`setUser` warns (dev only) when the `lt-auth-state` cookie approaches the ~4 KB browser limit.** Because the merge now keeps nest-server-only fields across reloads, a project storing large preference blobs on the user object could push the cookie over the per-cookie limit, at which point the browser silently rejects the write and the next reload reads as a logout. A dev-mode `console.warn` above ~3.5 KB encoded surfaces this early. Keep the cached user lean — move large preference data off the user object and fetch it from an authenticated API.

### Tests

- Added `test/merge-session-user.test.ts`: the merge invariant through the public `validateSession()` (same-id merge, different-id no-leak, no-cache verbatim), the fail-closed AUTHZ-key behaviour (drop-on-omit + session-overwrite), the both-ids-absent guard, the pending-session wait branch, the empty-session branches, and the passkey get-session fallback call site.

## [1.8.2] - 2026-07-10

### Fixed

- **Restored `buildLtApiUrl` documentation.** A previously inserted comment block had been placed between `buildLtApiUrl`'s JSDoc and the function, orphaning the entire API doc (resolution strategy, deployment table, `@param`). The doc is re-attached and the function now carries its full JSDoc again.
- **Corrected the "no API URL configured" warning.** The message is now scope-specific: the client variant names the app-origin/404 consequence and asks only for `NUXT_PUBLIC_API_URL`; the SSR variant explains that relative paths never reach the backend and asks for `NUXT_API_URL` / `NUXT_PUBLIC_API_URL`. A browser is never told to set the server-only `NUXT_API_URL` (enforced by test). Each warning fires at most once per process/page load instead of on every render.

### Added

- **`lt-config-check` plugin.** Validates the resolved API URL once at app init (per SSR request, deduplicated) instead of relying on whichever code path builds the first URL. Shares a one-shot warning key with `buildLtApiUrl`, so a misconfigured app reports the problem exactly once. Auto-registered — no configuration.

### Changed

- **Extracted a pure `resolveLtApiBaseUrl()`** from `buildLtApiUrl`, and consolidated the two ad-hoc "warn once" flags (`_proxyFallbackWarned` and the missing-URL warnings) into a single shared `warnOnce()` helper backed by a bounded key set. Behaviour is unchanged; the URL builder is now side-effect-free and testable. New internal exports (`resolveLtApiBaseUrl`, `warnMissingLtApiUrl`, `resetLtWarnOnceState`, `LtApiUrlResolution`) are plumbing only — absent from the package barrels and auto-imports, marked `INTERNAL`.
- Corrected stale documentation that promised an implicit `http://localhost:3000` API fallback (README URL-resolution section, `LtAuthModuleOptions.baseURL` / `LtAuthClientConfig.baseURL` JSDoc). There is no such fallback — an unset URL keeps API paths relative to the app origin.

### Tests

- **Test infra:** the vitest `import.meta` shim previously hard-substituted `import.meta.server` to `false`, making every SSR branch unreachable from unit tests. It now reads `globalThis.__ltTestRenderScope` (new `test/stubs/render-scope.ts` helper), so SSR branches are testable; unset defaults to the client scope, preserving all existing tests.
- Added `test/api-url-warnings.test.ts` covering warn-once semantics, client/server scope separation, the reset hook, server fallback chain, proxy mode + explicit opt-out, trailing-slash stripping, swallow-on-error contracts, and the `lt-config-check` plugin wiring.

## [1.8.0] - 2026-06-03

### Fixed

- **Random logout / "session loss" via SSR cookie write.** The auth composable wrote a default `{ user: null }` `lt-auth-state` cookie during SSR. With a backend-set, domain-scoped auth-state cookie (e.g. a SAML callback using `Domain=<appHost>`), this host-only `{ user: null }` twin shadowed the real session, so SSR auth guards intermittently bounced perfectly valid sessions to the login page. SSR no longer emits a clearing cookie: `setUser` only persists a user-bearing state on the server, `clearUser` is client-only, and the composable resolves auth state from the raw request `Cookie` header instead.
- **Duplicate-tolerant auth-state read** (`resolveLtAuthState`): when a host-only and a domain-scoped `lt-auth-state` cookie disagree, the user-bearing one now wins instead of a stale `{ user: null }`. `getLtAuthMode`, `isLtAuthenticated`, `getLtJwtToken` and `setLtAuthMode` all use this read.
- `clearLtAuthCookies` now expires BOTH the host-only and the domain-scoped cookie slot, so no "logged out" twin lingers after logout.

### Added

- **Opt-in per-project cookie namespace** via `cookiePrefix` (`NUXT_PUBLIC_COOKIE_PREFIX` → `runtimeConfig.public.cookiePrefix`). When set, the auth cookies become `<prefix>-auth-state` / `<prefix>-jwt-token`, so several lenne.tech apps can run on a shared host (e.g. `localhost`, where cookies collide by host — not port) without reading each other's session ("ghost" user). Unset → the legacy `lt-auth-state` / `lt-jwt-token` names (**fully backward compatible** — no project's cookie name changes on upgrade). Mirror the value on the backend via the `COOKIE_PREFIX` env (`@lenne.tech/nest-server` matching release) so both sides agree on the name. The prefix is sanitised to valid cookie-name characters. NOTE: `storagePrefix` deliberately does **not** influence cookie names (it is a localStorage-namespacing concern; coupling it would silently rename cookies on upgrade).

### Tests

- Added `resolveLtAuthState` twin-resolution tests (prefer user-bearing, malformed, fallback, custom name), `cookiePrefix` resolution + sanitisation tests, and a `useRequestHeaders` test stub.

## [1.7.1] - 2026-05-31

### Fixed

- Six 1.7.0 public AI types were defined but unreachable via the package entry — they existed in `src/runtime/types/ai.ts` but were missing from the manually-maintained re-export block in `src/module.ts`, so `nuxt-module-builder` emitted a `dist/types.d.mts` without them. Consumers got `TS2614: Module '"@lenne.tech/nuxt-extensions"' has no exported member ...` for: `LtAiPrompt`, `LtAiEffectiveSlot`, `LtAiPlaceholder`, `LtAiPromptRunInput`, `UseLtAiPromptsReturn`, `UseLtAiPlaceholdersReturn`.
- `LtAiModuleOptions` was likewise defined in `src/runtime/types/module.ts` but missing from the runtime types barrel, so it was unreachable from `src/index.ts`.

### Changed

- **Root-cause fix.** Replaced the three hand-maintained type re-export lists in `src/module.ts`, `src/index.ts`, and the runtime barrel with a single source of truth: `src/runtime/types/index.ts` re-exports every public type, and both entry files forward via `export type * from './runtime/types'`. No new type can be added now and silently miss the public surface.
- Added `test/public-exports.test.ts`, a Vitest spec that diffs every `export interface | export type` in `src/runtime/types/*.ts` against the barrel and fails if a type is missing.

## [1.7.0] - 2026-05-30

### Added

- **AI assistant composables** for the `@lenne.tech/nest-server` AI module
  - `useLtAi()` — one-shot prompts + SSE streaming
  - `useLtAiChat()` — multi-turn conversation with budget summary + context-window utilization + confirmation gate, optional `maxMessages` cap, auto-`stop()` on component unmount
  - `useLtAiConnections()` — user self-service connection selection
  - `useLtAiUsage()` — token usage info per user / tenant
  - `useLtAiAdmin()` — admin CRUD (connections, preferences, budget limits, slots, prompt hints, interactions)
- **Slot-management composable extensions** (matching the nest-server tenant-scoped slot store)
  - `listEffectiveSlots()` — framework defaults + tenant overrides + custom rows with `isSystem` / `isOverride` flags
  - `resetSlot(id)` — delete a tenant override → framework default applies again
- **User-facing prompt composable** `useLtAiPrompts()` — owner-scoped CRUD for re-usable user prompts ("Vorlagen") with `scope: 'user'` (private) / `'tenant'` (public)
- **Placeholder registry composable** `useLtAiPlaceholders()` — loads `{{placeholder}}` definitions from the backend so editors render a dynamic helper sidebar without hard-coded names
- **Types** — `LtAiBudgetSummary` (with cumulative `usedTokens` at every scope incl. `'llm'`), `LtAiEffectiveSlot`, `LtAiPlaceholder`, `LtAiPrompt`, `LtAiPromptInput`, `LtAiPromptRunInput`, `LtAiSlot`, `LtAiSlotInput`

### Changed

- Chat composable `messages` ref is now `shallowReadonly` so child components can bind individual messages while preserving streaming reactivity
- `parseLtAiSseStream()` now accepts an optional `{ signal?: AbortSignal }` parameter and bails out on a single line larger than 1 MiB (guards against a misbehaving proxy that never emits a newline)
- `ltAiResponseError()` caps the extracted backend message at 1 KiB and types the resulting Error as `Error & { status: number }` so consumers can branch on HTTP status without re-parsing
- `ltAiRequest()` sends `Accept: application/json` on every request for deterministic content negotiation
- `package.json` declares `"sideEffects": false` so conservative bundlers tree-shake unused composables (notably when `ai.enabled: false`)

### Breaking

- **Pre-release AI builds only.** Projects that never installed a pre-release AI build aren't affected.
  - `useLtAiSnippets()` → `useLtAiPrompts()` (follows nest-server `Snippet → Prompt`)
  - Internal Slot/Template alignment (nest-server `Template → Slot`)
  - Rename map:
    - `useLtAiSnippets` → `useLtAiPrompts`
    - `LtAiPromptSnippet` → `LtAiPrompt`
    - `LtAiPromptSnippetInput` → `LtAiPromptInput` (CRUD input for `LtAiPrompt`)
    - `LtAiPromptTemplate` → `LtAiSlot`
    - `LtAiPromptTemplateInput` → `LtAiSlotInput`
    - `UseLtAiSnippetsReturn` → `UseLtAiPromptsReturn` (`snippets` ref → `prompts`)
  - **`LtAiPromptInput` (execution payload) → `LtAiPromptRunInput`.** The CRUD input for `LtAiPrompt` now owns the `LtAiPromptInput` name (`Entity + EntityInput` convention). The execution payload used by `useLtAi.prompt()` / `useLtAi.promptStream()` has been renamed to `LtAiPromptRunInput` to resolve the duplicate-interface declaration merge that silently produced an invalid public type.
  - **`LtAiBudgetSummary.usedTokens` semantics.** Now the running per-period total at every scope (previously per-request `promptTokens` under `scope: 'llm'`). Any UI that displayed `usedTokens` under the `'llm'` scope as a per-request value should be updated to read `promptTokens` instead.

## [1.1.0] - 2026-01-24

### Added

- **Playwright Testing Helpers**
  - New `/testing` export path for E2E test utilities
  - `createPlaywrightHelpers()` factory for auth-aware testing
  - Login/logout helpers with session management
  - Form filling and navigation utilities
  - API request helpers with authentication
  - Wait utilities for network and element states

- **Error Translation System**
  - `useLtErrorTranslation()` composable for translating API errors
  - Automatic i18n integration with fallback support
  - Configurable error mapping for backend error codes
  - Support for nested error structures

- **Enhanced Auth State Management**
  - Improved `useLtAuthClient()` with better reactivity
  - Extended auth state tracking with loading states
  - Better session refresh handling
  - Improved 2FA redirect flow

### Changed

- Added `@playwright/test` as optional peer dependency
- Enhanced `auth-interceptor.client.ts` with better error handling
- Added `check` npm script for full validation pipeline
- Added TypeScript type checking to release script

### Fixed

- Auth state synchronization issues
- Cookie/JWT mode switching edge cases

## [1.0.0] - 2026-01-24

### Added

- **Better-Auth Integration**
  - `useLtAuth()` composable with full authentication lifecycle management
  - `useLtAuthClient()` / `ltAuthClient` for direct Better-Auth client access
  - `createLtAuthClient()` factory for custom configurations
  - Cookie/JWT dual-mode authentication with automatic fallback
  - Password hashing (SHA256) for nest-server compatibility
  - Passkey/WebAuthn support for passwordless authentication
  - Two-Factor Authentication (2FA/TOTP) support
  - Auto-logout on 401 via auth-interceptor plugin

- **TUS File Upload**
  - `useLtTusUpload()` composable for resumable file uploads
  - Pause/resume functionality
  - Progress tracking with speed calculation
  - Parallel upload support
  - `useLtFile()` utility for file size formatting

- **Transition Components**
  - `<LtTransitionFade>` - Fade in/out animation
  - `<LtTransitionSlide>` - Slide animation
  - `<LtTransitionSlideBottom>` - Slide from bottom
  - `<LtTransitionSlideRevert>` - Reversed slide
  - `<LtTransitionFadeScale>` - Fade with scale effect

- **Utility Functions**
  - `useLtShare()` - Web Share API with clipboard fallback
  - `tw()` - Tailwind CSS template literal helper
  - `ltSha256()` - SHA256 hashing utility
  - `ltArrayBufferToBase64Url()` / `ltBase64UrlToUint8Array()` - WebAuthn crypto utilities

- **i18n Support**
  - English and German translations included
  - Graceful degradation without @nuxtjs/i18n
  - German fallback for single-language projects

- **TypeScript Support**
  - Full type definitions for all exports
  - Auto-imports via Nuxt module system
  - Module augmentation for nuxt.config.ts

### Configuration Options

```typescript
ltExtensions: {
  auth: {
    enabled: true,
    baseURL: '',
    basePath: '/iam',
    loginPath: '/auth/login',
    twoFactorRedirectPath: '/auth/2fa',
    enableAdmin: true,
    enableTwoFactor: true,
    enablePasskey: true,
    interceptor: {
      enabled: true,
      publicPaths: [],
    },
  },
  tus: {
    defaultEndpoint: '/files/upload',
    defaultChunkSize: 5242880, // 5MB
  },
  i18n: {
    autoMerge: true,
  },
}
```

### Compatibility

- Nuxt 3.x and 4.x
- Vue 3.x
- @lenne.tech/nest-server backend
- better-auth ^1.0.0
- tus-js-client ^4.0.0 (optional)
- @better-auth/passkey ^1.0.0 (optional)

[1.1.0]: https://github.com/lenneTech/nuxt-extensions/releases/tag/1.1.0
[1.0.0]: https://github.com/lenneTech/nuxt-extensions/releases/tag/1.0.0
