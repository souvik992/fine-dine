import { formatINR, type CashMovementView } from '@dinepos/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { ApiError } from '../api/client.js';
import { useApp } from '../app-context.js';
import { rupeesToPaise } from '../billing/money-input.js';
import { Modal } from '../components/Modal.js';

type Action = 'pay_in' | 'pay_out' | 'drawer';
const LABEL: Record<Action, string> = { pay_in: 'Pay in', pay_out: 'Pay out', drawer: 'Open drawer' };
const KIND: Record<CashMovementView['kind'], string> = { pay_in: 'Paid in', pay_out: 'Paid out', opening: 'Opening', closing: 'Counted at day end' };

/** Cash drawer (P2-06): pay in, pay out (counted at day end) and open the drawer without a sale. Each prints a slip. */
export function CashDialog({ onClose }: { onClose: () => void }) {
  const { api, can } = useApp();
  const qc = useQueryClient();
  const movements = useQuery({ queryKey: ['day-cash'], queryFn: () => api.get<{ movements: CashMovementView[] }>('/v1/cash') });
  const actions = (['pay_in', 'pay_out', 'drawer'] as const).filter((a) => (a === 'drawer' ? can('drawer.open', true) : can('cash.move', true)));
  const [action, setAction] = useState<Action>(actions[0] ?? 'pay_in');
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  const submit = async () => {
    const paise = action === 'drawer' ? null : rupeesToPaise(amount);
    if (action !== 'drawer' && !paise) return setMessage({ ok: false, text: 'Enter the amount in rupees, like 500 or 250.50.' });
    setBusy(true);
    setMessage(null);
    try {
      if (action === 'drawer') await api.command('OpenDrawer', { reason: reason.trim() });
      else await api.command(action === 'pay_in' ? 'PayIn' : 'PayOut', { amountPaise: paise, reason: reason.trim() });
      setMessage({ ok: true, text: action === 'drawer' ? 'Drawer opened.' : `${LABEL[action]} of ${formatINR(paise!)} recorded.` });
      setAmount('');
      setReason('');
      await qc.invalidateQueries({ queryKey: ['day-cash'] });
    } catch (e) {
      setMessage({ ok: false, text: e instanceof ApiError ? e.message : 'Could not do that. Try again.' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title="Cash drawer" onClose={onClose}>
      <div className="mb-3 flex gap-1" role="tablist" aria-label="Cash action">
        {actions.map((a) => (
          <button key={a} role="tab" className="tab" aria-selected={action === a} onClick={() => setAction(a)}>
            {LABEL[a]}
          </button>
        ))}
      </div>
      {actions.length === 0 ? <p className="text-sm text-muted-foreground">Your role cannot move cash or open the drawer.</p> : null}
      {actions.length ? (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (reason.trim()) void submit();
          }}
        >
          {action !== 'drawer' ? (
            <input data-autofocus className="input mb-2" inputMode="decimal" placeholder="Amount ₹" aria-label="Amount in rupees" value={amount} onChange={(e) => setAmount(e.target.value)} />
          ) : null}
          <input
            data-autofocus={action === 'drawer' ? true : undefined}
            className="input"
            maxLength={120}
            placeholder={action === 'pay_in' ? 'Reason, e.g. opening float' : action === 'pay_out' ? 'Reason, e.g. milk from the market' : 'Reason, e.g. change for a note'}
            aria-label="Reason"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
          <p className="mt-2 text-xs text-muted-foreground">
            {action === 'drawer' ? 'Opening the drawer without a sale is recorded on the leakage report.' : 'Counted in the day-end cash. A slip prints and the drawer opens.'}
          </p>
          {message ? (
            <p role={message.ok ? 'status' : 'alert'} className={`mt-2 text-sm font-semibold ${message.ok ? 'text-ok' : 'text-danger'}`}>
              {message.text}
            </p>
          ) : null}
          <div className="mt-4 flex justify-end">
            <button type="submit" className="btn btn-primary" disabled={busy || !reason.trim()}>
              {busy ? 'Saving…' : LABEL[action]}
            </button>
          </div>
        </form>
      ) : null}

      <h3 className="mb-1 mt-5 text-sm font-semibold">Today</h3>
      <ul className="max-h-48 space-y-1 overflow-y-auto text-sm" aria-label="Cash movements today">
        {movements.data?.movements.map((m) => (
          <li key={m.id} className="flex justify-between gap-2">
            <span>
              {KIND[m.kind]} <span className="text-muted-foreground">· {[m.reason, m.userName].filter(Boolean).join(' · ')}</span>
            </span>
            <span className={`tabular-nums ${m.kind === 'pay_out' ? 'text-danger' : ''}`}>
              {m.kind === 'pay_out' ? '−' : ''}
              {formatINR(m.amountPaise)}
            </span>
          </li>
        ))}
        {movements.data?.movements.length === 0 ? <li className="text-muted-foreground">Nothing yet.</li> : null}
      </ul>
    </Modal>
  );
}
