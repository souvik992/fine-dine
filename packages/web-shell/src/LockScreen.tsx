import { ApiError } from '@dinepos/client';
import { Lock, LogOut } from 'lucide-react';
import { useState } from 'react';
import { PinKeys, ShellFrame } from './LoginScreen.js';
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

  return (
    <ShellFrame>
      <div className="text-center">
        <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/10 text-primary">
          <Lock className="h-7 w-7" />
        </div>
        <h1 className="font-display text-2xl font-semibold">Locked</h1>
        <p className="text-sm text-muted-foreground">{session.user.name}, enter your PIN to continue.</p>
      </div>
      {error ? (
        <p role="alert" className="mt-3 text-center font-semibold text-danger">
          {error}
        </p>
      ) : null}
      <PinKeys pin={pin} setPin={setPin} onSubmit={() => void submit()} busy={busy} />
      <button className="btn mx-auto mt-3 h-auto min-h-12 w-full max-w-xs whitespace-normal rounded-2xl leading-tight" disabled={busy} onClick={signOut}>
        <LogOut className="h-5 w-5 shrink-0" /> Sign out and sign in as someone else
      </button>
    </ShellFrame>
  );
}
