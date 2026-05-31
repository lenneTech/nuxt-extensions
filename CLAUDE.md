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
│   ├── plugins/           # Nuxt plugins (auth interceptor, error translation)
│   ├── server/            # Nitro server routes (auth proxy)
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
- Auth proxy server route at `/api/auth/**` (proxies to backend)
- Middleware `auth` for protected routes
- Passkey (WebAuthn) support via `@better-auth/passkey` peer dependency
- 2FA (TOTP) support built-in

### Auth Flow

1. Frontend calls `useLtAuth().signIn()` / `.signUp()`
2. Request goes through Nitro proxy at `/api/auth/**`
3. Proxy forwards to backend Better Auth endpoints
4. Session cookie set via `httpOnly` cookie (SSR-safe)

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
