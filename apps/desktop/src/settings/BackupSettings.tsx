import type { OutletConfig } from '@dinepos/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { DatabaseBackup, History, ShieldCheck, TriangleAlert } from 'lucide-react';
import { useEffect, useState } from 'react';
import { ApiError } from '../api/client.js';
import { useApp } from '../app-context.js';
import { Modal } from '../components/Modal.js';
import { ErrorText, Field, SectionHeader, useSave } from './common.js';

interface BackupInfo {
  file: string;
  kind: 'auto' | 'dayend' | 'manual' | 'restore';
  at: string;
  bytes: number;
}
interface BackupStatus {
  last: BackupInfo | null;
  ageMin: number | null;
  lastError: string | null;
  copyDir: string | null;
  copyLastAt: string | null;
  copyError: string | null;
}

const KIND: Record<BackupInfo['kind'], string> = { auto: 'Automatic', dayend: 'Day end', manual: 'Made by hand', restore: 'Before a restore' };
const when = (iso: string) => new Date(iso).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
const size = (b: number) => (b > 1_048_576 ? `${(b / 1_048_576).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`);
const age = (min: number) => (min < 1 ? 'just now' : min < 60 ? `${min} min ago` : min < 1440 ? `${Math.floor(min / 60)} h ago` : `${Math.floor(min / 1440)} days ago`);

/** Settings › Backups (P2-08): every 15 minutes and at day end, verified; a copy folder; restore with the Owner's PIN. */
export function BackupSettings() {
  const { api, can } = useApp();
  const qc = useQueryClient();
  const data = useQuery({ queryKey: ['backups'], queryFn: () => api.get<{ status: BackupStatus; backups: BackupInfo[] }>('/v1/admin/backups'), refetchInterval: 60_000 });
  const config = useQuery({ queryKey: ['config'], queryFn: () => api.get<OutletConfig>('/v1/config') });
  const { save, busy: saving, error: saveError } = useSave();
  const [copyDir, setCopyDir] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [restoring, setRestoring] = useState<BackupInfo | null>(null);
  useEffect(() => {
    if (config.data && copyDir === null) setCopyDir(config.data['backup.copyDir'] ?? '');
  }, [config.data, copyDir]);

  if (!data.data) return <p className="text-muted-foreground">Loading…</p>;
  const { status, backups } = data.data;
  const healthy = status.ageMin !== null && status.ageMin <= 60 && !status.lastError;

  const backupNow = async () => {
    setRunning(true);
    setMessage(null);
    try {
      const r = await api.send<{ backup: BackupInfo }>('POST', '/v1/admin/backups');
      setMessage({ ok: true, text: `Backup made and checked (${size(r.backup.bytes)}).` });
      await qc.invalidateQueries({ queryKey: ['backups'] });
    } catch (e) {
      setMessage({ ok: false, text: e instanceof ApiError ? e.message : 'The backup could not be made.' });
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="max-w-4xl">
      <SectionHeader
        title="Backups"
        subtitle="A checked copy of all data is made every 15 minutes and at day end. Hourly copies are kept for 7 days, daily ones for 30 days."
        action={
          <button className="btn btn-primary" onClick={() => void backupNow()} disabled={running}>
            <DatabaseBackup className="h-4 w-4" /> {running ? 'Backing up…' : 'Back up now'}
          </button>
        }
      />
      <div className={`mb-4 flex items-start gap-3 rounded-xl border p-4 ${healthy ? 'border-ok/40 bg-ok/5' : 'border-danger/40 bg-danger/5'}`} role="status">
        {healthy ? <ShieldCheck className="h-6 w-6 text-ok" /> : <TriangleAlert className="h-6 w-6 text-danger" />}
        <div className="text-sm">
          <p className="font-semibold">
            {status.last ? `Last backup ${age(status.ageMin ?? 0)} (${when(status.last.at)})` : 'No backup yet'}
            {healthy ? '' : ' — needs attention'}
          </p>
          {status.lastError ? <p className="text-danger">The last backup failed: {status.lastError}</p> : null}
          {status.copyError ? <p className="text-danger">Copy to the second folder failed: {status.copyError}</p> : null}
          {status.copyDir && status.copyLastAt && !status.copyError ? <p className="text-muted-foreground">Copied to {status.copyDir} at {when(status.copyLastAt)}.</p> : null}
        </div>
      </div>
      {message ? (
        <p className={`mb-3 text-sm font-semibold ${message.ok ? 'text-ok' : 'text-danger'}`} role={message.ok ? 'status' : 'alert'}>
          {message.text}
        </p>
      ) : null}

      <form
        className="mb-6 rounded-xl border border-border bg-card p-4"
        onSubmit={(e) => {
          e.preventDefault();
          void save('SetConfig', { values: { 'backup.copyDir': copyDir?.trim() ? copyDir.trim() : null } }).then((ok) => ok && setMessage({ ok: true, text: 'Copy folder saved.' }));
        }}
      >
        <Field label="Also copy every backup to" hint="A USB drive or a second disk on the master PC, e.g. E:\ or D:\Backups. If the PC's disk fails, the data is safe there. Leave empty for none.">
          <div className="flex gap-2">
            <input className="input font-mono" placeholder="E:\" value={copyDir ?? ''} onChange={(e) => setCopyDir(e.target.value)} aria-label="Copy folder" />
            <button type="submit" className="btn shrink-0" disabled={saving}>
              Save
            </button>
          </div>
        </Field>
        <ErrorText error={saveError} />
      </form>

      <h3 className="mb-2 font-semibold">Backups on this PC</h3>
      <table className="w-full rounded-xl border border-border bg-card text-sm" aria-label="Backups">
        <tbody>
          {backups.map((b) => (
            <tr key={b.file} className="border-b border-border last:border-0">
              <td className="px-3 py-2 font-semibold">{when(b.at)}</td>
              <td className="px-3 py-2 text-muted-foreground">{KIND[b.kind]}</td>
              <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">{size(b.bytes)}</td>
              <td className="px-3 py-1 text-right">
                {can('users.manage') ? (
                  <button className="btn h-8" onClick={() => setRestoring(b)} aria-label={`Restore the backup of ${when(b.at)}`}>
                    <History className="h-4 w-4" /> Restore
                  </button>
                ) : null}
              </td>
            </tr>
          ))}
          {backups.length === 0 ? (
            <tr>
              <td className="p-6 text-center text-muted-foreground">No backups yet. The first one is made a few seconds after the server starts.</td>
            </tr>
          ) : null}
        </tbody>
      </table>
      {restoring ? <RestoreDialog backup={restoring} onClose={() => setRestoring(null)} /> : null}
    </div>
  );
}

function RestoreDialog({ backup, onClose }: { backup: BackupInfo; onClose: () => void }) {
  const { api } = useApp();
  const [pin, setPin] = useState('');
  const [confirm, setConfirm] = useState('');
  const [state, setState] = useState<'ask' | 'restarting' | 'back'>('ask');
  const [error, setError] = useState<string | null>(null);

  const restore = async () => {
    setError(null);
    try {
      await api.send('POST', '/v1/admin/restore', { file: backup.file }, { 'x-manager-pin': pin });
      setState('restarting');
      // Wait for the server to come back on the restored data, then start the app again.
      for (let i = 0; i < 60; i++) {
        await new Promise((r) => setTimeout(r, 1000));
        try {
          await api.get('/v1/health');
          setState('back');
          setTimeout(() => window.location.reload(), 1500);
          return;
        } catch {
          // still restarting
        }
      }
      setError('The server did not come back. Open “DinePOS Server” on the master PC.');
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'The restore could not start.');
    }
  };

  return (
    <Modal title="Restore a backup" onClose={state === 'ask' ? onClose : () => undefined}>
      {state === 'ask' ? (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void restore();
          }}
        >
          <p className="text-sm">
            All data goes back to <span className="font-semibold">{when(backup.at)}</span>. Bills, orders and changes made after that are taken out of
            use. A backup of the data as it is now is made first, and the current database is kept aside, never deleted.
          </p>
          <p className="mt-2 text-sm text-muted-foreground">Every terminal disconnects for a few seconds while the server restarts. Do this when no bills are being made.</p>
          <Field label="Type RESTORE to confirm">
            <input data-autofocus className="input uppercase" value={confirm} onChange={(e) => setConfirm(e.target.value)} aria-label="Type RESTORE to confirm" />
          </Field>
          <div className="mt-3">
            <Field label="Owner PIN">
              <input className="input" type="password" inputMode="numeric" maxLength={6} value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))} aria-label="Owner PIN" />
            </Field>
          </div>
          <ErrorText error={error} />
          <div className="mt-5 flex justify-end gap-2">
            <button type="button" className="btn" onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className="btn bg-danger text-white" disabled={confirm.trim().toUpperCase() !== 'RESTORE' || pin.length < 4}>
              Restore
            </button>
          </div>
        </form>
      ) : (
        <div className="py-4 text-center" role="status">
          <p className="font-semibold">{state === 'restarting' ? 'Restoring… the server is restarting.' : 'Restored. Starting again…'}</p>
          <ErrorText error={error} />
        </div>
      )}
    </Modal>
  );
}
