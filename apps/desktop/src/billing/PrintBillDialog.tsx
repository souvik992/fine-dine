import { calculateBill, formatINR, type OrderSnapshot, type OutletConfig } from '@dinepos/shared';
import { useState } from 'react';
import { ApiError } from '../api/client.js';
import { Modal } from '../components/Modal.js';
import { bpToPercentText, percentToBp, rupeesToPaise } from './money-input.js';
import type { OrderSession } from './order-session.js';

const REASONS = ['Regular guest', 'Staff meal', 'Manager approval', 'Service delay'];

/**
 * Print bill (F9). The preview uses the shared calculator with the outlet settings; the printed figures are the
 * server's (same code, server-side). Enter prints, Esc cancels.
 */
export function PrintBillDialog({
  order,
  config,
  session,
  onDone,
  onClose,
}: {
  order: OrderSnapshot;
  config: OutletConfig;
  session: OrderSession;
  onDone: (billNo: string, warning?: string) => void;
  onClose: () => void;
}) {
  const [kind, setKind] = useState<'pct' | 'amount'>('pct');
  const [value, setValue] = useState('');
  const [reason, setReason] = useState('');
  const [service, setService] = useState(false);
  const [guest, setGuest] = useState({ name: '', phone: '', gstin: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const parsed = kind === 'pct' ? percentToBp(value) : rupeesToPaise(value);
  const scRate = config['bill.serviceChargeBp'];
  const fired = order.items.filter((i) => i.status === 'fired');
  let preview: ReturnType<typeof calculateBill> | null = null;
  let previewError: string | null = parsed === null ? (kind === 'pct' ? 'Enter a percentage up to 100.' : 'Enter an amount in rupees.') : null;
  if (parsed !== null) {
    try {
      preview = calculateBill(
        fired.map((i) => ({ id: i.id, qty: i.qty, unitPricePaise: i.unitPricePaise, taxRateBp: i.taxRateBp, addons: i.addons })),
        {
          discount: parsed > 0 ? (kind === 'pct' ? { kind: 'pct', valueBp: parsed } : { kind: 'amount', valuePaise: parsed }) : null,
          serviceChargeBp: service ? scRate : 0,
          roundOffStep: config['bill.roundOffStep'],
          roundOffTie: config['bill.roundOffTie'],
        },
      );
    } catch {
      previewError = 'The discount is more than the bill.';
    }
  }
  const needsReason = (parsed ?? 0) > 0 && !reason.trim();

  const submit = async () => {
    if (!preview || needsReason || busy) return;
    setBusy(true);
    setError(null);
    try {
      const customer = guest.name || guest.phone || guest.gstin ? { name: guest.name.trim() || null, phone: guest.phone.trim() || null, gstin: guest.gstin.trim() || null } : null;
      const res = await session.run<{ billNo: string; warning?: string }>('PrintBill', {
        discount: (parsed ?? 0) > 0 ? { kind, value: parsed, reason: reason.trim() } : null,
        serviceCharge: service ? { enabled: true } : null,
        customer,
      });
      onDone(res.result.billNo, res.result.warning);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not print the bill.');
      setBusy(false);
    }
  };

  const row = (label: string, amount: number, strong = false) => (
    <div className={`flex justify-between ${strong ? 'text-lg font-bold' : ''}`}>
      <span className={strong ? '' : 'text-muted-foreground'}>{label}</span>
      <span className="tabular-nums">{amount < 0 ? `-${formatINR(-amount)}` : formatINR(amount)}</span>
    </div>
  );

  return (
    <Modal title="Print bill" onClose={onClose}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <fieldset className="mb-3">
          <legend className="mb-1 text-sm font-semibold">Discount</legend>
          <div className="flex gap-2">
            <div role="radiogroup" aria-label="Discount type" className="flex rounded-lg border border-border p-0.5">
              {(['pct', 'amount'] as const).map((k) => (
                <button key={k} type="button" role="radio" aria-checked={kind === k} onClick={() => setKind(k)} className={`h-9 rounded-md px-3 text-sm font-semibold ${kind === k ? 'bg-foreground text-background' : ''}`}>
                  {k === 'pct' ? '%' : '₹'}
                </button>
              ))}
            </div>
            <input data-autofocus className="input w-28 text-right tabular-nums" inputMode="decimal" aria-label={kind === 'pct' ? 'Discount percent' : 'Discount amount'} placeholder="0" value={value} onChange={(e) => setValue(e.target.value)} />
            <input className="input flex-1" list="discount-reasons" aria-label="Discount reason" placeholder="Reason (needed for a discount)" value={reason} onChange={(e) => setReason(e.target.value)} />
            <datalist id="discount-reasons">
              {REASONS.map((r) => (
                <option key={r} value={r} />
              ))}
            </datalist>
          </div>
        </fieldset>

        <label className={`mb-3 flex items-center gap-2 text-sm font-semibold ${scRate ? '' : 'opacity-50'}`}>
          <input type="checkbox" checked={service} disabled={!scRate} onChange={(e) => setService(e.target.checked)} />
          Add service charge {scRate ? `(${bpToPercentText(scRate)}%) — only if the guest agrees` : '(not set up)'}
        </label>

        <details className="mb-3 rounded-lg border border-border p-3">
          <summary className="cursor-pointer text-sm font-semibold">Guest details (optional, for a GST bill)</summary>
          <div className="mt-2 grid grid-cols-2 gap-2">
            <input className="input" aria-label="Guest name" placeholder="Name" value={guest.name} onChange={(e) => setGuest({ ...guest, name: e.target.value })} />
            <input className="input" aria-label="Guest phone" placeholder="Phone" value={guest.phone} onChange={(e) => setGuest({ ...guest, phone: e.target.value })} />
            <input className="input col-span-2 uppercase" aria-label="Guest GSTIN" placeholder="GSTIN" maxLength={15} value={guest.gstin} onChange={(e) => setGuest({ ...guest, gstin: e.target.value.toUpperCase() })} />
          </div>
        </details>

        <div className="space-y-1 rounded-lg bg-secondary p-3 text-sm" aria-label="Bill preview">
          {preview ? (
            <>
              {row('Subtotal', preview.subtotal)}
              {preview.discount ? row('Discount', -preview.discount) : null}
              {preview.serviceCharge ? row('Service charge', preview.serviceCharge) : null}
              {row('GST', preview.totalTax)}
              {preview.roundOff ? row('Round off', preview.roundOff) : null}
              {row('Total', preview.total, true)}
            </>
          ) : (
            <p className="font-semibold text-danger">{previewError}</p>
          )}
        </div>

        {needsReason ? <p className="mt-2 text-sm font-semibold text-danger">Pick or type a reason for the discount.</p> : null}
        {error ? (
          <p role="alert" className="mt-2 text-sm font-semibold text-danger">
            {error}
          </p>
        ) : null}
        <div className="mt-4 flex justify-end gap-2">
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn btn-primary" disabled={!preview || needsReason || busy}>
            {busy ? 'Printing…' : 'Print bill'} <kbd className="text-xs opacity-80">Enter</kbd>
          </button>
        </div>
      </form>
    </Modal>
  );
}
