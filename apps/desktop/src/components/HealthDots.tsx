import { useQuery } from '@tanstack/react-query';
import { useApp } from '../app-context.js';

interface PrinterInfo {
  id: string;
  name: string;
  status: 'ok' | 'retrying' | 'offline';
  queued: number;
  lastError?: string;
}

/**
 * Server-link and printer health (docs/09 top bar). Each dot also has a text label. `onBar`: as light pills on the
 * brand-coloured top bar; `brief` (phones): the link, plus printers or backup only when something is wrong.
 */
export function HealthDots({ onBar = false, brief = false }: { onBar?: boolean; brief?: boolean } = {}) {
  const { api, streamStatus } = useApp();
  const printers = useQuery({
    queryKey: ['printers'],
    queryFn: () => api.get<{ printers: PrinterInfo[] }>('/v1/printers'),
    refetchInterval: 60_000,
  });
  const bad = printers.data?.printers.filter((p) => p.status !== 'ok') ?? [];
  // P2-08: warn when the last backup is over an hour old or failed (shown only when the server reports it).
  const health = useQuery({ queryKey: ['health'], queryFn: () => api.get<{ backup?: { ok: boolean; ageMin: number | null; error: string | null } }>('/v1/health'), refetchInterval: 5 * 60_000 });
  const backup = health.data?.backup;
  const link = { live: ['bg-ok', 'Live'], connecting: ['bg-warn', 'Connecting'], offline: ['bg-danger', 'Offline'] }[streamStatus];
  const printerTitle = bad.length ? bad.map((p) => `${p.name}: ${p.lastError ?? p.status}`).join('\n') : 'All printers OK';

  const printersBad = printers.isError || bad.length > 0;
  const item = onBar ? 'flex h-7 items-center gap-1.5 whitespace-nowrap rounded-full bg-card px-2.5 text-foreground shadow-sm' : 'flex items-center gap-1.5';
  return (
    <div className={`flex items-center text-xs font-semibold ${onBar ? 'gap-1.5' : 'gap-4 text-muted-foreground'}`}>
      <span className={item} data-testid="link-status" title="Connection to the outlet server">
        <span className={`dot ${link[0]}`} aria-hidden /> {link[1]}
      </span>
      <span className={`${item} ${brief && !printersBad ? 'hidden' : ''}`} title={printerTitle}>
        <span className={`dot ${printers.isError ? 'bg-muted-foreground' : bad.length ? 'bg-danger' : 'bg-ok'}`} aria-hidden />
        {printers.isError ? 'Printers ?' : bad.length ? `${bad.length} printer${bad.length > 1 ? 's' : ''} down` : 'Printers OK'}
      </span>
      {backup && !backup.ok ? (
        <span className={`${item} text-danger`} title={backup.error ?? 'No backup in the last hour. Check Settings, Backups.'} data-testid="backup-warning">
          <span className="dot bg-danger" aria-hidden /> {backup.ageMin === null ? 'No backup yet' : 'Backup late'}
        </span>
      ) : null}
    </div>
  );
}
