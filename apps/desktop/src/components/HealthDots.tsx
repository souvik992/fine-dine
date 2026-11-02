import { useQuery } from '@tanstack/react-query';
import { useApp } from '../app-context.js';

interface PrinterInfo {
  id: string;
  name: string;
  status: 'ok' | 'retrying' | 'offline';
  queued: number;
  lastError?: string;
}

/** Server-link and printer health (docs/09 top bar). Each dot also has a text label. */
export function HealthDots() {
  const { api, streamStatus } = useApp();
  const printers = useQuery({
    queryKey: ['printers'],
    queryFn: () => api.get<{ printers: PrinterInfo[] }>('/v1/printers'),
    refetchInterval: 60_000,
  });
  const bad = printers.data?.printers.filter((p) => p.status !== 'ok') ?? [];
  const link = { live: ['bg-ok', 'Live'], connecting: ['bg-warn', 'Connecting'], offline: ['bg-danger', 'Offline'] }[streamStatus];
  const printerTitle = bad.length ? bad.map((p) => `${p.name}: ${p.lastError ?? p.status}`).join('\n') : 'All printers OK';

  return (
    <div className="flex items-center gap-4 text-xs font-semibold text-muted-foreground">
      <span className="flex items-center gap-1.5" data-testid="link-status" title="Connection to the outlet server">
        <span className={`dot ${link[0]}`} aria-hidden /> {link[1]}
      </span>
      <span className="flex items-center gap-1.5" title={printerTitle}>
        <span className={`dot ${printers.isError ? 'bg-muted-foreground' : bad.length ? 'bg-danger' : 'bg-ok'}`} aria-hidden />
        {printers.isError ? 'Printers ?' : bad.length ? `${bad.length} printer${bad.length > 1 ? 's' : ''} down` : 'Printers OK'}
      </span>
    </div>
  );
}
