---
title: "nuxt-extensions"
description: "Reusable Nuxt 4 composables, components and Better-Auth integration for lenne.tech projects."
navigation:
  title: "Overview"
---

`@lenne.tech/nuxt-extensions` is the Nuxt module of the lenne.tech stack, the frontend counterpart of
[nest-server](https://github.com/lenneTech/nest-server). A project either installs it as an npm package or copies its core into the project
(vendor mode, `app/core/`). New projects start from the
[nuxt-base-starter](https://github.com/lenneTech/nuxt-base-starter), usually through the lt CLI
(`lt fullstack init`).

## Features

- **Better-Auth integration** - login, 2FA, passkey / WebAuthn, sign-in through social providers (SSO)
- **Cookie / JWT dual mode** - automatic fallback from cookies to JWT
- **TUS file upload** - resumable uploads with pause / resume
- **AI assistant** - composables for the AI module of nest-server
- **Offline sync** - read and write offline, reconcile with the nest-server sync module (opt-in)
- **Transition components** - ready-to-use Vue transition wrappers
- **i18n support** - English and German translations (works without i18n too)
- **security.txt** - opt-in RFC 9116 file that never expires between deployments
- **Auto-imports** - all composables and components are auto-imported
- **Pre-hydration input preservation** - text typed before hydration is kept, not erased
- **Form label repair** - restores `<label for>` associations that hydration breaks

## Where to start

| Page | When you need it |
|---|---|
| [Getting started](./1.getting-started.md) | Requirements, installation, versioning |
| [Module options](./2.configuration/1.module-options.md) | Configuring the module in `nuxt.config.ts` |
| [Environment variables](./2.configuration/2.environment-variables.md) | Pointing the app at the API per environment |
| [Authentication](./3.authentication/1.usage.md) | Sign-in, 2FA, passkey, social providers, authenticated requests |
| [File upload](./4.file-upload.md) | Resumable uploads and file links |
| [AI assistant](./5.ai-assistant.md) | Chat and the other AI composables |
| [Offline sync](./6.offline-sync.md) | Offline-capable models |
| [API reference](./8.api-reference.md) | Every composable, component and utility |
| [Migration guides](./9.migration-guides.md) | Updating to a new version |

## Related projects

| Project | Description |
|---------|-------------|
| [nuxt-base-starter](https://github.com/lenneTech/nuxt-base-starter) | Frontend starter template (uses this package) |
| [nest-server-starter](https://github.com/lenneTech/nest-server-starter) | Backend starter template (Better-Auth backend) |
| [@lenne.tech/nest-server](https://github.com/lenneTech/nest-server) | Backend framework with Better-Auth support |
| [@lenne.tech/cli](https://github.com/lenneTech/cli) | CLI tool for fullstack project initialization |

## Fullstack architecture

```text
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
