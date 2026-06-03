# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
