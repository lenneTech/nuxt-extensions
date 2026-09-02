# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.16.0] - 2026-09-02

### Fixed

- **`changePassword` silently discarded `revokeOtherSessions` — check your app after upgrading.**
  The wrapper rebuilt the request body from `{ currentPassword, newPassword }`, so any further
  option the caller passed was dropped between the call and the request. Better Auth reads and
  acts on `revokeOtherSessions` (`update-user` route), so a caller who set it got a successful
  password change **and every other session left open** — no error, no warning.

  This is the option you set after a password was compromised, which is what makes it worse than
  the four other occurrences below: the caller believes foreign sessions were ended. If your app
  passes it, verify after the bump that other sessions are actually terminated.

- **`twoFactor.enable` silently dropped `method` and `issuer`.** Its body schema is
  `{ password, method, issuer }`; the wrapper rebuilt it as `{ password }`. So
  `enable({ password, method: 'otp' })` — email/SMS codes — quietly set up TOTP instead, and a
  custom `issuer` never reached the authenticator app. Same shape as the `changePassword` defect
  above, and equally shipped.

- **Hashing wrappers forward the caller's parameters instead of rebuilding them.** The same
  field-whitelist shape affected `resetPassword` and the three `twoFactor` methods, while
  `signIn.email` and `signUp.email` already spread correctly — an inconsistency that is exactly
  why it went unnoticed. A hashing wrapper replaces ONE field; it is never a whitelist. New Better
  Auth options now work by default rather than needing a change here.

  **Being precise about which of these lost data.** Measured against the installed better-auth
  1.7.1 rather than assumed: `changePassword` (`revokeOtherSessions`) and `twoFactor.enable`
  (`method`, `issuer`) genuinely dropped options the server reads — those are the two defects.
  `resetPassword` did NOT: its body schema is `{ newPassword, token }` and nothing else, so the old
  whitelist happened to pass exactly what the endpoint accepts. `redirectTo` lives only on
  `requestPasswordReset`, which was never wrapped and still is not. Fixing `resetPassword` and the
  other `twoFactor` methods is consistency and future-proofing — a schema gaining a field must not
  need a change here — not a repaired data loss.

  Pinned by `test/auth-client-hashing.test.ts`, which asserts what actually reaches the request
  payload for all seven wrappers: the hash arrives, the plaintext appears nowhere, and the
  forwarded options survive. `test/auth-client-param-forwarding.test.ts` keeps the narrower
  source-level half — a spread is present at each call site, visible in review.

  **Why the runtime test is the one that matters**, stated because an earlier draft of this entry
  claimed the opposite: a source-shape assertion catches a whitelist rebuild but NOT the inversion
  `{ newPassword: hashed, ...params }`. That is valid JavaScript, `params` still carries the raw
  value, the spread overwrites the hash — the **plaintext password goes on the wire** — and the
  shape test passed 11/11 with exactly that applied. A guard a defect satisfies is worse than no
  guard, because it also carries the reassurance. Both mutations were re-run against the new test;
  both go red.

  `test/auth-types.test-d.ts` covers the other boundary, and `vitest.config.ts` now enables
  `typecheck` so it actually runs — a `.test-d.ts` file is otherwise collected by nothing.

### Changed

- **The three widened signatures use a generic parameter instead of `& Record<string, unknown>`.**
  TypeScript gives a `type` alias an implicit index signature and an `interface` deliberately none,
  so the intersection rejected an interface-typed variable or a `Ref<Form>.value` — the dominant
  shapes in this stack. That is the same boundary 1.15.0 broke and 1.15.1 reverted; twice in one
  release line is a pattern, so it is now asserted from the outside in
  `test/auth-types.test-d.ts` rather than left to review.

  The generic also restores the excess-property check that widening had removed: a stray
  `changePassword({ …, password: plaintext })` type-checked and would have travelled in the
  request body into proxy logs and error reporters. The foreign credential keys are typed `never`.

### Added

- **`useLtAuth()` exposes `requestPasswordReset` and `resetPassword`.** The composable offered
  `changePassword` but neither reset method, so a project building a reset page had to reach past
  it — and one that did hand-rolled the client-side hashing, sent a password shaped differently
  from what the server verifies, and desynchronised the two credential stores (fixed on the server
  side in `@lenne.tech/nest-server` 11.38.0). The gap is what created the workaround.

  **No backend bump is required for this release.** `revokeOtherSessions` and the `twoFactor.enable`
  fields are read by Better Auth itself, on every nest-server version. The 11.38.0 reference above
  is background — that release fixes the server half of the same defect and additionally makes
  plaintext-sending clients work; for this client, which hashes, it changes nothing.

  Both are straight passthroughs, arguments included. `redirectTo` MUST be an absolute app URL:
  Better Auth resolves it against the API origin, so a relative value lands on the API host where
  the route does not exist — 403, no mail sent, nothing visible in the browser. In an lt starter
  project `appUrl()` builds one and throws rather than returning something relative; that helper
  lives in the **starter** (`app/utils/app-origin.ts`), not in this package, so elsewhere use
  `new URL(path, config.public.siteUrl).toString()`.

  Documented for consumers in `CLAUDE.md` ("Password Handling") and the README, including the two
  things people get wrong: `redirectTo` carries a live reset token and must never be built from
  user input, and a minimum password length can only be enforced in your form — better-auth checks
  it against the value it receives, which is always a 64-character hash on this path.

### Migration

See [`migration-guides/1.15.x-to-1.16.0.md`](migration-guides/1.15.x-to-1.16.0.md). Short version:
upgrade the package, and if your app passes `revokeOtherSessions` or `twoFactor.enable`'s
`method`/`issuer`, verify they now take effect. No backend bump, no config changes.

### Known limitations

- **`changePassword`, `requestPasswordReset` and `resetPassword` still return `Promise<unknown>`,**
  so a consumer cannot read `data` / `error` without a cast. Widening it to better-auth's real
  result type is worth doing and is deliberately **not** in this release: 1.15.0 narrowed this type
  surface and broke consumers, 1.15.1 reverted it, and 1.16.0 already changes it once more. A third
  move at the same boundary in the same release is a bad trade. When it happens it needs its own
  case in `test/auth-types.test-d.ts`, asserted against the real return object — and not via
  `Parameters<typeof …>`, which reintroduces exactly the better-auth coupling 1.15.1 removed.

- **`admin.createUser` and `admin.setUserPassword` pass the password through UNHASHED.** They are
  the only credential-carrying methods here that do not hash. Harmless today —
  `@lenne.tech/nest-server` does not register better-auth's `admin()` plugin and offers no option
  to, so those routes 404 — but `auth.enableAdmin` defaults to `true`, so the client plugin is
  registered in every consuming project. Enabling `admin()` server-side is a **lock-step** change
  across both repos in one release: the routes join nest-server's password-normalisation table and
  these two methods get `ltSha256` wrappers here. Half of it produces accounts nobody can log in
  with. Hashing here pre-emptively would be equally wrong — it would build a client expectation the
  server does not answer.

### Note on the reverse direction

Spreading means caller keys that were previously discarded now reach the server. In practice this
changes nothing — better-auth validates each route body with a zod schema that strips unknown keys
— but it is a behaviour change in the "what leaves the browser" direction, so it is stated rather
than left to be discovered. The type-level guard above is what keeps a stray *credential* out of
that payload.

## [1.15.1] - 2026-08-23

### Fixed

- **Reverts the 1.15.0 type-surface change that broke consuming projects.** 1.15.0 replaced the
  `as any` casts in `auth-client.ts` with a hand-written interface. That narrowed the wrappers'
  `options` parameter from `any` to `unknown` — and better-auth derives each action's **return**
  type from that generic, so returns collapsed and the plugin surfaces (`passkey`, `admin`,
  `twoFactor.verifyTotp`, `twoFactor.verifyBackupCode`) became `| undefined` with no way for a
  consumer to narrow them.

  Measured in `nuxt-base-starter`, same starter code, only the dependency swapped:

  | nuxt-extensions | `typecheck` |
  |---|---|
  | 1.14.0 | 0 errors |
  | 1.15.0 | **14 errors** |

  The published type surface of `auth-client.d.ts` is now byte-identical to 1.14.0 again.
  Everything else 1.15.0 shipped — the peer-range narrowing, the guards, the stub and passkey
  fixes — is unaffected and stays.

  **If you are on 1.15.0, upgrade.** Nothing else is required; the runtime never changed, only
  the declarations.

### Added

- **The consumer gate now typechecks, not just builds.** `scripts/check-consumer-build.mjs`
  installs the packed tarball into a throwaway project and compiles type-level assertions against
  it, so a change that keeps the module *running* but makes it unusable to *compile against* fails
  before release. This is the gate whose absence let 1.15.0 out: `check` was 10/10 green, 291 tests
  passed, and `nuxt build` in a real consumer succeeded — the break was visible only to `tsc`.

  Verified against the defect it exists for: reapplying the 1.15.0 `auth-client.ts` turns it red
  with named messages (`authClient.passkey became optional`, …); the fix turns it green. Its known
  limit is documented in the script — it catches a type going useless, not a concrete union
  narrowing to a different concrete union.

## [1.15.0] - 2026-08-23

> **Release order matters for this one.** Ship `@lenne.tech/nest-server@11.37.0` first, or in the
> same wave. Publishing this release on its own recreates the exact split it exists to close —
> see "Do not release this alone" below.

### Breaking

- **The `better-auth` peer range is narrowed to one minor line.** It was `>=1.0.0` for both
  `better-auth` and `@better-auth/passkey`; it is now `>=1.7.1 <1.8.0`.

  **What breaks:** a project resolving `better-auth` below 1.7.1 now fails to install. `npm` errors
  with `ERESOLVE`, `pnpm` errors under its strict-peers default. This is intentional — that install
  was already broken at runtime, it just failed later and less clearly. See **Migration** below.

  The version digit stays a MINOR deliberately. In this package the MAJOR tracks the **Nuxt** major
  the module targets — `1.x` is Nuxt 4 — so it moves when, and only when, Nuxt moves. Everything of
  our own ships in a minor, breaking changes included. The `### Breaking` heading is what carries
  the warning instead, so nobody reads the version number as a promise it does not make.

  **Why 1.7.1 and not 1.7.0:** `@better-auth/passkey@1.7.1` peer-requires `better-auth: ^1.7.1`, so
  a floor of `1.7.0` would bless a pair that cannot install cleanly. `test/peer-dependency-ranges.test.ts`
  now asserts this rather than leaving it to a reviewer to notice.

  **Why an upper bound and not `^1.7.0`:** better-auth breaks in **minor** releases. 1.7 removed the
  `./plugins/oidc-provider` and `./plugins/mcp/client` subpath exports and changed the 2FA response
  shape. This module never imported either subpath — they are cited as evidence of upstream's
  release policy, not as something that hit us — but they are why a caret would re-open the hole at
  1.8.

  **What actually requires 1.7, precisely:** not this package's own source. Nothing in `src/` reads
  a 1.7-only field; `auth-client.ts` forwards the `twoFactor.enable` result to callers untouched.
  The requirement is at the **protocol** level: better-auth 1.7 gives `twoFactor.enable` a
  discriminated result carrying `method` (`{ method: "otp" }` or `{ method: "totp", totpURI,
  backupCodes }`), which 1.6.26 never sends. This module is the client half of that protocol and
  re-exports the shape to consumers, whose 2FA UI reads the discriminant. So a 1.7 client against a
  1.6 server produces a response the application cannot interpret.

  Second reason, independent of the first: the old range admitted versions carrying published
  advisories on surfaces this module wraps — including a 2FA bypass (GHSA-xg6x-h9c9-2m83, `<1.4.9`)
  and passkey deletion via IDOR (GHSA-4vcf-q4xf-f48m, `<1.4.0`). `>=1.0.0` declared those
  acceptable. The new range excludes every known 1.x advisory.

  **Why it matters beyond this package:** better-auth is one protocol with two ends. This module
  is the client end and `@lenne.tech/nest-server` is the server end, and until now the two
  declared it differently — nest-server pinned it as a hard dependency (1.6.26), so a fullstack
  project could move the app to 1.7.1 and the api could not follow. Every 2FA activation in every
  fullstack project failed, with a generic client error and nothing unusual in the server log.
  Both repos' checks were green throughout: each was internally consistent, and only the assembled
  workspace ever had both halves.

  nest-server 11.37.0 makes its side a peer with the **same** range (it additionally peers
  `@better-auth/core`, which this package does not import and therefore does not declare — do not
  copy that one into an app). From here the two must be raised together, in one release.

  **Do not release this alone.** Publishing 1.15.0 while nest-server is still 11.36.5 does not fail
  loudly: `lt-monorepo` sets `autoInstallPeers: true`, and `projects/api` and `projects/app` are
  separate workspace packages, so the api quietly keeps 1.6.26 while the app resolves 1.7.x. That is
  the silent split described above, reproduced — not prevented.

  **Migration**

  1. Raise `@lenne.tech/nest-server` to `11.37.0` and follow its migration guide. It carries a
     **data** migration (`account.issuer`) that no build will warn you about.
  2. Pin both packages, workspace-wide in a monorepo so the api and the app cannot drift:

     ```yaml
     # pnpm-workspace.yaml
     overrides:
       better-auth: 1.7.1
       '@better-auth/passkey': 1.7.1
     ```

  3. Verify a 2FA activation end to end. That is the flow the split breaks, and the one no
     build step checks.

  If you skip step 1, 2FA activation fails at runtime while every project's `check` stays green.

  **Emergency escape hatch.** If an advisory ever lands on 1.7.x with the fix only in 1.8.0, do not
  widen the range in a panic — override it locally and open an issue so both framework repos move
  together:

  ```jsonc
  // consumer package.json — temporary, until nuxt-extensions ships a matching release
  "pnpm": { "peerDependencyRules": { "allowedVersions": { "better-auth": "1.8.x" } } }
  ```

### Added

- **Guards for the invariants this release depends on.** The narrowed range was previously a claim
  nothing could check; these make it enforceable.

  - `test/peer-dependency-ranges.test.ts` — asserts every published peer range is satisfied by the
    devDependency the suite actually runs against, including the optional `@better-auth/passkey`
    that no other process in the repo touched, and that our floor is not one `@better-auth/passkey`
    rejects.
  - `test/better-auth-contract.test.ts` — pins the better-auth surface this module consumes
    (subpath exports, the plugin factories, and the `method`-discriminated `enable` response), in
    the spirit of `test/upstream-dom-contract.test.ts`. Turns "the code requires 1.7" from an
    assertion into something the suite proves.
  - `test/module-version-sync.test.ts` — covers `scripts/sync-module-version.mjs`, including the
    not-found guard whose removal previously cost zero test failures, plus a check that the newest
    CHANGELOG heading matches `package.json`.
  - `test/optional-peers.test.ts` — now pins the passkey stub against the **real** package rather
    than only asserting it in isolation.
  - CI (`build.yml`, `publish.yml`) now runs `format:check`, `version:check` and `check:manifest`.
    They previously ran on a maintainer's laptop only, so `pnpm test` was the sole enforced gate —
    including on the publish path.

### Fixed

- **`@better-auth/passkey` stub no longer breaks consumer builds that import more than
  `passkeyClient`.** The stub is aliased over the specifier app-wide (Vite *and* Nitro), so a
  consumer importing `PASSKEY_ERROR_CODES` or `getPasskeyActions` from
  `@better-auth/passkey/client` hit an unresolved-export failure — the same class of error the stub
  exists to prevent, merely relocated. The stub now mirrors the real package's full export surface,
  and its actions reject rather than resolving falsely.
- **Passkey detection no longer misses a package the consumer installed.** `tryResolveModule` now
  resolves against the consumer's `rootDir` as well as this module's own location. Under a strict,
  non-hoisted install the package is only reachable from the consumer's tree, so passkeys were
  silently disabled with nothing but a warning.
- **The module no longer dumps its resolved config into every consumer build.** The verbose banner
  is now dev-only; it was writing three lines of our configuration into other teams' production CI
  logs for no diagnostic value there. A single `[@lenne.tech/nuxt-extensions] v1.15.0` line still
  prints unconditionally, and deliberately so: `scripts/check-consumer-build.mjs` asserts that the
  packed module announces itself during a consumer's `nuxt build`, which is how it proves the
  tarball actually registered instead of silently doing nothing.

### Changed

- **`auth-client.ts` reaches better-auth's plugin surfaces through one documented type assertion**
  instead of twelve separate `as any` casts, each with its own eslint suppression. Twelve
  suppressions read as twelve unexamined decisions. The erasure itself is structural — the plugin
  array is built from runtime flags, so better-auth cannot infer the action surface — but the
  narrowed range makes a hand-written shape stable enough to be worth declaring, and
  `test/better-auth-contract.test.ts` pins it against the real package.

## [1.14.0] - 2026-08-23

Started as a one-line fix for a defect 1.13.0 shipped, and a review found three more problems in
the same file — including one worse than the original. The scope grew accordingly.

### Fixed

- **Form label repair no longer skips disabled and readonly fields.** 1.13.0 excluded
  `[disabled]` from the controls a label may be re-pointed at. Where a field's only control was
  disabled that left nothing eligible, so the repair never ran and the label stayed pointing at
  nothing — the plugin reproduced the exact defect it exists to fix, on every read-only form.
  Measured in a consuming app: a full Playwright suite went from 818/818 to 812/6, and the six
  failures were all read-only forms whose fields had lost their accessible name.

  A disabled control is rendered, stays in the accessibility tree and is announced. WCAG 1.3.1
  and 4.1.2 apply to it unchanged, and WCAG's only carve-out for inactive components is contrast
  (1.4.3 / 1.4.11) — there is no naming exemption anywhere. Note the repair restores the
  accessible **name** only for such a field: a disabled control prevents click dispatch and is
  not focusable, so the label's click-to-focus half is dead either way. On a read-only form the
  name is the entire value, because that is a page people read rather than operate.

- **Partially disabled radio and checkbox groups are no longer mis-bound.** This is the more
  dangerous half of the same defect and it went unnoticed until review. With one item disabled,
  `[disabled]` filtered it out, exactly one control remained eligible, the group rule never
  engaged — and **every caption in the group was bound to the one enabled item**. Clicking "No"
  then selected "Yes": a value the user never chose, submitted silently. That is precisely the
  outcome the plugin's own "refuses to guess" rule exists to prevent.

- **Reka's submit proxy is now identified by what it actually renders.** The exclusion list
  assumed `type="hidden"`. Reka renders `VisuallyHidden as="input"` with `feature: 'fully-hidden'`,
  producing an off-screen input carrying `data-hidden` and `tabindex="-1"` — with `type="checkbox"`
  or `type="text"`, never `type="hidden"`. `aria-hidden` joined that variant only in reka-ui
  2.10.1; on 2.9.x `data-hidden` is the sole identifier.

  The proxy is excluded on `[data-hidden]:not([id])`, and the `:not([id])` is load-bearing:
  Nuxt UI's `UFileUpload` renders the user's real file input through the same mechanism and puts
  the FormField id on it. An unqualified `[data-hidden]` excluded that field's only control.

### Added

- **`aria-describedby` is repaired too.** The same hydration divergence breaks it, for the same
  reason, and the consequence is worse. `FormField` renders its error / help / description
  containers with `:id` as a compiled binding, so Vue force-patches those ids on hydration; the
  matching `aria-describedby` reaches the control through a `v-bind` spread and does not get
  patched. Every validation error then points at an id that no longer exists — a sighted user
  sees "Required field", a screen-reader user gets silence (WCAG 3.3.1 / 3.3.3). Repaired
  token-wise, so application-authored references survive untouched.

- **Radio and checkbox groups are named via `aria-labelledby`.** Their FormField id lands on a
  `<div role="radiogroup">`, and `for` only resolves against labelable elements — so a repaired
  `for` was inert there no matter what. `aria-labelledby` names the group without touching any
  item, which makes it strictly safer than the `for` repair. Never overwrites naming the
  application wrote itself.

- **Select, checkbox and switch fields are repaired.** Nuxt UI puts the FormField id on a
  `<button>` for those three families, and `button` is a labelable element. They were previously
  exempt — their only native control is reka's proxy, correctly excluded, leaving nothing
  eligible. Narrowed to `[data-slot="base"]` so an ordinary submit or icon button inside a field
  is not mistaken for the control.

- **`formLabelAssociation.observeDeferred`** (default `true`) — a `MutationObserver` that catches
  server-rendered subtrees hydrating after the repair window closes. `hydrate-on-visible` fires on
  scroll and `hydrate-on-interaction` on a click, either of which can be long after mount; no
  fixed window reaches those. It reacts only to added subtrees that actually contain a field
  label and coalesces a burst into one sweep per frame.

- Two guards against a repair that would be worse than the defect it replaces: a control that
  already has a working label is left alone (multiple labels **concatenate** into one accessible
  name), and an id that is not unique in the document is never written (`for` resolves through
  `getElementById`, which returns the first match). A control hidden by `display:none` is also
  ignored — binding there gains no name yet marks the field healthy forever.

- `maxRepairMs` is clamped to `[0, 30000]`. A delay past 2^31 overflows `setTimeout` and fires
  immediately, silently turning an over-large window into no window at all.

### Changed

- The development warning fires **once per page** instead of once per sweep, and names the
  repaired fields instead of only counting them. Repaired labels carry `data-lt-label-repaired`,
  so a consuming project can assert on it in E2E — the 1.13.0 defect was found by a Playwright
  suite, not by anyone reading a console.

### Tests

- **`test/upstream-dom-contract.test.ts` (new).** `reka-ui` and `@nuxt/ui` are now devDependencies,
  because the plugin's selectors are assertions about those libraries and nothing here could check
  them: neither package was installed, so every fixture was hand-transcribed from something
  observed once, elsewhere. That is not a theoretical weakness — it is the direct cause of the
  1.13.0 defect. The proxy fixture was invented as `<input type="hidden">`, the invented shape was
  caught by the invented selector, the suite went green, and the wrong theory shipped.

  This file renders the real components and reads the real sources. It is the tripwire: when reka
  renames `data-hidden` or Nuxt UI stops stamping `data-slot`, it fails — instead of the rule
  tests staying green over a plugin that has silently stopped working.

- 19 → 64 cases across three files, and each guard above is pinned by a case that fails when the
  guard is removed (verified by mutation, not by inspection). Test names now state what each case
  proves: the old "skips the hidden form-value proxy" described a fixture reka never renders, and
  that misnaming is how the wrong theory survived review in the first place. Cases that are
  characterisation rather than regression say so.

### Upgrade

No configuration change is required, and there is no API change.

- **If you set `formLabelAssociation.enabled: false` to work around the 1.13.0 read-only-form
  regression, remove it.** That is the defect this release fixes, and the option now costs you
  the group, `aria-describedby` and select/checkbox/switch repairs as well.
- Accessible-name assertions against disabled or read-only fields that failed on 1.13.0 pass
  again — un-skip any specs you parked.
- Expect `aria-describedby` and `aria-labelledby` to change after mount on affected fields, in
  addition to `for`. Never assert on generated id values; assert on the accessible name.
- Set `observeDeferred: false` if you render no lazily hydrated server content and would rather
  not carry a `MutationObserver`.

## [1.13.0] - 2026-08-23

> **Superseded.** The exclusion of `disabled` controls described below was a defect: it stopped
> the repair on every field whose only control was disabled, and mis-bound partially disabled
> radio groups. Both were fixed in [1.14.0](#1140---2026-08-23). The entry is kept unedited as
> the historical record.

### Added

- **`<label for>` associations broken by hydration are repaired.** Nuxt UI's `FormField` derives the label's `for` and the control's `id` from a single `useId()` call, so they cannot disagree — unless `useId()` itself returns different values on server and client, which it does whenever the two walk a different number of async boundaries. Measured against `@nuxt/ui` 4.11.x: the SSR payload has both at `v-0-4-2`; after hydration the label still says `v-0-4-2` and the control says `v-0-1-2`.

  Vue 3.5.39 did not cause this, it exposed it ([vuejs/core#9083](https://github.com/vuejs/core/pull/9083) force-patches an element's dynamic props during hydration). The asymmetry is a component boundary: the control's `id` is a compiled element binding and is force-patched; the label's `for` is a prop on reka-ui's `Label` and arrives through `$attrs`, which is not in that set.

  The cost is not cosmetic. Without a placeholder the control has no accessible name at all — a screen reader announces "edit text, blank". **With** a placeholder it gets the placeholder as its name instead, so the visible label is no longer part of it and speech input stops working. Clicking the label focuses nothing either, and on a checkbox or radio the label is the primary hit target rather than a convenience. Tests addressing fields the way assistive technology does (`getByRole('textbox', { name })`) stop finding them.

  `runtime/plugins/form-label-association.client.ts` re-points dangling Nuxt UI field labels at the control in their own field, at `app:mounted` and for a bounded window afterwards. New options: `ltExtensions.formLabelAssociation.enabled` (default `true`) and `maxRepairMs` (default `1500`, for server-rendered subtrees whose hydration is deferred behind `hydrate-on-visible` or an unresolved `<Suspense>`).

  **This is a stopgap.** The right fix is for the id not to diverge; this exists because the divergence sits in the framework stack rather than in any one application.

### Notes on the approach

- **The repair refuses to guess, and that rule is the load-bearing part.** It only fires when the field holds exactly one eligible control. A dangling label is inert and visible; a mis-pointed one is confidently wrong and silent — and on a radio or checkbox a click on the caption would change a value the user never chose. Verified against `@nuxt/ui` 4.11.0: `RadioGroup` renders one `data-slot="root"` with N item labels whose ids all derive from the group's `useId()`, and `CheckboxGroup` does the same through its child `Checkbox` components. Both are therefore skipped rather than having every caption bound to the first option.
- Hidden form-value proxies, `aria-hidden` and `disabled` controls are excluded. Reka-based components render a hidden native control beside the visible one; pointing a label at it restores neither the accessible name nor click-to-focus — and because the association would then *resolve*, the healthy-check would suppress any correct repair from then on.
- Only Nuxt UI's own field labels are touched (`label[data-slot="label"][for]`). Scanning every `label[for]` would rewrite application-authored labels that merely sit inside some component root.
- "Already resolves" is not treated as "healthy" on its own. Server and client ids come from the same generator space on the same page, so a stale server id can resolve to a *different* field's control; an association that resolves outside its own field is repaired rather than left naming the wrong control forever.
- **`for` is repaired rather than `aria-labelledby` added**, because `for` carries both the accessible name and click-to-focus.
- The repair announces itself with a `console.warn` in development. A silent repair masks the defect, removes the pressure to fix it upstream, and leaves the next developer looking at a `for` attribute nobody in the codebase wrote.

### Tests

- `test/form-label-association.test.ts` — 19 cases against DOM fixtures, so they run without `@nuxt/ui`. Beyond the happy path they pin every way the repair must NOT fire: radio and checkbox groups, hidden/`aria-hidden`/`disabled` controls, button-only fields, application-authored labels, and an association that already resolves inside its own field. Plus the cases it must handle: `<textarea>` and `<select>`, an id collision that resolves to another field, an element-scoped root, idempotence, and an eleven-field page.

## [1.12.0] - 2026-08-23

### Added

- **Text typed before hydration is no longer silently erased — for the input types Vue does not cover.** Until Vue hydrates a server-rendered `<input>`, the element carries no framework listener: what the user types goes into the DOM node, the `input` event lands nowhere, and `v-model`'s mounted hook then writes the model value back over it. The entry is ERASED, not delayed. It is load-dependent, so it hides in development and surfaces on a cold cache, a slow device or a throttled CPU — most often on the sign-in screen, where people type on sight.

  Vue fixed this in **3.5.41** ([vuejs/core#14411](https://github.com/vuejs/core/pull/14411), merged 2026-08-04): on hydration it compares the field's live value against what the server rendered and adopts the typed value into the model instead of overwriting the node. **That adoption is gated on `type="text"` and `textarea`.** Every other type still loses the entry — `email`, `password`, `tel`, `url`, `search`, `number` — which is precisely what a sign-in form is made of. Widening the gate is tracked upstream as [vuejs/core#15210](https://github.com/vuejs/core/issues/15210) (open, `p2-edge-case`, no milestone).

  `runtime/plugins/pre-hydration-input.client.ts` closes the remaining gap: at `app:beforeMount` the bundle has loaded but hydration has not run, so every field still holds what was typed; at `app:mounted` anything that was overwritten is written back with a synthetic `input` event so `v-model` adopts it. A field counts as edited when its value differs from `defaultValue` — the same test Vue itself uses, so values the server pre-filled are never mistaken for user input. A browser autofill that lands before hydration is recovered the same way.

  New options: `ltExtensions.preHydrationInput.enabled` (default `true`) and `maxRestoreMs` (default `1500`, for subtrees whose mount is deferred behind an unresolved `<Suspense>`).

  **This is a stopgap.** When Vue covers the remaining types, delete the plugin — `test/pre-hydration-input.test.ts` pins the current gate and will fail on the types Vue takes over, which is the signal.

### Changed

- Dependency maintenance ahead of the release. The one runtime dependency, `@nuxt/kit`, now resolves to 4.5.2 instead of 4.4.8 — the module is developed against Nuxt 4.5.2, and building against an older kit than the Nuxt it targets is how two copies end up in a consumer's tree. The declared range stays `^4.0.0`: a published library must not narrow what its consumers may resolve.
- `better-auth` and `@better-auth/passkey` raised 1.6.23 → 1.7.1 (dev + peer). **Worth knowing if you use 2FA:** better-auth 1.7.0 changed `twoFactor.enable` to return a discriminated result carrying `method: "otp" | "totp"`, which has to be narrowed before reading `totpURI` or `backupCodes`. This module's wrapper passes the result through unchanged, so nothing here needed migrating — but your own code that reads those fields does. The peer range remains `>=1.0.0`, so this is not forced on you.
- TypeScript stays on 5.9.3. TypeScript 7 is available but `vue-tsc` 3.3.11 still resolves `typescript/lib/tsc`, a path TypeScript 7's `exports` map no longer exposes, so the type-check gate would break. Revisit once Volar declares TS 7 support.
- Toolchain and test dependencies refreshed: `vitest` + `@vitest/coverage-v8` 4.1.11, `vue-tsc` 3.3.11, `oxlint` 1.79.0, `oxfmt` 0.64.0, `@nuxt/module-builder` 1.0.3, `@playwright/test` 1.62.1, `@types/node` 26.2.0, `happy-dom` 20.11.6. The oxfmt bump reformatted three transition components (whitespace only).

### Security

- Two `overrides` in `pnpm-workspace.yaml` had drifted into downgrade locks and were raised: `postcss` 8.5.24 → 8.5.26 and `brace-expansion` 2.1.2 → 2.1.4. The postcss one was concretely harmful — part of the tree already requested 8.5.26 on its own while the override held another consumer at 8.5.24, so two copies were being installed. `pnpm audit` reports zero findings across all severities.

### Notes on the approach

- **A `readonly`-until-mounted guard was built first and then removed.** Declining the keystroke looks like the obvious remedy and is worse: the user faces a field that looks usable and silently refuses, which reads as a broken page. Measured costs beyond that: `readonly` is the documented technique for SUPPRESSING browser autofill and the load-time autofill pass runs inside exactly that window; screen readers announce "read only" and never announce the silent flip back; mobile browsers do not raise the on-screen keyboard for a readonly field, and do not raise it after the attribute is removed either, because presentation is tied to the focus gesture. Preserving the entry avoids all of it, because the field is never anything other than a normal editable field.
- The plugin is library-agnostic — it protects every `<input>` and `<textarea>` on the page, whatever rendered it. The earlier approach wrapped three Nuxt UI components via `components:extend` and a Vite `resolveId` plugin; none of that machinery survives, and `@nuxt/ui` is not a dependency of this package in any form.

### Tests

- `test/pre-hydration-input.test.ts` — 14 cases. Seven pin what Vue 3.5.41 itself does, against real `vModelText`: `text` and `textarea` are adopted, `email` / `password` / `search` / `tel` / `url` are erased. The rest cover the plugin's own parts: which fields count as edited (a server-pre-filled value does not; the same value typed over does), and that restoration dispatches an `input` event rather than only assigning `.value` — without the event the model keeps the old value and the next render wipes the node again.

## [1.11.2] - 2026-08-12

### Fixed

- **A session that had genuinely expired no longer looks like an empty page.** Two independent bugs in the 401 path lined up so that neither a dead session nor a mere permission error produced the right outcome. Both were found in a consuming project, where the symptom was a hub that said "no tool unlocked for this clinic" to anyone whose session had run out — people called their clinic management when all they needed was to sign in again.
  - **The session probe ran without the session cookie.** `fetchWithAuth` omits cookies in JWT mode, and every successful login pre-fetches a JWT (`switchToJwtMode()` flips `authMode` to `'jwt'`), so the interceptor's `/get-session` probe was effectively always bearer-only. Better Auth resolves that endpoint from the session COOKIE alone and answers `200` with a `null` body when it sees none — byte for byte what a signed-out visitor gets. The probe therefore read *every* authenticated JWT-mode session as dead, and the first mislabelled 401 (a permission error the backend returned as 401 instead of 403) ended the session. Measured against a live backend: with cookie → full session, bearer-only → `200 null`. `/get-session` is now in `PATHS_REQUIRING_COOKIES`.
  - **A 401 the interceptor ignored swallowed the 401s behind it.** `isHandling401` was claimed BEFORE the `isAuthenticated` check and always released on a 1 s timer, so a no-op — most importantly the first API call of a page load, which can land before the auth plugin has restored the user from the cookie — blocked the guard for a full second. That is exactly the window the rest of the page's requests arrive in, and among them the ones that would have proven the session dead. The guard is now claimed only while a logout is actually running and released immediately otherwise.

- **A rate limit or a backend hiccup no longer signs anyone out.** `isSessionStillAlive()` treated every non-2xx probe response as "session dead", which folded 429 (Better Auth's rate limiter), 403, and 500/502/503/504 (deploy, gateway restart, cold start) in with a real 401. Only `401`/`403` is a verdict about the session now; anything else non-ok returns "no verdict" and never logs out. Releasing the guard immediately (above) made hitting one of those measurably likelier, so the two changes belong together.

- **A stale JWT no longer leaves the client looping.** In JWT mode the failing request authenticates with the bearer, but the probe's verdict comes from the session cookie — so an expired JWT alongside a live cookie session read as "session alive" and no logout followed. Nothing repaired the bearer either (`refreshJwtToken()` has no internal call site, and `fetchWithAuth` only switches modes on a 401 in *cookie* mode), so the client settled into request → 401 → probe → "alive" → request → 401 … while the UI still showed the user as signed in. A live cookie verdict in JWT mode now mints a fresh token.

- **`import.meta.env.VITE_API_URL` can no longer reach Better Auth as a boolean.** The env object carries a loose index signature — Vite's own keys include booleans — so the `||` fallback chain widened to `string | true`. Nuxt 4.5's stricter types surfaced this; the value is now taken only when it really is a string.

### Changed

- **A positive session verdict is reused for one second.** Releasing the guard immediately means sequential 401s each probe on their own: a page firing several requests the user lacks rights for cost one `/get-session` call per request, and a polled forbidden endpoint doubled its request rate indefinitely (measured: 12 sequential 401s → 12 probes, where the old blanket 1 s hold cost one). Only the `true` verdict is cached — `false` leads straight to logout and `null` must never be cached, because suppressing re-probes after a network blip is precisely the swallowing the guard change removes. The worst case is bounded: a session dying inside the window is noticed up to a second late, never missed.
- **`isAuthEndpoint()` lists the session routes Better Auth actually exposes.** A generic `'/session'` entry stood there and had never matched anything: the routes are `get-session`, `list-sessions`, `revoke-session`, … — in each of them the character before `session` is `-`, not `/`, so the `includes` test was always false. `/get-session` in particular matters, because it is the probe's own URL: exempting it restores the second recursion layer the `isSessionStillAlive()` JSDoc had been claiming (and not having) since 1.8.4.
- Dependency maintenance to clear `pnpm audit`: `nuxt` and `@nuxt/schema` 4.4.8 → 4.5.2 (six advisories, incl. SSR RCE via island props, a payload-cache leak across users, and an auth-gate bypass on mixed-case route rules; the bump also pulls `@nuxt/devtools` onto `^3.4.1`, closing a critical unauthenticated-RPC command execution on the developer's host). `brace-expansion`'s 5.x override floor moved 5.0.8 → 5.0.9 for GHSA-rgw5-rvv9-x895, and a `nanoid@<3.3.17 → 3.3.18` override was added.

### Tests

- `test/auth-fetch-cookies.test.ts` — the credentials decision per mode and path: `/get-session` gets the cookie in JWT mode, ordinary endpoints do not, passkey/2FA keep theirs, and cookie mode sends cookies throughout.
- `test/auth-interceptor.test.ts` — the guard now covers what it must and nothing more (a 401 before hydration does not swallow the next one, no-verdict and permission-error probes are re-evaluated, parallel 401s still collapse to one logout), plus the new verdict rules: 429/502/503 never log out, a positive verdict is reused across a burst, and a live cookie session in JWT mode mints a fresh bearer. The logout test now asserts the redirect target and its encoding, not just that `clearUser` ran.
- A second suite drives a 401 through the real wrapped `globalThis.fetch` rather than the provided handler — the two fetch wrappers decide whether the handler is reached at all and had no coverage.

## [1.11.1] - 2026-07-30

### Changed

- Security overrides pinning `brace-expansion`, `minimatch`, `tar`, `shell-quote`, `svgo` and `postcss` onto patched versions to clear `pnpm audit` advisories (DoS, path traversal). The overrides apply to this repo's own install only — `overrides:` is honoured for the root project of an install, so a consumer gets its own — and are mirrored into `nuxt-base-starter` and `lt-monorepo`, where they do reach a consumer tree.

## [1.11.0] - 2026-07-18

### Changed

- **The `check` Steps report is grouped per project.** The list after "Check PASSED" interleaved workspace, api and app steps in completion order, which parallel groups made hard to scan. Steps are now partitioned per project — workspace-level steps under a `monorepo` header, then one block per member, each in chain order.

### Fixed

- **`check.mjs` is back at parity with the rest of its family.** The wrapper is one maintained code family across `lt-monorepo`, `nest-server-starter`, `nuxt-base-template`, `nest-server` and this repo, and this copy had fallen behind on two discovery fixes: `realChain()` silently dropped a workspace member whose `check` is itself this wrapper, and root-only steps were not being resolved.

## [1.10.0] - 2026-07-16

### Fixed

- **The module reported a stale `meta.version` (frozen at 1.5.2).** `scripts/sync-module-version.mjs` runs on every `prepack` and rewrites `export const version` in `src/module.ts` from `package.json`, but its pattern only matched double quotes (`version = "..."`) while the oxfmt-formatted source uses single quotes. `String.replace` with a non-matching pattern returns the input unchanged, so the script wrote the file back untouched and reported success — the version silently stopped tracking `package.json` after 1.5.2. The pattern now accepts both quote styles, writes single quotes to stay oxfmt-clean, and exits non-zero if the export cannot be found, so a future rename fails loudly instead of silently freezing the version again.
- **Projects that do not install `@better-auth/passkey` could not build.** `package.json` declares the package as an OPTIONAL peer (`peerDependenciesMeta.optional: true`), but `auth-client.ts` imports `passkeyClient` as a *static top-level* import — so the bundler had to resolve the specifier even when a project never enabled passkeys. Vite substituted its optional-peer placeholder and Rollup then died on `"passkeyClient" is not exported by "__vite-optional-peer-dep:@better-auth/passkey/client"`. The declared optionality was a promise the code did not keep. The module now resolves the package once at build time (`tryResolveModule`) and, when it is absent, aliases `@better-auth/passkey/client` onto a no-op stub (for both Vite and Nitro) and forces `auth.enablePasskey` to `false`, emitting one build-time warning that names the package and the opt-out. Projects that *do* install the package are unaffected: `enablePasskey` stays `true` and the real plugin is used. The playground never caught this because it installs every devDependency — only a consumer install surfaces it.

### Changed

- **The exact `packageManager: "pnpm@…"` pin is gone.** It bought no reproducibility — it produced drift: Corepack's `AUTO_PIN` is on by default and rewrites the field on every `pnpm install` with whatever pnpm the machine happens to run (the `+sha512…` suffix seen across the lt repos is Corepack's signature, not a human's). Repos installed on different machines therefore pinned different versions on their own, and Corepack refuses a workspace whose root and member disagree — which is exactly how `lt fullstack init` came to die on `This project is configured to use 11.5.1 of pnpm. Your current pnpm is v11.13.0`. Without the pin any pnpm 11.x works and no version needs bumping across repos ever again. `engines.pnpm: "^11.0.0"` documents the supported range (note: `engines` is advisory — pnpm only enforces it under `engineStrict`, which is unusable here because it applies to every transitive dependency, not just this package). The real guard is `--frozen-lockfile`, which catches the only case that actually hurts: a different pnpm major writing an incompatible lockfile format. CI now asks for the range (`pnpm/action-setup` with `version: 11`) instead of inheriting the pin.
- **`nuxt` peer dependency narrowed from `>=3.0.0` to `^4.0.0`.** The module is Nuxt-4-only — it is developed, tested and built against Nuxt 4, and `@nuxt/kit` resolves to 4.x — so `>=3.0.0` advertised a compatibility that was never real. Nuxt 3 projects were not silently working before; they were never supported. The declaration now matches the code. (Formally this narrows the contract; practically it turns a broken promise into an accurate one.)
- **`@nuxt/kit` is now `^4.0.0` instead of the exact pin `4.4.8`.** An exact pin on a library's runtime dependency forces a second `@nuxt/kit` copy into every consumer whose Nuxt version differs, and would require a release of this package for each Nuxt patch. The caret range lets the consumer's own kit dedupe. The lower bound is deliberately `4.0.0` and not the tested version: the module uses six long-stable kit APIs (`addComponent`, `addImports`, `addPlugin`, `addRouteMiddleware`, `createResolver`, `defineNuxtModule`), all present with identical signatures since 4.0.0 — verified by building a real consumer project against Nuxt 4.0.0 with kit pinned to 4.0.0. The tested version is documented by the exact `devDependencies` pins and the lockfile, which is what those are for.
- Dependency maintenance: `@nuxt/kit`/`@nuxt/schema`/`nuxt` aligned on 4.4.8, `better-auth` + `@better-auth/passkey` 1.6.13 → 1.6.23, `oxlint` 1.67 → 1.74, `oxfmt` 0.52 → 0.59, `@types/node` 25 → 26, plus patches for `vitest`, `@vitest/coverage-v8`, `vue-tsc`, `@playwright/test` and `happy-dom`. TypeScript stays on 5.9.3: TS 7 ships no programmatic API before 7.1, which `vue-tsc` requires.
- **All 11 pnpm `overrides` removed, with `pnpm audit` still clean.** Ten had become obsolete — the upstream packages ship the patched versions themselves. The eleventh (esbuild) was resolved by lifting the parent instead: `vite@7.3.6` widens its range and selects esbuild 0.28.1 on its own. The removed `esbuild@<0.28.1` override had in fact been harmful, forcing `mkdist`/`unbuild` three majors past their declared `^0.25.9` even though 0.25.x was never affected by the advisory.

### Added

- **`check` now guards the two blind spots that let the bugs above ship.** Both were invisible locally because the playground installs every devDependency and `check` never runs `prepack`:
  - `test/optional-peers.test.ts` — for every peer marked `optional: true`, a static **value** import into the bundle is only allowed if `module.ts` aliases the specifier onto a stub. Type-only imports (`@playwright/test`) and lazy `await import()` (`tus-js-client`) pass untouched — those are the correct patterns and stay the recommendation. Verified by removing the alias: the test goes red.
  - `pnpm run version:check` — fails when `src/module.ts` and `package.json` disagree, and `check` auto-repairs it via `version:sync` the same way it auto-fixes format/lint. Verified against drift, auto-fix, and a renamed export.
  - `pnpm run check:manifest` — asserts that every `files` pattern actually contributes files and that every `main`/`types`/`bin`/`exports` target is really in the tarball. Catches the silent case where a rename makes a `files` entry match nothing, or an `exports` subpath (`./lib`, `./testing`) points at an unpacked file — both of which only fail in the consumer.
- **`pnpm install --frozen-lockfile` is now the first step of `check`.** A lockfile that has drifted from package.json passes locally (node_modules already exists) and only fails in CI or on a consumer's fresh install. It also doubles as the pnpm-major guard described above.
- **`pnpm run check:consumer`** — packs the module, installs it into a throwaway Nuxt project with **only the non-optional peers**, and builds it. That is the exact scenario the passkey bug broke; it reproduces the original Rollup error when the alias is removed. It costs ~60s, so it runs in `release` rather than in `check`.

### Removed

- `@nuxt/devtools` from devDependencies — `nuxt` already ships it as a direct dependency at the same version.
- `eslint.config.mjs` — dead since the initial release: it imports `@nuxt/eslint-config`, which is not installed (the project uses oxlint/oxfmt), so the file threw `ERR_MODULE_NOT_FOUND` on any eslint run.
- `my-module: "latest"` from the playground — a template leftover referencing a real, unrelated npm package.

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

- **A 401 no longer triggers a false logout for mislabeled permission errors.** The auth interceptor cleared the session and redirected to login on every 401. But a 401 from a domain endpoint is not proof of an expired session: backends may mislabel permission errors (authenticated user, missing right — semantically 403) as 401, which kicked a logged-in user out of the app over a mere missing right. `handleUnauthorized()` now verifies against `/get-session` before logging out: session alive → treat as a permission error, no logout; session dead → clear state + redirect (real expiry); probe undecided (API unreachable) → keep the user logged in (unreachable ≠ logged out). The probe is recursion-safe via the existing `isHandling401` guard, and an unverifiable probe never logs the user out.

  > **Correction (1.11.2):** the sentence that stood here — "so the change is fail-safe (worst case: a dead session is logged out one request late)" — was wrong, and stayed wrong for three releases. In JWT mode the failure ran the other way: the probe was sent without the session cookie, so it read *every* session as dead and the first mislabelled 401 ended it. The claim also credited a second recursion layer that did not exist (`isAuthEndpoint` never matched the probe URL). Both are fixed in 1.11.2; this note stays so the entry is not read at face value.

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
