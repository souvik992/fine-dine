import { newId, type LoginResult } from '@dinepos/shared';
import { useState } from 'react';
import { ApiError } from '../api/client.js';
import { useApp } from '../app-context.js';

/** First run (like Tiffin POS Setup): name the restaurant and create the owner, then sign straight in. */
export function SetupScreen({ onDone }: { onDone: () => void }) {
  const { api, signIn } = useApp();
  const [form, setForm] = useState({ outletName: '', ownerName: '', pin: '', pin2: '' });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const pinOk = /^\d{4,6}$/.test(form.pin);
  const ready = form.outletName.trim() && form.ownerName.trim() && pinOk && form.pin === form.pin2;

  const submit = async () => {
    if (!ready || busy) return;
    setBusy(true);
    setError(null);
    try {
      const ownerId = newId();
      await api.command('SetupOutlet', { outletName: form.outletName.trim(), ownerId, ownerName: form.ownerName.trim(), pin: form.pin });
      signIn(await api.send<LoginResult>('POST', '/v1/sessions', { userId: ownerId, pin: form.pin }));
      onDone();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not finish the setup.');
      setBusy(false);
    }
  };

  const field = (key: keyof typeof form, label: string, extra: Record<string, unknown> = {}) => (
    <label className="block text-sm font-semibold">
      {label}
      <input className="input mt-1" value={form[key]} onChange={(e) => setForm({ ...form, [key]: e.target.value })} {...extra} />
    </label>
  );

  return (
    <div className="flex h-full items-center justify-center bg-background px-6">
      <form
        className="w-full max-w-md rounded-2xl border border-border bg-card p-6 shadow-sm"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <h1 className="font-display text-3xl font-semibold">Welcome to DinePOS</h1>
        <p className="mb-5 mt-1 text-sm text-muted-foreground">Two things before the first order: your restaurant&apos;s name and the owner&apos;s sign-in.</p>
        <div className="space-y-3">
          {field('outletName', 'Restaurant name (printed on bills)', { 'data-autofocus': true, autoFocus: true, maxLength: 60 })}
          {field('ownerName', 'Owner name', { maxLength: 40 })}
          <div className="grid grid-cols-2 gap-3">
            {field('pin', 'Owner PIN (4–6 digits)', { type: 'password', inputMode: 'numeric', maxLength: 6, autoComplete: 'new-password' })}
            {field('pin2', 'Type the PIN again', { type: 'password', inputMode: 'numeric', maxLength: 6, autoComplete: 'new-password' })}
          </div>
          {form.pin && !pinOk ? <p className="text-sm font-semibold text-danger">A PIN has 4 to 6 digits.</p> : null}
          {pinOk && form.pin2 && form.pin !== form.pin2 ? <p className="text-sm font-semibold text-danger">The two PINs are different.</p> : null}
        </div>
        <p className="mt-4 text-xs text-muted-foreground">The owner can add staff, tables, the menu and printers in Settings afterwards. Keep the PIN private.</p>
        {error ? (
          <p role="alert" className="mt-3 text-sm font-semibold text-danger">
            {error}
          </p>
        ) : null}
        <button type="submit" className="btn btn-primary mt-5 h-11 w-full" disabled={!ready || busy}>
          {busy ? 'Setting up…' : 'Start using DinePOS'}
        </button>
      </form>
    </div>
  );
}
