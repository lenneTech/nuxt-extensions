# @lenne.tech/nuxt-extensions

[![npm version][npm-version-src]][npm-version-href]
[![npm downloads][npm-downloads-src]][npm-downloads-href]
[![License][license-src]][license-href]
[![Nuxt][nuxt-src]][nuxt-href]

Reusable Nuxt 4 composables, components, and Better-Auth integration for lenne.tech projects.

## Quick Start

> **Want to start a new fullstack project?**
>
> Use the [nuxt-base-starter](https://github.com/lenneTech/nuxt-base-starter) (Frontend)
> together with the [nest-server-starter](https://github.com/lenneTech/nest-server-starter) (Backend)
> to initialize a complete fullstack project with this package pre-configured.
>
> Both starters are designed to work seamlessly together and serve as
> **reference implementations** showing how to use all features in a real application.
>
> **Quick initialization:**
> ```bash
> npx @lenne.tech/cli fullstack init my-project
> ```

## Installation

```bash
npm install @lenne.tech/nuxt-extensions better-auth
# Optional: For passkey support
npm install @better-auth/passkey
# Optional: For TUS file uploads
npm install tus-js-client
```

## Features

- **Better-Auth Integration** - Login, 2FA, Passkey/WebAuthn support
- **Cookie/JWT Dual-Mode** - Automatic fallback from cookies to JWT
- **TUS File Upload** - Resumable uploads with pause/resume
- **Transition Components** - Ready-to-use Vue transition wrappers
- **i18n Support** - English and German translations (works without i18n too)
- **Auto-imports** - All composables and components are auto-imported
- **Pre-hydration input preservation** - text typed before hydration is kept, not erased
- **Form label repair** - restores `<label for>` associations that hydration breaks

## Environment Variables

| Variable | Context | Description |
|----------|---------|-------------|
| `NUXT_PUBLIC_API_URL` | Client + Server | Public API URL. Primary way to configure the API endpoint. Used for client-side requests and as SSR fallback. |
| `NUXT_API_URL` | Server only | Internal API URL for SSR requests. Use when the backend has a private network address that should not be exposed to the client. |
| `NUXT_PUBLIC_API_PROXY` | Client | Set to `true` to enable the Vite dev proxy. Routes client requests through `/api/` for same-origin cookies. **Only for local development.** |

### How URL Resolution Works

All environment variables are resolved **at runtime** (not build time). This means you can build a Docker image once and deploy it to different environments by changing env vars — no rebuild needed.

**SSR fallback chain:**
`NUXT_API_URL` → `NUXT_PUBLIC_API_URL` → `auth.baseURL` (from nuxt.config.ts) → *(unset)*

**Client fallback chain (no proxy):**
`NUXT_PUBLIC_API_URL` → `auth.baseURL` (from nuxt.config.ts) → *(unset)*

**Client with proxy (`NUXT_PUBLIC_API_PROXY=true`):**
All requests go to `/api/{path}` — the Vite dev proxy forwards them to the backend.

> **No implicit `localhost` default.** If none of the sources above is set, there is **no** built-in fallback URL: API paths stay relative (e.g. `/iam/token`) and resolve against the app origin, so auth and setup calls 404 unless the app is served behind a same-origin reverse proxy. The module logs a one-time warning (`[LtExtensions] No API URL configured…`) at app init and on the first API call. Always set `NUXT_PUBLIC_API_URL` (and optionally `NUXT_API_URL` for SSR).

> **Security:** `NUXT_API_URL` is never exposed to the client bundle. It stays in `runtimeConfig.apiUrl` (server only). This is important when using internal network addresses like `http://api.svc.cluster.local`.

### Deployment Scenarios

**Local development** — Frontend and backend on different ports, proxy ensures same-origin cookies:
```bash
NUXT_PUBLIC_API_URL=http://localhost:3000
NUXT_PUBLIC_API_PROXY=true
```

**Production (simple)** — Backend reachable via public URL from both SSR and client:
```bash
NUXT_PUBLIC_API_URL=https://api.example.com
```

**Production (internal network)** — SSR uses fast internal route, client uses public URL:
```bash
NUXT_PUBLIC_API_URL=https://api.example.com
NUXT_API_URL=http://api-internal:3000
```

**Legacy (nuxt.config.ts only)** — Works but env vars are preferred for runtime flexibility:
```typescript
// nuxt.config.ts
ltExtensions: {
  auth: {
    baseURL: 'https://api.example.com',
  },
}
```

## Configuration

```typescript
// nuxt.config.ts
export default defineNuxtConfig({
  modules: ['@lenne.tech/nuxt-extensions'],

  ltExtensions: {
    // Auth configuration
    auth: {
      enabled: true,                // Enable auth features
      baseURL: '',                  // API base URL (empty = use env vars)
      basePath: '/iam',             // Better-Auth endpoint prefix
      loginPath: '/auth/login',     // Login redirect path
      twoFactorRedirectPath: '/auth/2fa',  // 2FA redirect path

      // Plugin options
      enableAdmin: true,            // Admin plugin
      enableTwoFactor: true,        // 2FA plugin
      enablePasskey: true,          // Passkey/WebAuthn plugin

      // Interceptor options
      interceptor: {
        enabled: true,              // 401 auto-handler
        publicPaths: ['/auth/login', '/auth/register'],
      },

      // System setup (first admin user creation)
      systemSetup: {
        enabled: false,             // Enable setup flow
        setupPath: '/auth/setup',   // Setup page path
      },
    },

    // Error translation configuration
    errorTranslation: {
      enabled: true,                // Translate backend error codes
      defaultLocale: 'de',          // Fallback locale
    },

    // TUS upload configuration
    tus: {
      defaultEndpoint: '/files/upload',
      defaultChunkSize: 5 * 1024 * 1024,  // 5MB
    },

    // i18n configuration (optional)
    i18n: {
      autoMerge: true,              // Auto-merge locales with @nuxtjs/i18n
    },

    // AI module configuration
    ai: {
      enabled: true,                // Enable AI composables / auto-imports
      basePath: '/ai',              // Must match the nest-server AI controller
    },
  },
});
```

## Form Label Repair

Restores `<label for>` associations that hydration breaks. Active by default.

### The problem

Nuxt UI's `FormField` derives the label's `for` and the control's `id` from a single
`useId()` call, so they cannot disagree — unless `useId()` itself returns different values on
server and client, which happens when the two walk a different number of async boundaries.

Measured against `@nuxt/ui` 4.11.x:

| | label `for` | control `id` |
|---|---|---|
| SSR payload | `v-0-4-2` | `v-0-4-2` |
| after hydration | `v-0-4-2` | `v-0-1-2` |

Vue 3.5.39 did not cause this, it exposed it
([vuejs/core#9083](https://github.com/vuejs/core/pull/9083) force-patches an element's
dynamic props on hydration). The control's `id` is such a prop; the label's `for`, passed
through reka-ui's `Label` component, is not — so only the label keeps the stale value.

### What it costs when it breaks

The control loses its programmatic label. Without a placeholder it has no accessible name at
all and a screen reader announces "edit text, blank"; **with** a placeholder that becomes the
name instead, so the visible label is no longer part of it and speech input stops working.
Clicking the label focuses nothing either — which on a checkbox or radio is the primary hit
target, not a convenience. Tests using `getByRole('textbox', { name })` stop finding fields.

### What the repair does

After mount, and for a bounded window afterwards, three associations are repaired inside each
Nuxt UI field whose label no longer resolves:

| Association | Repaired how | Why it needs its own path |
|---|---|---|
| `<label for>` → control | re-pointed at the field's control | `for` carries **both** the accessible name and click-to-focus |
| `aria-labelledby` on a group | caption id minted, group pointed at it | A radio group's id sits on a `<div role="radiogroup">`, and `for` only resolves against labelable elements — there it is inert however carefully it is chosen |
| `aria-describedby` → error / help | dangling tokens re-pointed, token-wise | The error container's id **is** force-patched on hydration; the reference to it is not. So the message is visible and never announced (WCAG 3.3.1 / 3.3.3) |

**It refuses to guess.** A repair that fires where it should not is worse than the defect: a
dangling label is inert and visible, a mis-pointed one is confidently wrong and silent, and on a
radio or checkbox a click on the caption would change a value the user never chose. So the `for`
repair only fires when the field contains exactly **one** eligible control. Skipped deliberately:

| Case | Why |
|------|-----|
| Radio / checkbox groups | One field root, many controls — binding every caption to one item would submit a value nobody picked. Named via `aria-labelledby` instead |
| Reka's submit proxy (`[data-hidden]` with no `id`) | Not the user's control. The missing id is what identifies it — Nuxt UI's `UFileUpload` renders the *real* file input the same way, but stamps the field id on it |
| Anything `aria-hidden`, `hidden`, `type="hidden"` or `display:none` | Outside the accessibility tree, so a label pointing there would carry no name — the repair would report success and change nothing |
| A control that already has a working label | Multiple `<label>`s **concatenate** into one accessible name, so a second one produces a name matching no visible text |
| An id that is not unique in the document | `for` resolves through `getElementById`, which returns the *first* match — the label's click would go to the other element |
| Labels your application wrote | Only Nuxt UI's own field labels (`data-slot="label"`) are touched |

**`disabled` and `readonly` fields ARE repaired.** They are rendered, stay in the accessibility
tree and are announced, so WCAG 1.3.1 / 4.1.2 apply unchanged — and WCAG's only carve-out for
inactive components is contrast (1.4.3 / 1.4.11); there is no naming exemption. For a disabled
field the repair restores the **name only**, since a disabled control prevents click dispatch and
is not focusable. On a read-only form that is the whole value: it is a page people read rather
than operate. Excluding `disabled` was tried in 1.13.0 and reproduced the very defect this plugin
repairs on every read-only form.

**This is a repair, not a cure.** The real fix is for the id not to diverge; this exists because
the divergence sits in the framework stack rather than in any one application.

### Opting out

```ts
export default defineNuxtConfig({
  ltExtensions: {
    formLabelAssociation: {
      enabled: false,
      // Or keep it on and tune the two knobs:
      // maxRepairMs: 3000,        // window for deferred subtrees; clamped to [0, 30000]
      // observeDeferred: false,   // drop the MutationObserver for hydrate-on-visible content
    },
  },
});
```

Two real reasons to turn it off: your application assigns `for` itself and depends on those exact
values, or your tests assert on literal `for` / `id` strings rather than on the accessible name.
Fix the second reason instead — assert on the accessible name, which is what a user perceives.

### Debugging it in a consuming project

- **A `for`, `aria-labelledby` or `aria-describedby` that changes after mount is this plugin.**
  In development it logs once per page, naming the fields it repaired.
- Repaired labels carry `data-lt-label-repaired`, so an E2E suite can assert the repair count is
  zero once the upstream divergence is fixed — and delete the plugin at that point.

## Pre-Hydration Input Preservation

Text typed before a page has hydrated is kept instead of being silently thrown away.

### The problem

Until Vue hydrates a server-rendered `<input>`, the element carries **no framework listener**.
Text typed in that window is written to the DOM node, the `input` event reaches nothing, and
`v-model`'s mounted hook then writes the model value back over it. The entry is **erased, not
delayed** — no error, no toast, nothing persisted.

It is load-dependent, so it hides in development and shows up on a cold cache, a slow device
or a throttled CPU — most often on the login screen, where people type on sight.

### What Vue already does, and where it stops

Vue fixed this in **3.5.41** ([vuejs/core#14411](https://github.com/vuejs/core/pull/14411)):
on hydration it compares the field's live value against what the server rendered and, when
they differ, adopts the typed value into the model instead of overwriting the node.

That adoption is gated on `type="text"` and `textarea`. **Every other type still loses the
entry** — and those are exactly the fields a sign-in form uses:

| Input type | Typed before hydration |
|------------|------------------------|
| `text`, `textarea` | kept by Vue itself |
| `email`, `password`, `tel`, `url`, `search`, `number` | **erased** |

Widening the gate is tracked upstream as
[vuejs/core#15210](https://github.com/vuejs/core/issues/15210) — open, labelled
`p2-edge-case`, no milestone.

### What this module adds

A small client plugin that closes the remaining gap. Just before hydration it reads what is
in each field; just after, it writes back anything that was overwritten and dispatches a
synthetic `input` event so `v-model` adopts it.

A field counts as edited when its value differs from `defaultValue` — the same test Vue uses,
so values the server pre-filled are never mistaken for user input. A browser autofill that
lands before hydration is recovered the same way.

Fields stay ordinary editable fields throughout. Nothing is made `readonly`, so autofill,
screen-reader semantics and the mobile on-screen keyboard are untouched, and the user never
faces a field that looks usable and silently refuses.

**This is a stopgap.** When Vue covers the remaining types, delete it —
`test/pre-hydration-input.test.ts` pins the current gate and will fail on the types Vue takes
over, which is the signal.

### Opting out

```ts
export default defineNuxtConfig({
  ltExtensions: {
    preHydrationInput: {
      enabled: false,
      // or keep it on and only change how long deferred subtrees are waited for:
      // maxRestoreMs: 3000,
    },
  },
});
```

## Usage

### Authentication

```vue
<script setup>
// Auth composable (auto-imported)
const {
  user,
  isAuthenticated,
  isAdmin,
  isLoading,
  signIn,
  signOut,
  authenticateWithPasskey,
  registerPasskey,
  twoFactor,
} = useLtAuth();

// Login with email/password
async function handleLogin(email: string, password: string) {
  const result = await signIn.email({ email, password });
  if (result.requiresTwoFactor) {
    navigateTo('/auth/2fa');
  }
}

// Passkey login
async function handlePasskeyLogin() {
  const result = await authenticateWithPasskey();
  if (result.success) {
    navigateTo('/dashboard');
  }
}
</script>

<template>
  <div v-if="isAuthenticated">
    Welcome, {{ user?.name }}!
    <button @click="signOut()">Logout</button>
  </div>
</template>
```

#### Admin detection (`role` vs `roles`)

`isAdmin` accepts **both** user shapes, so the same frontend works against either backend:

| Backend | User shape | `isAdmin` is `true` when |
|---------|------------|-------------------------|
| `@lenne.tech/nest-server` | `roles: ['admin']` — core Better-Auth additionalField (`type: 'string[]'`), no singular `role` | `roles` contains `'admin'` |
| Better-Auth admin plugin | `role: 'admin'` — single role | `role === 'admin'` |

```vue
<script setup>
const { isAdmin } = useLtAuth();
</script>

<template>
  <NuxtLink v-if="isAdmin" to="/admin">Admin</NuxtLink>
</template>
```

> **`isAdmin` is a UX gate, not an authorization boundary.** It reads the client-side `lt-auth-state` cookie cache, which is not httpOnly and therefore user-writable. Use it to decide what to *render*; always enforce admin rights server-side (`@Restricted(RoleEnum.ADMIN)` in nest-server).
>
> The `auth.enableAdmin` option toggles the Better-Auth **admin client plugin** (user-management calls such as `admin.listUsers()`). It does **not** control `isAdmin` — role detection works regardless of that flag.

For roles other than admin, use `hasRole(role)` / `hasAnyRole(...roles)`. They apply the exact same both-shapes union and `Array.isArray` guard as `isAdmin` (which is itself just `hasRole('admin')`), so you never need the unguarded `user.value?.roles?.includes(...)`:

```vue
<script setup>
const { hasRole, hasAnyRole } = useLtAuth();
</script>

<template>
  <button v-if="hasRole('editor')">Edit</button>
  <NuxtLink v-if="hasAnyRole('admin', 'editor')" to="/manage">Manage</NuxtLink>
</template>
```

### Custom Better Auth Plugins

You can extend the auth client with additional [Better Auth plugins](https://www.better-auth.com/docs/plugins):

**Option 1: Plugin Registration (recommended)**

Create a Nuxt plugin to register plugins before the auth client is initialized:

```typescript
// plugins/auth-plugins.client.ts
import { registerLtAuthPlugins } from '@lenne.tech/nuxt-extensions/lib';
import { organizationClient, magicLinkClient } from 'better-auth/client/plugins';

export default defineNuxtPlugin(() => {
  registerLtAuthPlugins([
    organizationClient(),
    magicLinkClient(),
  ]);
});
```

> **Note:** In Vue components, `registerLtAuthPlugins` is auto-imported. In `.ts` files (like Nuxt plugins), import from `@lenne.tech/nuxt-extensions/lib`.

**Option 2: Direct Factory Usage**

For full control, create the auth client directly with your plugins:

```typescript
import { createLtAuthClient } from '@lenne.tech/nuxt-extensions/lib';
import { organizationClient } from 'better-auth/client/plugins';

const authClient = createLtAuthClient({
  plugins: [organizationClient()],
});

// Use authClient.organization.* methods
```

**Available Better Auth Plugins:**
- `organizationClient` - Organization/team management
- `magicLinkClient` - Passwordless email login
- `oneTapClient` - Google One Tap login
- `anonymousClient` - Anonymous/guest sessions
- See [Better Auth Plugins](https://www.better-auth.com/docs/plugins) for full list

### TUS File Upload

```vue
<script setup>
const {
  addFiles,
  uploads,
  totalProgress,
  isUploading,
  pauseUpload,
  resumeUpload,
  cancelUpload,
} = useLtTusUpload({
  endpoint: '/api/files/upload',
  onSuccess: (item) => console.log('Uploaded:', item.url),
  onError: (item, error) => console.error('Failed:', error),
});

const { formatFileSize } = useLtFile();

function handleFileSelect(event: Event) {
  const input = event.target as HTMLInputElement;
  if (input.files) {
    addFiles(Array.from(input.files));
  }
}
</script>

<template>
  <div>
    <input type="file" multiple @change="handleFileSelect" />

    <div v-for="upload in uploads" :key="upload.id">
      <span>{{ upload.file.name }}</span>
      <span>{{ formatFileSize(upload.progress.bytesUploaded) }} / {{ formatFileSize(upload.progress.bytesTotal) }}</span>
      <span>{{ upload.progress.percentage }}%</span>

      <button v-if="upload.status === 'uploading'" @click="pauseUpload(upload.id)">
        Pause
      </button>
      <button v-if="upload.status === 'paused'" @click="resumeUpload(upload.id)">
        Resume
      </button>
    </div>

    <div v-if="isUploading">
      Total Progress: {{ totalProgress.percentage }}%
    </div>
  </div>
</template>
```

### Transition Components

```vue
<template>
  <!-- Fade transition -->
  <LtTransitionFade>
    <div v-if="show">Content with fade</div>
  </LtTransitionFade>

  <!-- Fade with scale -->
  <LtTransitionFadeScale :start-duration="200" :leave-duration="150">
    <div v-if="show">Content with fade and scale</div>
  </LtTransitionFadeScale>

  <!-- Slide from right -->
  <LtTransitionSlide>
    <div v-if="show">Content slides from right</div>
  </LtTransitionSlide>

  <!-- Slide from bottom -->
  <LtTransitionSlideBottom>
    <div v-if="show">Content slides from bottom</div>
  </LtTransitionSlideBottom>

  <!-- Slide from left -->
  <LtTransitionSlideRevert>
    <div v-if="show">Content slides from left</div>
  </LtTransitionSlideRevert>
</template>
```

### Web Share API

```vue
<script setup>
const { share } = useLtShare();

async function handleShare() {
  await share('Check this out!', 'Amazing content');
  // Uses native share on mobile, clipboard fallback on desktop
}
</script>
```

### Utilities

```typescript
// Tailwind TypeScript helper
const buttonClasses = tw`bg-blue-500 hover:bg-blue-700 text-white`;

// Crypto utilities (for WebAuthn)
const hash = await ltSha256('password');
const base64 = ltArrayBufferToBase64Url(buffer);
const uint8 = ltBase64UrlToUint8Array(base64String);
```

## AI Assistant

Headless, provider-agnostic composables for the `@lenne.tech/nest-server` **AI module**
(REST + SSE). All requests use the same auth-aware `ltAuthFetch` (Cookie/JWT) and URL
resolution as the rest of the library. Configure via `ltExtensions.ai`:

```typescript
// nuxt.config.ts
ltExtensions: {
  ai: { enabled: true, basePath: '/ai' }, // basePath must match the nest-server AI controller
}
```

### Chat (streaming, multi-turn)

```vue
<script setup lang="ts">
const { budget, confirm, messages, requiresConfirmation, send, streaming } = useLtAiChat();
</script>
```

`useLtAiChat()` streams the answer token-by-token, tracks the `conversationId`, exposes
the per-response `budget` summary, and drives the confirmation flow for mutating/
destructive actions (`requiresConfirmation` → `confirm()`).

### User-facing prompts ("Vorlagen")

```vue
<script setup lang="ts">
const { create, error, load, loading, prompts, remove, update } = useLtAiPrompts();
await load();
// create({ name: 'Summary', content: 'Summarize {{topic}}', scope: 'user' });
</script>
```

`useLtAiPrompts()` lets any signed-in user manage re-usable prompt snippets. `scope: 'user'`
is private to the owner; `scope: 'tenant'` is shared across the owner's tenant. The list
returned by `load()` is already server-filtered to what the user is allowed to see.

### Lower-level + supporting composables

| Composable | Purpose |
|------------|---------|
| `useLtAi()` | One-shot `prompt(input)` and streaming `promptStream(input, handlers)` (POST `/ai/stream`) |
| `useLtAiChat()` | Multi-turn chat state, streaming, budget, confirmation, `stop()`/`clear()`, optional `maxMessages` cap, auto-stop on component unmount |
| `useLtAiConnections()` | User self-service: available connections + `select()` (`selected`/`locked`) |
| `useLtAiUsage()` | Full token/prompt usage breakdown (`GET /ai/usage`) |
| `useLtAiPrompts()` | User-facing CRUD for re-usable prompt snippets ("Vorlagen", `scope: 'user'` / `'tenant'`) |
| `useLtAiPlaceholders()` | Loads `{{placeholder}}` registry from the backend so slot / prompt editors render a dynamic helper sidebar |
| `useLtAiAdmin()` | Admin CRUD: connections (+ `detectCapabilities`), preferences, budget-limits, slots (incl. `listEffectiveSlots`/`resetSlot`), prompt hints, interactions |

Helpers: `buildLtAiUrl(path)`, `ltAiRequest(method, path, body?)`, `parseLtAiSseStream(response, onEvent, options?)`.
All AI DTOs are exported as `LtAi*` types. The streaming endpoint is consumed via a
`fetch` + `ReadableStream` SSE reader (not `EventSource`, since it is a `POST` with auth).

> **Security note:** `useLtAiAdmin()` is exposed as a regular composable; admin gating
> is enforced server-side (`@Restricted(ADMIN)`). Render admin UI behind a frontend
> route guard for UX, but trust the backend for authorization.

## i18n Support

The package works **with or without** `@nuxtjs/i18n`:

| Setup | Language | Text Source |
|-------|----------|-------------|
| **Without i18n** | German | Hardcoded fallback texts |
| With i18n, Locale: `de` | German | From `de.json` |
| With i18n, Locale: `en` | English | From `en.json` |
| With i18n, other Locale | English | Fallback to `en.json` |

## API Reference

### Composables

| Composable | Description |
|------------|-------------|
| `useLtAuth()` | Better-Auth integration with session, passkey, 2FA |
| `useLtAuthClient()` | Direct access to the Better-Auth client singleton |
| `useLtErrorTranslation()` | Translate backend error codes to user-friendly messages |
| `useLtTusUpload()` | TUS protocol file uploads with pause/resume |
| `useLtFile()` | File utilities (size formatting, URLs) |
| `useLtShare()` | Web Share API with clipboard fallback |
| `useSystemSetup()` | System setup flow for initial admin user creation |
| `useLtAi()` | One-shot `prompt()` + streaming `promptStream()` for the nest-server AI module |
| `useLtAiChat()` | Multi-turn chat state, streaming, budget summary, confirmation gate, `maxMessages` cap |
| `useLtAiConnections()` | User self-service connection list + `select()` |
| `useLtAiUsage()` | Token/prompt usage breakdown per user / tenant |
| `useLtAiPrompts()` | User-facing prompt snippet CRUD (`'user'` / `'tenant'` scope) |
| `useLtAiPlaceholders()` | Loads the backend's `{{placeholder}}` registry |
| `useLtAiAdmin()` | Admin CRUD for connections, preferences, budget limits, slots, prompt hints, interactions |

### Components

| Component | Description |
|-----------|-------------|
| `<LtTransitionFade>` | Opacity fade transition |
| `<LtTransitionFadeScale>` | Fade with scale transition |
| `<LtTransitionSlide>` | Slide from right transition |
| `<LtTransitionSlideBottom>` | Slide from bottom transition |
| `<LtTransitionSlideRevert>` | Slide from left transition |

### Utilities

| Utility | Description |
|---------|-------------|
| `tw` | Tailwind TypeScript helper |
| `ltSha256()` | SHA256 hash function |
| `ltArrayBufferToBase64Url()` | ArrayBuffer to base64url conversion |
| `ltBase64UrlToUint8Array()` | Base64url to Uint8Array conversion |
| `createLtAuthClient()` | Auth client factory for custom configuration |
| `registerLtAuthPlugins()` | Register custom Better Auth plugins |

## Related Projects

| Project | Description |
|---------|-------------|
| [nuxt-base-starter](https://github.com/lenneTech/nuxt-base-starter) | Frontend starter template (uses this package) |
| [nest-server-starter](https://github.com/lenneTech/nest-server-starter) | Backend starter template (Better-Auth backend) |
| [@lenne.tech/nest-server](https://github.com/lenneTech/nest-server) | Backend framework with Better-Auth support |
| [@lenne.tech/cli](https://github.com/lenneTech/cli) | CLI tool for fullstack project initialization |

## Fullstack Architecture

```
+-------------------------------------------------------------+
|                     Your Fullstack App                       |
+-----------------------------+-------------------------------+
|         Frontend            |           Backend              |
|    (nuxt-base-starter)      |    (nest-server-starter)       |
+-----------------------------+-------------------------------+
|  @lenne.tech/nuxt-extensions|   @lenne.tech/nest-server     |
|  - useLtAuth()              |   - CoreBetterAuthModule      |
|  - useLtTusUpload()         |   - CoreFileModule            |
|  - <LtTransition*>          |   - CoreUserModule            |
+-----------------------------+-------------------------------+
```

## Development

```bash
# Install dependencies
npm install

# Generate type stubs
npm run dev:prepare

# Develop with playground
npm run dev

# Build the module
npm run build

# Run tests
npm run test
```

## License

[MIT](./LICENSE)

<!-- Badges -->
[npm-version-src]: https://img.shields.io/npm/v/@lenne.tech/nuxt-extensions/latest.svg?style=flat&colorA=020420&colorB=00DC82
[npm-version-href]: https://npmjs.com/package/@lenne.tech/nuxt-extensions

[npm-downloads-src]: https://img.shields.io/npm/dm/@lenne.tech/nuxt-extensions.svg?style=flat&colorA=020420&colorB=00DC82
[npm-downloads-href]: https://npm.chart.dev/@lenne.tech/nuxt-extensions

[license-src]: https://img.shields.io/npm/l/@lenne.tech/nuxt-extensions.svg?style=flat&colorA=020420&colorB=00DC82
[license-href]: https://npmjs.com/package/@lenne.tech/nuxt-extensions

[nuxt-src]: https://img.shields.io/badge/Nuxt-020420?logo=nuxt
[nuxt-href]: https://nuxt.com
