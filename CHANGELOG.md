# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
