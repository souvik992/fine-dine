import type { LoginResult, LoginUser, SetupState } from '@dinepos/shared';
import { ArrowLeft, Store } from 'lucide-react';
import { useState } from 'react';
import { ApiError } from '../api/client.js';
import { useApp } from '../app-context.js';
import { BrandMark } from '../components/Brand.js';
import { AuthBadge, AuthShell, PinLayout, roleIcon } from './AuthShell.js';
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

  if (user) {
    return (
      <AuthShell onSettings={onSettings}>
        <PinLayout
          heading={
            <>
              <BrandMark size={64} className="mx-auto mb-4 short:mb-2 short:h-12 short:w-12" />
              <h1 className="font-display text-2xl font-semibold sm:text-3xl">{state.outletName}</h1>
              <p className="mt-1 text-sm text-muted-foreground">Enter the PIN for {user.name}</p>
            </>
          }
        >
          <PinPad value={pin} onChange={setPin} onSubmit={() => void submit()} />
          {error ? (
            <p role="alert" className="mt-4 text-center text-sm font-semibold text-danger">
              {error}
            </p>
          ) : null}
          <button className="btn mt-4 h-12 w-full rounded-2xl short:mt-2 short:h-10" onClick={() => setUser(null)}>
            <ArrowLeft className="h-4 w-4" /> Not {user.name.split(' ')[0]}?
          </button>
        </PinLayout>
      </AuthShell>
    );
  }

  return (
    <AuthShell onSettings={onSettings}>
      <div className="mb-6 text-center short:mb-3">
        <AuthBadge>
          <Store className="h-8 w-8 short:h-6 short:w-6" />
        </AuthBadge>
        <h1 className="font-display text-2xl font-semibold sm:text-3xl">{state.outletName}</h1>
        <p className="mt-1 text-sm text-muted-foreground">Who is signing in?</p>
      </div>
      <ul className="grid w-full max-w-2xl grid-cols-2 gap-3 sm:grid-cols-3 short:grid-cols-4" aria-label="Staff">
        {state.users.map((u) => {
          const Icon = roleIcon(u.roleName);
          return (
            <li key={u.id}>
              <button
                className="flex min-h-32 w-full flex-col items-center justify-center gap-1.5 rounded-2xl border border-border bg-card px-2 py-4 shadow-sm transition-colors hover:border-primary short:min-h-24 short:py-2"
                onClick={() => {
                  setUser(u);
                  setPin('');
                  setError(null);
                }}
              >
                <Icon className="h-8 w-8 text-primary short:h-6 short:w-6" />
                <span className="text-center text-base font-semibold leading-tight">{u.name}</span>
                <span className="rounded-full bg-muted px-2.5 py-0.5 text-xs font-medium text-muted-foreground">{u.roleName}</span>
              </button>
            </li>
          );
        })}
      </ul>
    </AuthShell>
  );
}
