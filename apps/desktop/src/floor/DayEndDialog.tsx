import { formatINR, type FloorSnapshot } from '@dinepos/shared';
import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { ApiError } from '../api/client.js';
import { useApp } from '../app-context.js';
import { rupeesToPaise } from '../billing/money-input.js';
import { Modal } from '../components/Modal.js';

interface ZSummary {
  businessDate: string;
  bills: number;
  netSalesPaise: number;
  discountPaise: number;
  byMode: Array<{ mode: string; amountPaise: number }>;
  cashExpectedPaise: number;
  cashCountedPaise: number;
}

/** Day end (docs/08): refused while tables are open; asks for the counted cash, then shows the Z-report. */
export function DayEndDialog({ floor, onClose }: { floor: FloorSnapshot; onClose: () => void }) {
  const { api } = useApp();
  const qc = useQueryClient();
  const [cash, setCash] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ z: ZSummary; nextDate: string | null; licence?: string } | null>(null);
  const openTables = floor.tables.filter((t) => t.orderId);
  const counted = rupeesToPaise(cash);

  const submit = async () => {
    if (counted === null || cash.trim() === '' || busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await api.command<{ zReport: ZSummary; nextDate: string | null; licence?: string }>('DayEnd', { cashCountedPaise: counted });
      setDone({ z: res.result.zReport, nextDate: res.result.nextDate, ...(res.result.licence ? { licence: res.result.licence } : {}) });
      await qc.invalidateQueries();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not close the day.');
    } finally {
      setBusy(false);
    }
  };

  if (done) {
    const diff = done.z.cashCountedPaise - done.z.cashExpectedPaise;
    const row = (k: string, v: string, strong = false) => (
      <div className={`flex justify-between ${strong ? 'font-bold' : ''}`}>
        <dt className={strong ? '' : 'text-muted-foreground'}>{k}</dt>
        <dd className="tabular-nums">{v}</dd>
      </div>
    );
    return (
      <Modal title={`Day closed: ${done.z.businessDate}`} onClose={onClose}>
        <dl className="space-y-1 text-sm" data-testid="z-summary">
          {row('Bills', String(done.z.bills))}
          {row('Net sales', formatINR(done.z.netSalesPaise), true)}
          {row('Discounts', formatINR(done.z.discountPaise))}
          {done.z.byMode.map((m) => row(m.mode.toUpperCase(), formatINR(m.amountPaise)))}
          {row('Cash expected', formatINR(done.z.cashExpectedPaise))}
          {row('Cash counted', formatINR(done.z.cashCountedPaise))}
          {row(diff === 0 ? 'Cash matches' : diff > 0 ? 'Cash over' : 'Cash short', formatINR(Math.abs(diff)), diff !== 0)}
        </dl>
        <p className="mt-3 text-sm text-muted-foreground">
          The Z-report was sent to the bill printer.{' '}
          {done.nextDate ? `New business date: ${done.nextDate}.` : <span className="font-semibold text-danger">No new business date was opened. {done.licence}</span>}
        </p>
        <button data-autofocus className="btn btn-primary mt-4 w-full" onClick={onClose}>
          Done
        </button>
      </Modal>
    );
  }

  return (
    <Modal title="Day end" onClose={onClose}>
      {openTables.length > 0 ? (
        <>
          <p className="text-sm font-semibold text-danger" role="alert">
            Settle every table before closing the day: {openTables.map((t) => t.label).join(', ')}.
          </p>
          <button data-autofocus className="btn mt-4 w-full" onClick={onClose}>
            Back to floor
          </button>
        </>
      ) : (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          <label htmlFor="cash-counted" className="block text-sm font-semibold">
            Cash counted in the drawer (₹)
          </label>
          <input id="cash-counted" data-autofocus className="input mt-1 h-12 text-right text-xl font-bold tabular-nums" inputMode="decimal" value={cash} onChange={(e) => setCash(e.target.value)} />
          {counted === null ? <p className="mt-1 text-sm font-semibold text-danger">Enter rupees, e.g. 12500 or 12500.50.</p> : null}
          <p className="mt-2 text-xs text-muted-foreground">Closing prints the Z-report and starts the next business date. It cannot be undone.</p>
          {error ? (
            <p role="alert" className="mt-2 text-sm font-semibold text-danger">
              {error}
            </p>
          ) : null}
          <div className="mt-4 flex justify-end gap-2">
            <button type="button" className="btn" onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className="btn btn-primary" disabled={busy || counted === null || cash.trim() === ''}>
              {busy ? 'Closing…' : 'Close the day'}
            </button>
          </div>
        </form>
      )}
    </Modal>
  );
}
