// Backups and restore (docs/07 "Backups", P2-08; approach from TiffinPOS). Every backup is made with SQLite's online
// backup API (never a raw copy of a live database) and verified before it counts. A restore is staged while the
// server runs and applied at the next start, before the database is opened (single-writer rule).
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import type { Db } from '../db/connection.js';
import { loadMigrations } from '../db/migrate.js';

export const BACKUP_KINDS = ['auto', 'dayend', 'manual', 'restore'] as const;
export type BackupKind = (typeof BACKUP_KINDS)[number];

/** "<kind>-<UTC stamp>.db", e.g. auto-20261103T091500123Z.db. */
export const BACKUP_FILE = /^(auto|dayend|manual|restore)-(\d{8}T\d{9}Z)\.db$/;
export const PENDING_RESTORE = 'restore-pending.json';
/** The folder made inside a chosen copy folder (USB drive, second disk). */
export const COPY_FOLDER = 'DinePOS-backups';

export interface BackupInfo {
  file: string;
  kind: BackupKind;
  at: string;
  bytes: number;
}

const stamp = (d: Date) => d.toISOString().replace(/[-:.]/g, '');
const fromStamp = (s: string) => `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}T${s.slice(9, 11)}:${s.slice(11, 13)}:${s.slice(13, 15)}.${s.slice(15, 18)}Z`;

function removeSidecars(file: string): void {
  for (const suffix of ['-wal', '-shm']) rmSync(file + suffix, { force: true });
}

/** Opens a backup read-only: integrity check and a schema this build understands. */
export function verifyBackup(file: string): { ok: boolean; schemaVersion: number; problems: string[] } {
  let db: Database.Database | undefined;
  try {
    db = new Database(file, { readonly: true, fileMustExist: true });
    const check = db.pragma('quick_check') as Array<{ quick_check: string }>;
    const problems = check.map((r) => r.quick_check).filter((m) => m !== 'ok');
    const version = (db.prepare('SELECT max(version) FROM schema_migrations').pluck().get() as number | null) ?? 0;
    if (version < 1) problems.push('not a DinePOS database');
    if (version > loadMigrations().length) problems.push(`made by a newer DinePOS (schema ${version})`);
    return { ok: problems.length === 0, schemaVersion: version, problems };
  } catch (e) {
    return { ok: false, schemaVersion: 0, problems: [e instanceof Error ? e.message : String(e)] };
  } finally {
    db?.close();
    removeSidecars(file);
  }
}

/** Online backup of the live database into `dir`, verified. A backup that fails its check is deleted and reported. */
export async function runBackup(db: Db, dir: string, kind: BackupKind, now: Date): Promise<BackupInfo> {
  mkdirSync(dir, { recursive: true });
  const name = `${kind}-${stamp(now)}.db`;
  const file = path.join(dir, name);
  const tmp = `${file}.tmp`;
  await db.backup(tmp);
  const v = verifyBackup(tmp);
  if (!v.ok) {
    rmSync(tmp, { force: true });
    throw new Error(`backup failed its check: ${v.problems.join('; ')}`);
  }
  renameSync(tmp, file);
  return { file: name, kind, at: now.toISOString(), bytes: statSync(file).size };
}

export function listBackups(dir: string): BackupInfo[] {
  let names: string[];
  try {
    names = readdirSync(dir);
  } catch {
    return [];
  }
  return names
    .map((f) => [f, BACKUP_FILE.exec(f)] as const)
    .filter((x): x is readonly [string, RegExpExecArray] => x[1] !== null)
    .map(([f, m]) => ({ file: f, kind: m[1] as BackupKind, at: fromStamp(m[2]!), bytes: statSync(path.join(dir, f)).size }))
    .sort((a, b) => b.at.localeCompare(a.at));
}

/**
 * Retention (docs/07): automatic backups — all from the last 2 hours, then the newest of each hour for 7 days,
 * then the newest of each day for 30 days. Day-end backups: 90; manual: 30; taken before a restore: 10.
 * Returns the files removed.
 */
export function pruneBackups(dir: string, now: Date): string[] {
  const all = listBackups(dir);
  const keep = new Set<string>();
  const ms = (b: BackupInfo) => now.getTime() - Date.parse(b.at);
  const H = 3_600_000;
  const seen = new Set<string>();
  // Newest first, so the first file seen in an hour (or day) is the one kept.
  for (const b of all.filter((x) => x.kind === 'auto')) {
    const age = ms(b);
    const bucket = age < 2 * H ? null : age < 7 * 24 * H ? `h${b.at.slice(0, 13)}` : age < 30 * 24 * H ? `d${b.at.slice(0, 10)}` : undefined;
    if (bucket === undefined) continue;
    if (bucket !== null && seen.has(bucket)) continue;
    if (bucket !== null) seen.add(bucket);
    keep.add(b.file);
  }
  const limits: Record<Exclude<BackupKind, 'auto'>, number> = { dayend: 90, manual: 30, restore: 10 };
  for (const kind of Object.keys(limits) as Array<keyof typeof limits>) {
    for (const b of all.filter((x) => x.kind === kind).slice(0, limits[kind])) keep.add(b.file);
  }
  const removed: string[] = [];
  for (const b of all) {
    if (keep.has(b.file)) continue;
    rmSync(path.join(dir, b.file), { force: true });
    removed.push(b.file);
  }
  return removed;
}

/** Copies a verified backup to the second folder (USB drive), checks the copy there, and prunes it the same way. */
export function copyToFolder(dir: string, file: string, chosen: string, now: Date): string {
  if (!existsSync(chosen)) throw new Error(`the folder ${chosen} is not available (is the USB drive plugged in?)`);
  const dest = path.join(chosen, COPY_FOLDER);
  mkdirSync(dest, { recursive: true });
  const tmp = path.join(dest, `${file}.tmp`);
  copyFileSync(path.join(dir, file), tmp);
  const v = verifyBackup(tmp);
  if (!v.ok) {
    rmSync(tmp, { force: true });
    throw new Error('the copy on the drive failed its check; the drive may be faulty');
  }
  renameSync(tmp, path.join(dest, file));
  pruneBackups(dest, now);
  return path.join(dest, file);
}

export interface PendingRestore {
  file: string;
  requestedAt: string;
  requestedBy: string | null;
}

/** Checks the backup and records that it should replace the database at the next start. */
export function stageRestore(dataDir: string, backupDir: string, file: string, by: string | null, now: Date): PendingRestore {
  if (!BACKUP_FILE.test(file)) throw new Error('not a backup file name');
  const full = path.join(backupDir, file);
  if (!existsSync(full)) throw new Error('that backup does not exist');
  const v = verifyBackup(full);
  if (!v.ok) throw new Error(`that backup cannot be used: ${v.problems.join('; ')}`);
  const pending: PendingRestore = { file, requestedAt: now.toISOString(), requestedBy: by };
  writeFileSync(path.join(dataDir, PENDING_RESTORE), JSON.stringify(pending, null, 2));
  return pending;
}

/**
 * At start-up, before the database is opened: if a restore is pending, the current database (with its WAL) is moved
 * into `pre-restore-<stamp>/` (never deleted) and the backup copied into place. On any failure the previous database
 * is put back and the marker kept aside, so the server starts on what it had.
 */
export function applyPendingRestore(dataDir: string, dbFile: string, now: Date): { restored: string; aside: string } | null {
  const marker = path.join(dataDir, PENDING_RESTORE);
  if (!existsSync(marker)) return null;
  const pending = JSON.parse(readFileSync(marker, 'utf8')) as PendingRestore;
  const backup = path.join(dataDir, 'backups', pending.file);
  const target = path.join(dataDir, dbFile);
  const aside = path.join(dataDir, `pre-restore-${stamp(now)}`);
  const moved: string[] = [];
  let copied = false;
  try {
    const v = verifyBackup(backup);
    if (!v.ok) throw new Error(`the backup failed its check: ${v.problems.join('; ')}`);
    mkdirSync(aside, { recursive: true });
    for (const suffix of ['', '-wal', '-shm']) {
      if (existsSync(target + suffix)) {
        renameSync(target + suffix, path.join(aside, dbFile + suffix));
        moved.push(suffix);
      }
    }
    copied = true;
    copyFileSync(backup, target);
    unlinkSync(marker);
    return { restored: pending.file, aside };
  } catch (e) {
    // Only a half-copied backup is removed: the current database is never touched unless it was moved aside first.
    if (copied) rmSync(target, { force: true });
    for (const suffix of moved) renameSync(path.join(aside, dbFile + suffix), target + suffix);
    renameSync(marker, `${marker}.failed-${stamp(now)}`);
    throw e;
  }
}
