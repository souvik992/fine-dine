import { useQuery } from '@tanstack/react-query';
import { ShieldAlert } from 'lucide-react';
import { useApp } from '../app-context.js';

interface HealthLicence {
  state: string;
  canOpenDay: boolean;
  message: string;
  daysLeft?: number;
}

/** States that need the owner's attention (P2-09): ending soon, grace, ended, missing or not valid here. */
export const WARN_STATES = new Set(['expiring', 'grace', 'expired', 'none', 'invalid']);

/**
 * The licence warning on every screen, the sign-in screen included (from /v1/health, which needs no sign-in). Amber
 * while billing still works, red when no new business day can start.
 */
export function LicenceBanner({ onOpen }: { onOpen?: () => void }) {
  const { api } = useApp();
  const health = useQuery({ queryKey: ['health'], queryFn: () => api.get<{ licence?: HealthLicence }>('/v1/health'), refetchInterval: 5 * 60_000 });
  const l = health.data?.licence;
  if (!l || !WARN_STATES.has(l.state)) return null;
  return (
    <div
      role="alert"
      className={`fixed bottom-4 right-4 z-50 flex max-w-md items-start gap-2 rounded-xl px-4 py-3 text-sm font-semibold shadow-lg ${l.canOpenDay ? 'bg-warn text-black' : 'bg-danger text-white'}`}
      data-testid="licence-banner"
    >
      <ShieldAlert className="mt-0.5 h-5 w-5 shrink-0" />
      <span className="flex-1">{l.message}</span>
      {onOpen ? (
        <button className="shrink-0 rounded-md bg-black/15 px-2 py-0.5 underline-offset-2 hover:underline" onClick={onOpen}>
          Licence
        </button>
      ) : null}
    </div>
  );
}
