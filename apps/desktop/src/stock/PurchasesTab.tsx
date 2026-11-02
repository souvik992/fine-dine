import { formatINR, formatQty, newId, parseQty, stockAmount, sumPaise, UNIT_LABELS, type PurchaseView } from '@dinepos/shared';
import { useQuery } from '@tanstack/react-query';
import { Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { useApp } from '../app-context.js';
import { rupeesToPaise } from '../billing/money-input.js';
import { Modal } from '../components/Modal.js';
import { DialogButtons, Empty, ErrorText, Field } from '../settings/common.js';
import { qtyText, useStock, useStockCommand, when } from './common.js';

interface PurchasesResponse {
  purchases: PurchaseView[];
  suppliers: Array<{ name: string; gstin: string | null }>;
}

/** Supplier invoices (from TiffinPOS Purchases): recorded once, voided and entered again to correct. */
export function PurchasesTab() {
  const { api } = useApp();
  const list = useQuery({ queryKey: ['purchases'], queryFn: () => api.get<PurchasesResponse>('/v1/purchases?limit=100') });
  const [adding, setAdding] = useState(false);
  const [viewing, setViewing] = useState<PurchaseView | null>(null);
  if (!list.data) return <p className="text-muted-foreground">Loading…</p>;
  const { purchases, suppliers } = list.data;

  return (
    <>
      <div className="mb-3 flex items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">Each purchase adds to stock and updates the material's cost. Showing the latest 100.</p>
        <button className="btn btn-primary" onClick={() => setAdding(true)}>
          <Plus className="h-4 w-4" /> Record purchase
        </button>
      </div>
      {purchases.length === 0 ? (
        <Empty>No purchases yet. Record the supplier's invoice when goods arrive.</Empty>
      ) : (
        <table className="w-full rounded-xl border border-border bg-card text-sm" aria-label="Purchases">
          <thead>
            <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
              <th className="px-3 py-2">Recorded</th>
              <th className="px-3 py-2">Supplier</th>
              <th className="px-3 py-2">Invoice</th>
              <th className="px-3 py-2">Materials</th>
              <th className="px-3 py-2 text-right">Total</th>
            </tr>
          </thead>
          <tbody>
            {purchases.map((p) => (
              <tr key={p.id} className={`cursor-pointer border-b border-border last:border-0 hover:bg-secondary ${p.status === 'void' ? 'text-muted-foreground line-through' : ''}`} onClick={() => setViewing(p)}>
                <td className="whitespace-nowrap px-3 py-2">{when(p.createdAt)}</td>
                <td className="px-3 py-2 font-semibold">{p.supplierName}</td>
                <td className="px-3 py-2">{[p.invoiceNo, p.invoiceDate].filter(Boolean).join(' · ') || '—'}</td>
                <td className="max-w-80 truncate px-3 py-2 text-muted-foreground">{p.lines.map((l) => l.name).join(', ')}</td>
                <td className="px-3 py-2 text-right font-semibold tabular-nums">
                  {p.status === 'void' ? <span className="mr-2 rounded bg-secondary px-1.5 text-xs no-underline">VOID</span> : null}
                  {formatINR(p.totalPaise)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {adding ? <PurchaseDialog suppliers={suppliers} onClose={() => setAdding(false)} /> : null}
      {viewing ? <ViewDialog purchase={viewing} onClose={() => setViewing(null)} /> : null}
    </>
  );
}

interface LineDraft {
  key: string;
  stockItemId: string;
  qty: string;
  rate: string;
}

const blankLine = (): LineDraft => ({ key: newId(), stockItemId: '', qty: '', rate: '' });

function PurchaseDialog({ suppliers, onClose }: { suppliers: PurchasesResponse['suppliers']; onClose: () => void }) {
  const stock = useStock();
  const { send, busy, error, setError } = useStockCommand();
  const [id] = useState(newId); // one id per form: a retried save cannot record it twice
  const [supplier, setSupplier] = useState('');
  const [gstin, setGstin] = useState('');
  const [invoiceNo, setInvoiceNo] = useState('');
  const [invoiceDate, setInvoiceDate] = useState('');
  const [note, setNote] = useState('');
  const [lines, setLines] = useState<LineDraft[]>([blankLine()]);
  const materials = (stock.data?.items ?? []).filter((m) => m.active);
  const byId = new Map(materials.map((m) => [m.id, m]));

  const parsed = lines.map((l) => {
    const qtyMilli = parseQty(l.qty);
    const ratePaise = rupeesToPaise(l.rate);
    return { ...l, qtyMilli, ratePaise, amount: qtyMilli && ratePaise !== null ? stockAmount(qtyMilli, ratePaise) : null };
  });
  const total = sumPaise(parsed.map((l) => l.amount ?? 0));
  const setLine = (key: string, patch: Partial<LineDraft>) => setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));

  const submit = () => {
    const used = parsed.filter((l) => l.stockItemId || l.qty || l.rate);
    if (used.length === 0) return setError('Add at least one material.');
    for (const [i, l] of used.entries()) {
      const m = byId.get(l.stockItemId);
      if (!m) return setError(`Line ${i + 1}: choose a material.`);
      if (!l.qtyMilli) return setError(`Line ${i + 1}: enter the quantity in ${UNIT_LABELS[m.unit]}, like 5 or 2.5.`);
      if (l.ratePaise === null) return setError(`Line ${i + 1}: enter the rate in rupees per ${UNIT_LABELS[m.unit]}.`);
    }
    if (new Set(used.map((l) => l.stockItemId)).size !== used.length) return setError('A material appears twice. Combine the lines.');
    void send('RecordPurchase', {
      id,
      supplierName: supplier.trim(),
      supplierGstin: gstin.trim() || null,
      invoiceNo: invoiceNo.trim() || null,
      invoiceDate: invoiceDate || null,
      note: note.trim() || null,
      lines: used.map((l) => ({ stockItemId: l.stockItemId, qtyMilli: l.qtyMilli!, unitCostPaise: l.ratePaise! })),
    }).then((ok) => ok && onClose());
  };

  return (
    <Modal title="Record a purchase" onClose={onClose} wide>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <div className="grid grid-cols-3 gap-3">
          <div className="col-span-2">
            <Field label="Supplier">
              <input
                data-autofocus
                className="input"
                list="dinepos-suppliers"
                maxLength={80}
                value={supplier}
                onChange={(e) => {
                  setSupplier(e.target.value);
                  const known = suppliers.find((s) => s.name.toLowerCase() === e.target.value.trim().toLowerCase());
                  if (known?.gstin && !gstin) setGstin(known.gstin);
                }}
              />
              <datalist id="dinepos-suppliers">
                {suppliers.map((s) => (
                  <option key={s.name} value={s.name} />
                ))}
              </datalist>
            </Field>
          </div>
          <Field label="Supplier GSTIN">
            <input className="input font-mono uppercase placeholder:font-sans placeholder:normal-case" maxLength={15} placeholder="Optional" value={gstin} onChange={(e) => setGstin(e.target.value)} />
          </Field>
          <Field label="Invoice no.">
            <input className="input" maxLength={40} placeholder="Optional" value={invoiceNo} onChange={(e) => setInvoiceNo(e.target.value)} />
          </Field>
          <Field label="Invoice date">
            <input className="input" type="date" value={invoiceDate} onChange={(e) => setInvoiceDate(e.target.value)} />
          </Field>
        </div>

        <table className="mt-4 w-full text-sm" aria-label="Purchase lines">
          <thead>
            <tr className="text-left text-xs uppercase tracking-wide text-muted-foreground">
              <th className="pb-1">Material</th>
              <th className="w-32 pb-1">Quantity</th>
              <th className="w-36 pb-1">Rate ₹ / unit</th>
              <th className="w-28 pb-1 text-right">Amount</th>
              <th className="w-10" />
            </tr>
          </thead>
          <tbody>
            {parsed.map((l, i) => {
              const m = byId.get(l.stockItemId);
              return (
                <tr key={l.key}>
                  <td className="py-1 pr-2">
                    <select className="input" aria-label={`Line ${i + 1} material`} value={l.stockItemId} onChange={(e) => setLine(l.key, { stockItemId: e.target.value })}>
                      <option value="">Choose…</option>
                      {materials.map((x) => (
                        <option key={x.id} value={x.id}>
                          {x.name} ({UNIT_LABELS[x.unit]})
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="py-1 pr-2">
                    <input className="input" inputMode="decimal" aria-label={`Line ${i + 1} quantity`} placeholder={m ? UNIT_LABELS[m.unit] : ''} value={l.qty} onChange={(e) => setLine(l.key, { qty: e.target.value })} />
                  </td>
                  <td className="py-1 pr-2">
                    <input
                      className="input"
                      inputMode="decimal"
                      aria-label={`Line ${i + 1} rate`}
                      placeholder={m && m.lastUnitCostPaise !== null ? `last ${formatINR(m.lastUnitCostPaise)}` : ''}
                      value={l.rate}
                      onChange={(e) => setLine(l.key, { rate: e.target.value })}
                    />
                  </td>
                  <td className="py-1 text-right tabular-nums">{l.amount !== null ? formatINR(l.amount) : '—'}</td>
                  <td className="py-1 pl-1">
                    <button type="button" className="btn h-9 w-9 px-0" aria-label={`Remove line ${i + 1}`} disabled={lines.length === 1} onClick={() => setLines((ls) => ls.filter((x) => x.key !== l.key))}>
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr>
              <td colSpan={3} className="pt-2">
                <button type="button" className="btn h-9" onClick={() => setLines((ls) => [...ls, blankLine()])}>
                  <Plus className="h-4 w-4" /> Add line
                </button>
              </td>
              <td className="pt-2 text-right font-semibold tabular-nums">{formatINR(total)}</td>
              <td />
            </tr>
          </tfoot>
        </table>
        {materials.length === 0 ? <p className="mt-2 text-sm text-muted-foreground">Add materials in the Materials tab first.</p> : null}
        <input className="input mt-3" maxLength={200} placeholder="Note (optional)" aria-label="Note" value={note} onChange={(e) => setNote(e.target.value)} />
        <p className="mt-2 text-xs text-muted-foreground">Enter the rate you paid per unit, including any tax you cannot claim back. A recorded purchase cannot be edited; void it and record it again.</p>
        <ErrorText error={error} />
        <DialogButtons busy={busy} onCancel={onClose} label="Record purchase" disabled={!supplier.trim()} />
      </form>
    </Modal>
  );
}

function ViewDialog({ purchase: p, onClose }: { purchase: PurchaseView; onClose: () => void }) {
  const { send, busy, error } = useStockCommand();
  const [voiding, setVoiding] = useState(false);
  const [reason, setReason] = useState('');
  return (
    <Modal title={`${p.supplierName}${p.invoiceNo ? ` #${p.invoiceNo}` : ''}`} onClose={onClose} wide>
      <p className="mb-3 text-sm text-muted-foreground">
        Recorded {when(p.createdAt)}
        {p.createdByName ? ` by ${p.createdByName}` : ''}
        {p.invoiceDate ? ` · invoice date ${p.invoiceDate}` : ''}
        {p.supplierGstin ? ` · GSTIN ${p.supplierGstin}` : ''}
      </p>
      {p.status === 'void' ? (
        <p className="mb-3 rounded-lg bg-secondary p-2 text-sm font-semibold">
          Void {p.voidedAt ? when(p.voidedAt) : ''}: {p.voidReason}
        </p>
      ) : null}
      <table className="w-full text-sm" aria-label="Purchase lines">
        <thead>
          <tr className="text-left text-xs uppercase tracking-wide text-muted-foreground">
            <th className="py-1">Material</th>
            <th className="text-right">Quantity</th>
            <th className="text-right">Rate</th>
            <th className="text-right">Amount</th>
          </tr>
        </thead>
        <tbody>
          {p.lines.map((l) => (
            <tr key={l.stockItemId} className="border-t border-border">
              <td className="py-1.5">{l.name}</td>
              <td className="text-right tabular-nums">{qtyText(l.qtyMilli, l)}</td>
              <td className="text-right tabular-nums">
                {formatINR(l.unitCostPaise)} / {UNIT_LABELS[l.unit]}
              </td>
              <td className="text-right tabular-nums">{formatINR(l.amountPaise)}</td>
            </tr>
          ))}
          <tr className="border-t border-border font-semibold">
            <td className="py-1.5" colSpan={3}>
              Total
            </td>
            <td className="text-right tabular-nums">{formatINR(p.totalPaise)}</td>
          </tr>
        </tbody>
      </table>
      {p.note ? <p className="mt-2 text-sm text-muted-foreground">Note: {p.note}</p> : null}
      {p.status === 'posted' && !voiding ? (
        <div className="mt-5 flex justify-end">
          <button className="btn text-danger" onClick={() => setVoiding(true)}>
            Void this purchase
          </button>
        </div>
      ) : null}
      {voiding ? (
        <form
          className="mt-4"
          onSubmit={(e) => {
            e.preventDefault();
            void send('VoidPurchase', { purchaseId: p.id, reason: reason.trim() }).then((ok) => ok && onClose());
          }}
        >
          <Field label="Why is it void?" hint={`Removes ${p.lines.map((l) => `${formatQty(l.qtyMilli)} ${UNIT_LABELS[l.unit]} ${l.name}`).join(', ')} from stock.`}>
            <input data-autofocus className="input" maxLength={200} value={reason} onChange={(e) => setReason(e.target.value)} />
          </Field>
          <ErrorText error={error} />
          <DialogButtons busy={busy} onCancel={() => setVoiding(false)} label="Void purchase" disabled={!reason.trim()} />
        </form>
      ) : null}
    </Modal>
  );
}
