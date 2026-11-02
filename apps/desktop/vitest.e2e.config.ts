import { defineConfig } from 'vitest/config';

// End-to-end tests drive the built Electron app; run with `npm run test:e2e -w @dinepos/desktop`.
export default defineConfig({
  test: {
    include: ['apps/desktop/e2e/**/*.e2e.test.ts'],
    environment: 'node',
    testTimeout: 60_000,
    hookTimeout: 120_000,
    fileParallelism: false,
  },
});
