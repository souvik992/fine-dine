import { newId } from '@dinepos/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Bike, ShoppingBag } from 'lucide-react';
import { useRef, useState } from 'react';
import { ApiError } from '../api/client.js';
import { useApp } from '../app-context.js';
import { Modal } from '../components/Modal.js';
import { cleanPhone, counterFormError, type CounterType } from './counter-model.js';

/**
 * Starts a takeaway or delivery order (OpenCounterOrder), then opens it to punch items. A takeaway needs nothing (the
 * name is optional, for calling it out); a delivery needs a phone number and an address, which go on the bill. One
 * commandId per dialog, so a double click cannot open two orders.
 */
export function CounterOrderDialog({ initialType, onClose, onOpened }: { initialType: CounterType; onClose: () => void; onOpened: (orderId: string) => void }) {
  const { api } = useApp();
  const qc = useQueryClient();
  const [type, setType] = useState<CounterType>(initialType);
  const [form, setForm] = useState({ name: '', phone: '', address: '' });
  const [tried, setTried] = useState(false);
  const commandId = useRef(newId());
  const problem = counterFormError(type, form);

  const start = useMutation({
    mutationFn: () =>
      api.command(
        'OpenCounterOrder',
        {
          type,
          customerName: form.name.trim() || null,
          customerPhone: form.phone.trim() || null,
          address: type === 'delivery' ? form.address.trim() || null : null,
        },
        { commandId: commandId.current },
      ),
    onSuccess: async (res) => {
      await qc.invalidateQueries({ queryKey: ['floor'] });
      onClose();
      if (res.order) onOpened(res.order.id); // straight into the order to punch items
    },
  });
  const serverError = start.error instanceof ApiError ? start.error.message : start.error ? 'Could not start the order.' : null;
  const set = (k: keyof typeof form, v: string) => {
    setForm((f) => ({ ...f, [k]: v }));
    commandId.current = newId(); // different details: a different order if the first try failed
  };

  return (
    <Modal title={type === 'delivery' ? 'New delivery order' : 'New takeaway order'} onClose={onClose}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          setTried(true);
          if (!problem) start.mutate();
        }}
      >
        <div className="mb-4 grid grid-cols-2 gap-2" role="radiogroup" aria-label="Order type">
          {(['takeaway', 'delivery'] as const).map((t) => {
            const Icon = t === 'delivery' ? Bike : ShoppingBag;
            return (
              <button
                key={t}
                type="button"
                role="radio"
                aria-checked={type === t}
                className={`btn h-12 justify-center ${type === t ? 'btn-primary' : ''}`}
                onClick={() => {
                  setType(t);
                  setTried(false);
                  commandId.current = newId();
                }}
              >
                <Icon className="h-5 w-5" /> {t === 'delivery' ? 'Delivery' : 'Takeaway'}
              </button>
            );
          })}
        </div>

        <label className="mb-1 block text-sm font-semibold" htmlFor="co-name">
          Customer name {type === 'takeaway' ? <span className="font-normal text-muted-foreground">(optional, to call out)</span> : null}
        </label>
        <input id="co-name" data-autofocus className="input" maxLength={60} value={form.name} onChange={(e) => set('name', e.target.value)} autoComplete="off" />

        <label className="mb-1 mt-3 block text-sm font-semibold" htmlFor="co-phone">
          Phone {type === 'takeaway' ? <span className="font-normal text-muted-foreground">(optional)</span> : null}
        </label>
        <input
          id="co-phone"
          className="input tabular-nums"
          inputMode="tel"
          value={form.phone}
          onChange={(e) => set('phone', cleanPhone(e.target.value))}
          aria-invalid={tried && problem?.includes('phone') ? true : undefined}
          autoComplete="off"
        />

        {type === 'delivery' ? (
          <>
            <label className="mb-1 mt-3 block text-sm font-semibold" htmlFor="co-address">
              Delivery address
            </label>
            <textarea
              id="co-address"
              className="input min-h-[76px] py-2"
              maxLength={300}
              value={form.address}
              onChange={(e) => set('address', e.target.value)}
              aria-invalid={tried && problem?.includes('address') ? true : undefined}
              placeholder="House, street, landmark"
            />
            <p className="mt-1 text-xs text-muted-foreground">Printed on the bill for the rider.</p>
          </>
        ) : null}

        {(tried && problem) || serverError ? (
          <p role="alert" className="mt-3 text-sm font-semibold text-danger">
            {tried && problem ? problem : serverError}
          </p>
        ) : null}
        <div className="mt-5 flex justify-end gap-2">
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn btn-primary" disabled={start.isPending}>
            {start.isPending ? 'Starting…' : 'Start order'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
