# @lenne.tech/nuxt-extensions

Reusable Nuxt 4 module providing composables, components, utilities, and Better Auth integration for lenne.tech projects.

## Architecture

```
src/
├── module.ts              # Nuxt module entry point (auto-imports, plugin registration)
├── runtime/
│   ├── composables/       # Auto-imported composables
│   ├── components/        # Auto-imported components
│   ├── lib/               # Library exports (auth-client, auth-state, ai)
│   ├── middleware/        # Route middleware (system setup)
│   ├── plugins/           # Nuxt plugins (auth interceptor, error translation, config check)
│   ├── server/            # server-side tsconfig scope (no runtime routes; auth talks to the backend directly)
│   ├── testing/           # Playwright test helpers
│   ├── types/             # TypeScript type definitions
│   └── utils/             # Auto-imported utility functions
```

## Key Composables

### Auth + uploads + utilities

| Composable | Purpose |
|-----------|---------|
| `useLtAuth()` | Authentication state, login, logout, session management |
| `useLtAuthClient()` | Raw Better Auth client access |
| `useSystemSetup()` | First-admin setup flow |
| `useLtTusUpload()` | TUS resumable file uploads |
| `useLtFile()` | File utilities (size formatting, URLs) |
| `useLtShare()` | Web Share API with clipboard fallback |
| `useLtErrorTranslation()` | Translate backend error codes |

### AI assistant (nest-server AI module)

| Composable | Purpose |
|-----------|---------|
| `useLtAi()` | One-shot `prompt()` + streaming `promptStream()` (POST `/ai/prompt` / `/ai/stream`) |
| `useLtAiChat()` | Multi-turn chat: streaming, budget summary, confirmation gate, `stop()`/`clear()`, optional `maxMessages` cap, auto-stop on unmount |
| `useLtAiConnections()` | User-facing list of available connections + `select()` |
| `useLtAiUsage()` | Full token/prompt usage breakdown (`GET /ai/usage`) |
| `useLtAiPrompts()` | User-facing CRUD for re-usable prompt snippets ("Vorlagen", `scope: 'user'` / `'tenant'`) |
| `useLtAiPlaceholders()` | Loads the backend's `{{placeholder}}` registry for editor sidebars |
| `useLtAiAdmin()` | Admin CRUD: connections, preferences, budget limits, slots, prompt hints, interactions — server-gated |

## Module Configuration

Configure in `nuxt.config.ts` (top-level key is `ltExtensions`):

```typescript
export default defineNuxtConfig({
  modules: ['@lenne.tech/nuxt-extensions'],
  ltExtensions: {
    auth: {
      enabled: true,
      basePath: '/iam',              // Better-Auth endpoint prefix
      loginPath: '/auth/login',
      enableAdmin: true,
      enablePasskey: true,
      enableTwoFactor: true,
    },
    errorTranslation: {
      enabled: true,
      defaultLocale: 'de',
    },
    tus: {
      defaultEndpoint: '/files/upload',
      defaultChunkSize: 5 * 1024 * 1024,  // 5MB
    },
    i18n: {
      autoMerge: true,
    },
    ai: {
      enabled: true,
      basePath: '/ai',               // Must match the nest-server AI controller
    },
  },
});
```

The API base URL is resolved at runtime from `NUXT_PUBLIC_API_URL` (client + SSR fallback) and the optional `NUXT_API_URL` (SSR-only, e.g. for internal cluster addresses). `NUXT_API_URL` is never promoted into the public bundle.

## Authentication (Better Auth)

- SSR-safe session management via `useLtAuth()`
- Auth requests go **directly** to the backend Better-Auth endpoints (`basePath: '/iam'`) via `ltAuthFetch` (Cookie/JWT dual-mode) — the module ships **no** local Nitro `/api/auth/**` proxy
- Protected-route gating is the consumer's own middleware (see "Custom Auth Middleware Pattern" below); the module only registers the optional `lt-system-setup` middleware
- Passkey (WebAuthn) support via `@better-auth/passkey` peer dependency
- 2FA (TOTP) support built-in

### Auth Flow

1. Frontend calls `useLtAuth().signIn()` / `.signUp()`
2. The Better-Auth client sends the request straight to the backend Better-Auth endpoints (`basePath: '/iam'`), with the base URL resolved by `buildLtApiUrl` (`NUXT_PUBLIC_API_URL` / SSR `NUXT_API_URL`)
3. The backend sets the session as an `httpOnly` cookie (`iam.session_token`); `lt-auth-state` is the non-httpOnly client-side cache used by middleware
4. Subsequent authenticated requests use `ltAuthFetch` (Cookie mode by default, JWT fallback)

## AI Assistant Flow

- All AI composables route through `ltAuthFetch` (Cookie/JWT dual mode) and `buildLtAiUrl` (SSR/public URL resolution), so they inherit the same auth + URL behaviour as the rest of the library.
- `useLtAi.promptStream()` and `useLtAiChat()` consume `POST /ai/stream` via `fetch` + `ReadableStream` (NOT `EventSource` — the endpoint is `POST` with auth). The SSE parser is robust against split chunks, keep-alive comments, malformed lines, and oversized lines (>1 MiB throws).
- `useLtAiAdmin()` is exposed as a regular composable; admin gating is enforced server-side (`@Restricted(ADMIN)`). Render admin UI behind a frontend route guard for UX, but trust the backend for authorization.
- The chat composable's `messages` ref is a shallow `Readonly<Ref<LtAiMessage[]>>` so child components can bind individual messages while preserving streaming reactivity.

## Testing Helpers

Import from `@lenne.tech/nuxt-extensions/testing`:

```typescript
import { createTestUser, loginTestUser } from '@lenne.tech/nuxt-extensions/testing';
```

## Authentication Cookie Rules

The `useLtAuth()` composable manages the `lt-auth-state` cookie for authentication state. Projects that implement custom auth middleware MUST follow these rules:

### DO:
- Use `useLtAuth()` for all auth state management (login, logout, session validation)
- In custom auth middleware, read `lt-auth-state` via `document.cookie` (client) or `useCookie('lt-auth-state')` (server) — but ONLY for reading, never writing
- Let `setUser()` and `clearUser()` handle all cookie mutations

### DON'T:
- Don't manually set `lt-auth-state` via `document.cookie` outside of `useLtAuth()`
- Don't call `useCookie('lt-auth-state')` with different options than `useLtAuth()` uses (`maxAge: 604800, sameSite: 'lax'`)
- Don't URL-decode or JSON-parse the cookie value manually on the server — `useCookie` handles this automatically
- Don't write to `authState.value` from custom middleware — this generates a `Set-Cookie` header in the SSR response that may overwrite the browser's cookie

### How Auth Cookies Work:
1. `setUser()` writes the cookie via both `useCookie().value` (for SSR sync) and `document.cookie` (for immediate availability)
2. On SSR, `useCookie` reads the cookie from the HTTP Cookie header, URL-decodes it, and parses the JSON
3. If `useLtAuth()` can't find a valid user in the cookie on the server, it initializes with `{user: null}` — this is intentional and correct
4. The `iam.session_token` httpOnly cookie (set by Better Auth) is the actual session identifier — `lt-auth-state` is a convenience cache for the client-side middleware

### Session User Merge (nest-server-only fields):
On session re-validation (`validateSession()` at app init / hard reload, and the passkey get-session fallback), `useLtAuth()` **merges** the Better-Auth session user onto the cached user of the SAME identity via the private `mergeSessionUser()`, instead of overwriting it. Consequences you must know:

- **nest-server-only fields persist across reloads.** Better-Auth's get-session returns only Better-Auth-owned fields (id/email/name + registered additionalFields). Fields it does not own (e.g. custom preferences like `leadTableColumns`) previously vanished on every reload; they now survive. If you built a workaround that re-fetched such fields after each reload, you can retire it.
- **Authorization fields are fail-closed.** `role`, `roles`, `banned`, `banExpires`, `banReason`, `emailVerified`, `twoFactorEnabled` always reflect the session — any of these the session omits is dropped from the merge (never kept stale), so a backend downgrade is reflected client-side. If your project adds its OWN authorization-relevant user field, either register it as a Better-Auth additionalField (so get-session returns it) or add it to the `AUTHZ_KEYS` list in `use-lt-auth.ts` — otherwise it could persist stale in the client cache.
- **Keep the cached user lean.** `lt-auth-state` is a non-httpOnly cookie sent on every same-site request and capped at ~4 KB by browsers. Because the merge keeps preference fields across reloads, large blobs on the user object can push the cookie over the limit — the browser then silently rejects the write and the next reload reads as a logout. `setUser` emits a dev-mode warning above ~3.5 KB; move large preference data off the user object and fetch it from an authenticated API.

### Admin Detection (`role` vs `roles`):
`useLtAuth().isAdmin` accepts BOTH user shapes, so one frontend works against either backend:

- **`@lenne.tech/nest-server`** registers `roles` as a *core* Better-Auth additionalField (`type: 'string[]'`, `defaultValue: []`). Its users carry `roles: ['admin']` and no singular `role`.
- **Better-Auth's admin plugin** uses the singular `role: 'admin'`.

`isAdmin` is `true` when `role === 'admin'` **or** `roles` contains `'admin'` (a union — either shape granting admin is sufficient). A malformed non-array `roles` (the `lt-auth-state` cookie is client-writable) degrades to `false` — it never throws and never fail-opens via `String.prototype.includes` substring matching. Matching is case-sensitive (`'admin'`, not `'Admin'`), identical to nest-server's own `hasRole(RoleEnum.ADMIN)`.

- `roles` is in `AUTHZ_KEYS`, so a backend-side admin revocation closes the admin UI on the next session re-validation instead of being masked by a stale cached array.
- The `auth.enableAdmin` module option toggles the Better-Auth **admin client plugin** (user-management calls like `admin.listUsers()`). It does NOT control `isAdmin` — role detection works regardless of that flag.
- **`isAdmin` is a UX gate, not an authorization boundary.** It reads the non-httpOnly `lt-auth-state` cache, which a user can edit. Render admin UI behind it; enforce admin rights server-side (`@Restricted(RoleEnum.ADMIN)`).

### Custom Auth Middleware Pattern:
```typescript
// CORRECT — read-only check, no cookie mutation
export default defineNuxtRouteMiddleware((to) => {
  if (import.meta.client) {
    const cookie = document.cookie.split('; ').find(r => r.startsWith('lt-auth-state='));
    if (cookie) {
      const value = decodeURIComponent(cookie.split('=').slice(1).join('='));
      const state = JSON.parse(value);
      if (state?.user) return; // Authenticated
    }
  } else {
    const authCookie = useCookie<{ user: unknown } | null>('lt-auth-state');
    if (authCookie.value?.user) return; // Authenticated
  }
  return navigateTo('/auth/login');
});
```

## Development Rules

1. **ALWAYS read source code** in `dist/runtime/` to understand available composables and components
2. **Use `useLtAuth()`** for authentication — never implement auth manually
3. **Check existing composables** before creating new ones — this module may already provide what you need
4. **Peer dependencies** (`better-auth`, `@better-auth/passkey`, `tus-js-client`) must be installed in the consuming project
5. **AI types collision pitfall:** `LtAiPromptInput` is the CRUD input for the user-facing `LtAiPrompt` entity (used by `useLtAiPrompts().create/update`). The execution payload for `useLtAi.prompt()` / `.promptStream()` is `LtAiPromptRunInput`. Do not conflate them.
