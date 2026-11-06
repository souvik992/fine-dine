import { useQuery } from '@tanstack/react-query';
import { Globe, Smartphone } from 'lucide-react';
import { useState } from 'react';
import { useApp } from '../app-context.js';
import { ErrorText, useSave } from './common.js';

interface CloudStatus {
  enabled: boolean;
  paired: boolean;
  connection: 'off' | 'connecting' | 'connected' | 'retrying';
  deviceUrl: string | null;
  lastError: string | null;
  streams: number;
}

const STATE: Record<CloudStatus['connection'], string> = { off: 'Off', connecting: 'Connecting…', connected: 'Connected', retrying: 'Reconnecting…' };

/**
 * Settings › Cloud sync › Devices from anywhere (P6-02, ADR-0005): terminals, captain phones and kitchen screens reach
 * this outlet through DinePOS Cloud at https://<store>.<cloud>, tunnelled to this PC. This PC stays the outlet's only
 * database; on the outlet's own network everything keeps working without internet.
 */
export function RemoteDevices() {
  const { api } = useApp();
  const status = useQuery({ queryKey: ['cloud'], queryFn: () => api.get<CloudStatus>('/v1/cloud'), refetchInterval: 5_000 });
  const { save, busy, error } = useSave();
  const [copied, setCopied] = useState(false);
  const s = status.data;
  if (!s) return null;

  const toggle = async (on: boolean) => {
    if (await save('SetConfig', { values: { 'cloud.remoteDevices': on } })) await status.refetch();
  };
  const copy = async () => {
    if (!s.deviceUrl) return;
    try {
      await navigator.clipboard.writeText(s.deviceUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // the address is on screen to type
    }
  };

  return (
    <div className="mt-8 rounded-xl border border-border bg-card p-5" data-testid="remote-devices">
      <div className="flex items-start gap-3">
        <Globe className="mt-0.5 h-6 w-6 shrink-0 text-muted-foreground" />
        <div className="flex-1">
          <p className="font-semibold">Devices from anywhere</p>
          <p className="text-sm text-muted-foreground">
            Captain phones, kitchen screens and other terminals can reach this outlet over the internet (mobile data, another Wi-Fi) through DinePOS Cloud. This PC stays
            the outlet’s only database: on the outlet’s own network everything keeps working without internet. Each device still needs pairing and a staff PIN.
          </p>
        </div>
      </div>
      {!s.paired ? (
        <p className="mt-3 text-sm">Connect this outlet to DinePOS Cloud first (Settings › Online orders › Order hub: paste the connection link).</p>
      ) : (
        <>
          <label className="mt-4 flex items-center gap-3">
            <input type="checkbox" className="h-5 w-5" checked={s.enabled} disabled={busy} onChange={(e) => void toggle(e.target.checked)} />
            <span className="font-semibold">Let devices connect through DinePOS Cloud</span>
            {s.enabled ? (
              <span className={`ml-auto rounded-full px-2.5 py-0.5 text-xs font-bold ${s.connection === 'connected' ? 'bg-ok/15 text-ok' : 'bg-warn/20'}`} data-testid="remote-state">
                {STATE[s.connection]}
                {s.connection === 'connected' && s.streams ? ` · ${s.streams} device${s.streams === 1 ? '' : 's'} live` : ''}
              </span>
            ) : null}
          </label>
          <ErrorText error={error} />
          {s.enabled && s.lastError && s.connection !== 'connected' ? <p className="mt-2 text-sm text-danger">{s.lastError}</p> : null}
          {s.enabled && s.deviceUrl ? (
            <div className="mt-4 space-y-2">
              <p className="text-sm font-semibold">This outlet’s address on the internet</p>
              <div className="flex gap-2">
                <code className="flex-1 rounded-lg border border-border bg-background px-3 py-2 text-sm" data-testid="device-url">
                  {s.deviceUrl}
                </code>
                <button className="btn" onClick={() => void copy()}>
                  {copied ? 'Copied' : 'Copy'}
                </button>
              </div>
              <ul className="space-y-1 text-sm text-muted-foreground">
                <li className="flex gap-2">
                  <Smartphone className="mt-0.5 h-4 w-4 shrink-0" /> Captain phone: open {s.deviceUrl}/captain and pair it (approve the code in Settings › Devices).
                </li>
                <li>Kitchen screen (DinePOS Kitchen app or a browser): use {s.deviceUrl} as the server address, or open {s.deviceUrl}/kds.</li>
                <li>Another DinePOS terminal: Settings › This terminal › server address {s.deviceUrl}, then pair it.</li>
              </ul>
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}
