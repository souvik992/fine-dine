import { ApiError } from '@dinepos/client';
import { Delete, Lock, LogOut } from 'lucide-react';
import { useState } from 'react';
import { useShell } from './shell-context.js';

/**
 * After the Lock button (and after closing the app while locked), as in Tiffin POS: only the signed-in person's PIN
 * opens the phone again. Open orders stay on the server.
 */
export function LockScreen() {
  const { session, unlock, signOut } = useShell();
  const [pin, setPin] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  if (!session) return null;

  const submit = async () => {
    if (pin.length < 4 || busy) return;
    setBusy(true);
    setError(null);
    try {
      await unlock(pin);
    } catch (e) {
      if (e instanceof ApiError && (e.details as { sessionEnded?: boolean } | undefined)?.sessionEnded) return signOut();
      setError(e instanceof ApiError ? e.message : 'Cannot reach the outlet server.');
      setPin('');
    } finally {
      setBusy(false);
    }
  };
  const press = (d: string) => {
    if (pin.length < 6) setPin(pin + d);
  };

  return (
    <main className="flex min-h-full flex-col px-5 py-4">
      <div className="mt-4 text-center">
        <div className="mx-auto mb-2 flex h-12 w-12 items-center justify-center rounded-2xl bg-primary text-primary-foreground">
          <Lock className="h-6 w-6" />
        </div>
        <h1 className="font-display text-2xl font-semibold">Locked</h1>
        <p className="text-sm text-muted-foreground">{session.user.name}, enter your PIN to continue.</p>
      </div>
      <div className="my-5 flex justify-center gap-3" aria-label={`${pin.length} digits entered`}>
        {Array.from({ length: Math.max(4, pin.length) }, (_, i) => (
          <span key={i} className={`h-4 w-4 rounded-full border-2 border-foreground ${i < pin.length ? 'bg-foreground' : ''}`} />
        ))}
      </div>
      {error ? (
        <p role="alert" className="mb-3 text-center font-semibold text-danger">
          {error}
        </p>
      ) : null}
      <div className="mt-auto grid grid-cols-3 gap-3">
        {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((d) => (
          <button key={d} className="btn h-16 text-2xl" onClick={() => press(d)} aria-label={d}>
            {d}
          </button>
        ))}
        <button className="btn h-16" onClick={() => setPin(pin.slice(0, -1))} aria-label="Delete last digit">
          <Delete className="h-6 w-6" />
        </button>
        <button className="btn h-16 text-2xl" onClick={() => press('0')} aria-label="0">
          0
        </button>
        <button className="btn btn-primary h-16" onClick={() => void submit()} disabled={pin.length < 4 || busy}>
          OK
        </button>
      </div>
      <button className="btn mt-3 w-full" disabled={busy} onClick={signOut}>
        <LogOut className="h-5 w-5" /> Sign out and sign in as someone else
      </button>
    </main>
  );
}
