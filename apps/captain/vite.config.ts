import { fileURLToPath } from 'node:url';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const src = (pkg: string) => fileURLToPath(new URL(`../../packages/${pkg}/src/index.ts`, import.meta.url));

// Served by the outlet server at /captain (apps/server/src/routes/web-apps.ts). `npm run dev` proxies the API.
export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  base: '/captain/',
  plugins: [react(), tailwindcss()],
  resolve: { alias: { '@dinepos/shared': src('shared'), '@dinepos/client': src('client') } },
  server: { port: 5174, strictPort: true, host: true, proxy: { '/v1': { target: 'http://127.0.0.1:7420', ws: true } } },
  build: { outDir: 'dist', emptyOutDir: true, target: 'es2022', sourcemap: true },
});
