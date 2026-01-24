export default defineNuxtConfig({
  modules: ['../src/module'],
  devtools: { enabled: true },
  compatibilityDate: 'latest',

  ltExtensions: {
    auth: {
      enabled: true,
      basePath: '/iam',
      loginPath: '/auth/login',
      twoFactorRedirectPath: '/auth/2fa',
      interceptor: {
        enabled: true,
        publicPaths: ['/auth/login', '/auth/register'],
      },
    },
    tus: {
      defaultEndpoint: '/api/files/upload',
      defaultChunkSize: 5 * 1024 * 1024,
    },
    i18n: {
      autoMerge: true,
    },
  },
});
