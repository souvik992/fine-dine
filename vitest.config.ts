import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const src = (pkg: string) => fileURLToPath(new URL(`./packages/${pkg}/src/index.ts`, import.meta.url));

export default defineConfig({
  resolve: {
    // Tests run against workspace sources, so no build is needed before `npm run test`.
    alias: {
      '@dinepos/shared': src('shared'),
      '@dinepos/printing': src('printing'),
      '@dinepos/client': src('client'),
      '@dinepos/web-shell': src('web-shell'),
    },
  },
  test: {
    include: ['packages/*/src/**/*.test.ts', 'apps/*/src/**/*.test.ts', 'apps/desktop/electron/**/*.test.ts', 'apps/kitchen/electron/**/*.test.ts', 'addons/*/src/**/*.test.ts'],
    exclude: ['**/node_modules/**', '**/*.e2e.test.ts'],
    environment: 'node',
    passWithNoTests: false,
  },
});
