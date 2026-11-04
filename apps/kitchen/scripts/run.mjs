// Runs the kitchen app from source (development: a normal window, not full screen).
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const electron = createRequire(import.meta.url)('electron');
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE; // VS Code's terminal sets it; Electron would then behave as plain Node
spawn(electron, ['.'], { cwd: fileURLToPath(new URL('..', import.meta.url)), env, stdio: 'inherit' });
