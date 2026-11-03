import { addDays, localDate, newId, type FloorSnapshot, type FloorTable, type Reservation, type ReservationDay, type Waitlist } from '@dinepos/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, CalendarPlus, Clock, Phone, Plus, UserPlus, Users } from 'lucide-react';
import { useState } from 'react';
import { ApiError } from '../api/client.js';
import { useApp } from '../app-context.js';
import { Modal } from '../components/Modal.js';
import { bookingTime } from '../floor/SeatDialog.js';
import { LOCAL_ZONE, STATUS_LABEL, toInstant, waitClass } from './bookings-model.js';

/**
 * Bookings and the waitlist (P4-04, docs/09): the day's bookings in time order (seat, change, cancel, no-show) and the
 * walk-ins waiting for a table (seat at a free table, or they left). A booking holds its tables from the outlet's hold
 * time; seating a walk-in on a held table asks first.
 */
export function BookingsScreen({ onBack, onOpenOrder }: { onBack: () => void; onOpenOrder: (orderId: string) => void }) {
  const { api, can } = useApp();
  const today = localDate(new Date(), LOCAL_ZONE);
  const [date, setDate] = useState(today);
  const day = useQuery({ queryKey: ['reservations', date], queryFn: () => api.get<ReservationDay>(`/v1/reservations?date=${date}`), refetchInterval: 60_000 });
  const waitlist = useQuery({ queryKey: ['waitlist'], queryFn: () => api.get<Waitlist>('/v1/waitlist'), refetchInterval: 30_000 });
  const floor = useQuery({ queryKey: ['floor'], queryFn: () => api.get<FloorSnapshot>('/v1/floor') });
  const [editing, setEditing] = useState<Reservation | 'new' | null>(null);
  const [seating, setSeating] = useState<{ kind: 'booking'; r: Reservation } | { kind: 'waitlist'; id: string; name: string; party: number } | null>(null);
  const [adding, setAdding] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const run = useRun(setMessage);
  const manage = can('reservation.manage');

  const booked = (day.data?.reservations ?? []).filter((r) => r.status === 'booked');
  const done = (day.data?.reservations ?? []).filter((r) => r.status !== 'booked');

  const row = (r: Reservation) => (
    <li key={r.id} className="flex items-start gap-4 px-4 py-3" data-booking={r.guestName}>
      <span className="w-16 shrink-0 text-xl font-bold tabular-nums">{bookingTime(r.startsAt)}</span>
      <span className="min-w-0 flex-1">
        <span className="font-semibold">{r.guestName}</span>
        <span className="ml-2 inline-flex items-center gap-1 text-sm text-muted-foreground">
          <Users className="h-3.5 w-3.5" /> {r.partySize}
        </span>
        {r.tables.length ? <span className="ml-2 text-sm font-semibold">{r.tables.map((t) => t.label).join(', ')}</span> : <span className="ml-2 text-sm text-muted-foreground">no table yet</span>}
        {r.late ? <span className="ml-2 rounded bg-danger px-1.5 py-0.5 text-xs font-bold text-white">Late</span> : null}
        {r.status !== 'booked' ? <span className="ml-2 rounded bg-secondary px-1.5 py-0.5 text-xs font-bold">{STATUS_LABEL[r.status]}</span> : null}
        <span className="block text-sm text-muted-foreground">
          {r.phone ? (
            <span className="mr-3 inline-flex items-center gap-1">
              <Phone className="h-3 w-3" /> {r.phone}
            </span>
          ) : null}
          {r.durationMin} min{r.note ? ` · ${r.note}` : ''}
          {r.createdByName ? ` · booked by ${r.createdByName}` : ''}
        </span>
      </span>
      {r.status === 'booked' ? (
        <span className="flex shrink-0 gap-1">
          {can('order.create') && date === today ? (
            <button className="btn btn-primary h-9" onClick={() => setSeating({ kind: 'booking', r })}>
              Seat
            </button>
          ) : null}
          {manage ? (
            <>
              <button className="btn h-9" onClick={() => setEditing(r)}>
                Change
              </button>
              {r.late ? (
                <button className="btn h-9" onClick={() => void run('CloseReservation', { reservationId: r.id, outcome: 'no_show' }, `${r.guestName}: no-show.`)}>
                  No-show
                </button>
              ) : null}
              <button className="btn h-9" onClick={() => void run('CloseReservation', { reservationId: r.id, outcome: 'cancelled' }, `${r.guestName}’s booking cancelled.`)}>
                Cancel
              </button>
            </>
          ) : null}
        </span>
      ) : r.orderId ? (
        <button className="btn h-9" onClick={() => onOpenOrder(r.orderId!)}>
          Open order
        </button>
      ) : null}
    </li>
  );

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center gap-3 border-b border-border bg-card px-4 py-2.5">
        <button className="btn" onClick={onBack}>
          <ArrowLeft className="h-4 w-4" /> Floor
        </button>
        <h1 className="font-display text-xl font-semibold">Bookings</h1>
        <nav className="ml-4 flex gap-1" aria-label="Day">
          {[
            [today, 'Today'],
            [addDays(today, 1), 'Tomorrow'],
          ].map(([d, label]) => (
            <button key={d} className="tab h-8" aria-selected={date === d} onClick={() => setDate(d!)}>
              {label}
            </button>
          ))}
          <input type="date" className="input h-8 w-40" value={date} onChange={(e) => e.target.value && setDate(e.target.value)} aria-label="Date" />
        </nav>
        {manage ? (
          <button className="btn btn-primary ml-auto" onClick={() => setEditing('new')}>
            <CalendarPlus className="h-4 w-4" /> New booking
          </button>
        ) : null}
      </header>

      {message ? (
        <p role="status" className="bg-secondary px-4 py-2 text-sm font-semibold" onClick={() => setMessage(null)}>
          {message}
        </p>
      ) : null}

      <div className="grid min-h-0 flex-1 grid-cols-[1fr_380px]">
        <section className="min-h-0 overflow-y-auto p-4" aria-label="Bookings of the day">
          <h2 className="mb-2 text-sm font-bold uppercase tracking-wide text-muted-foreground">
            To come · {booked.length}
            {day.data ? <span className="ml-2 font-normal normal-case">Tables are held from {day.data.holdMin} min before; late after {day.data.graceMin} min.</span> : null}
          </h2>
          <ul className="divide-y divide-border rounded-xl border border-border bg-card">{booked.map(row)}</ul>
          {day.data && booked.length === 0 ? <p className="rounded-xl border border-dashed border-border p-6 text-center text-muted-foreground">No bookings to come.</p> : null}
          {done.length ? (
            <>
              <h2 className="mb-2 mt-6 text-sm font-bold uppercase tracking-wide text-muted-foreground">Done · {done.length}</h2>
              <ul className="divide-y divide-border rounded-xl border border-border bg-card opacity-80">{done.map(row)}</ul>
            </>
          ) : null}
        </section>

        <aside className="min-h-0 overflow-y-auto border-l border-border bg-card p-4" aria-label="Waitlist">
          <div className="mb-2 flex items-center justify-between">
            <h2 className="text-sm font-bold uppercase tracking-wide text-muted-foreground">Waiting · {waitlist.data?.entries.length ?? 0}</h2>
            {manage ? (
              <button className="btn h-8" onClick={() => setAdding(true)}>
                <UserPlus className="h-4 w-4" /> Add
              </button>
            ) : null}
          </div>
          <ul className="space-y-2">
            {waitlist.data?.entries.map((e, i) => (
              <li key={e.id} className="rounded-lg border border-border p-3" data-waiting={e.guestName}>
                <p className="flex items-center justify-between">
                  <span className="font-semibold">
                    {i + 1}. {e.guestName}
                    <span className="ml-2 inline-flex items-center gap-1 text-sm font-normal text-muted-foreground">
                      <Users className="h-3.5 w-3.5" /> {e.partySize}
                    </span>
                  </span>
                  <span className={`flex items-center gap-1 text-sm font-semibold tabular-nums ${waitClass(e)}`}>
                    <Clock className="h-3.5 w-3.5" /> {e.waitedMin} min{e.quotedMin !== undefined ? ` / ${e.quotedMin}` : ''}
                  </span>
                </p>
                {e.phone || e.note ? <p className="text-sm text-muted-foreground">{[e.phone, e.note].filter(Boolean).join(' · ')}</p> : null}
                <div className="mt-2 flex gap-1">
                  {can('order.create') ? (
                    <button className="btn btn-primary h-8" onClick={() => setSeating({ kind: 'waitlist', id: e.id, name: e.guestName, party: e.partySize })}>
                      Seat
                    </button>
                  ) : null}
                  {manage ? (
                    <button className="btn h-8" onClick={() => void run('LeaveWaitlist', { entryId: e.id, outcome: 'left' }, `${e.guestName} left the waitlist.`)}>
                      Left
                    </button>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
          {waitlist.data && waitlist.data.entries.length === 0 ? <p className="text-sm text-muted-foreground">Nobody is waiting.</p> : null}
        </aside>
      </div>

      {editing ? <BookingDialog booking={editing === 'new' ? null : editing} date={date} floor={floor.data} onClose={() => setEditing(null)} /> : null}
      {adding ? <WaitlistDialog onClose={() => setAdding(false)} /> : null}
      {seating ? (
        <SeatPicker
          title={seating.kind === 'booking' ? `Seat ${seating.r.guestName} (${seating.r.partySize})` : `Seat ${seating.name} (${seating.party})`}
          suggested={seating.kind === 'booking' ? seating.r.tables.map((t) => t.id) : []}
          ownBookingId={seating.kind === 'booking' ? seating.r.id : null}
          floor={floor.data}
          onClose={() => setSeating(null)}
          onPick={async (t, anyway) => {
            const res =
              seating.kind === 'booking'
                ? await run('SeatReservation', { reservationId: seating.r.id, tableId: t.id })
                : await run('SeatFromWaitlist', { entryId: seating.id, tableId: t.id, ignoreReservation: anyway });
            if (res?.order) {
              setSeating(null);
              onOpenOrder(res.order.id);
            }
          }}
        />
      ) : null}
    </div>
  );
}

function useRun(setMessage: (m: string | null) => void) {
  const { api } = useApp();
  const qc = useQueryClient();
  return async (type: string, payload: unknown, done?: string) => {
    try {
      const res = await api.command(type, payload);
      if (done) setMessage(done);
      await Promise.all(['reservations', 'waitlist', 'floor'].map((k) => qc.invalidateQueries({ queryKey: [k] })));
      return res;
    } catch (e) {
      setMessage(e instanceof ApiError ? e.message : 'Could not save. Try again.');
      return null;
    }
  };
}

/** Free tables to seat at; tables held for another booking are marked and need a confirmation. */
function SeatPicker({
  title,
  suggested,
  ownBookingId,
  floor,
  onClose,
  onPick,
}: {
  title: string;
  suggested: string[];
  ownBookingId: string | null;
  floor: FloorSnapshot | undefined;
  onClose: () => void;
  onPick: (t: FloorTable, anyway: boolean) => Promise<void>;
}) {
  const [confirm, setConfirm] = useState<FloorTable | null>(null);
  const [busy, setBusy] = useState(false);
  const free = (floor?.tables ?? []).filter((t) => !t.orderId && t.state !== 'BLOCKED');
  const heldByOther = (t: FloorTable) => t.booking?.holding && t.booking.reservationId !== ownBookingId;
  const pick = async (t: FloorTable, anyway: boolean) => {
    setBusy(true);
    await onPick(t, anyway);
    setBusy(false);
  };
  return (
    <Modal title={title} onClose={onClose}>
      {confirm ? (
        <div>
          <p className="mb-4">
            Table {confirm.label} is held for <b>{confirm.booking!.guestName}</b> ({confirm.booking!.partySize}) at {bookingTime(confirm.booking!.startsAt)}. Seat here anyway? That
            booking will need another table.
          </p>
          <div className="flex justify-end gap-2">
            <button className="btn" onClick={() => setConfirm(null)}>
              Back
            </button>
            <button className="btn btn-primary" disabled={busy} onClick={() => void pick(confirm, true)}>
              Seat anyway
            </button>
          </div>
        </div>
      ) : (
        <>
          <p className="mb-3 text-sm text-muted-foreground">Free tables. {suggested.length ? 'The booked table is marked.' : ''}</p>
          <div className="grid grid-cols-4 gap-2" role="list" aria-label="Free tables">
            {free.map((t) => (
              <button
                key={t.id}
                role="listitem"
                className={`btn h-16 flex-col gap-0 ${suggested.includes(t.id) ? 'btn-primary' : ''}`}
                disabled={busy || (heldByOther(t) && ownBookingId !== null)}
                onClick={() => (heldByOther(t) ? setConfirm(t) : void pick(t, false))}
                aria-label={`Table ${t.label}`}
              >
                <span className="text-lg font-bold">{t.label}</span>
                <span className="text-xs font-normal">{heldByOther(t) ? `held ${bookingTime(t.booking!.startsAt)}` : t.seats ? `${t.seats} seats` : ''}</span>
              </button>
            ))}
          </div>
          {floor && free.length === 0 ? <p className="text-muted-foreground">No free table right now.</p> : null}
        </>
      )}
    </Modal>
  );
}

function BookingDialog({ booking, date, floor, onClose }: { booking: Reservation | null; date: string; floor: FloorSnapshot | undefined; onClose: () => void }) {
  const [message, setMessage] = useState<string | null>(null);
  const run = useRun(setMessage);
  const [name, setName] = useState(booking?.guestName ?? '');
  const [phone, setPhone] = useState(booking?.phone ?? '');
  const [party, setParty] = useState(booking?.partySize ?? 2);
  const [day, setDay] = useState(booking ? localDate(new Date(booking.startsAt), LOCAL_ZONE) : date);
  const [time, setTime] = useState(booking ? bookingTime(booking.startsAt) : '20:00');
  const [duration, setDuration] = useState(booking?.durationMin ?? 90);
  const [tables, setTables] = useState(new Set(booking?.tables.map((t) => t.id) ?? []));
  const [note, setNote] = useState(booking?.note ?? '');
  const [busy, setBusy] = useState(false);
  const flip = (id: string) =>
    setTables((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  return (
    <Modal title={booking ? `Change ${booking.guestName}’s booking` : 'New booking'} onClose={onClose} wide>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          setBusy(true);
          const fields = { guestName: name.trim(), phone: phone.trim() || null, partySize: party, startsAt: toInstant(day, time), durationMin: duration, tableIds: [...tables], note: note.trim() || null };
          void (booking ? run('UpdateReservation', { reservationId: booking.id, ...fields }) : run('CreateReservation', { id: newId(), ...fields })).then((res) => {
            setBusy(false);
            if (res) onClose();
          });
        }}
      >
        <div className="grid grid-cols-2 gap-3">
          <label className="block text-sm font-semibold">
            Guest name
            <input data-autofocus className="input mt-1" maxLength={60} value={name} onChange={(e) => setName(e.target.value)} aria-label="Guest name" />
          </label>
          <label className="block text-sm font-semibold">
            Phone
            <input className="input mt-1" inputMode="tel" maxLength={20} value={phone} onChange={(e) => setPhone(e.target.value)} aria-label="Phone" />
          </label>
          <label className="block text-sm font-semibold">
            Date
            <input type="date" className="input mt-1" value={day} onChange={(e) => setDay(e.target.value)} aria-label="Booking date" />
          </label>
          <label className="block text-sm font-semibold">
            Time
            <input type="time" className="input mt-1" step={900} value={time} onChange={(e) => setTime(e.target.value)} aria-label="Booking time" />
          </label>
          <label className="block text-sm font-semibold">
            Guests
            <input className="input mt-1" inputMode="numeric" value={party} onChange={(e) => setParty(Math.min(99, Math.max(1, Number(e.target.value.replace(/\D/g, '')) || 1)))} aria-label="Guests" />
          </label>
          <label className="block text-sm font-semibold">
            Table for
            <select className="input mt-1" value={duration} onChange={(e) => setDuration(Number(e.target.value))} aria-label="Duration">
              {[60, 90, 120, 150, 180].map((m) => (
                <option key={m} value={m}>
                  {m / 60 >= 1 ? `${Math.floor(m / 60)} h${m % 60 ? ` ${m % 60} min` : ''}` : `${m} min`}
                </option>
              ))}
            </select>
          </label>
        </div>
        <p className="mb-2 mt-4 text-sm font-semibold">Tables (optional; you can assign one later)</p>
        <div className="max-h-48 space-y-2 overflow-y-auto">
          {floor?.areas.map((a) => (
            <div key={a.id}>
              <p className="text-xs font-bold uppercase text-muted-foreground">{a.name}</p>
              <div className="mt-1 flex flex-wrap gap-1.5">
                {floor.tables
                  .filter((t) => t.areaId === a.id && t.state !== 'BLOCKED')
                  .map((t) => (
                    <button
                      type="button"
                      key={t.id}
                      role="checkbox"
                      aria-checked={tables.has(t.id)}
                      onClick={() => flip(t.id)}
                      className={`h-9 min-w-11 rounded-lg border-2 px-2 text-sm font-semibold ${tables.has(t.id) ? 'border-primary bg-primary/10' : 'border-border bg-card hover:bg-secondary'}`}
                    >
                      {t.label}
                    </button>
                  ))}
              </div>
            </div>
          ))}
        </div>
        <label className="mt-4 block text-sm font-semibold">
          Note
          <input className="input mt-1" maxLength={140} placeholder="Birthday, high chair, window…" value={note} onChange={(e) => setNote(e.target.value)} aria-label="Note" />
        </label>
        {message ? (
          <p role="alert" className="mt-3 text-sm font-semibold text-danger">
            {message}
          </p>
        ) : null}
        <div className="mt-5 flex justify-end gap-2">
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn btn-primary" disabled={busy || !name.trim() || !time || !day}>
            <Plus className="h-4 w-4" /> {booking ? 'Save' : 'Book'}
          </button>
        </div>
      </form>
    </Modal>
  );
}

function WaitlistDialog({ onClose }: { onClose: () => void }) {
  const [message, setMessage] = useState<string | null>(null);
  const run = useRun(setMessage);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [party, setParty] = useState(2);
  const [quoted, setQuoted] = useState(15);
  return (
    <Modal title="Add to the waitlist" onClose={onClose}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void run('AddToWaitlist', { id: newId(), guestName: name.trim(), phone: phone.trim() || null, partySize: party, quotedMin: quoted }).then((res) => res && onClose());
        }}
      >
        <div className="grid grid-cols-2 gap-3">
          <label className="block text-sm font-semibold">
            Guest name
            <input data-autofocus className="input mt-1" maxLength={60} value={name} onChange={(e) => setName(e.target.value)} aria-label="Waiting guest name" />
          </label>
          <label className="block text-sm font-semibold">
            Phone
            <input className="input mt-1" inputMode="tel" maxLength={20} value={phone} onChange={(e) => setPhone(e.target.value)} />
          </label>
          <label className="block text-sm font-semibold">
            Guests
            <input className="input mt-1" inputMode="numeric" value={party} onChange={(e) => setParty(Math.min(99, Math.max(1, Number(e.target.value.replace(/\D/g, '')) || 1)))} aria-label="Waiting guests" />
          </label>
          <label className="block text-sm font-semibold">
            Wait told to the guest
            <select className="input mt-1" value={quoted} onChange={(e) => setQuoted(Number(e.target.value))}>
              {[5, 10, 15, 20, 30, 45, 60].map((m) => (
                <option key={m} value={m}>
                  {m} min
                </option>
              ))}
            </select>
          </label>
        </div>
        {message ? (
          <p role="alert" className="mt-3 text-sm font-semibold text-danger">
            {message}
          </p>
        ) : null}
        <div className="mt-5 flex justify-end gap-2">
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn btn-primary" disabled={!name.trim()}>
            <UserPlus className="h-4 w-4" /> Add
          </button>
        </div>
      </form>
    </Modal>
  );
}
