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
│   ├── server/            # Nitro code: the opt-in security.txt route (auth talks to the backend directly, no proxy)
│   ├── testing/           # Playwright test helpers
│   ├── types/             # TypeScript type definitions
│   └── utils/             # Auto-imported utility functions
```

## Key Composables

### Auth + uploads + utilities

| Composable | Purpose |
|-----------|---------|
| `useLtAuth()` | Authentication state, login, logout, session management, password change + reset |
| `useLtAuthClient()` | Raw Better Auth client access (`twoFactor.*`, `admin.*`, `passkey`) |
| `useSystemSetup()` | First-admin setup flow: status, HTTP-setup release + setup token (nest-server >= 12.4.0) |
| `useLtTusUpload()` | TUS resumable file uploads |
| `useLtFile()` | File utilities (size formatting; file links on the API, the public URL also during SSR) |
| `useLtShare()` | Web Share API with clipboard fallback |
| `useLtErrorTranslation()` | Translate backend error codes |

### AI assistant (nest-server AI module)

| Composable | Purpose |
|-----------|---------|
| `useLtAi()` | One-shot `prompt()` + streaming `promptStream()` (POST `/ai/prompt` / `/ai/stream`) |
| `useLtAiChat()` | Multi-turn chat: streaming, budget summary, confirmation gate, `stop()`/`clear()`, optional `maxMessages` cap, auto-stop on unmount |
| `useLtAiConnections()` | User-facing list of available connections + `select()` |
| `useLtAiSettings()` | The user's own AI settings: MCP confirmation switch (`GET/PUT /ai/settings`, `enforced` → show disabled) |
| `useLtAiStatus()` | Whether the API's AI module is on (`GET /ai/status`, public; 404 = off): `enabled`, `mcp`, shared `useState`, one request per app start, fails closed |
| `useLtAiUsage()` | Full token/prompt usage breakdown (`GET /ai/usage`) |
| `useLtAiPrompts()` | User-facing CRUD for re-usable prompt snippets ("Vorlagen", `scope: 'user'` / `'tenant'`). `load()` = active only (chat picker); `load({ includeDisabled: true })` = management list (nest-server >= 12.7.0), kept for the reload after create/update/remove |
| `useLtAiPlaceholders()` | Loads the backend's `{{placeholder}}` registry for editor sidebars |
| `useLtAiAdmin()` | Admin CRUD: connections, preferences, budget limits, slots, prompt hints, interactions — server-gated |

### Offline sync (nest-server sync module, opt-in)

| Composable | Purpose |
|-----------|---------|
| `useLtOfflineSync(model, options?)` | Offline read/write of one model in IndexedDB; push/pull against `/sync`, hints, conflicts, tabs, owner check |

## Module Configuration

Configure in `nuxt.config.ts` (top-level key is `ltExtensions`):

```typescript
export default defineNuxtConfig({
  modules: ['@lenne.tech/nuxt-extensions'],
  ltExtensions: {
    auth: {
      enabled: true,                 // only gates the 401 interceptor (= interceptor.enabled); the auth composables stay
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
      defaultEndpoint: '/tus',       // nest-server's TUS path (default)
      defaultChunkSize: 5 * 1024 * 1024,  // 5MB
    },
    i18n: {
      autoMerge: true,
    },
    ai: {
      enabled: true,
      basePath: '/ai',               // Must match the nest-server AI controller
    },
    sync: {
      enabled: false,                // opt-in: useLtOfflineSync() + sign-out cleanup
      basePath: '/sync',             // Must match the nest-server sync module
    },
    formLabelAssociation: {
      enabled: true,                 // repair <label for> broken by an SSR/client useId() divergence
      maxRepairMs: 1500,             // how long to keep repairing deferred subtrees
    },
    preHydrationInput: {
      enabled: true,                 // keep text typed before hydration instead of losing it
      maxRestoreMs: 1500,            // how long to keep repairing deferred subtrees
    },
    securityTxt: {
      enabled: false,                // opt-in: /.well-known/security.txt (RFC 9116)
      contact: 'mailto:security@lenne.tech',
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

### One authenticated fetch (DEV-4074)

`useLtAuth().fetchWithAuth` and `ltAuthFetch` / `createLtAuthFetch` are ONE implementation:
`createLtAuthFetchFor` in `lib/auth-state.ts`. They used to be two copies, and only one of them
renewed an expired JWT. Do not write a third one; a caller with its own state passes it in.

- **A 401 while signed in fetches a JWT once and retries once.** Cookie mode: the switch to JWT.
  JWT mode: the bearer had expired (15 minutes against a 7-day session). One `GET <basePath>/token`
  per burst, shared by every caller (`requestLtJwtAfter401`); each caller stores the token where it
  keeps its own (`adoptJwt`: the cookies, or the composable's `useCookie` refs).
- **A 401 the bearer did not cause is never retried in JWT mode.** `ltAuthFetch`: Better-Auth's own
  routes (under the auth base), where a 401 is the verdict of sign-in, 2FA or passkey; sending a wrong
  password or code again counts twice against the rate limit. `fetchWithAuth`: the cookie-bound paths.
- **Cookies in JWT mode differ on purpose.** `ltAuthFetch` always sends them: nest-server
  (>= 11.13.1) falls back to the session cookie when the bearer fails, and Better-Auth's own routes
  read the session from it. `fetchWithAuth` sends them only to passkey, 2FA and `/get-session`
  (`cookiesInJwtMode: 'auth-paths'`, as ng-base does). Changing either is a behaviour change.
- **The JWT comes from `auth.basePath`.** Without an argument, `ltAuthFetch`, `createLtAuthFetch()`
  and `attemptLtJwtSwitch()` read it from the runtime config. `requestLtJwt()` is the only place a
  JWT is fetched, `useLtAuth().switchToJwtMode()` included.

## AI Assistant Flow

- All AI composables route through `ltAuthFetch` (Cookie/JWT dual mode) and `buildLtAiUrl` (SSR/public URL resolution), so they inherit the same auth + URL behaviour as the rest of the library.
- `useLtAi.promptStream()` and `useLtAiChat()` consume `POST /ai/stream` via `fetch` + `ReadableStream` (NOT `EventSource` — the endpoint is `POST` with auth). The SSE parser is robust against split chunks, keep-alive comments, malformed lines, and oversized lines (>1 MiB throws).
- `useLtAiAdmin()` is exposed as a regular composable; admin gating is enforced server-side (`@Restricted(ADMIN)`). Render admin UI behind a frontend route guard for UX, but trust the backend for authorization.
- The chat composable's `messages` ref is a shallow `Readonly<Ref<LtAiMessage[]>>` so child components can bind individual messages while preserving streaming reactivity.

## Offline Sync

`useLtOfflineSync()` is the client of the nest-server sync module (>= 12.2.0); the protocol is
`docs/offline-sync-protocol.md` in nest-server. Both ends are opt-in: `ltExtensions.sync.enabled`
here, a sync model (`@PersistedModel({ sync })` + `@SyncService`) on the API.

**The local data belongs to the signed-in user, and only explicit sign-out deletes it:**

- `useLtAuth().signOut()` sends what is unsent (at most 5 s), signs out, then deletes the whole
  IndexedDB database `lt-offline-sync`. **A custom sign-out that bypasses it must call
  `flushLtSyncBeforeSignOut(userId)` and `deleteLtSyncDatabase()` (from `/lib`) itself** — otherwise
  the user's records stay on the device.
- **The flush sends only the signing-out user's own changes.** After an expired session the outbox
  of the PREVIOUS user is still there; pushed under the current session it would land in the
  current user's account. `flushLtSyncBeforeSignOut` compares the stored owner with `userId`.
- **An expired session deletes nothing.** The 401 interceptor calls `clearUser()`, not `signOut()`,
  on purpose: the protocol promises that after signing in again the same changes go out without
  duplicates. Never hook the sync cleanup into `clearUser()` — that would delete unsent work on
  every expired session.
- Another user wipes the data before anything is shown or pulled (`claimLtSyncOwner`, one
  transaction); so does data WITHOUT an owner. Nobody signed in sees nothing.
- **Every write of a sync run is fenced by the owner it started for** (`runLtSyncTx(…, { owner })`).
  An answer arriving after sign-out deleted the database, or after another account claimed it,
  would otherwise reopen the database and write the previous user's records for the next one.
- Local data is kept per model AND tenant (`ltSyncScope`): the server stamps a create into the
  tenant of its `X-Tenant-Id`, so one tenant's unsent change must never go out under another.

**Rules that keep the engine correct (`src/runtime/lib/sync.ts`):**

- A push carries at most ONE change per record, and the next one goes out only once the one before
  it is `applied` or `merged`. Its `baseVersion` assumes exactly that; sent while the first is open
  (`retry`) or after it was refused (`rejected`, `not_found`, `conflict`), it can meet another
  writer's version with the same number and be applied on top of it. So it waits behind a `retry`
  and is dropped after a refusal (protocol §11 since nest-server 12.3.0, which also guards this
  server-side within one request).
- An outbox item a push has carried (`attempted`) is never edited again; a later edit becomes a new
  item. Read-and-mark happens in one IndexedDB transaction.
- `onConflict` runs outside any IndexedDB transaction (an awaited hook would let the transaction
  auto-commit). Nothing inside `runLtSyncTx()` may await anything but that transaction's requests.
- Hints are read with `fetch`, not `EventSource` (no `Authorization` header in JWT mode). Every
  reconnect pulls once: the server ends the stream on purpose and never replays the hint it missed.
- ONE hint stream per tab and tenant (`subscribeLtSyncHints`), for every model in use. A stream per
  composable call holds a connection each; over HTTP/1.1 six of them stall every API request.
- A refused change (`rejected`) to a record the server has drops the cursor, so the pull right after
  restores the server's state; otherwise the device would keep showing the refused value.

**Tests:** `test/sync-engine.test.ts` runs the protocol's five client scenarios (offline
create/change/delete, conflict, two tabs, expired session, cleared storage) against
`test/fixtures/sync-server.ts` with `fake-indexeddb`. The browser E2E against a real nest-server
lives in the nuxt-base-starter (DEV-3919).

A service worker must never cache `/sync` or `/iam` responses (nest-server
`src/core/modules/sync/SECURITY.md`).

## Testing Helpers

Playwright helpers, imported from `@lenne.tech/nuxt-extensions/testing` (the starter's E2E tests use
them this way):

```typescript
import { fillInput, generateTestUser, gotoAndWaitForHydration, waitForURLAndHydration } from '@lenne.tech/nuxt-extensions/testing';

const user = generateTestUser('e2e');
await gotoAndWaitForHydration(page, '/auth/register');
await fillInput(page, 'input[name="email"]', user.email);
```

| Group | Exports |
|-------|---------|
| Hydration | `waitForHydration`, `gotoAndWaitForHydration`, `waitForURLAndHydration`, `DEFAULT_HYDRATION_TIMEOUT` |
| Input | `fillInput`, `fillInputs` |
| Test data | `generateTestUser` (type `TestUser`), `generateRandomString` |
| TOTP / 2FA | `generateTOTP`, `extractTOTPSecret`, `parseTOTPUrl` |
| Waiting, reading | `waitForElement`, `waitForNetworkIdle`, `hasText`, `getAllText` |

There is no `createTestUser` or `loginTestUser`. A test registers and signs in through the pages, as
the starter's specs do. `test/doc-imports.test.ts` fails when this file or the README imports a
name that `/testing` or `/lib` does not export.

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
- Don't store the `token` of a 2FA or passkey answer anywhere. Finish a 2FA sign-in with `useLtAuth().twoFactor.verifyTotp()` / `verifyBackupCode()`.

### The session token never reaches `lt-jwt-token`:
Better-Auth answers `two-factor/verify-totp` and `verify-backup-code` with `{ token, user }`, and
`passkey/verify-authentication` with `{ session, user }`; nest-server forwards these routes
unchanged. That token is the session token, the value the API keeps in the httpOnly
`iam.session_token` cookie. The starter's 2FA page stored it as the "JWT" in the readable
`lt-jwt-token` cookie, so one XSS was enough to take the session for its whole lifetime
(nuxt-extensions 1.26.0 closes it).

- **`lt-jwt-token` holds a JWT or nothing.** The `jwtToken` ref, `setLtJwtToken()`,
  `switchToJwtMode()`, `attemptLtJwtSwitch()` and `signIn` / `signUp` take a value only when
  `isLtJwtShaped()` says so. That is the same test as nest-server's `isJwtShaped`: three segments,
  header `eyJ`. Test fixtures need JWT-shaped tokens too; `'a.b.c'` is refused.
- **A JWT comes from `GET /iam/token`, or from a body the server already converted** (sign-in with
  `cookies: false`; nest-server's `resolveJwtToken` never returns the session token there).
- **Anything else found in `lt-jwt-token` is deleted** on start (`useLtAuth()`) and on read
  (`getLtJwtToken()`), along with its JWT mode, because leaked values from before 1.26.0 are
  still in users' browsers. Never write such a value there "temporarily".
- **`setUser(user, 'jwt')` without a stored JWT falls back to `'cookie'`** and fetches the JWT.
  Without that fallback, the refusal above would turn a hand-written 2FA page into a sign-in that
  sends no credentials at all.
- **`useLtAuthClient().twoFactor.verify*` strips a non-JWT `token` from the answer**, and
  `authenticateWithPasskey()` returns no `session`. Keep both: application code that never
  receives the session token cannot store it.

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

## Password Handling: Reset, Change, and Client-Side Hashing

**Every password leaves the browser SHA256-hashed.** `auth-client.ts` wraps each Better-Auth
method that carries a credential and substitutes that one field with its digest;
`@lenne.tech/nest-server` hashes the received value again on its side. The two ends agree only
because both do this — which is why a hand-rolled call is not a style choice but a way to lock
a user out of their own account.

### Use the composable. Never hand-roll the flow.

`useLtAuth()` exposes the whole set — `changePassword`, `requestPasswordReset`, `resetPassword`
(since 1.16.0) — alongside `signIn` / `signUp`. Reach for `useLtAuthClient()` only for surfaces
the composable does not carry (`twoFactor.*`, `admin.*`, `passkey`); that client hashes too.

What went wrong when a project did otherwise: `useLtAuth()` offered `changePassword` but neither
reset method, so a reset page was built directly against `$fetch`, the client-side hashing was
forgotten, and the backend stored `scrypt(plaintext)` while sign-in verified
`scrypt(sha256(plaintext))`. The password the user had just chosen did not work, and nothing in
either log said why. The gap in this composable is what created that workaround.

```typescript
const { requestPasswordReset, resetPassword } = useLtAuth();

// Step 1 — send the mail. `redirectTo` MUST be absolute (see below).
await requestPasswordReset({
  email,
  redirectTo: new URL('/auth/reset-password', config.public.siteUrl).toString(),
});

// Step 2 — on the reset page, with the token from the query string.
await resetPassword({ newPassword, token });
```

### `redirectTo` must be absolute, and must never come from user input

Better Auth resolves it against the **API** origin (`new URL(callbackURL, ctx.baseURL)`). A
relative value therefore lands on the API host, where the route does not exist: 403
`INVALID_REDIRECT_URL`, no mail sent, nothing visible in the browser. It fails silently.

**It also carries a live single-use reset token.** An attacker-chosen value is account takeover,
not a phishing redirect — so never build it from `route.query`, a referrer, or a form field.
The only thing holding it back is the server's `trustedOrigins` allowlist; a project that
widens that (or sets a wildcard) removes the last barrier. In lt starter projects `appUrl()`
(from the starter's `app/utils/app-origin.ts`, not from this package) builds one and throws
rather than returning something relative; elsewhere use `new URL(path, siteUrl).toString()`.

### Password length is enforced by YOUR form — the server cannot do it

better-auth checks `minPasswordLength` against the value it **receives**
(`api/routes/password.mjs`). Because this library hashes first, that value is always a 64-character
hex string, so the check passes trivially on every path. nest-server 11.38.0 adds a raw-value
length check for plaintext clients, and it deliberately skips anything matching `^[a-f0-9]{64}$`
— i.e. skips us.

This is a consequence of client-side hashing, not a bug in either backend, and there is nothing to
"fix" server-side. **A minimum length must live in your form schema** (the starters use
`v.minLength(8)` on register, setup and reset). If someone later removes that rule reasoning that
"the server validates it", nothing will catch it.

### `admin.*` is passed through UNHASHED — an armed trap, not a live one

`admin.createUser` (`password`) and `admin.setUserPassword` (`newPassword`) are the only
passwords this library does **not** hash. (The setup token of `useSystemSetup().initSetup()` is
unhashed too, by design — see "First Admin Setup" below.)

Today that is harmless: `@lenne.tech/nest-server` does not register better-auth's `admin()`
plugin and has no option to enable it, so those routes 404. But `auth.enableAdmin` defaults to
`true`, meaning the admin *client* plugin is registered in every consuming project — the trap is
armed and waiting for a server that answers.

**Enabling `admin()` server-side is therefore a lock-step change across both repos in one
release:** the two routes join nest-server's password-normalisation table, and these two methods
get `ltSha256` wrappers here. Doing only the server half creates accounts whose password nobody
can ever log in with, with no error anywhere. Hashing here pre-emptively is equally wrong — it
would build a client expectation the server does not answer.

### If you add a wrapper that hashes something

Add it to both guards. `test/auth-client-hashing.test.ts` asserts the actual request payload;
`test/auth-client-param-forwarding.test.ts` keeps the source-level half. A hashing wrapper
replaces ONE field and forwards the rest — `{ ...params, password: hashed }`. Never
`{ password: hashed }` (drops `revokeOtherSessions`, `redirectTo`, `method`, `issuer` — all
shipped defects), and never `{ password: hashed, ...params }`, which looks almost identical and
puts the **plaintext** back on the wire.

## First Admin Setup: the HTTP init is closed on deployed stages

Since nest-server 12.4.0 the anonymous `POST /system-setup/init` is open only in `local`, `ci` and
`e2e`. A deployed API refuses it with 403 (`LTNS_0053`) unless `systemSetup.httpInit` releases it,
optionally behind a setup token (`LTNS_0054` when wrong). `GET /system-setup/status` reports
`httpInitEnabled` and `httpInitTokenRequired`; `useSystemSetup()` exposes both.

- **The middleware does not redirect when `httpInitEnabled === false`.** That is deliberate, not a
  bug: a redirect would hold every visitor on a page whose only action fails, and the login would be
  unreachable. The setup page itself must show the notice ("first admin comes from the
  configuration") instead of the form.
- **The token is a header (`X-System-Setup-Token`), unhashed, never a body field.** Unlike the
  passwords, it is not hashed: the server compares it as given. Do not add it to the SHA256
  wrappers.
- **A missing field means an API before 12.4.0**, which accepts the HTTP setup: `httpInitEnabled`
  reads `true`. The server's 403 is the boundary, the flag is UX. Only a 200 without the field
  counts as old; a failed status read leaves both values unchanged (`null` initially).
- **After a 403 from `initSetup()` the composable re-reads the status** before rethrowing, so the
  page switches to the notice or the token field when the API was restarted with another
  configuration. Pass the error itself to `translateError(error)`: the `#LTNS_` code is in the
  body, `error.message` holds only the transport line.

## Package Entry Points (DEV-4079)

- **npm `.`** is `dist/module.mjs`, built from `src/module.ts`: the module and every type
  (`export type * from './runtime/types'`). Runtime values come from auto-imports or `./lib`;
  `./testing` holds the Playwright helpers.
- **`src/index.ts` is the entry of the VENDORED core, not dead code.** npm mode never builds it,
  but the lt CLI copies it to `app/core/index.ts` and rewrites `from '@lenne.tech/nuxt-extensions'`
  to `app/core`. Deleting it breaks every type import of a vendored project. It re-exports whole
  barrels (`export *`); never turn it back into a hand-written list, which lost three composables.
- **Every package `src/` imports is declared**, as a dependency or a peer. A package that is only
  there when the project installs it is an optional peer, with a stub alias in `module.ts` if it is
  imported statically (`test/optional-peers.test.ts`).
- **One declaration per type** under `src/runtime/types`. `test/package-exports.test.ts` holds
  the last three rules.

## Error Translation: loaded after mount (DEV-4078)

`plugins/error-translation.client.ts` starts `loadTranslations()` in `app:mounted` and does not
await it. `test/error-translation-loading.test.ts` holds both halves.

- **Never make the plugin async again, and never start the load before the mount.** Awaited, it
  held back every client start for one API request. Started early but not awaited, it races
  hydration: the server renders the developer message (it loads no translations), and
  translations arriving before hydration render another text on the client.
- **Loads are shared per Nuxt app and locale** (`inFlightLoads`), and `isLoading` is shared
  state. A second caller waits for the request in flight instead of returning before the
  translations are there. A load for another locale is never swallowed by one in flight.
- **Until the load is done, `translateError` returns the developer message.** That is the
  documented fallback, not a bug. `loadTranslations()` never rejects; a failure is logged, and
  the next call tries again.
- **SSR translates nothing by default** (one request and the whole table in every payload). The
  README shows the opt-in: a project's own `.server` plugin awaits `loadTranslations()`, and the
  payload carries the state to the client. It needs `@nuxtjs/i18n`, so both sides pick the same
  locale.

## Form Label Repair

**The defect:** Nuxt UI's `FormField` derives the label's `for` and the control's `id` from one
`useId()` call. When `useId()` diverges between server and client, the control's `id` is
force-patched on hydration (vuejs/core#9083) while the label's `for` — a prop on reka-ui's
`Label` component — is not. The label keeps the stale value and the association breaks.

**What this module adds:** `runtime/plugins/form-label-association.client.ts` repairs three
associations inside Nuxt UI fields whose label no longer resolves — `<label for>`,
`aria-labelledby` on group roots, and `aria-describedby` on controls — at `app:mounted`, for a
bounded window afterwards (`maxRepairMs`, default 1500 ms), and via a `MutationObserver` for
subtrees that hydrate later (`observeDeferred`, default on).

**What this means when you debug a consuming project:**

- **A `for` / `aria-labelledby` / `aria-describedby` that changes after mount is this plugin, not
  a bug.** It logs once per page in development, naming the repaired fields. Repaired labels
  carry `data-lt-label-repaired`.
- **`aria-describedby` is the one people miss.** The error container's id IS force-patched on
  hydration; the reference to it is not, so validation errors are visible but never announced
  (WCAG 3.3.1 / 3.3.3). If a project reports "screen reader stays silent on form errors", check
  whether this plugin is disabled before looking anywhere else.
- **It refuses to guess.** The `for` repair fires only when the field holds exactly one eligible
  control. Groups get `aria-labelledby` instead — a `for` on a `<div role="radiogroup">` is inert
  however carefully it is chosen.
- **`disabled` and `readonly` fields ARE repaired**, and must stay that way. They are rendered
  and announced, so WCAG 1.3.1 / 4.1.2 apply unchanged; WCAG's only carve-out for inactive
  components is contrast. Excluding `disabled` was tried in 1.13.0 and reproduced the very defect
  the plugin repairs on every read-only form — and additionally mis-bound partially disabled radio
  groups, so a click on one caption selected a different option.
- **`[data-hidden]` alone does NOT mean "reka proxy".** The missing `id` is what means that.
  `UFileUpload` renders the user's real file input through the same mechanism and stamps the
  field id on it — excluding it unqualified takes out the field's only control.
- **Only Nuxt UI's own field labels are touched** (`label[data-slot="label"][for]`). Labels your
  application wrote are never rewritten, and naming the application set itself is never
  overwritten.
- **Never assert on a generated `for` or `id` value** in tests. Assert on the accessible name —
  the ids come from `useId()` and are neither stable nor meaningful, and this plugin rewrites them.
- **If you change a selector in that file, run the mutation check.** `test/upstream-dom-contract.test.ts`
  pins what reka-ui and @nuxt/ui actually render (both are devDependencies for exactly this
  reason); `test/form-label-association.test.ts` pins our own pairing rules. Every guard has a
  case that fails when the guard is removed. The 1.13.0 defect shipped because a fixture was
  invented rather than observed, and the invented selector matched the invented fixture.
- This is a **stopgap** for a framework-level divergence. Opt out with
  `ltExtensions.formLabelAssociation.enabled: false`.

## Pre-Hydration Input Preservation

**The defect:** until Vue hydrates a server-rendered `<input>`, it carries no framework
listener. Text typed in that window goes into the DOM node, the `input` event reaches nothing,
and `v-model`'s mounted hook then overwrites it. The entry is **erased, not delayed**. It is
load-dependent, so it hides in development.

**Vue already fixes most of it.** Since 3.5.41 (vuejs/core#14411) Vue adopts the typed value
into the model on hydration — but only for `type="text"` and `textarea`. `email`, `password`,
`tel`, `url`, `search` and `number` are still erased. Upstream tracking: vuejs/core#15210.

**What this module adds:** `runtime/plugins/pre-hydration-input.client.ts` snapshots edited
fields at `app:beforeMount` and restores them at `app:mounted`, dispatching a synthetic
`input` event so `v-model` adopts the value.

**What this means when you debug a consuming project:**

- **Do not add a `readonly`-until-mounted guard to inputs.** It was tried and removed: it makes
  the field look usable while silently refusing, suppresses browser autofill (`readonly` is the
  documented technique for exactly that), makes screen readers announce "read only" with no
  announcement when it flips back, and stops mobile browsers raising the on-screen keyboard.
- A field is treated as edited when `value !== defaultValue`, so server-pre-filled values are
  never restored over a legitimate change made during hydration.
- Each field is restored at most once; a later programmatic clear is not undone.
- This is a **stopgap**. When Vue widens its gate, delete the plugin —
  `test/pre-hydration-input.test.ts` pins the current behaviour and will fail on the types Vue
  takes over.
- Opt out with `ltExtensions.preHydrationInput.enabled: false`.

## security.txt (RFC 9116)

`ltExtensions.securityTxt.enabled: true` serves `/.well-known/security.txt`. Contact defaults to
`mailto:security@lenne.tech`. Builder: `runtime/server/lib/security-txt.ts` (pure, tested in
`test/security-txt.test.ts`). Route: `runtime/server/routes/security-txt.ts`.

- **Do not replace it with a static file in `public/`.** `Expires` is computed per request so it
  never runs out between deployments. A static file expires silently, and scanners drop it.
- **Do not register it with a method.** `addServerHandler` without `method` answers HEAD too;
  scanners probe with HEAD.
- **Values live in the server-only runtime config** (`runtimeConfig.ltExtensions.securityTxt`), so
  `NUXT_LT_EXTENSIONS_SECURITY_TXT_*` overrides them per stage. `enabled` is build-time only.
- **`Canonical` from the request host only via the `hosts` allowlist.** The host is a request
  header; anything not listed must never reach the file.
- **No list defaults in `defaultOptions`.** `defineNuxtModule` merges them with `defu`, which
  concatenates arrays: a default `['de', 'en']` turned a project's `['en']` into `en, de, en`. Set
  list defaults where the option is read. `test/security-txt.test.ts` runs the real merge.
- **A contact that is not a `mailto:`, `https://` or `tel:` URI counts as blank**, so a bare address
  ends in a 404 rather than a file scanners reject. If a project reports a 404 with the option on,
  check the contact first.
- For a customer project, ask whether reports go to lenne.Tech or the customer before enabling it.
- **No `tsconfig.json` under `src/runtime`.** Vendoring copies that tree one level deeper, so a
  relative `extends` points at nothing, and `oxlint --type-aware` then stops every vendored project's
  `check` with `Invalid tsconfig`. Nitro code is typechecked through the root `tsconfig.server.json`.
  No gate here runs in vendor mode, so `test/vendored-core.test.ts` holds this.
- **nuxt-base-starter lints `app/core/**` with a subset of the plugins in `.oxlintrc.json`, never
  more**, and `lint` here runs with `--deny-warnings`. A plugin only the starter applies reports its
  warnings in every generated project after the release; the 1.24.0 smoke test found three. A plugin
  the starter wants for `app/core/**` is added here first. `check:vendored-core` (part of `check`)
  holds this: it copies `src/` into a temporary `app/core/` the way `lt fullstack init` does and lints
  it with the template's current `.oxlintrc.json` from GitHub, `--deny-warnings`. Red without a change
  here means the template now applies more to the core; offline it fails rather than passing unseen
  (`LT_TEMPLATE_OXLINTRC=<path>` lints against a local copy).
- **A version this repository shares with nuxt-base-template is raised in the template first.**
  `lt fullstack init` raises every shared version to this repository's when that is newer, so a
  vendor-mode project gets versions the template's own `check` never ran with: vue-tsc 3.3.14 broke
  a template component after 1.24.0, partly with exit 0. `check:template-pins` (part of `check`)
  applies the CLI's rule to the template's `package.json` on GitHub and fails on every version
  vendoring would raise. When it does, raise the version in nuxt-base-starter (whose `check` runs
  the type check, lint and tests with it), or keep this repository on the template's version until
  then. Offline it fails; `LT_TEMPLATE_PACKAGE_JSON=<path>` compares against a local copy.
  The stack publishes this repository before the starter, so a release here must not wait for the
  template: `scripts/template-pins-pending.json` allows one named version per package until the
  starter release that brings the template along (`"vue-tsc": { "to": "3.3.15",
  "templateFollowsIn": "2.38.0" }`). That release coming out without it fails `check`, and so does
  an entry nobody needs any more: remove it once the template has the version.
- **The `nuxt/schema` blocks in `runtime/types/module.ts` augment `PublicRuntimeConfig` and nothing
  else.** Vendoring turns them into project source, where they cause TS2310, and the cli removes a
  block only while it holds that one interface. Type server-only config where it is read.

## Transition Components and Tailwind 4

The `LtTransition*` components are the only place this module uses Tailwind classes.

- **Tailwind 4 syntax: `duration-(--start-duration)`, never `duration-[--start-duration]`.**
  Tailwind 4 compiles the v3 shorthand to `transition-duration: --start-duration`, which the browser
  drops: the fade ran in 0 s and the duration props did nothing (DEV-4071).
  `test/transition-classes.test.ts` compiles every class with the stack's Tailwind version.
- **npm mode needs a `@source` line** for `node_modules/@lenne.tech/nuxt-extensions/dist/runtime` in
  the stylesheet that imports Tailwind (README, "Transition Components"). Nuxt UI only adds the
  layers' `app` directories, without a hook a module could use. A missing `@source` path is
  ignored, so the line is harmless in vendor mode.

## Development Rules

1. **ALWAYS read source code** in `dist/runtime/` to understand available composables and components
2. **Use `useLtAuth()`** for authentication — never implement auth manually. This includes the
   password-reset flow: passwords are SHA256-hashed client-side, and a hand-rolled call that skips
   that step desynchronises the two credential stores and locks the user out (see "Password
   Handling" below).
3. **Check existing composables** before creating new ones — this module may already provide what you need
4. **Peer dependencies** (`better-auth`, `@better-auth/passkey`, `tus-js-client`) must be installed in the consuming project.
   `better-auth` and `@better-auth/passkey` are pinned to **`>=1.7.16 <1.8.0`** — deliberately not a caret.
   **They move in lock-step with `@lenne.tech/nest-server`.** better-auth is one protocol with two ends;
   this module is the client end, nest-server the server end, and both declare the *same* narrow range.
   Raising it means raising it in **both** framework repos and pinning the new version in **both** starters,
   in one release. Never half of it, not even "just to unblock the frontend" — a split resolves as api on one
   minor and app on another, 2FA activation fails at runtime, and *both* repos' `check` stays green because
   each is internally consistent and only the assembled workspace has both halves.
   `test/peer-dependency-ranges.test.ts` guards the declared range against the version actually tested;
   `test/better-auth-contract.test.ts` pins the consumed better-auth surface.
5. **AI types collision pitfall:** `LtAiPromptInput` is the CRUD input for the user-facing `LtAiPrompt` entity (used by `useLtAiPrompts().create/update`). The execution payload for `useLtAi.prompt()` / `.promptStream()` is `LtAiPromptRunInput`. Do not conflate them.
