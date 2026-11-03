import type { LicenceInfo } from '@dinepos/shared';
import { useQuery } from '@tanstack/react-query';
import { Copy, KeyRound, ShieldAlert, ShieldCheck } from 'lucide-react';
import { useState } from 'react';
import { useApp } from '../app-context.js';
import { ErrorText, SectionHeader, useSave } from './common.js';

const STATE_TEXT: Record<LicenceInfo['state'], string> = {
  dev: 'Development run',
  none: 'Not licensed',
  invalid: 'Key not valid here',
  ok: 'Licensed',
  expiring: 'Ending soon',
  grace: 'Ended: grace period',
  expired: 'Ended',
};

/**
 * Licence (P2-09, docs/07): the status, this PC's hardware id (send it to get a key), seats in use, and installing a
 * key. Without a valid licence no new business day can start; a day in progress is never stopped.
 */
export function LicenceSettings() {
  const { api } = useApp();
  const info = useQuery({ queryKey: ['licence'], queryFn: () => api.get<LicenceInfo>('/v1/licence') });
  const { save, busy, error } = useSave();
  const [key, setKey] = useState('');
  const [copied, setCopied] = useState(false);
  const [installed, setInstalled] = useState<string | null>(null);
  const l = info.data;
  if (!l) return <p className="text-muted-foreground">Loading…</p>;
  const good = l.state === 'ok' || l.state === 'dev';
  const seat = (k: keyof LicenceInfo['used'], label: string) =>
    l.seats ? (
      <li className="flex justify-between">
        <span>{label}</span>
        <span className={`tabular-nums ${l.used[k] > l.seats[k] ? 'font-bold text-danger' : ''}`}>
          {l.used[k]} of {l.seats[k]}
        </span>
      </li>
    ) : null;

  return (
    <div className="max-w-3xl">
      <SectionHeader title="Licence" subtitle="DinePOS runs on a licence key issued for this PC. Without a valid key, a new business day cannot start." />
      <div className={`mb-6 flex items-start gap-3 rounded-xl border-2 p-4 ${good ? 'border-ok' : 'border-danger'}`} data-testid="licence-status">
        {good ? <ShieldCheck className="mt-0.5 h-6 w-6 shrink-0 text-ok" /> : <ShieldAlert className="mt-0.5 h-6 w-6 shrink-0 text-danger" />}
        <div className="flex-1">
          <p className="font-semibold">{STATE_TEXT[l.state]}</p>
          <p className="text-sm">{l.message}</p>
          {l.licensee && l.state !== 'ok' ? (
            <p className="mt-1 text-sm text-muted-foreground">
              {l.licensee} · until {l.expiresAt?.slice(0, 10)}
            </p>
          ) : null}
        </div>
        {l.seats ? (
          <ul className="w-56 space-y-0.5 text-sm" aria-label="Seats">
            {seat('terminals', 'Billing terminals (this PC included)')}
            {seat('captains', 'Captain phones')}
            {seat('kds', 'Kitchen screens')}
          </ul>
        ) : null}
      </div>

      <p className="mb-1 text-sm font-semibold">This PC’s hardware id</p>
      <div className="mb-6 flex items-center gap-2">
        <code className="rounded-lg border border-border bg-card px-3 py-2 font-mono text-lg tracking-wider" data-testid="hardware-id">
          {l.hardwareId}
        </code>
        <button
          className="btn h-10"
          onClick={() => {
            void navigator.clipboard
              ?.writeText(l.hardwareId)
              .then(() => setCopied(true))
              .catch(() => undefined);
          }}
        >
          <Copy className="h-4 w-4" /> {copied ? 'Copied' : 'Copy'}
        </button>
        <span className="text-sm text-muted-foreground">Send this to your DinePOS supplier to get or renew a key.</span>
      </div>

      {l.enforced ? (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            setInstalled(null);
            void save('InstallLicence', { key: key.trim() }).then(async (ok) => {
              if (!ok) return;
              setKey('');
              setInstalled('Licence installed.');
              await info.refetch();
            });
          }}
        >
          <label className="block text-sm font-semibold">
            Licence key
            <textarea
              className="input mt-1 h-28 resize-y py-2 font-mono text-xs"
              placeholder="Paste the whole key you were sent"
              value={key}
              onChange={(e) => setKey(e.target.value)}
              aria-label="Licence key"
              spellCheck={false}
            />
          </label>
          <ErrorText error={error} />
          {installed ? <p className="mt-2 text-sm font-semibold text-ok">{installed}</p> : null}
          <button type="submit" className="btn btn-primary mt-3" disabled={busy || key.trim().length < 40}>
            <KeyRound className="h-4 w-4" /> Install key
          </button>
        </form>
      ) : (
        <p className="text-sm text-muted-foreground">This is a development run: licence keys are not checked. The installed server always checks them.</p>
      )}
    </div>
  );
}
