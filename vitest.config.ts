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
    ],
    environment: 'node',
  },
});
