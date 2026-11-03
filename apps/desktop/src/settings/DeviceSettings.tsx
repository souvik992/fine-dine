import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Monitor, Smartphone, Tv } from 'lucide-react';
import { useState } from 'react';
import { ApiError } from '../api/client.js';
import { useApp } from '../app-context.js';
import { ErrorText, SectionHeader } from './common.js';

interface Device {
  id: string;
  name: string;
  kind: 'terminal' | 'captain' | 'kds';
  pairedAt: string | null;
  lastSeenAt: string | null;
  revokedAt: string | null;
  sessions: number;
  master: boolean;
}
interface Pending {
  id: string;
  code: string;
  name: string;
  kind: Device['kind'];
  remoteAddr: string | null;
  createdAt: string;
}

const ICON = { terminal: Monitor, captain: Smartphone, kds: Tv } as const;
const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—');

/** Settings › Devices (P2-02): approve new terminals by their code (manager PIN) and revoke lost or old ones. */
export function DeviceSettings() {
  const { api } = useApp();
  const qc = useQueryClient();
  const list = useQuery({ queryKey: ['devices'], queryFn: () => api.get<{ devices: Device[]; pending: Pending[] }>('/v1/devices'), refetchInterval: 3_000 });
  const me = useQuery({ queryKey: ['this-device'], queryFn: () => api.get<{ id: string; name: string; master: boolean }>('/v1/device') });
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [revoking, setRevoking] = useState<Device | null>(null);

  const act = async (type: string, payload: unknown, ok: string) => {
    setBusy(true);
    setError(null);
    setDone(null);
    try {
      await api.command(type, payload);
      setDone(ok);
      setCode('');
      await qc.invalidateQueries({ queryKey: ['devices'] });
      return true;
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not do that. Try again.');
      return false;
    } finally {
      setBusy(false);
    }
  };

  if (!list.data) return <p className="text-muted-foreground">Loading…</p>;
  const { devices, pending } = list.data;

  return (
    <div className="max-w-4xl">
      <SectionHeader title="Devices" subtitle="Only paired terminals, captain phones and kitchen screens can see orders. The master PC is always allowed." />

      <section className="mb-6 rounded-xl border border-border bg-card p-4" aria-label="Pair a device">
        <h3 className="font-semibold">Pair a new device</h3>
        <p className="mb-3 text-sm text-muted-foreground">On the new device, choose “Get a pairing code”, then approve its code here. A manager PIN is asked for.</p>
        {pending.length ? (
          <ul className="mb-3 space-y-2" aria-label="Waiting to be paired">
            {pending.map((p) => (
              <li key={p.id} className="flex items-center gap-3 rounded-lg border border-border px-3 py-2">
                <span className="font-mono text-xl font-bold tracking-widest">{p.code}</span>
                <span className="flex-1 text-sm">
                  <span className="font-semibold">{p.name}</span>
                  <span className="ml-2 text-muted-foreground">
                    {p.remoteAddr ?? ''} · asked {when(p.createdAt)}
                  </span>
                </span>
                <button className="btn btn-primary h-9" disabled={busy} onClick={() => void act('PairDevice', { code: p.code }, `${p.name} is paired.`)}>
                  Approve
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mb-3 text-sm text-muted-foreground">No device is waiting.</p>
        )}
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (/^\d{6}$/.test(code)) void act('PairDevice', { code }, 'Device paired.');
          }}
        >
          <input className="input w-48 font-mono tracking-widest" inputMode="numeric" maxLength={6} placeholder="6-digit code" aria-label="Pairing code" value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} />
          <button type="submit" className="btn" disabled={busy || code.length !== 6}>
            Approve code
          </button>
        </form>
        {done ? (
          <p role="status" className="mt-2 text-sm font-semibold text-ok">
            {done}
          </p>
        ) : null}
        <ErrorText error={error} />
      </section>

      <table className="w-full rounded-xl border border-border bg-card text-sm" aria-label="Paired devices">
        <thead>
          <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
            <th className="px-3 py-2">Device</th>
            <th className="px-3 py-2">Paired</th>
            <th className="px-3 py-2">Last seen</th>
            <th className="px-3 py-2">Signed in</th>
            <th className="px-3 py-2" />
          </tr>
        </thead>
        <tbody>
          {devices.map((d) => {
            const Icon = ICON[d.kind];
            const isMe = me.data?.id === d.id;
            return (
              <tr key={d.id} className={`border-b border-border last:border-0 ${d.revokedAt ? 'text-muted-foreground' : ''}`}>
                <td className="px-3 py-2">
                  <span className="flex items-center gap-2 font-semibold">
                    <Icon className="h-4 w-4" /> {d.name}
                    {d.master ? <span className="rounded bg-secondary px-1.5 text-xs font-normal">the server</span> : null}
                    {isMe ? <span className="rounded bg-primary/15 px-1.5 text-xs font-normal text-primary">this terminal</span> : null}
                    {d.revokedAt ? <span className="rounded bg-danger px-1.5 text-xs font-bold text-white">REVOKED</span> : null}
                  </span>
                </td>
                <td className="px-3 py-2">{when(d.pairedAt)}</td>
                <td className="px-3 py-2">{d.master ? 'always' : when(d.lastSeenAt)}</td>
                <td className="px-3 py-2 tabular-nums">{d.sessions}</td>
                <td className="px-3 py-1 text-right">
                  {!d.master && !d.revokedAt && !isMe ? (
                    <button className="btn h-8 text-danger" onClick={() => setRevoking(d)} aria-label={`Revoke ${d.name}`}>
                      Revoke
                    </button>
                  ) : null}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      {revoking ? (
        <div className="mt-4 rounded-xl border border-danger/40 bg-danger/5 p-4" role="alertdialog" aria-label={`Revoke ${revoking.name}`}>
          <p className="text-sm font-semibold">Revoke {revoking.name}? It is cut off at once: anyone signed in on it is signed out, and it must be paired again to be used.</p>
          <div className="mt-3 flex justify-end gap-2">
            <button className="btn" onClick={() => setRevoking(null)}>
              Keep it
            </button>
            <button className="btn bg-danger text-white" disabled={busy} onClick={() => void act('RevokeDevice', { deviceId: revoking.id }, `${revoking.name} is revoked.`).then((ok) => ok && setRevoking(null))}>
              Revoke
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
