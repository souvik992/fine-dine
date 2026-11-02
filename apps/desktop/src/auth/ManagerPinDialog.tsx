import { ShieldCheck } from 'lucide-react';
import { useState } from 'react';
import { useApp } from '../app-context.js';
import { Modal } from '../components/Modal.js';
import { PinPad } from './PinPad.js';

/** Shown when the server answers PIN_REQUIRED: a manager types their PIN and the same command is sent again. */
export function ManagerPinDialog() {
  const { pinRequest } = useApp();
  const [pin, setPin] = useState('');
  if (!pinRequest) return null;
  const done = (value: string | null) => {
    setPin('');
    pinRequest.resolve(value);
  };
  return (
    <Modal title="Manager approval" onClose={() => done(null)}>
      <p className="mb-4 flex items-start gap-2 text-sm">
        <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
        <span>{pinRequest.message}</span>
      </p>
      <div className="mx-auto w-64">
        <PinPad value={pin} onChange={setPin} onSubmit={() => pin.length >= 4 && done(pin)} />
      </div>
      <button className="btn mt-4 w-full" onClick={() => done(null)}>
        Cancel
      </button>
    </Modal>
  );
}
