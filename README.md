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

## Requirements

| Dependency | Required version | Notes |
|---|---|---|
| Node | `>= 22` | |
| Nuxt | `^4.0.0` | |
| `better-auth` | `>=1.7.16 <1.8.0` | **required peer** — pin it, see below |
| `@better-auth/passkey` | `>=1.7.16 <1.8.0` | optional peer, passkey/WebAuthn only |
| `tus-js-client` | `>=4.0.0` | optional peer, resumable uploads only |
| `@nuxt/ui` | `>=3.0.0` | optional peer: toasts of `showErrorToast` and the auth flows; without it they go to the console |
| `tailwindcss` | `>=4.0.0` | optional peer, `LtTransition*` components only (Tailwind 4 class syntax, see "Transition Components") |
| `@lenne.tech/nest-server` | `>= 11.37.0` | **only if you use the backend** — see the lock-step rule |

**Why `better-auth` is pinned to one minor line, and why you must not widen it:**
better-auth is one protocol with two ends. This module is the client end and
`@lenne.tech/nest-server` is the server end, and they must resolve the **same**
better-auth minor. better-auth breaks in *minor* releases — 1.7 removed subpath
exports and changed the 2FA response shape — so a caret (`^1.7.16`) would re-open the
hole at 1.8. If the api and the app drift apart, 2FA activation fails at runtime with a
generic client error while **both** projects' checks stay green: each is internally
consistent, and only the assembled workspace has both halves.

Raising better-auth therefore means raising it in `@lenne.tech/nest-server` **and**
`@lenne.tech/nuxt-extensions` in one step.

**Why the floor is 1.7.16:** better-auth 1.7.16 closes twelve advisories published on
2026-11-03. Among those that reach a typical lt project: a social sign-in can treat an unverified
provider email as verified
([GHSA-9hm7-xhfp-cx58](https://github.com/better-auth/better-auth/security/advisories/GHSA-9hm7-xhfp-cx58)),
revoked sessions can stay valid with secondary storage or the cookie cache
([GHSA-fvxx-76fc-893x](https://github.com/better-auth/better-auth/security/advisories/GHSA-fvxx-76fc-893x)),
email-change links stay valid after the address changes hands
([GHSA-hwq2-v29r-p69r](https://github.com/better-auth/better-auth/security/advisories/GHSA-hwq2-v29r-p69r)),
and passkey verification does not enforce origin or user verification
([GHSA-gv75-j3v8-3crm](https://github.com/better-auth/better-auth/security/advisories/GHSA-gv75-j3v8-3crm)).
It also pins better-call 1.4.5, which closes
[GHSA-23w8-wx9r-vm57](https://github.com/better-auth/better-call/security/advisories/GHSA-23w8-wx9r-vm57)
(high, shared router context). That one is a second layer only: better-auth's own handler builds a
fresh router per request, so the flaw is not reachable through it. Older flaws stay behind the
floor too: before
1.7.12 better-auth verifies JWTs with the algorithm named in the token's own header
([#11925](https://github.com/better-auth/better-auth/pull/11925)), and below 1.7.7 the OAuth
state can be used as a magic link to sign in as another user
([GHSA-965c-763c-88jm](https://github.com/better-auth/better-auth/security/advisories/GHSA-965c-763c-88jm),
critical). All of these are in the server end, so your API must run 1.7.16 too
(`@lenne.tech/nest-server` 12.3.1 declares the same range), and the pin below keeps both halves
on it.

## Installation

```bash
npm install @lenne.tech/nuxt-extensions better-auth@1.7.16
# Optional: For passkey support
npm install @better-auth/passkey@1.7.16
# Optional: For TUS file uploads
npm install tus-js-client
```

In a fullstack monorepo, pin it workspace-wide so the api and the app cannot drift:

```yaml
# pnpm-workspace.yaml
overrides:
  better-auth: 1.7.16
  '@better-auth/passkey': 1.7.16
  '@better-auth/core': 1.7.16 # the api of nest-server-starter projects depends on it directly
```

## Features

- **Better-Auth Integration** - Login, 2FA, Passkey/WebAuthn support
- **Cookie/JWT Dual-Mode** - Automatic fallback from cookies to JWT
- **TUS File Upload** - Resumable uploads with pause/resume
- **Offline Sync** - Read and write offline, reconcile with the nest-server sync module (opt-in)
- **Transition Components** - Ready-to-use Vue transition wrappers
- **i18n Support** - English and German translations (works without i18n too)
- **security.txt** - Opt-in RFC 9116 file that never expires between deployments
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
      enabled: true,                // Only gates the 401 interceptor below; useLtAuth() etc. stay available
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
      defaultEndpoint: '/tus',            // nest-server's TUS path (module default: '/files/upload')
      defaultChunkSize: 5 * 1024 * 1024,  // 5MB
      resolveAgainstApi: true,            // relative endpoint = path on the API, like auth/AI requests
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

    // security.txt at /.well-known/security.txt (see "security.txt" below)
    securityTxt: {
      enabled: false,               // Opt-in
      contact: 'mailto:security@lenne.tech',
    },

    // Offline sync (opt-in, see "Offline Sync" below)
    sync: {
      enabled: false,               // Enable useLtOfflineSync() and the sign-out cleanup
      basePath: '/sync',            // Must match the nest-server sync module
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

## security.txt (RFC 9116)

A `security.txt` tells security researchers where to report a vulnerability. The module can serve
one at `/.well-known/security.txt`. It is **off by default**: only turn it on where somebody
actually reads the contact address. A published address that nobody answers is worse than none.

```ts
export default defineNuxtConfig({
  ltExtensions: {
    securityTxt: {
      enabled: true,
      // All optional:
      contact: 'mailto:security@lenne.tech',   // default; string or array, mailto:/https:/tel:
      hosts: ['example.com', 'www.example.com'], // hostnames served without a redirect
      preferredLanguages: ['de', 'en'],          // default
      validDays: 180,                            // default; clamped to 365
      policy: '/security-policy',                // a path is resolved against the site URL
    },
  },
});
```

Response for `https://example.com`:

```text
Contact: mailto:security@lenne.tech
Expires: 2027-04-26T00:00:00.000Z
Preferred-Languages: de, en
Canonical: https://example.com/.well-known/security.txt
```

**For a customer project, decide where reports go.** The default sends them to lenne.Tech. If the
customer wants reports themselves, set their address.

How it behaves:

- **`Expires` never runs out.** The file is built per request: "now + `validDays`", cut to
  midnight UTC. A file written once at deploy time would expire on its own, and scanners such as
  the BSI's drop an expired file without telling anyone.
- **`Canonical`** names `runtimeConfig.public.siteUrl` (`NUXT_PUBLIC_SITE_URL`; the module declares
  the key while the option is on). If the site answers under more than one hostname without a redirect (apex
  and `www`), list them in `hosts`. A request for one of them adds a second `Canonical` line,
  because RFC 9116 expects the URL a file was fetched from to be listed. The host comes from a
  request header, so only hosts on that list ever reach the file.
- **GET and HEAD** both answer `200` with `text/plain; charset=utf-8` and `cache-control: no-store`.
- **Overridable per stage at runtime**, without a rebuild:
  `NUXT_LT_EXTENSIONS_SECURITY_TXT_CONTACT`, `…_HOSTS` (`"example.com,www.example.com"`),
  `…_PREFERRED_LANGUAGES`, `…_VALID_DAYS`, `…_POLICY`. Only `enabled` is fixed at build time.
- **A contact must be a URI.** `mailto:`, `https://` or `tel:`; a bare `security@example.com` counts
  as no contact. Without a usable contact, including a blanked one, the route answers `404`, because
  a file without `Contact` is invalid.
- **Never prerendered.** The route is excluded from prerendering, so `Expires` is not frozen at
  build time. A fully static site (`nuxt generate`) has no server to answer it at all. The module
  warns about that at build time.

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
  changePassword,
  requestPasswordReset,
  resetPassword,
} = useLtAuth();

// Login with email/password. For an account with 2FA, nest-server answers
// `{ requiresTwoFactor: true }` (Better-Auth's own `twoFactorRedirect` makes the two-factor
// client plugin navigate to `auth.twoFactorRedirectPath` by itself; nest-server does not send it).
async function handleLogin(email: string, password: string) {
  const { data } = (await signIn.email({ email, password })) as {
    data?: { requiresTwoFactor?: boolean; twoFactorRedirect?: boolean } | null;
  };
  if (data?.requiresTwoFactor || data?.twoFactorRedirect) {
    await navigateTo('/auth/2fa');
  }
}

// On the 2FA page: finishes the sign-in (user, cookie session, JWT from /iam/token)
async function handleTotp(code: string) {
  const { error } = (await twoFactor.verifyTotp({ code })) as { error?: { message?: string } | null };
  if (!error) {
    navigateTo('/dashboard');
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

#### Two-factor sign-in, and what `lt-jwt-token` may hold

Finish a sign-in that stopped at the second factor with `useLtAuth().twoFactor.verifyTotp()` or
`verifyBackupCode()`. They put the user into the auth state on the cookie session and fetch the
JWT from `/iam/token`.

- **Never store the `token` of a 2FA or passkey answer.** Better-Auth answers `verify-totp` and
  `verify-backup-code` with `{ token, user }`, and `passkey/verify-authentication` with
  `{ session, user }`. That token is its session token, the value the API keeps in the httpOnly
  cookie. Stored as the "JWT", it lands in the readable `lt-jwt-token` cookie, where any script
  on the page can take it for the session's whole lifetime.
- **`lt-jwt-token` holds a JWT or nothing.** `jwtToken`, `setLtJwtToken()` and the sign-in
  methods refuse anything else; `isLtJwtShaped()` (from `/lib`) is the test, the same as
  nest-server's `isJwtShaped`.
- **A value found there that is not a JWT is deleted** on the next start or read, along with the
  JWT mode it came with. The httpOnly session cookie keeps the user signed in.
- **`setUser(user, 'jwt')` without a stored JWT signs in on the cookie session** and fetches the
  JWT. A hand-written 2FA page that stored the body token therefore still works, without the
  leak; move it to the helpers anyway.
- **`useLtAuthClient().twoFactor.verifyTotp()` / `verifyBackupCode()` no longer return the
  session token.**
- **`authenticateWithPasskey()` returns no `session`.**

#### Authenticated requests: `fetchWithAuth` and `ltAuthFetch`

`useLtAuth().fetchWithAuth` and `ltAuthFetch` (from `/lib`, also used by the Better-Auth client,
the AI composables and offline sync) run through one implementation.

- **JWT mode sends `Authorization: Bearer <jwt>`.** `ltAuthFetch` always sends the cookies as well,
  so nest-server (>= 11.13.1) falls back to the session cookie when the bearer fails.
  `fetchWithAuth` sends them in JWT mode only to passkey, 2FA and `/get-session`.
- **A 401 while signed in fetches a JWT once and retries the request once.** In cookie mode that
  is the switch to JWT; in JWT mode it renews an expired JWT, which lives 15 minutes while the
  session lasts 7 days. Requests that fail in the same burst share one `GET <basePath>/token`. A
  401 that survives the fresh token reaches the caller unchanged, and so does a 401 in JWT mode from
  Better-Auth's own routes (sign-in, 2FA, passkey): there it is the flow's verdict, and a wrong
  password or code must not be sent twice.
- **The JWT comes from `auth.basePath`.** Without an argument, `ltAuthFetch`, `createLtAuthFetch()`
  and `attemptLtJwtSwitch()` read it from the module config; they used to fetch it from `/iam`
  whatever was configured. A path passed explicitly still wins.

#### Server-side rendering: backend calls are anonymous

During SSR, `ltAuthFetch`, the AI composables and offline sync call the API **without** a session:
on the server `getLtAuthMode()` is `'cookie'`, `getLtJwtToken()` is `null` and `isLtAuthenticated()`
is `false`. The one exception is `useLtAuth().fetchWithAuth` (see the last point below). That is deliberate. The auth helpers are module singletons shared by every request a
Nitro process renders, so they may not carry one request's cookies. And the session cookie
(`iam.session_token`) belongs to the API host: nest-server sets it host-only unless
`crossSubDomainCookies` is configured, so the app server never receives it. `validateSession()` on
the server therefore relies on the `lt-auth-state` cookie only, which is a display cache, not proof
of a session.

For pages that show user data:

- **Load it in the browser.** `useAsyncData(key, fetcher, { server: false })` or `onMounted`, with a
  skeleton or loading state for the first paint. This is what nuxt-base-starter does.
  `useLazyAsyncData` alone is not enough: `lazy` only stops it from blocking navigation, the
  fetcher still runs during SSR, and its anonymous answer (a 401 or the public subset) goes into
  the payload, which the browser does not fetch again. Add `server: false` there too.
- **Render only public data on the server**, and never decide access there: an SSR guard that reads
  `lt-auth-state` decides what to render, the API decides what the user may see.
- If a page truly needs user data in the SSR HTML, that needs a server route of the app that
  forwards the request's own session to the API, set up per project together with a shared cookie
  domain. `ltAuthFetch` does not do it.
- **`useLtAuth().fetchWithAuth` during SSR is not anonymous.** It reads the request's cookies through
  `useCookie`, and in JWT mode (the normal state after sign-in) it sends the request's `lt-jwt-token`
  as the bearer. It cannot renew that token on the server, so the call works until the JWT expires
  (15 minutes) and then answers 401. Do not use it for SSR-rendered user data, and never cache
  (`swr`, `isr`, a CDN) a route whose SSR output went through it: one user's data would be served to
  the next.

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

### Password Change and Reset

All three methods hash the password with SHA256 before it leaves the browser, because
`@lenne.tech/nest-server` verifies that shape. **Use them rather than calling the endpoints
yourself** — a hand-rolled reset that skips the hashing stores a credential the login can never
match, and the user is locked out of the account they just set a password for. That is not
hypothetical; it is why these two methods were added in 1.16.0.

```vue
<script setup lang="ts">
const { changePassword, requestPasswordReset, resetPassword } = useLtAuth();
const config = useRuntimeConfig();

// Signed-in user changes their own password.
// `revokeOtherSessions` ends every OTHER session — set it after a suspected compromise.
await changePassword({ currentPassword, newPassword, revokeOtherSessions: true });

// Step 1: send the reset mail.
await requestPasswordReset({
  email,
  redirectTo: new URL('/auth/reset-password', config.public.siteUrl).toString(),
});

// Step 2: on the reset page, with the token from the query string.
await resetPassword({ newPassword, token: route.query.token as string });
</script>
```

**`redirectTo` must be an absolute URL.** Better Auth resolves it against the **API** origin, so
a relative value lands on the API host where the route does not exist — a 403
`INVALID_REDIRECT_URL`, no mail sent, and nothing visible in the browser. In an lt starter
project the auto-imported `appUrl()` helper builds one and throws rather than returning something
relative; that helper lives in the starter (`app/utils/app-origin.ts`), not in this package, so
outside a starter use `new URL(path, siteUrl).toString()` as above.

**Never build `redirectTo` from user input** (`route.query`, a referrer, a form field). The link
carries a live single-use reset token, so an attacker-chosen destination is account takeover
rather than a phishing redirect. The server's `trustedOrigins` allowlist is what stops it.

**Enforce a minimum password length in your own form.** better-auth checks `minPasswordLength`
against the value it receives, and because this library hashes first, that value is always a
64-character hex string — the check passes on every path. The form is the only place the rule can
live.

### First Admin Setup

With `auth.systemSetup.enabled`, a global middleware sends visitors to `setupPath` while the API
has no user yet, and `useSystemSetup()` creates the first admin.

Since `@lenne.tech/nest-server` 12.4.0 the anonymous `POST /system-setup/init` is open only in
`local`, `ci` and `e2e`. A deployed API refuses it with 403 (`LTNS_0053`) unless the deployment
releases it (`systemSetup.httpInit`), optionally behind a setup token. A deployment usually creates
its first admin from its configuration instead (`systemSetup.initialAdmin`).
`GET /system-setup/status` reports which applies, and the composable exposes it:

```vue
<script setup lang="ts">
const { httpInitEnabled, httpInitTokenRequired, initSetup } = useSystemSetup();
const { translateError } = useLtErrorTranslation();
const toast = useToast();

async function onSubmit(data: { email: string; name: string; password: string; token?: string }) {
  try {
    // `token` goes out as the X-System-Setup-Token header, unhashed; omit it when not required.
    await initSetup(data);
  } catch (error) {
    // Pass the error itself: the #LTNS_ code is in the response body, not in `error.message`.
    toast.add({ color: 'error', description: translateError(error), title: 'Setup failed' });
  }
}
</script>

<template>
  <!-- `false`: the deployment creates its first admin from its configuration — no form. -->
  <SetupNotice v-if="httpInitEnabled === false" />
  <SetupForm v-else :with-token="httpInitTokenRequired === true" @submit="onSubmit" />
</template>
```

- **Without the HTTP setup the middleware redirects nowhere.** A redirect would hold every visitor
  on a page whose only action fails. The setup page stays reachable, so it must show the notice
  itself.
- **An API before 12.4.0** reports neither field and accepts the HTTP setup, so `httpInitEnabled`
  reads `true` and `httpInitTokenRequired` `false` — the behaviour before this release.
- **After a 403 from `initSetup()`** the composable re-reads the status before rethrowing, so a page
  whose API was restarted with another configuration switches to the notice (`LTNS_0053`) or to the
  token field (`LTNS_0054`) without a reload.
- `null` means the status was not read yet, or reading it failed.

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
  endpoint: '/tus', // optional — defaults to ltExtensions.tus.defaultEndpoint
  onSuccess: (item) => console.log('Stored file:', item.fileId),
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

**Where the upload goes.** A relative endpoint is a path on the API: it is resolved like the auth
requests — `NUXT_PUBLIC_API_URL` + path, or `/api` + path while the dev proxy is on
(`NUXT_PUBLIC_API_PROXY=true`). So `'/tus'` works in every environment without per-stage config. An
absolute URL is used as it is. If your project routes uploads through its own same-origin proxy
instead, set `ltExtensions.tus.resolveAgainstApi: false` and the relative endpoint stays on the app
origin.

**Changing it per stage.** The `tus` options are part of the public runtime config, so a deployed
stage can override them through the environment, without a rebuild:

```bash
# Send this stage's uploads to another host (absolute URLs are used as they are)
NUXT_PUBLIC_LT_EXTENSIONS_TUS_DEFAULT_ENDPOINT=https://uploads.example.com/tus
# Keep a relative endpoint on the app origin (own same-origin proxy)
NUXT_PUBLIC_LT_EXTENSIONS_TUS_RESOLVE_AGAINST_API=false
```

Keep the relative default where you can: `NUXT_PUBLIC_API_URL` already differs per stage, so `'/tus'`
follows it. Uploads are sent with credentials, so a host other than the API has to receive the
session cookie, or every upload answers 401.

**Which id to keep.** After a successful upload, `item.fileId` is the id of the stored file, read
from the `X-File-Id` response header (nest-server 11.42.13+). Use it for file links and references.
`item.url` is the TUS upload resource; its last segment is the upload id, not the file id. `fileId`
is undefined when the backend sends no such header (an older nest-server, or an `onUploadComplete()`
override that never calls `super.onUploadComplete(upload)`).

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

The components style themselves with Tailwind 4 utilities. Tailwind only generates the classes it
finds in your sources, and a package in `node_modules` is not among them, so in npm mode add the
package's runtime to the stylesheet that imports Tailwind:

```css
/* app/assets/css/tailwind.css */
@import 'tailwindcss';
@import '@nuxt/ui';
@source '../../../node_modules/@lenne.tech/nuxt-extensions/dist/runtime';
```

The path is relative to that stylesheet. A vendored core (`app/core`) is scanned with the app
anyway, and Tailwind ignores a `@source` path that does not exist, so the line can stay after a
switch to vendor mode. Without it, a transition whose classes the app does not use elsewhere runs
without its duration or easing.

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

### Error Translation

`useLtErrorTranslation()` turns a backend error such as `#LTNS_0100: Unauthorized - User is
not logged in` into the text for the user's locale, loaded from the API's
`GET /i18n/errors/<locale>`.

```typescript
const { translateError, showErrorToast } = useLtErrorTranslation();

const message = translateError(error); // "Sie sind nicht angemeldet."
showErrorToast(error, 'Anmeldung fehlgeschlagen');
```

**The translations load after the app is mounted, and the start does not wait for them.**
Until they are there, `translateError` returns the developer message (`Unauthorized - User is
not logged in`), never an empty string. A template that renders `translateError(...)` switches
to the translation as soon as it arrives. A toast takes the text it had when it was shown. Code
that has to have the translations first awaits them; a load already in flight is shared, not
repeated:

```typescript
const { loadTranslations, translateError } = useLtErrorTranslation();
await loadTranslations(); // resolves once loaded, or once the load failed (logged, never thrown)
```

**Messages rendered during SSR carry the developer message.** The server loads no translations
by default: that would cost one API request and the whole table in the payload of every page,
for messages that almost always appear after an action in the browser. The client translates
them after the mount. A project that renders errors on the server, such as an `error.vue` for a
failed `useAsyncData`, loads the table there itself, in a plugin of its own:

```typescript
// plugins/error-translations-ssr.server.ts
export default defineNuxtPlugin(async () => {
  await useLtErrorTranslation().loadTranslations();
});
```

The state reaches the client in the payload, so the browser fetches nothing again and hydration
sees the same text as the server. This needs `@nuxtjs/i18n`: without it, the server takes
`errorTranslation.defaultLocale` and the browser its own language, and the two can differ.

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

`load()` lists active prompts only, which is what a chat picker offers. A management screen
calls `load({ includeDisabled: true })` (nest-server >= 12.7.0), so a prompt saved with
`enabled: false` stays in the list and can be switched on again:

```typescript
// Settings page: every prompt, disabled ones included
const { load, prompts, update } = useLtAiPrompts();
onMounted(() => load({ includeDisabled: true }));
// The reload after create / update / remove asks for the same list
await update(prompt.id, { enabled: false });
```

Each `useLtAiPrompts()` call has its own list, so the chat picker on the same page stays on
active prompts. An API before 12.7.0 ignores the parameter and lists active prompts only.

### AI status

`useLtAiStatus()` says whether the API's AI module is on, so AI pages and navigation entries can
be shown only then. It reads the public `GET /ai/status` of nest-server: 200 `{ mcp }` while the
module is on, 404 while it is off.

```typescript
// middleware/ai.ts
export default defineNuxtRouteMiddleware(async () => {
  const status = useLtAiStatus();
  await status.load();
  if (!status.enabled.value) {
    return navigateTo('/app');
  }
});
```

- One request per app start. The state is shared (`useState`) and travels from SSR to the
  client, and callers that load at the same time share one request. `load({ force: true })` asks
  again.
- Sent without credentials; the endpoint is public.
- Fails closed. A 404 means "AI is off" and sets no `error`. A network error, a timeout (5 s),
  any other status or a malformed body leaves `enabled` false and sets `error`.
- `GET /ai/status` exists from nest-server 12.3.1. An older API answers 404 as well, so AI reads
  as off there. Gate on this only once your API runs 12.3.1 or later.
- `mcp` says whether the API serves MCP. Show the MCP confirmation switch below only then.

### MCP confirmation switch

Over MCP (Claude Desktop, Claude Code and other clients), nest-server 12.3.0 or later asks the
user before a destructive tool runs, and before a mutating one if the server is configured that
way. Each user may switch the question off for themselves, like a "bypass permissions" mode.
`useLtAiSettings()` reads and changes that switch (`GET/PUT /ai/settings`):

```vue
<script setup lang="ts">
const { enforced, load, settings, update } = useLtAiSettings();
await load();

async function toggle(value: boolean) {
  try {
    await update({ mcpConfirmation: value });
  } catch {
    // `error` holds the message; `settings` keeps the previous value, so the switch snaps back
  }
}
</script>

<template>
  <USwitch
    v-if="settings"
    :model-value="settings.mcpConfirmation"
    :disabled="enforced"
    label="Ask before destructive AI actions over MCP"
    @update:model-value="toggle"
  />
</template>
```

- Mount the switch only once `settings` is loaded (`v-if`). reka-ui's `Switch` decides at mount
  whether it is controlled: mounted with `undefined`, for example while `onMounted(load)` is still
  running, it keeps its own state, and a refused change then stays flipped although `settings`
  kept the old value.
- `settings` is always the value as it takes effect, never just the stored choice. `update()`
  adopts the server's answer instead of the input.
- `enforced` is true when the server fixed the value (`ai.mcp.confirmation.enforced`). Show the
  switch disabled. A change is refused with 403 `#LTNS_0609`, which `update()` throws.
- Switching it off lets an MCP client run destructive tools in this user's name without asking.
  Say so next to the switch. The tool's own `authorize()` check and the admin's `deny` / `ask`
  rules still apply, and other users and the in-app chat are not affected.

### Lower-level + supporting composables

| Composable | Purpose |
|------------|---------|
| `useLtAi()` | One-shot `prompt(input)` and streaming `promptStream(input, handlers)` (POST `/ai/stream`) |
| `useLtAiChat()` | Multi-turn chat state, streaming, budget, confirmation, `stop()`/`clear()`, optional `maxMessages` cap, auto-stop on component unmount |
| `useLtAiConnections()` | User self-service: available connections + `select()` (`selected`/`locked`) |
| `useLtAiSettings()` | The user's own AI settings: the MCP confirmation switch + `update()` (`enforced`) |
| `useLtAiStatus()` | Whether the API's AI module is on (`enabled`, `mcp`), shared state, one request per app start |
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

## Offline Sync

Read and write while disconnected, reconcile when back. `useLtOfflineSync()` is the client of the
`@lenne.tech/nest-server` **sync module** (12.2.0 or later); the protocol is
`docs/offline-sync-protocol.md` in nest-server. It is opt-in, both here and on the server:

```typescript
// nuxt.config.ts
ltExtensions: {
  sync: { enabled: true, basePath: '/sync' }, // basePath must match the nest-server sync module
}
```

The API needs a sync model too: `@PersistedModel({ sync })` on the model and `@SyncService` on its
CrudService (nest-server `src/core/modules/sync/README.md`).

```vue
<script setup lang="ts">
const { create, needsLogin, offline, pendingCount, records, remove } = useLtOfflineSync<{ title: string }>('note');

// Works offline: the change shows at once and waits in the outbox until the next sync
const add = (title: string) => create({ title });
</script>

<template>
  <p v-if="offline">Offline — {{ pendingCount }} changes waiting</p>
  <p v-if="needsLogin">Please sign in again; nothing is lost</p>
  <ul>
    <li v-for="note in records" :key="note.id">
      {{ note.data?.title }} <button @click="remove(note.id)">Delete</button>
    </li>
  </ul>
</template>
```

**What it does:**

- Keeps records, cursors and unsent changes in IndexedDB. Each change carries a `mutationId` and
  the `baseVersion` it is based on, so a repeated send never duplicates and a stale one conflicts.
- Syncs at start, on `online`, on focus, shortly after a local change, and after a server hint
  (`GET <basePath>/hints`, read with `fetch` so it signs in with a cookie and a JWT alike). Every
  reconnect of the hint stream pulls once: the server ends the stream on purpose and does not
  replay what it missed. All instances of a tab share one stream per tenant, and a hidden tab
  keeps none open.
- Handles every item status and HTTP status of the protocol: `401` keeps everything (sign in again,
  the same changes go out without duplicates), `410` drops the local records and pulls everything
  again while keeping unsent changes, `403` on a pull drops the model's records, `429`/`503` and
  network errors back off. A refused change is dropped and the record returns to the server's state.
- Tabs share the data: one syncs at a time (Web Locks), the others show the result
  (BroadcastChannel).

**Options:** `idFormat` (`'objectId'` default, `'uuidv7'` for models declared with it),
`onConflict` (default: the server wins; return `{ data }` to send your answer again on top of the
server's version), `tenantId` (`X-Tenant-Id`; records and unsent changes are kept per tenant, so a
change made under one tenant never goes out under another), `pageLimit`, `hints: false`,
`auto: false` (only `sync()` syncs).

**Whose data it is.** The local data belongs to the signed-in user:

| Event | Local data |
|-------|-----------|
| `useLtAuth().signOut()` | The user's own unsent changes are sent (at most 5 s), then the whole database is deleted |
| Another user signs in | Deleted before anything is shown or pulled |
| Session expired, same user signs in again | Kept; the outbox goes out without duplicates |
| Nobody signed in | Nothing shown, changes refused |

A sync answer that arrives after the sign-out or the account switch is discarded, not stored. A
sign-out flow that bypasses `useLtAuth().signOut()` must do the same itself:
`flushLtSyncBeforeSignOut(userId)` and `deleteLtSyncDatabase()` from
`@lenne.tech/nuxt-extensions/lib`. The flush sends only when the local data belongs to `userId`.
`pendingCount` lets the app warn before signing out. A service worker must never cache responses
of `/sync` or `/iam` (nest-server `src/core/modules/sync/SECURITY.md`).

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
| `useLtAuth()` | Better-Auth integration with session, passkey, 2FA, password change + reset |
| `useLtAuthClient()` | Direct access to the Better-Auth client singleton (`twoFactor.*`, `admin.*`, `passkey`) |
| `useLtErrorTranslation()` | Translate backend error codes to user-friendly messages |
| `useLtTusUpload()` | TUS protocol file uploads with pause/resume |
| `useLtFile()` | File utilities (size formatting, URLs) |
| `useLtShare()` | Web Share API with clipboard fallback |
| `useSystemSetup()` | First admin creation: setup status, HTTP-setup release + token (nest-server >= 12.4.0) |
| `useLtAi()` | One-shot `prompt()` + streaming `promptStream()` for the nest-server AI module |
| `useLtAiChat()` | Multi-turn chat state, streaming, budget summary, confirmation gate, `maxMessages` cap |
| `useLtAiConnections()` | User self-service connection list + `select()` |
| `useLtAiSettings()` | The user's own AI settings (MCP confirmation switch, nest-server >= 12.3.0) |
| `useLtAiStatus()` | Whether the API's AI module is on and serves MCP (public `GET /ai/status`) |
| `useLtAiUsage()` | Token/prompt usage breakdown per user / tenant |
| `useLtAiPrompts()` | User-facing prompt snippet CRUD (`'user'` / `'tenant'` scope) |
| `useLtAiPlaceholders()` | Loads the backend's `{{placeholder}}` registry |
| `useLtAiAdmin()` | Admin CRUD for connections, preferences, budget limits, slots, prompt hints, interactions |
| `useLtOfflineSync()` | Offline read/write of one model, synced with the nest-server sync module (opt-in) |

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
