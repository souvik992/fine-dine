// Dev loop: Vite dev server (hot reload) + Electron pointed at it. Ctrl+C or closing the window stops both.
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import { runElectron } from './run-electron.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const vite = await createServer({ configFile: `${root}vite.config.ts` });
await vite.listen();
const url = vite.resolvedUrls?.local[0] ?? 'http://127.0.0.1:5173/';
execFileSync(process.execPath, [`${root}scripts/build-electron.mjs`], { stdio: 'inherit' });
const child = runElectron({ DINEPOS_DEV_URL: url });
const stop = async (code) => {
  await vite.close();
  process.exit(code ?? 0);
};
child.on('exit', (code) => void stop(code));
process.on('SIGINT', () => child.kill());
