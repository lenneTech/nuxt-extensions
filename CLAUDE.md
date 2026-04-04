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

## Development Rules

1. **ALWAYS read source code** in `dist/runtime/` to understand available composables and components
2. **Use `useBetterAuth()`** for authentication — never implement auth manually
3. **Check existing composables** before creating new ones — this module may already provide what you need
4. **Peer dependencies** (`better-auth`, `@better-auth/passkey`, `tus-js-client`) must be installed in the consuming project
