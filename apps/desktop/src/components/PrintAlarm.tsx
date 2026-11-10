import type { FailedPrintJob } from '@dinepos/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { RotateCw, TriangleAlert, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { ApiError } from '../api/client.js';
import { useApp } from '../app-context.js';

const RING_EVERY_MS = 4_000;

let ctx: AudioContext | null = null;
/** Low-high pulses: not the online-order chime, so staff can tell a printer problem apart. */
function alarm(): void {
  try {
    ctx ??= new window.AudioContext();
    if (ctx.state === 'suspended') void ctx.resume();
    const a = ctx;
    [523, 1047, 523, 1047].forEach((hz, i) => {
      const osc = a.createOscillator();
      const gain = a.createGain();
      osc.type = 'square';
      osc.frequency.value = hz;
      const s = a.currentTime + i * 0.22;
      gain.gain.setValueAtTime(0.0001, s);
      gain.gain.exponentialRampToValueAtTime(0.25, s + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.0001, s + 0.2);
      osc.connect(gain).connect(a.destination);
      osc.start(s);
      osc.stop(s + 0.21);
    });
  } catch {
    // no audio
  }
}

/**
 * The print alarm, on every screen: a KOT or bill that did not print after the print queue's retries shows a red card
 * ("KOT 0012 · Table T4 did not print on Kitchen printer") and an alarm sounds every 4 s until staff send it again
 * (RetryPrintJobs) or dismiss it. Before, only "N printers down" in the top bar said so, and the kitchen never got the
 * order. Refreshed by the printers stream topic and every 10 s.
 */
export function PrintAlarm() {
  const { api, can } = useApp();
  const qc = useQueryClient();
  const allowed = can('kot.fire');
  const failed = useQuery({ queryKey: ['failed-prints'], queryFn: () => api.get<{ jobs: FailedPrintJob[] }>('/v1/print-jobs/failed'), refetchInterval: 10_000, enabled: allowed });
  const [dismissed, setDismissed] = useState<ReadonlySet<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const jobs = (failed.data?.jobs ?? []).filter((j) => !dismissed.has(j.id));
  const loud = allowed && jobs.length > 0;

  useEffect(() => {
    if (!loud) return;
    alarm();
    const t = setInterval(alarm, RING_EVERY_MS);
    return () => clearInterval(t);
  }, [loud]);

  if (!loud) return null;
  const first = jobs[0]!;
  const retry = async () => {
    setBusy(true);
    setError(null);
    try {
      await api.command('RetryPrintJobs', { jobIds: jobs.map((j) => j.id) });
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not reach the outlet server.');
    } finally {
      setBusy(false);
      await qc.invalidateQueries({ queryKey: ['failed-prints'] });
      await qc.invalidateQueries({ queryKey: ['printers'] });
    }
  };
  return (
    <div role="alert" aria-label="Printing failed" className="fixed bottom-4 left-1/2 z-50 flex w-[min(94vw,640px)] -translate-x-1/2 items-center gap-3 rounded-2xl border-2 border-danger bg-card p-3 shadow-2xl" data-testid="print-alarm">
      <span className="flex h-11 w-11 shrink-0 animate-pulse items-center justify-center rounded-full bg-danger text-white">
        <TriangleAlert className="h-6 w-6" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="font-bold">
          {first.label} did not print on {first.printerName}
          {jobs.length > 1 ? ` (+${jobs.length - 1} more)` : ''}
        </p>
        <p className="truncate text-xs text-muted-foreground" title={first.error ?? ''}>
          {error ?? `Check the printer is on, has paper and is connected, then retry. ${first.error ?? ''}`}
        </p>
      </div>
      <button className="btn btn-primary h-10 shrink-0" disabled={busy} onClick={() => void retry()}>
        <RotateCw className="h-4 w-4" /> Retry
      </button>
      <button className="btn h-10 shrink-0" onClick={() => setDismissed(new Set([...dismissed, ...jobs.map((j) => j.id)]))} aria-label="Dismiss the print alarm">
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}
