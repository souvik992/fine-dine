// Entry point for the outlet server (the single SQLite writer). See apps/server/README.md.
// Started by `npm start` / `npm run dev:server`, or on shop PCs by the "DinePOS Server" shortcut
// (bundled node.exe + server.mjs), which shows this process in its own console window.
import { appendFileSync } from 'node:fs';
import path from 'node:path';
import { createInterface } from 'node:readline';
import { listBackups, stageRestore } from './backup/backups.js';
import { loadConfig } from './config.js';
import { StartupError } from './core/errors.js';
import { startServer } from './server.js';
import { IS_BUNDLED } from './version.js';

const SHUTDOWN_TIMEOUT_MS = 10_000;

async function main(): Promise<void> {
  process.title = 'DinePOS Server';
  const config = loadConfig();
  // P2-15: kitchen screens find this server by UDP on its own port number (DINEPOS_DISCOVERY=0 turns it off)
  const discovery = process.env.DINEPOS_DISCOVERY === '0' ? {} : { discoveryPort: config.port };
  // When the server cannot start (a damaged database), a backup can be chosen here instead of in Settings (P2-08):
  //   server.mjs --list-backups      server.mjs --restore <file name>
  const backupDir = path.join(config.dataDir, 'backups');
  const arg = process.argv.indexOf('--restore');
  if (process.argv.includes('--list-backups')) {
    const list = listBackups(backupDir);
    process.stdout.write(list.length ? `${list.map((b) => `  ${b.file}  ${b.kind}  ${Math.round(b.bytes / 1024)} KB`).join('\n')}\n` : '  No backups yet.\n');
    return;
  }
  if (arg >= 0) {
    const pending = stageRestore(config.dataDir, backupDir, process.argv[arg + 1] ?? '', 'command line', new Date());
    process.stdout.write(`\n  Restoring ${pending.file}; the current database is kept aside.\n`);
  }
  // A restore staged in Settings › Backups: stop, then start again in this same window; the start applies it.
  let restarting = false;
  const restart = async () => {
    if (restarting) return;
    restarting = true;
    process.stdout.write('\n  Restoring a backup: restarting the DinePOS server…\n');
    try {
      await server.close();
      server = await startServer(config, { banner: true, requestRestart: () => void restart(), ...discovery });
    } catch (err) {
      console.error('\n  DinePOS server could not restart:', err);
      process.exit(1);
    } finally {
      restarting = false;
    }
  };
  let server = await startServer(config, { banner: true, requestRestart: () => void restart(), ...discovery });

  // A stray failure in a background task (a call to the order hub, a printer) must never stop the outlet: it is
  // logged and the server carries on. A real crash is written to the log at once and kept on screen.
  process.on('unhandledRejection', (reason) => {
    server.app.log.error({ err: reason }, 'unhandled failure in a background task; the server carries on');
  });
  process.on('uncaughtException', (err) => {
    if (server.logFile) {
      try {
        appendFileSync(server.logFile, `${JSON.stringify({ level: 60, time: Date.now(), msg: 'server crashed', err: { message: err.message, stack: err.stack } })}\n`);
      } catch {
        // the log cannot be written: the console still shows it
      }
    }
    console.error('\n  The DinePOS server stopped because of an error:', err);
    void server
      .close()
      .catch(() => undefined)
      .then(holdWindowOpen)
      .finally(() => process.exit(1));
  });

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
