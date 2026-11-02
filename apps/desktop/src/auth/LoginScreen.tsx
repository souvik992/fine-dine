import type { LoginResult, LoginUser, SetupState } from '@dinepos/shared';
import { ArrowLeft, Settings } from 'lucide-react';
import { useState } from 'react';
import { ApiError } from '../api/client.js';
import { useApp } from '../app-context.js';
import { PinPad } from './PinPad.js';

/** Sign-in (docs/07): tap your name, type your PIN. */
export function LoginScreen({ state, onSettings }: { state: SetupState; onSettings: () => void }) {
  const { api, signIn } = useApp();
  const [user, setUser] = useState<LoginUser | null>(null);
  const [pin, setPin] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (!user || pin.length < 4 || busy) return;
    setBusy(true);
    setError(null);
    try {
      signIn(await api.send<LoginResult>('POST', '/v1/sessions', { userId: user.id, pin }));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not sign in.');
      setPin('');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex h-full flex-col items-center justify-center bg-background px-6">
      <button className="btn absolute right-4 top-4 h-10 w-10 px-0" onClick={onSettings} aria-label="Terminal settings" title="Terminal settings">
        <Settings className="h-5 w-5" />
      </button>
      <div className="mb-8 text-center">
        <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-2xl bg-primary font-display text-3xl text-primary-foreground">D</div>
        <h1 className="font-display text-3xl font-semibold">{state.outletName}</h1>
        <p className="text-sm text-muted-foreground">{user ? `Enter the PIN for ${user.name}` : 'Who is signing in?'}</p>
      </div>

      {!user ? (
        <ul className="grid w-full max-w-2xl grid-cols-2 gap-3 sm:grid-cols-3" aria-label="Staff">
          {state.users.map((u) => (
            <li key={u.id}>
              <button
                className="flex h-24 w-full flex-col items-center justify-center rounded-xl border-2 border-border bg-card hover:border-ring"
                onClick={() => {
                  setUser(u);
                  setPin('');
                  setError(null);
                }}
              >
                <span className="text-lg font-semibold">{u.name}</span>
                <span className="text-xs text-muted-foreground">{u.roleName}</span>
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <div className="w-72">
          <PinPad value={pin} onChange={setPin} onSubmit={() => void submit()} />
          {error ? (
            <p role="alert" className="mt-4 text-center text-sm font-semibold text-danger">
              {error}
            </p>
          ) : null}
          <button className="btn mt-4 w-full" onClick={() => setUser(null)}>
            <ArrowLeft className="h-4 w-4" /> Not {user.name.split(' ')[0]}?
          </button>
        </div>
      )}
    </div>
  );
}
