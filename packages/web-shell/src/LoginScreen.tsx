import { ApiError } from '@dinepos/client';
import type { LoginResult, LoginUser, SetupState } from '@dinepos/shared';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, Delete } from 'lucide-react';
import { useState } from 'react';
import { useShell } from './shell-context.js';

/** Who is signing in: a name, then the PIN on a big pad (docs/07). `question` e.g. "Who is taking orders?". */
export function LoginScreen({ question }: { question: string }) {
  const { api, signIn } = useShell();
  const setup = useQuery({ queryKey: ['setup'], queryFn: () => api.get<SetupState>('/v1/setup-state') });
  const [user, setUser] = useState<LoginUser | null>(null);
  const [pin, setPin] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (value = pin) => {
    if (!user || value.length < 4) return;
    setBusy(true);
    setError(null);
    try {
      signIn(await api.send<LoginResult>('POST', '/v1/sessions', { userId: user.id, pin: value }));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Cannot reach the outlet server.');
      setPin('');
    } finally {
      setBusy(false);
    }
  };
  const press = (d: string) => {
    if (pin.length < 6) setPin(pin + d);
  };

  if (!setup.data) return <p className="p-6 text-center text-muted-foreground">{setup.isError ? 'Cannot reach the outlet server.' : 'Connecting…'}</p>;
  if (!user) {
    return (
      <main className="px-4 py-6">
        <h1 className="text-center font-display text-2xl font-semibold">{setup.data.outletName}</h1>
        <p className="mb-5 text-center text-muted-foreground">{question}</p>
        <div className="grid grid-cols-2 gap-3">
          {setup.data.users.map((u) => (
            <button key={u.id} className="btn h-20 flex-col gap-0" onClick={() => setUser(u)} aria-label={u.name}>
              <span className="text-base">{u.name}</span>
              <span className="text-xs font-normal text-muted-foreground">{u.roleName}</span>
            </button>
          ))}
        </div>
      </main>
    );
  }
  return (
    <main className="flex min-h-full flex-col px-5 py-4">
      <button
        className="btn w-fit"
        onClick={() => {
          setUser(null);
          setPin('');
          setError(null);
        }}
      >
        <ArrowLeft className="h-5 w-5" /> Back
      </button>
      <h1 className="mt-4 text-center text-xl font-semibold">{user.name}</h1>
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
    </main>
  );
}
