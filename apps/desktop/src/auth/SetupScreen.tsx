import { newId, type LoginResult } from '@dinepos/shared';
import { Lock, ShieldCheck, Store, UserRound } from 'lucide-react';
import { useState, type ComponentType } from 'react';
import { ApiError } from '../api/client.js';
import { useApp } from '../app-context.js';
import { BrandLogo } from '../components/Brand.js';

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

  const field = (key: keyof typeof form, label: string, Icon: ComponentType<{ className?: string }>, placeholder: string, extra: Record<string, unknown> = {}) => (
    <label className="block min-w-0 text-sm font-semibold">
      {label}
      <span className="relative mt-1 block">
        <Icon className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
        <input className="input h-11 pl-9" placeholder={placeholder} value={form[key]} onChange={(e) => setForm({ ...form, [key]: e.target.value })} {...extra} />
      </span>
    </label>
  );

  return (
    <div className="flex h-full justify-center overflow-y-auto bg-background px-4 py-5 sm:items-center sm:px-6">
      <form
        className="h-fit w-full max-w-md sm:rounded-2xl sm:border sm:border-border sm:bg-card sm:p-6 sm:shadow-sm"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <BrandLogo size={34} />
        <SetupArt />
        <h1 className="font-display text-2xl font-semibold sm:text-3xl">Welcome to DinePOS</h1>
        <p className="mb-5 mt-1 text-sm text-muted-foreground">Set up your outlet to start taking orders: your restaurant&apos;s name and the owner&apos;s sign-in.</p>
        <div className="space-y-3">
          {field('outletName', 'Restaurant name (printed on bills)', Store, 'Enter restaurant name', { 'data-autofocus': true, autoFocus: true, maxLength: 60 })}
          {field('ownerName', 'Owner name', UserRound, 'Enter owner name', { maxLength: 40 })}
          <div className="grid grid-cols-2 gap-3">
            {field('pin', 'Owner PIN (4–6 digits)', Lock, 'Enter PIN', { type: 'password', inputMode: 'numeric', maxLength: 6, autoComplete: 'new-password' })}
            {field('pin2', 'Type the PIN again', Lock, 'Re-enter PIN', { type: 'password', inputMode: 'numeric', maxLength: 6, autoComplete: 'new-password' })}
          </div>
          {form.pin && !pinOk ? <p className="text-sm font-semibold text-danger">A PIN has 4 to 6 digits.</p> : null}
          {pinOk && form.pin2 && form.pin !== form.pin2 ? <p className="text-sm font-semibold text-danger">The two PINs are different.</p> : null}
        </div>
        <p className="mt-4 flex gap-2 text-xs text-muted-foreground">
          <ShieldCheck className="h-4 w-4 shrink-0" aria-hidden />
          <span>The owner can add staff, tables, the menu and printers in Settings afterwards. Keep the PIN private.</span>
        </p>
        {error ? (
          <p role="alert" className="mt-3 text-sm font-semibold text-danger">
            {error}
          </p>
        ) : null}
        <button type="submit" className="btn btn-primary mt-5 h-12 w-full rounded-xl text-base" disabled={!ready || busy}>
          {busy ? 'Setting up…' : 'Start using DinePOS'}
        </button>
      </form>
    </div>
  );
}

/** A billing terminal and a receipt printer on a counter, in the brand colours (hidden on a phone held sideways). */
function SetupArt() {
  return (
    <div className="my-4 overflow-hidden rounded-2xl bg-accent short:hidden" aria-hidden>
      <svg viewBox="0 0 360 150" className="block h-auto w-full">
        <rect x="0" y="112" width="360" height="38" fill="var(--secondary)" />
        <circle cx="60" cy="18" r="9" fill="var(--warn)" opacity=".5" />
        <path d="M60 0v9" stroke="var(--accent-foreground)" strokeWidth="2" opacity=".4" />
        {/* terminal */}
        <rect x="112" y="30" width="118" height="76" rx="9" fill="var(--foreground)" />
        <rect x="119" y="37" width="104" height="62" rx="5" fill="var(--primary)" />
        <path d="M159 55v10M164 55v10M169 55v10M159 65a5 5 0 0 0 10 0M164 70v14" stroke="var(--primary-foreground)" strokeWidth="2.6" strokeLinecap="round" fill="none" />
        <path d="M177 53c4 .4 6.5 5.5 6.5 12l-3 6v13a1.8 1.8 0 0 1-3.5 0V54z" fill="var(--primary-foreground)" />
        <path d="M163 106h16l6 8h-28z" fill="var(--foreground)" />
        {/* printer and its receipt */}
        <rect x="246" y="78" width="62" height="34" rx="7" fill="var(--foreground)" opacity=".85" />
        <path d="M258 80V52h38v28" fill="var(--card)" stroke="var(--border)" />
        <path d="M265 60h24M265 66h18M265 72h22" stroke="var(--muted-foreground)" strokeWidth="2" strokeLinecap="round" />
        {/* a plant */}
        <rect x="52" y="92" width="22" height="20" rx="4" fill="var(--card)" />
        <path d="M63 92c-10-8-12-22-4-30 2 10 6 14 4 30zM63 92c8-10 18-12 22-6-8 2-14 4-22 6z" fill="var(--ok)" opacity=".7" />
      </svg>
    </div>
  );
}
