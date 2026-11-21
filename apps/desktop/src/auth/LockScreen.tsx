import { Lock, LogOut } from 'lucide-react';
import { useState } from 'react';
import { ApiError } from '../api/client.js';
import { useApp } from '../app-context.js';
import { PinPad } from './PinPad.js';

/**
 * After the Lock button (and after a restart while locked), as in Tiffin POS: only the signed-in person's PIN opens
 * the terminal again. Nothing else is on screen meanwhile; open orders stay on the server.
 */
export function LockScreen() {
  const { session, unlock, signOut } = useApp();
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
      setError(e instanceof ApiError ? e.message : 'Could not unlock.');
      setPin('');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex h-full flex-col items-center justify-center bg-background px-6">
      <div className="mb-8 text-center">
        <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-2xl bg-primary text-primary-foreground">
          <Lock className="h-7 w-7" />
        </div>
        <h1 className="font-display text-3xl font-semibold">Locked</h1>
        <p className="text-sm text-muted-foreground">{session.user.name}, enter your PIN to continue. Open orders are kept.</p>
      </div>
      <div className="w-72">
        <PinPad value={pin} onChange={setPin} onSubmit={() => void submit()} />
        {error ? (
          <p role="alert" className="mt-4 text-center text-sm font-semibold text-danger">
            {error}
          </p>
        ) : null}
        <button className="btn mt-4 w-full" disabled={busy} onClick={signOut}>
          <LogOut className="h-4 w-4" /> Sign out and sign in as someone else
        </button>
      </div>
    </div>
  );
}
