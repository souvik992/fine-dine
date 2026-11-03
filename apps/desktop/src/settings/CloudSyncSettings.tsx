import type { SyncStatus } from '@dinepos/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { CloudOff, CloudUpload, RefreshCw, TriangleAlert } from 'lucide-react';
import { useState } from 'react';
import { ApiError } from '../api/client.js';
import { useApp } from '../app-context.js';
import { ErrorText, SectionHeader, useSave } from './common.js';

const STATE_TEXT: Record<SyncStatus['state'], string> = {
  'not-paired': 'Not connected to a hub',
  idle: 'Up to date',
  sending: 'Sending…',
  offline: 'Waiting for the internet',
  stuck: 'Needs attention',
};

const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' }) : 'never');

/**
 * Cloud sync (P4-05, docs/05): bills and day-end reports go up to the hub (the same connection as online orders), and
 * a renewed licence key put on the hub is installed by itself. Billing never waits for it.
 */
export function CloudSyncSettings() {
  const { api } = useApp();
  const qc = useQueryClient();
  const status = useQuery({ queryKey: ['sync'], queryFn: () => api.get<SyncStatus>('/v1/sync'), refetchInterval: 10_000 });
  const { save, busy, error } = useSave();
  const [running, setRunning] = useState(false);
  const [runError, setRunError] = useState<string | null>(null);
  const s = status.data;
  if (!s) return <p className="text-muted-foreground">Loading…</p>;

  const syncNow = async () => {
    setRunning(true);
    setRunError(null);
    try {
      qc.setQueryData(['sync'], await api.send<SyncStatus>('POST', '/v1/sync/run', {}));
    } catch (e) {
      setRunError(e instanceof ApiError ? e.message : 'Could not reach the outlet server.');
    } finally {
      setRunning(false);
    }
  };
  const good = s.state === 'idle' || s.state === 'sending';

  return (
    <div className="max-w-3xl">
      <SectionHeader title="Cloud sync" subtitle="Bills and day-end reports are sent to your order hub, so the owner can see sales from anywhere. Billing never waits for it." />
      {!s.paired ? (
        <div className="flex items-start gap-3 rounded-xl border-2 border-border p-4" data-testid="sync-status">
          <CloudOff className="mt-0.5 h-6 w-6 shrink-0 text-muted-foreground" />
          <div>
            <p className="font-semibold">{STATE_TEXT['not-paired']}</p>
            <p className="text-sm">Connect this outlet to the hub in Settings › Online orders (paste the connection link). The same connection carries sales and licence renewals.</p>
            {s.pending > 0 ? <p className="mt-1 text-sm text-muted-foreground">{s.pending} records are kept here and will be sent once connected.</p> : null}
          </div>
        </div>
      ) : (
        <>
          <div className={`mb-4 flex items-start gap-3 rounded-xl border-2 p-4 ${good ? 'border-ok' : 'border-danger'}`} data-testid="sync-status">
            {good ? <CloudUpload className="mt-0.5 h-6 w-6 shrink-0 text-ok" /> : <TriangleAlert className="mt-0.5 h-6 w-6 shrink-0 text-danger" />}
            <div className="flex-1">
              <p className="font-semibold">{STATE_TEXT[s.state]}</p>
              <p className="text-sm">
                {s.store ? `${s.store.name} on ${s.hubUrl}` : s.hubUrl} · last sent {when(s.lastSyncAt)}
              </p>
              <p className="text-sm">
                {s.pending === 0 ? 'Nothing waiting to be sent.' : `${s.pending} record${s.pending === 1 ? '' : 's'} waiting, the oldest from ${when(s.oldestPendingAt)}.`}
              </p>
              {s.lastError ? <p className="mt-1 text-sm text-danger">{s.lastError}</p> : null}
            </div>
            <button className="btn" onClick={() => void syncNow()} disabled={running}>
              <RefreshCw className={`h-4 w-4 ${running ? 'animate-spin' : ''}`} /> Sync now
            </button>
          </div>
          <ErrorText error={runError} />

          {s.conflict ? (
            <div className="mb-4 rounded-xl border border-danger p-4">
              <p className="font-semibold">The hub has different records under the same numbers</p>
              <p className="text-sm">
                This happens when this database was restored from a backup or copied from another PC. Start a new sync stream: records not yet sent go up
                under it, and what the hub already has stays there. Nothing here is deleted.
              </p>
              <ErrorText error={error} />
              <button className="btn btn-primary mt-3" disabled={busy} onClick={() => void save('ResetSyncStream', {}).then(() => syncNow())}>
                Start a new sync stream
              </button>
            </div>
          ) : null}

          <p className="mb-1 text-sm font-semibold">Licence renewals</p>
          <p className="text-sm text-muted-foreground">
            When your supplier puts a renewed key on the hub, it is installed here by itself (checked every hour, and on Sync now). Last checked {when(s.licence.checkedAt)}
            {s.licence.result ? `: ${s.licence.result}` : '.'}
          </p>
        </>
      )}
    </div>
  );
}
