import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['scripts/deploy-safety/**/*.test.ts'],
    environment: 'node',
  },
});
