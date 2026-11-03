import { formatINR, type FloorSnapshot, type FloorTable } from '@dinepos/shared';
import { useQuery } from '@tanstack/react-query';
import { Clock, Lock, Minus, Plus, TriangleAlert, Users, WifiOff } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useApp } from '../app-context.js';
import { Sheet } from '../components/Sheet.js';
import { floorWithPending, waitingByTable } from '../offline/pending-model.js';
import { useSync } from '../offline/sync-context.js';
import { elapsedText, STATE_CLASS, STATE_LABEL, stateCounts, tablesOf } from '../tables-model.js';
import { AttentionSheet } from './AttentionSheet.js';
import { OrderScreen } from './OrderScreen.js';

/**
 * My tables (docs/09 Captain): area tabs, live table states; a free table is seated, an occupied one opens its order.
 * Offline (P3-03): the last floor stays on screen, tables seated on this phone show as seated, and the header counts
 * what is waiting to be sent and what needs attention.
 */
export function TablesScreen() {
  const { session, signOut, stream, can } = useApp();
  const sync = useSync();
  const floor = useQuery({ queryKey: ['floor'], queryFn: () => sync.cachedGet<FloorSnapshot>('/v1/floor'), refetchInterval: 60_000 });
  const [areaId, setAreaId] = useState<string | null>(null);
  const [picked, setPicked] = useState<FloorTable | null>(null);
  const [open, setOpen] = useState<{ orderId: string; areaId: string | null } | null>(null);
  const [attentionOpen, setAttentionOpen] = useState(false);
  const data = useMemo(() => (floor.data ? floorWithPending(floor.data, sync.entries) : undefined), [floor.data, sync.entries]);
  const waiting = useMemo(() => waitingByTable(sync.entries), [sync.entries]);
  const area = areaId ?? data?.areas[0]?.id ?? null;
  const tables = data ? tablesOf(data, area) : [];
  const queued = sync.entries.filter((e) => e.status === 'queued').length;
  const attention = sync.entries.length - queued;

  const attentionSheet = attentionOpen ? <AttentionSheet floor={data} onClose={() => setAttentionOpen(false)} /> : null;
  if (open)
    return (
      <>
        <OrderScreen orderId={open.orderId} areaId={open.areaId} onBack={() => setOpen(null)} onAttention={() => setAttentionOpen(true)} />
        {attentionSheet}
      </>
    );

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
          <WifiOff className="h-4 w-4 shrink-0" /> {stream === 'offline' ? 'Offline: orders are kept on this phone and sent when the connection is back.' : 'Connecting…'}
        </p>
      ) : null}
      {attention ? (
        <button className="flex items-center gap-2 bg-danger px-4 py-2 text-left font-semibold text-white" onClick={() => setAttentionOpen(true)}>
          <TriangleAlert className="h-5 w-5 shrink-0" /> {attention} need{attention === 1 ? 's' : ''} attention
        </button>
      ) : null}
      {queued ? (
        <p role="status" className="flex items-center gap-2 bg-secondary px-4 py-2 text-sm font-semibold" data-testid="waiting-count">
          <Clock className="h-4 w-4 shrink-0" /> {queued} change{queued === 1 ? '' : 's'} waiting to send
        </p>
      ) : null}
      {!sync.durable ? (
        <p role="status" className="bg-warn/30 px-4 py-2 text-sm">This browser does not let the app keep data. Do not close it while changes are waiting.</p>
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
          {tables.map((t) => {
            const w = waiting.get(t.id);
            return (
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
                  {w ? (
                    <span className={`flex items-center gap-1 text-xs font-bold ${w.attention ? 'text-danger' : ''}`} data-testid="table-waiting">
                      {w.attention ? <TriangleAlert className="h-3 w-3" /> : <Clock className="h-3 w-3" />}
                      {w.attention ? 'needs attention' : `${w.waiting} waiting`}
                    </span>
                  ) : t.orderId ? (
                    <span className="flex justify-between text-xs">
                      <span>{elapsedText(t.elapsedMin)}</span>
                      <span className="tabular-nums">{t.amountPaise ? formatINR(t.amountPaise) : ''}</span>
                    </span>
                  ) : null}
                </button>
              </li>
            );
          })}
        </ul>
        {data && tables.length === 0 ? <p className="mt-10 text-center text-muted-foreground">No tables in this area.</p> : null}
        {floor.error && !data ? <p className="mt-10 text-center text-muted-foreground">Cannot reach the outlet server, and no tables are saved on this phone yet.</p> : null}
      </main>

      {picked ? (
        can('order.create') ? (
          <SeatSheet
            table={picked}
            onClose={() => setPicked(null)}
            onSeat={(covers) => {
              const orderId = sync.openTable(picked, covers);
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
      {attentionSheet}
    </div>
  );
}

function SeatSheet({ table, onClose, onSeat }: { table: FloorTable; onClose: () => void; onSeat: (covers: number) => void }) {
  const [covers, setCovers] = useState(Math.min(table.seats ?? 2, 2));
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
      <button className="btn btn-primary w-full" onClick={() => onSeat(covers)}>
        Seat {covers} guest{covers === 1 ? '' : 's'}
      </button>
    </Sheet>
  );
}
