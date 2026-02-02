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

## Configuration

```typescript
// nuxt.config.ts
export default defineNuxtConfig({
  modules: ['@lenne.tech/nuxt-extensions'],

  ltExtensions: {
    // Auth configuration
    auth: {
      enabled: true,                // Enable auth features
      baseURL: '',                  // API base URL (empty = use Nuxt proxy)
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
| `useLtTusUpload()` | TUS protocol file uploads with pause/resume |
| `useLtFile()` | File utilities (size formatting, URLs) |
| `useLtShare()` | Web Share API with clipboard fallback |

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
