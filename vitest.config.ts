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
      'supabase/functions/_shared/**/*.test.ts',
      'lib/**/*.test.ts',
      'scripts/syn05-watchdog/**/*.test.ts',
      'scripts/deploy-safety/**/*.test.ts',
      'scripts/syn05-collector/**/*.test.ts',
    ],
    // Real-PG OAuth harness lives in vitest.oauth-local.config.ts (needs `pg` + disposable DB).
    exclude: [
      '**/node_modules/**',
      '**/dist/**',
      '**/*.postgres.integration.test.ts',
    ],
    // Playwright OAuth E2E runs via `npm run test:oauth-e2e` (serial; shares disposable PG).
    testTimeout: 30_000,
    hookTimeout: 30_000,
    environment: 'node',
  },
});
