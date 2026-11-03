import { formatINR, type DayBill } from '@dinepos/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Ban, Printer } from 'lucide-react';
import { useState } from 'react';
import { ApiError } from '../api/client.js';
import { useApp } from '../app-context.js';
import { Modal } from '../components/Modal.js';

const STATE: Record<DayBill['state'], string> = { printed: 'Unpaid', superseded: 'Replaced', settled: 'Paid', void: 'VOID' };

/** Today's bills (P2-06): reprint any, void one (reason; manager PIN when the role needs it). VOID bills keep their number. */
export function BillsDialog({ onClose }: { onClose: () => void }) {
  const { api, can } = useApp();
  const qc = useQueryClient();
  const bills = useQuery({ queryKey: ['day-bills'], queryFn: () => api.get<{ date: string; bills: DayBill[] }>('/v1/bills') });
  const [voiding, setVoiding] = useState<DayBill | null>(null);
  const [reason, setReason] = useState('');
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const act = async (send: () => Promise<unknown>, ok: string) => {
    setBusy(true);
    setMessage(null);
    try {
      await send();
      setMessage({ ok: true, text: ok });
      await Promise.all(['day-bills', 'floor', 'order'].map((k) => qc.invalidateQueries({ queryKey: [k] })));
      return true;
    } catch (e) {
      setMessage({ ok: false, text: e instanceof ApiError ? e.message : 'Could not do that. Try again.' });
      return false;
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title={`Bills of ${bills.data?.date ?? 'today'}`} onClose={onClose} wide>
      {message ? (
        <p role={message.ok ? 'status' : 'alert'} className={`mb-3 text-sm font-semibold ${message.ok ? 'text-ok' : 'text-danger'}`}>
          {message.text}
        </p>
      ) : null}
      {bills.data?.bills.length === 0 ? <p className="py-6 text-center text-sm text-muted-foreground">No bills yet today.</p> : null}
      <div className="max-h-[60vh] overflow-y-auto">
        <table className="w-full text-sm" aria-label="Today's bills">
          <tbody>
            {bills.data?.bills
              .filter((b) => b.state !== 'superseded')
              .map((b) => (
                <tr key={b.billId} className={`border-b border-border last:border-0 ${b.state === 'void' ? 'text-muted-foreground' : ''}`}>
                  <td className="py-2 pr-2 font-mono font-semibold">{b.billNo}</td>
                  <td className="pr-2">
                    {b.table}
                    {b.parts > 1 ? <span className="ml-1 text-xs text-muted-foreground">part {b.partNo}/{b.parts}</span> : null}
                  </td>
                  <td className="pr-2 text-xs text-muted-foreground">{b.payments.map((p) => `${p.mode.toUpperCase()} ${formatINR(p.amountPaise)}`).join(' + ')}</td>
                  <td className={`pr-2 text-right tabular-nums ${b.state === 'void' ? 'line-through' : 'font-semibold'}`}>{formatINR(b.totalPaise)}</td>
                  <td className="pr-2">
                    <span className={`rounded px-1.5 py-0.5 text-xs font-bold ${b.state === 'void' ? 'bg-danger text-white' : b.state === 'settled' ? 'bg-ok/15 text-ok' : 'bg-secondary'}`}>{STATE[b.state]}</span>
                  </td>
                  <td className="whitespace-nowrap py-1 text-right">
                    {b.state !== 'void' && can('reprint', true) ? (
                      <button className="btn h-8 px-2" disabled={busy} aria-label={`Reprint ${b.billNo}`} title="Reprint (DUPLICATE)" onClick={() => void act(() => api.command('ReprintBill', { billId: b.billId }), `${b.billNo} printed again.`)}>
                        <Printer className="h-4 w-4" />
                      </button>
                    ) : null}
                    {b.state !== 'void' && can('bill.void', true) ? (
                      <button
                        className="btn ml-1 h-8 px-2 text-danger"
                        disabled={busy}
                        aria-label={`Void ${b.billNo}`}
                        title="Void"
                        onClick={() => {
                          setVoiding(b);
                          setReason('');
                        }}
                      >
                        <Ban className="h-4 w-4" />
                      </button>
                    ) : null}
                  </td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>

      {voiding ? (
        <form
          className="mt-4 rounded-xl border border-danger/40 bg-danger/5 p-4"
          onSubmit={(e) => {
            e.preventDefault();
            void act(
              () => api.command('VoidBill', { billId: voiding.billId, reason: reason.trim() }, { orderId: voiding.orderId, expectedVersion: voiding.orderVersion }),
              `${voiding.billNo} is void.${voiding.state === 'settled' ? ` Give back ${formatINR(voiding.totalPaise)} to the guest.` : ''}`,
            ).then((ok) => ok && setVoiding(null));
          }}
        >
          <p className="text-sm font-semibold">
            Void {voiding.billNo} ({formatINR(voiding.totalPaise)})? It keeps its number and shows VOID in reports.{voiding.state === 'settled' ? ' Its payment is reversed.' : ''}
          </p>
          <input data-autofocus className="input mt-2" maxLength={120} placeholder="Reason" aria-label="Reason for voiding" value={reason} onChange={(e) => setReason(e.target.value)} />
          <div className="mt-3 flex justify-end gap-2">
            <button type="button" className="btn" onClick={() => setVoiding(null)}>
              Keep the bill
            </button>
            <button type="submit" className="btn bg-danger text-white" disabled={busy || !reason.trim()}>
              Void bill
            </button>
          </div>
        </form>
      ) : null}
    </Modal>
  );
}
