// Entry point for the outlet server (the single SQLite writer). See apps/server/README.md.
import { loadConfig } from './config.js';
import { StartupError } from './core/errors.js';
import { startServer } from './server.js';

const SHUTDOWN_TIMEOUT_MS = 10_000;

async function main(): Promise<void> {
  const server = await startServer(loadConfig());

  let stopping = false;
  const stop = (signal: string) => {
    if (stopping) return;
    stopping = true;
    server.app.log.info({ signal }, 'shutting down');
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
  for (const signal of ['SIGINT', 'SIGTERM', 'SIGBREAK'] as const) process.on(signal, () => stop(signal));
}

main().catch((err: unknown) => {
  if (err instanceof StartupError) {
    console.error(`DinePOS server could not start [${err.code}]: ${err.message}`);
  } else {
    console.error('DinePOS server could not start:', err);
  }
  process.exit(1);
});
