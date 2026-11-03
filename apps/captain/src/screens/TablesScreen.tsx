import { ApiError } from '@dinepos/client';
import { formatINR, type FloorSnapshot, type FloorTable } from '@dinepos/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Lock, Minus, Plus, Users, WifiOff } from 'lucide-react';
import { useState } from 'react';
import { useApp } from '../app-context.js';
import { Sheet } from '../components/Sheet.js';
import { elapsedText, STATE_CLASS, STATE_LABEL, stateCounts, tablesOf } from '../tables-model.js';
import { OrderScreen } from './OrderScreen.js';

/** My tables (docs/09 Captain): area tabs, live table states; a free table is seated, an occupied one opens its order. */
export function TablesScreen() {
  const { api, session, signOut, stream, can } = useApp();
  const floor = useQuery({ queryKey: ['floor'], queryFn: () => api.get<FloorSnapshot>('/v1/floor'), refetchInterval: 60_000 });
  const [areaId, setAreaId] = useState<string | null>(null);
  const [picked, setPicked] = useState<FloorTable | null>(null);
  const [open, setOpen] = useState<{ orderId: string; areaId: string | null } | null>(null);
  const data = floor.data;
  const area = areaId ?? data?.areas[0]?.id ?? null;
  const tables = data ? tablesOf(data, area) : [];

  if (open) return <OrderScreen orderId={open.orderId} areaId={open.areaId} onBack={() => setOpen(null)} />;

  const pick = (t: FloorTable) => (t.orderId ? setOpen({ orderId: t.orderId, areaId: t.areaId }) : setPicked(t));
  return (
    <div className="flex min-h-full flex-col">
      <header className="sticky top-0 z-10 border-b border-border bg-card px-4 pb-2 pt-3">
        <div className="flex items-center gap-2">
          <h1 className="font-display text-xl font-semibold">Tables</h1>
          <span className="ml-auto text-right text-sm leading-tight">
            {session?.user.name}
            <span className="block text-xs text-muted-foreground">{session?.user.roleName}</span>
          </span>
          <button className="btn h-10 w-10 px-0" onClick={signOut} aria-label="Lock">
            <Lock className="h-5 w-5" />
          </button>
        </div>
        <nav role="tablist" aria-label="Areas" className="no-scrollbar -mx-1 mt-2 flex gap-1 overflow-x-auto px-1">
          {data?.areas.map((a) => (
            <button key={a.id} role="tab" className="tab" aria-selected={a.id === area} onClick={() => setAreaId(a.id)}>
              {a.name}
            </button>
          ))}
        </nav>
      </header>
      {stream !== 'live' ? (
        <p role="status" className="flex items-center gap-2 bg-warn/30 px-4 py-2 text-sm font-semibold">
          <WifiOff className="h-4 w-4" /> {stream === 'offline' ? 'Offline: reconnecting to the outlet server…' : 'Connecting…'}
        </p>
      ) : null}

      <main className="flex-1 px-3 py-3">
        <div className="mb-3 flex flex-wrap gap-1.5">
          {stateCounts(tables).map(([s, n]) => (
            <span key={s} className="rounded-full border border-border bg-card px-2.5 py-0.5 text-xs font-semibold">
              {STATE_LABEL[s]}: {n}
            </span>
          ))}
        </div>
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3" aria-label="Tables">
          {tables.map((t) => (
            <li key={t.id}>
              <button className={`tile w-full ${STATE_CLASS[t.state]}`} data-table={t.label} data-state={t.state} disabled={t.state === 'BLOCKED'} onClick={() => pick(t)}>
                <span className="flex items-start justify-between">
                  <span className="font-display text-2xl font-bold">{t.label}</span>
                  {t.covers ? (
                    <span className="flex items-center gap-1 text-sm">
                      <Users className="h-4 w-4" /> {t.covers}
                    </span>
                  ) : t.seats ? (
                    <span className="text-xs opacity-70">{t.seats} seats</span>
                  ) : null}
                </span>
                <span className="text-sm font-semibold">{STATE_LABEL[t.state]}</span>
                {t.orderId ? (
                  <span className="flex justify-between text-xs">
                    <span>{elapsedText(t.elapsedMin)}</span>
                    <span className="tabular-nums">{t.amountPaise ? formatINR(t.amountPaise) : ''}</span>
                  </span>
                ) : null}
              </button>
            </li>
          ))}
        </ul>
        {data && tables.length === 0 ? <p className="mt-10 text-center text-muted-foreground">No tables in this area.</p> : null}
      </main>

      {picked ? (
        can('order.create') ? (
          <SeatSheet
            table={picked}
            onClose={() => setPicked(null)}
            onSeated={(orderId) => {
              setPicked(null);
              setOpen({ orderId, areaId: picked.areaId });
            }}
          />
        ) : (
          <Sheet title={`Table ${picked.label}`} onClose={() => setPicked(null)}>
            <p>Your role cannot seat tables.</p>
          </Sheet>
        )
      ) : null}
    </div>
  );
}

function SeatSheet({ table, onClose, onSeated }: { table: FloorTable; onClose: () => void; onSeated: (orderId: string) => void }) {
  const { api } = useApp();
  const qc = useQueryClient();
  const [covers, setCovers] = useState(Math.min(table.seats ?? 2, 2));
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const seat = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await api.command<{ orderId: string }>('OpenTable', { tableId: table.id, covers });
      void qc.invalidateQueries({ queryKey: ['floor'] });
      onSeated(res.result.orderId);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not seat the table.');
    } finally {
      setBusy(false);
    }
  };
  return (
    <Sheet title={`Seat ${table.label}`} onClose={onClose}>
      <p className="mb-2 font-semibold">Guests</p>
      <div className="mb-5 flex items-center justify-center gap-6">
        <button className="btn h-16 w-16 px-0" onClick={() => setCovers(Math.max(1, covers - 1))} aria-label="One guest fewer" disabled={covers <= 1}>
          <Minus className="h-6 w-6" />
        </button>
        <span className="w-16 text-center text-5xl font-bold tabular-nums" data-testid="covers">
          {covers}
        </span>
        <button className="btn h-16 w-16 px-0" onClick={() => setCovers(Math.min(99, covers + 1))} aria-label="One more guest">
          <Plus className="h-6 w-6" />
        </button>
      </div>
      {error ? (
        <p role="alert" className="mb-3 font-semibold text-danger">
          {error}
        </p>
      ) : null}
      <button className="btn btn-primary w-full" onClick={() => void seat()} disabled={busy}>
        Seat {covers} guest{covers === 1 ? '' : 's'}
      </button>
    </Sheet>
  );
}
