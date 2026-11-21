// The DinePOS Server tray notices add-on installs (ADR-0004). The outlet server reads the add-ons folder only when it
// starts, and it keeps running in the tray when the DinePOS windows close, so an add-on installed, updated or removed
// while it runs does nothing until the server restarts. This compares the folder with what the running server loaded
// and says so once, so the tray can offer a restart (never forced: a bill may be open). Free of Electron for tests.
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import type { ServerCommand } from './server-supervisor.js';

/** Where the server looks for add-ons: DINEPOS_ADDONS_DIR, else <data dir>/addons (as apps/server/src/server.ts). */
export function addonsDirOf(command: Pick<ServerCommand, 'env' | 'dataDir'>): string {
  return command.env.DINEPOS_ADDONS_DIR || path.join(command.dataDir, 'addons');
}

/**
 * The add-ons folder as the server would load it: each sub-folder with the fingerprint of its manifest.json (the signed
 * file every install writes last and every uninstall removes first), or "-" while it has none. "" when there is no folder.
 */
export function addonsFingerprint(dir: string): string {
  let folders: string[];
  try {
    folders = readdirSync(dir, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => e.name)
      .sort();
  } catch {
    return '';
  }
  return folders
    .map((f) => {
      try {
        return `${f}:${createHash('sha256').update(readFileSync(path.join(dir, f, 'manifest.json'))).digest('hex')}`;
      } catch {
        return `${f}:-`;
      }
    })
    .join('\n');
}

export interface AddonWatcherOptions {
  dir: string;
  /** Called once per change the running server has not loaded. */
  onChanged: () => void;
  /** How often the folder is read. */
  everyMs?: number;
  fingerprint?: (dir: string) => string;
}

export class AddonWatcher {
  private loaded: string | null = null;
  private seen: string | null = null;
  private told: string | null = null;
  private timer: NodeJS.Timeout | null = null;
  constructor(private readonly o: AddonWatcherOptions) {}

  private read(): string {
    return (this.o.fingerprint ?? addonsFingerprint)(this.o.dir);
  }

  /** The server (re)started: it loads the folder as it is now. */
  serverStarted(): void {
    this.loaded = this.read();
    this.seen = null;
    this.told = null;
  }

  /**
   * One look at the folder. A change is reported only when it is the same on two looks in a row: an installer that
   * restarts the server itself (Table QR) is not asked about, and a half-copied package is not either.
   */
  check(): void {
    if (this.loaded === null) return;
    const now = this.read();
    if (now === this.loaded) {
      this.seen = null;
      this.told = null;
      return;
    }
    const steady = now === this.seen;
    this.seen = now;
    if (!steady || now === this.told) return;
    this.told = now;
    this.o.onChanged();
  }

  start(): void {
    this.timer ??= setInterval(() => this.check(), this.o.everyMs ?? 5000);
    this.timer.unref();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }
}
