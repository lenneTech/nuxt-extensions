# @lenne.tech/nuxt-extensions

Reusable Nuxt 4 module providing composables, components, utilities, and Better Auth integration for lenne.tech projects.

## Architecture

```
src/
├── module.ts              # Nuxt module entry point (auto-imports, plugin registration)
├── runtime/
│   ├── composables/       # Auto-imported composables
│   ├── components/        # Auto-imported components
│   ├── lib/               # Library exports (auth-client, helpers)
│   ├── middleware/         # Route middleware (auth)
│   ├── plugins/           # Nuxt plugins (auth initialization)
│   ├── server/            # Nitro server routes (auth proxy)
│   ├── testing/           # Playwright test helpers
│   ├── types/             # TypeScript type definitions
│   └── utils/             # Auto-imported utility functions
```

## Key Composables

| Composable | Purpose |
|-----------|---------|
| `useBetterAuth()` | Authentication state, login, logout, session management |
| `useAuthClient()` | Raw Better Auth client access |
| `useTusUpload()` | TUS resumable file uploads |

## Module Configuration

Configure in `nuxt.config.ts`:

```typescript
export default defineNuxtConfig({
  modules: ['@lenne.tech/nuxt-extensions'],
  lennetech: {
    // API base URL for auth proxy
    apiUrl: 'http://localhost:3000',
    // Enable/disable features
    betterAuth: true,
    tusUpload: true,
  }
})
```

## Authentication (Better Auth)

- SSR-safe session management via `useBetterAuth()`
- Auth proxy server route at `/api/auth/**` (proxies to backend)
- Middleware `auth` for protected routes
- Passkey (WebAuthn) support via `@better-auth/passkey` peer dependency
- 2FA (TOTP) support built-in

### Auth Flow

1. Frontend calls `useBetterAuth().signIn()` / `.signUp()`
2. Request goes through Nitro proxy at `/api/auth/**`
3. Proxy forwards to backend Better Auth endpoints
4. Session cookie set via `httpOnly` cookie (SSR-safe)

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
2. **Use `useBetterAuth()`** for authentication — never implement auth manually
3. **Check existing composables** before creating new ones — this module may already provide what you need
4. **Peer dependencies** (`better-auth`, `@better-auth/passkey`, `tus-js-client`) must be installed in the consuming project
