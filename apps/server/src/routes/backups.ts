import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { approveWithPin } from '../auth/approval.js';
import { requireRight, sessionToken } from '../auth/require-right.js';
import { resolveSession, tokenHash } from '../auth/sessions.js';
import { listBackups, stageRestore } from '../backup/backups.js';
import type { BackupScheduler } from '../backup/scheduler.js';
import { PosError } from '../core/errors.js';
import type { Db } from '../db/connection.js';

export interface BackupRouteDeps {
  db: Db;
  now: () => Date;
  timeZone: string;
  dataDir: string;
  backups: BackupScheduler;
  /** Stops the server and starts it again (the pending restore is applied at start). */
  requestRestart: () => void;
}

const restoreBody = z.object({ file: z.string().min(1).max(80) }).strict();

/**
 * Settings › Backups (P2-08). Backups are files, not records, so these are routes rather than commands; a restore
 * replaces the whole database and is applied at the next start (single-writer rule). Audited.
 */
export function backupRoutes(app: FastifyInstance, deps: BackupRouteDeps): void {
  const { db, now, backups } = deps;
  const noStore = { 'cache-control': 'no-store' };
  const audit = (req: FastifyRequest, action: string, after: unknown, approvedBy: string | null = null) => {
    const user = resolveSession(db, sessionToken(req), now()).user.id;
    db.prepare(
      `INSERT INTO audit_event (ts, device_id, user_id, approved_by, command_id, entity, entity_id, action, before_json, after_json, reason, leakage_flag)
       VALUES (?, NULL, ?, ?, NULL, 'backup', NULL, ?, NULL, ?, NULL, 0)`,
    ).run(now().toISOString(), user, approvedBy, action, JSON.stringify(after)); // UTC, like every audit row
    return user;
  };

  app.get('/v1/admin/backups', (req, reply) => {
    requireRight(db, req, 'admin', now());
    return reply.headers(noStore).send({ status: backups.status(), backups: listBackups(backups.dir) });
  });

  app.post('/v1/admin/backups', async (req, reply) => {
    requireRight(db, req, 'admin', now());
    try {
      const backup = await backups.run('manual');
      audit(req, 'backup.manual', { file: backup.file });
      return await reply.headers(noStore).send({ backup });
    } catch (e) {
      throw new PosError('INTERNAL', `The backup could not be made: ${e instanceof Error ? e.message : String(e)}`);
    }
  });

  app.post('/v1/admin/restore', async (req, reply) => {
    requireRight(db, req, 'users.manage', now());
    const body = restoreBody.safeParse(req.body);
    if (!body.success) throw new PosError('VALIDATION', 'Choose a backup to restore.');
    const pin = req.headers['x-manager-pin'];
    const token = sessionToken(req);
    // An Owner's PIN, typed again, even for an Owner: a restore replaces everything since that backup.
    const approver = approveWithPin(db, typeof pin === 'string' ? pin : null, { right: 'users.manage' }, token ? tokenHash(token) : 'no-session', now().getTime(), "Restoring needs the Owner's PIN.");
    // A safety backup of the current data first, so the restore itself can be undone.
    const safety = await backups.run('restore');
    let pending;
    try {
      pending = stageRestore(deps.dataDir, backups.dir, body.data.file, approver, now());
    } catch (e) {
      throw new PosError('VALIDATION', e instanceof Error ? e.message : String(e));
    }
    audit(req, 'backup.restore_staged', { file: pending.file, safetyBackup: safety.file }, approver);
    await reply.headers(noStore).send({ restoring: pending.file, safetyBackup: safety.file, restarting: true });
    setTimeout(deps.requestRestart, 100);
    return reply;
  });
}
