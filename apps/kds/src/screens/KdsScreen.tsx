import { ApiError } from '@dinepos/client';
import type { KdsBoard, KdsTicket, KdsTicketLine } from '@dinepos/shared';
import { useShell } from '@dinepos/web-shell';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeftRight, Check, RotateCcw, Users, UtensilsCrossed, WifiOff } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { ageLevel, ageSeconds, ageText, allDay, bumpTargets, byCourse, columns, KIND_LABEL, type Card } from '../kds-model.js';

const kotText = (n: number) => `KOT ${String(n).padStart(4, '0')}`;
type Action = 'ready' | 'served' | 'recall';
const COMMAND: Record<Action, string> = { ready: 'MarkKotReady', served: 'MarkKotServed', recall: 'RecallKot' };

/** A short two-note chime when a new ticket arrives (kitchens are loud; the screen may be behind the cook). */
function chime(): void {
  try {
    const ctx = new window.AudioContext();
    [880, 1320].forEach((hz, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.frequency.value = hz;
      gain.gain.setValueAtTime(0.0001, ctx.currentTime + i * 0.18);
      gain.gain.exponentialRampToValueAtTime(0.25, ctx.currentTime + i * 0.18 + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + i * 0.18 + 0.16);
      osc.connect(gain).connect(ctx.destination);
      osc.start(ctx.currentTime + i * 0.18);
      osc.stop(ctx.currentTime + i * 0.18 + 0.18);
    });
    setTimeout(() => void ctx.close(), 800);
  } catch {
    // No audio on this device.
  }
}

function Lines({ lines }: { lines: readonly KdsTicketLine[] }) {
  return (
    <>
      {byCourse(lines).map((g, _i, all) => (
        <div key={g.course}>
          {all.length > 1 ? <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground">Course {g.course}</p> : null}
          <ul>
            {g.lines.map((l, i) => (
              <li key={i} className="py-0.5">
                <p className="text-lg leading-snug">
                  <span className="mr-2 inline-block min-w-8 font-bold tabular-nums">{l.qty}</span>
                  <span className={l.qty < 0 ? 'line-through decoration-2' : 'font-semibold'}>{l.name}</span>
                  {l.nowQty !== undefined && l.nowQty !== null ? <span className="ml-2 text-sm font-bold">now {l.nowQty}</span> : null}
                </p>
                {l.addons.map((a) => (
                  <p key={a.name} className="pl-10 text-sm text-muted-foreground">
                    + {a.qty > 1 ? `${a.qty} × ` : ''}
                    {a.name}
                  </p>
                ))}
                {l.note ? <p className="pl-10 text-sm font-bold text-warn">! {l.note}</p> : null}
              </li>
            ))}
          </ul>
        </div>
      ))}
    </>
  );
}

/** A change slip on its own card, or attached to the ticket it changes (docs/06). */
function Slip({ slip }: { slip: KdsTicket }) {
  return (
    <div className={`border-t-2 px-3 py-2 ${slip.kind === 'cancel' ? 'border-danger bg-danger/20' : 'border-warn bg-warn/15'}`} data-slip={slip.kotNo}>
      <p className={`text-sm font-black tracking-wide ${slip.kind === 'cancel' ? 'text-danger' : 'text-warn'}`}>
        {KIND_LABEL[slip.kind]} · {kotText(slip.kotNo)}
      </p>
      <Lines lines={slip.lines} />
      {slip.reason ? <p className="text-sm italic text-muted-foreground">Reason: {slip.reason}</p> : null}
    </div>
  );
}

/**
 * The kitchen screen (docs/06, docs/09 KDS): this station's tickets in two columns, New and Ready, each with its age
 * (amber and red at the outlet's thresholds) and an all-day count of what is still to cook. Change slips sit on the
 * ticket they change. Tap Ready when cooked, Served when it has gone out; a mistaken bump can be undone. The screen
 * works on its pairing alone (no sign-in): it may bump tickets and nothing else.
 */
export function KdsScreen({ stationId, onChangeStation }: { stationId: string; onChangeStation: () => void }) {
  const { api, stream } = useShell();
  const qc = useQueryClient();
  const board = useQuery({ queryKey: ['board', stationId], queryFn: () => api.get<KdsBoard>(`/v1/kds/tickets?stationId=${stationId}`), refetchInterval: 30_000 });
  const [now, setNow] = useState(() => Date.now());
  const [offset, setOffset] = useState(0);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<{ text: string; undo?: KdsTicket[]; error?: boolean } | null>(null);
  const known = useRef<Set<string> | null>(null);

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  useEffect(() => {
    if (!board.data) return;
    setOffset(Date.parse(board.data.serverTime) - Date.now());
    const ids = new Set(board.data.tickets.map((t) => t.id));
    if (known.current && [...ids].some((id) => !known.current!.has(id))) chime();
    known.current = ids;
  }, [board.data]);
  useEffect(() => {
    if (!message) return;
    const t = setTimeout(() => setMessage(null), message.undo ? 10_000 : 5_000);
    return () => clearTimeout(t);
  }, [message]);

  /** One bump acts on the card's ticket and its slips, one command each. */
  const run = async (action: Action, targets: KdsTicket[], key: string) => {
    setBusy(key);
    try {
      for (const t of targets) await api.command(COMMAND[action], { kotId: t.id });
      const first = targets[0]!;
      if (action === 'served') setMessage({ text: `${kotText(first.kotNo)} served.`, undo: targets });
      else if (action === 'recall') setMessage({ text: `${kotText(first.kotNo)} is back in New.` });
      else setMessage(null);
    } catch (e) {
      setMessage({ text: e instanceof ApiError ? e.message : 'Cannot reach the outlet server.', error: true });
    } finally {
      setBusy(null);
      await qc.invalidateQueries({ queryKey: ['board', stationId] });
    }
  };

  if (board.isError && !board.data) {
    return (
      <main className="flex min-h-full flex-col items-center justify-center gap-4 p-6 text-center">
        <p className="text-lg font-semibold">{board.error instanceof ApiError ? board.error.message : 'Cannot reach the outlet server.'}</p>
        <button className="btn" onClick={onChangeStation}>
          <ArrowLeftRight className="h-5 w-5" /> Choose another station
        </button>
      </main>
    );
  }
  const data = board.data;
  const { fresh, ready } = columns(data?.tickets ?? []);
  const counts = allDay(data?.tickets ?? []);
  const clock = new Date(now + offset).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });

  const card = (c: Card) => {
    const t = c.ticket;
    const seconds = ageSeconds(t, t.readyAt ? Date.parse(t.readyAt) - offset : now, offset);
    const level = ageLevel(seconds, data!);
    const isSlip = t.kind === 'modify' || t.kind === 'cancel';
    const band = KIND_LABEL[t.kind];
    return (
      <li key={t.id} className="ticket" data-kot={t.kotNo} data-level={level} aria-label={`${kotText(t.kotNo)}, ${t.tableLabel ? `table ${t.tableLabel}` : 'takeaway'}, ${ageText(seconds)}`}>
        <div className="ticket-head flex items-start justify-between gap-2 px-3 py-2">
          <div>
            <p className="text-2xl font-bold leading-tight">{t.tableLabel ?? 'Takeaway'}</p>
            <p className="text-sm text-muted-foreground">
              {kotText(t.kotNo)}
              {t.covers ? (
                <span className="ml-2 inline-flex items-center gap-0.5">
                  <Users className="h-3.5 w-3.5" /> {t.covers}
                </span>
              ) : null}
              {t.captainName ? <span className="ml-2">{t.captainName}</span> : null}
            </p>
          </div>
          <p className="text-right font-mono text-2xl font-bold tabular-nums" data-testid="age">
            {ageText(seconds)}
            {level !== 'ok' ? <span className="block font-sans text-xs font-bold uppercase">{level === 'red' ? 'Late' : 'Waiting'}</span> : null}
          </p>
        </div>
        {band && !isSlip ? <p className="bg-warn px-3 py-1 text-sm font-black tracking-wide text-black">{band}</p> : null}
        {isSlip ? (
          <Slip slip={t} />
        ) : (
          <div className="flex-1 space-y-2 px-3 py-2">
            {t.notice ? <p className="text-lg font-bold">{t.notice}</p> : null}
            <Lines lines={t.lines} />
          </div>
        )}
        {c.slips.map((s) => (
          <Slip key={s.id} slip={s} />
        ))}
        {t.readyAt ? (
          <div className="flex gap-2 p-2">
            <button className="btn h-12 w-14 shrink-0 px-0" onClick={() => void run('recall', bumpTargets(c, 'recall'), t.id)} disabled={busy === t.id} aria-label={`Back to New: ${kotText(t.kotNo)}`}>
              <RotateCcw className="h-5 w-5" />
            </button>
            <button className="btn btn-primary h-12 flex-1 text-lg" onClick={() => void run('served', bumpTargets(c, 'served'), t.id)} disabled={busy === t.id}>
              <UtensilsCrossed className="h-5 w-5" /> Served
            </button>
          </div>
        ) : (
          <button className="btn btn-primary m-2 h-14 text-lg" onClick={() => void run('ready', bumpTargets(c, 'ready'), t.id)} disabled={busy === t.id}>
            <Check className="h-6 w-6" /> {isSlip ? 'Seen' : 'Ready'}
          </button>
        )}
      </li>
    );
  };

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center gap-3 border-b border-border px-4 py-2">
        <h1 className="font-display text-2xl font-semibold">{data?.station.name ?? 'Kitchen'}</h1>
        <span className="font-mono text-xl tabular-nums">{clock}</span>
        <span className="text-sm text-muted-foreground">
          {fresh.length} to cook · {ready.length} ready
        </span>
        {data?.today ? (
          <span className="flex items-center gap-3 rounded-full border border-border px-3 py-1 text-sm" aria-label={`Today: ${data.today.served} served${data.today.avgReadySec !== null ? `, average ${ageText(data.today.avgReadySec)} to ready` : ''}`}>
            <span className="flex items-center gap-1 font-bold" data-testid="served-today">
              <UtensilsCrossed className="h-4 w-4" /> Served today {data.today.served}
            </span>
            {data.today.avgReadySec !== null ? (
              <span className="text-muted-foreground" data-testid="avg-ready">
                Avg to ready <span className="font-mono font-bold tabular-nums text-foreground">{ageText(data.today.avgReadySec)}</span>
              </span>
            ) : null}
            {data.today.late ? <span className="font-bold text-warn">{data.today.late} late</span> : null}
          </span>
        ) : null}
        {stream !== 'live' ? (
          <span role="status" className="flex items-center gap-1 rounded-full bg-warn px-3 py-1 text-sm font-bold text-black">
            <WifiOff className="h-4 w-4" /> Offline: new tickets may be missing
          </span>
        ) : null}
        <button className="btn ml-auto h-10" onClick={onChangeStation}>
          <ArrowLeftRight className="h-4 w-4" /> Station
        </button>
      </header>

      <div className="grid min-h-0 flex-1 grid-cols-[1fr_minmax(260px,24%)_minmax(200px,16%)]">
        <section aria-label="New" className="min-h-0 overflow-y-auto p-3">
          <h2 className="mb-2 text-sm font-bold uppercase tracking-wide text-muted-foreground">New · {fresh.length}</h2>
          <ul className="grid grid-cols-[repeat(auto-fill,minmax(250px,1fr))] items-start gap-3">{fresh.map(card)}</ul>
          {data && fresh.length === 0 ? <p className="mt-16 text-center text-xl text-muted-foreground">Nothing to cook. Tickets appear here as soon as they are sent.</p> : null}
        </section>
        <section aria-label="Ready" className="min-h-0 overflow-y-auto border-l border-border bg-black/15 p-3">
          <h2 className="mb-2 text-sm font-bold uppercase tracking-wide text-muted-foreground">Ready · {ready.length}</h2>
          <ul className="flex flex-col gap-3">{ready.map(card)}</ul>
        </section>
        <aside aria-label="All day" className="min-h-0 overflow-y-auto border-l border-border p-3">
          <h2 className="mb-2 text-sm font-bold uppercase tracking-wide text-muted-foreground">All day</h2>
          <ul className="space-y-1">
            {counts.map((c) => (
              <li key={c.name} className="flex justify-between gap-2 text-lg" data-all-day={c.name}>
                <span className="truncate">{c.name}</span>
                <span className="font-bold tabular-nums">{c.qty}</span>
              </li>
            ))}
          </ul>
          {data && counts.length === 0 ? <p className="text-muted-foreground">—</p> : null}
        </aside>
      </div>

      {message ? (
        <div role={message.error ? 'alert' : 'status'} className={`fixed bottom-4 left-1/2 flex -translate-x-1/2 items-center gap-3 rounded-full px-5 py-3 text-lg font-semibold shadow-xl ${message.error ? 'bg-danger text-white' : 'bg-foreground text-background'}`}>
          {message.text}
          {message.undo ? (
            <button className="rounded-full bg-background px-4 py-1 text-foreground" onClick={() => void run('recall', message.undo!, message.undo![0]!.id)}>
              Undo
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
