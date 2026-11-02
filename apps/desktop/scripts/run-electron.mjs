// Starts Electron on this app. VS Code terminals set ELECTRON_RUN_AS_NODE=1, which would make Electron act
// as plain Node, so it is removed here (lesson from Tiffin POS).
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

export function runElectron(extraEnv = {}) {
  const electron = createRequire(import.meta.url)('electron');
  const env = { ...process.env, ...extraEnv };
  delete env.ELECTRON_RUN_AS_NODE;
  return spawn(electron, ['.'], { cwd: fileURLToPath(new URL('..', import.meta.url)), env, stdio: 'inherit' });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  runElectron().on('exit', (code) => process.exit(code ?? 0));
}
