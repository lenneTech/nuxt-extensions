import LtExtensions from '../../../src/module';

export default defineNuxtConfig({
  modules: [LtExtensions],
  ltExtensions: {
    auth: {
      enabled: true,
    },
  },
});
