import path from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(__dirname, '.'),
    },
  },
  test: {
    include: [
      'supabase/functions/_shared/oauth.postgres.integration.test.ts',
      'e2e/oauth/gotrue.integration.test.ts',
      'e2e/oauth/lifecycle.playwright.test.ts',
    ],
    fileParallelism: false,
    testTimeout: 60_000,
    hookTimeout: 60_000,
    environment: 'node',
  },
});
