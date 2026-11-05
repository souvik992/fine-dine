import type { AddonInfo } from '@dinepos/shared';
import { useQuery } from '@tanstack/react-query';
import { CircleCheck, CircleOff, Puzzle } from 'lucide-react';
import { useApp } from '../app-context.js';
import { SectionHeader } from './common.js';

/**
 * Settings › Add-ons (P5-01): the signed add-ons installed on the main PC and whether each is on. One that is off says
 * why (not signed by DinePOS, changed, too new for this DinePOS, an older version…); billing always works without it.
 * Add-ons are installed and removed with their own Windows installer, never from here.
 */
export function AddonsSettings() {
  const { api } = useApp();
  const list = useQuery({ queryKey: ['addons'], queryFn: () => api.get<{ addons: AddonInfo[] }>('/v1/addons') });
  const addons = list.data?.addons ?? [];
  return (
    <section className="max-w-3xl">
      <SectionHeader title="Add-ons" subtitle="Extra modules installed on the main PC with their own installer. Each is checked (signed by DinePOS, unchanged) every time DinePOS starts." />
      {list.isLoading ? <p className="text-muted-foreground">Loading…</p> : null}
      {list.data && addons.length === 0 ? (
        <p className="rounded-xl border border-dashed border-border p-6 text-center text-muted-foreground">
          <Puzzle className="mx-auto mb-2 h-6 w-6" />
          No add-ons installed. Run an add-on’s installer (for example DinePOS-TableQR-Setup.exe) on the main PC, then restart DinePOS.
        </p>
      ) : null}
      <ul className="space-y-2">
        {addons.map((a) => (
          <li key={a.id} className="rounded-xl border border-border bg-card p-4" data-addon={a.id}>
            <div className="flex items-center gap-3">
              {a.status === 'on' ? <CircleCheck className="h-5 w-5 text-ok" /> : <CircleOff className="h-5 w-5 text-danger" />}
              <p className="font-semibold">{a.name}</p>
              <span className="text-sm text-muted-foreground">{a.version !== '0.0.0' ? `v${a.version}` : ''}</span>
              <span className={`ml-auto rounded-full px-2.5 py-0.5 text-xs font-bold ${a.status === 'on' ? 'bg-ok/15 text-ok' : 'bg-danger/15 text-danger'}`}>{a.status === 'on' ? 'On' : 'Off'}</span>
            </div>
            {a.description ? <p className="mt-1 text-sm text-muted-foreground">{a.description}</p> : null}
            {a.error ? <p className="mt-2 text-sm text-danger" role="alert">Switched off: {a.error}</p> : null}
          </li>
        ))}
      </ul>
    </section>
  );
}
