import { fileURLToPath } from 'node:url';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const shared = fileURLToPath(new URL('../../packages/shared/src/index.ts', import.meta.url));
const client = fileURLToPath(new URL('../../packages/client/src/index.ts', import.meta.url));

export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  // Relative asset paths: the same build loads from the dev server or app://dinepos/.
  base: './',
  plugins: [react(), tailwindcss()],
  resolve: { alias: { '@dinepos/shared': shared, '@dinepos/client': client } },
  server: { port: 5173, strictPort: true, host: '127.0.0.1' },
  build: { outDir: 'dist-renderer', emptyOutDir: true, target: 'chrome140', sourcemap: true },
});
