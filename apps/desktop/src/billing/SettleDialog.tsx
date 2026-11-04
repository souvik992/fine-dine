import { formatINR, type TenderMode } from '@dinepos/shared';
import { Plus, Trash2 } from 'lucide-react';
import { useRef, useState } from 'react';
import { ApiError } from '../api/client.js';
import { Modal } from '../components/Modal.js';
import { paiseToInput, rupeesToPaise } from './money-input.js';

interface Line {
  mode: TenderMode;
  amount: string;
  ref: string;
}

export interface Tender {
  mode: TenderMode;
  amountPaise: number;
  ref: string | null;
}

const MODES: Array<{ mode: TenderMode; label: string; key: string }> = [
  { mode: 'cash', label: 'Cash', key: 'c' },
  { mode: 'card', label: 'Card', key: 'k' },
  { mode: 'upi', label: 'UPI', key: 'u' },
  { mode: 'due', label: 'Due', key: 'd' },
  { mode: 'complimentary', label: 'Comp', key: 'm' },
  { mode: 'other', label: 'Other', key: 'o' },
];

/**
 * Settle (F10, docs/09 §3). Type the amount received; letter keys switch the focused line's mode
 * (c cash, k card, u UPI, d due, m complimentary, o other); + adds a line; Enter settles once covered.
 * Remaining and change are shown for the cashier; the server checks and records the payment. Also used for a
 * cash-on-delivery online order when it is delivered or collected (fewer modes, its own command).
 */
export function SettleDialog({
  billNo,
  totalPaise,
  settle,
  modes = MODES.map((m) => m.mode),
  title,
  onDone,
  onClose,
}: {
  billNo: string;
  totalPaise: number;
  /** Sends the payment; resolves with the change to return. */
  settle: (tenders: Tender[]) => Promise<number>;
  /** The modes offered (default: all). */
  modes?: readonly TenderMode[];
  title?: string;
  onDone: (changePaise: number) => void;
  onClose: () => void;
}) {
  const offered = MODES.filter((m) => modes.includes(m.mode));
  const [lines, setLines] = useState<Line[]>([{ mode: 'cash', amount: '', ref: '' }]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const amountRefs = useRef<Array<HTMLInputElement | null>>([]);

  const amounts = lines.map((l) => (l.amount.trim() === '' && lines.length === 1 ? totalPaise : rupeesToPaise(l.amount)));
  const invalid = amounts.some((a) => a === null);
  const paid = amounts.reduce<number>((s, a) => s + (a ?? 0), 0);
  const nonCash = lines.reduce((s, l, i) => s + (l.mode === 'cash' ? 0 : (amounts[i] ?? 0)), 0);
  const remaining = Math.max(0, totalPaise - paid);
  const change = Math.max(0, paid - totalPaise);
  const missingRef = lines.some((l) => l.mode === 'complimentary' && !l.ref.trim());
  const ready = !invalid && remaining === 0 && nonCash <= totalPaise && !missingRef && !busy;

  const update = (i: number, patch: Partial<Line>) => setLines((ls) => ls.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  const addLine = () => {
    setLines((ls) => [...ls, { mode: offered.find((m) => m.mode !== 'cash')?.mode ?? 'cash', amount: remaining ? paiseToInput(remaining) : '', ref: '' }]);
    setTimeout(() => amountRefs.current[lines.length]?.focus(), 0);
  };

  const submit = async () => {
    if (!ready) return;
    setBusy(true);
    setError(null);
    try {
      const tenders = lines.map((l, i) => ({ mode: l.mode, amountPaise: amounts[i]!, ref: l.ref.trim() || null })).filter((t) => t.amountPaise > 0);
      onDone(await settle(tenders));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not settle the bill.');
      setBusy(false);
    }
  };

  return (
    <Modal title={title ?? `Settle ${billNo}`} onClose={onClose}>
      <div className="mb-4 flex items-baseline justify-between">
        <span className="text-sm text-muted-foreground">Amount due</span>
        <span className="text-3xl font-bold tabular-nums" data-testid="settle-total">
          {formatINR(totalPaise)}
        </span>
      </div>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <ul className="space-y-2">
          {lines.map((l, i) => (
            <li key={i} className="rounded-lg border border-border p-2">
              <div className="mb-2 flex flex-wrap gap-1" role="radiogroup" aria-label={`Payment ${i + 1} mode`}>
                {offered.map((m) => (
                  <button key={m.mode} type="button" role="radio" aria-checked={l.mode === m.mode} onClick={() => update(i, { mode: m.mode })} className={`h-8 rounded-md px-2.5 text-xs font-bold ${l.mode === m.mode ? 'bg-foreground text-background' : 'bg-secondary'}`}>
                    {m.label} <span className="opacity-60">{m.key}</span>
                  </button>
                ))}
              </div>
              <div className="flex gap-2">
                <input
                  ref={(el) => {
                    amountRefs.current[i] = el;
                  }}
                  {...(i === 0 ? { 'data-autofocus': true } : {})}
                  className="input h-12 flex-1 text-right text-xl font-bold tabular-nums"
                  inputMode="decimal"
                  aria-label={`Amount ${i + 1}`}
                  placeholder={lines.length === 1 ? paiseToInput(totalPaise) : '0'}
                  value={l.amount}
                  onChange={(e) => update(i, { amount: e.target.value })}
                  onKeyDown={(e) => {
                    const m = offered.find((x) => x.key === e.key.toLowerCase());
                    if (m && !e.ctrlKey && !e.altKey) {
                      e.preventDefault();
                      update(i, { mode: m.mode });
                    } else if (e.key === '+') {
                      e.preventDefault();
                      addLine();
                    }
                  }}
                />
                {l.mode !== 'cash' ? (
                  <input className="input h-12 w-40" aria-label={`Reference ${i + 1}`} placeholder={l.mode === 'complimentary' ? 'Reason (required)' : 'Ref / slip no.'} value={l.ref} onChange={(e) => update(i, { ref: e.target.value })} />
                ) : null}
                {lines.length > 1 ? (
                  <button type="button" className="btn h-12 w-12 px-0" aria-label={`Remove payment ${i + 1}`} onClick={() => setLines((ls) => ls.filter((_, j) => j !== i))}>
                    <Trash2 className="h-4 w-4" />
                  </button>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
        <button type="button" className="btn mt-2" onClick={addLine}>
          <Plus className="h-4 w-4" /> Split payment <kbd className="text-xs text-muted-foreground">+</kbd>
        </button>

        <div className="mt-4 space-y-1 rounded-lg bg-secondary p-3 text-sm">
          <div className="flex justify-between">
            <span className="text-muted-foreground">Received</span>
            <span className="tabular-nums">{formatINR(paid)}</span>
          </div>
          {remaining > 0 ? (
            <div className="flex justify-between font-bold text-danger">
              <span>Still to pay</span>
              <span className="tabular-nums">{formatINR(remaining)}</span>
            </div>
          ) : null}
          {change > 0 ? (
            <div className="flex justify-between text-lg font-bold" data-testid="settle-change">
              <span>Change to return</span>
              <span className="tabular-nums">{formatINR(change)}</span>
            </div>
          ) : null}
        </div>
        {invalid ? <p className="mt-2 text-sm font-semibold text-danger">Amounts are in rupees, e.g. 500 or 499.50.</p> : null}
        {nonCash > totalPaise ? <p className="mt-2 text-sm font-semibold text-danger">Only cash can be more than the bill.</p> : null}
        {missingRef ? <p className="mt-2 text-sm font-semibold text-danger">Give a reason for the complimentary bill.</p> : null}
        {error ? (
          <p role="alert" className="mt-2 text-sm font-semibold text-danger">
            {error}
          </p>
        ) : null}
        <div className="mt-4 flex justify-end gap-2">
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn btn-primary h-11" disabled={!ready}>
            {busy ? 'Settling…' : 'Settle'} <kbd className="text-xs opacity-80">Enter</kbd>
          </button>
        </div>
      </form>
    </Modal>
  );
}
