// Entry point for the outlet server (the single SQLite writer). See apps/server/README.md.
// Started by `npm start` / `npm run dev:server`, or on shop PCs by the "DinePOS Server" shortcut
// (bundled node.exe + server.mjs), which shows this process in its own console window.
import { createInterface } from 'node:readline';
import { loadConfig } from './config.js';
import { StartupError } from './core/errors.js';
import { startServer } from './server.js';
import { IS_BUNDLED } from './version.js';

const SHUTDOWN_TIMEOUT_MS = 10_000;

async function main(): Promise<void> {
  process.title = 'DinePOS Server';
  const server = await startServer(loadConfig(), { banner: true });

  let stopping = false;
  const stop = (signal: string) => {
    if (stopping) return;
    stopping = true;
    server.app.log.info({ signal }, 'shutting down');
    process.stdout.write('\n  Stopping the DinePOS server…\n');
    const timer = setTimeout(() => {
      server.app.log.error('shutdown timed out; exiting');
      process.exit(1);
    }, SHUTDOWN_TIMEOUT_MS);
    timer.unref();
    server.close().then(
      () => process.exit(0),
      (err: unknown) => {
        server.app.log.error({ err }, 'error during shutdown');
        process.exit(1);
      },
    );
  };
  // SIGHUP: the server window was closed (Windows gives the process a few seconds to finish).
  for (const signal of ['SIGINT', 'SIGTERM', 'SIGBREAK', 'SIGHUP'] as const) process.on(signal, () => stop(signal));
}

/** In the shop's server window, keep a start-up error on screen instead of closing the window at once. */
async function holdWindowOpen(): Promise<void> {
  if (!IS_BUNDLED || !process.stdin.isTTY) return;
  process.stderr.write('\n  Press Enter to close this window.\n');
  const rl = createInterface({ input: process.stdin });
  await new Promise<void>((resolve) => rl.once('line', () => resolve()));
  rl.close();
}

main().catch(async (err: unknown) => {
  if (err instanceof StartupError) {
    console.error(`\n  DinePOS server could not start [${err.code}]: ${err.message}`);
  } else {
    console.error('\n  DinePOS server could not start:', err);
  }
  await holdWindowOpen();
  process.exit(1);
});
