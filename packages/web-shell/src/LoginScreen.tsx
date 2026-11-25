import { ApiError } from '@dinepos/client';
import type { LoginResult, LoginUser, SetupState } from '@dinepos/shared';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, Calculator, ChefHat, ConciergeBell, Delete, Store, UserRound, UsersRound } from 'lucide-react';
import { useState, type ComponentType, type ReactNode } from 'react';
import { BrandLogo, BrandMark } from './Brand.js';
import { useShell } from './shell-context.js';

/** An icon for a role by its name (roles are the outlet's own; unknown ones get a person). */
function roleIcon(roleName: string): ComponentType<{ className?: string }> {
  const r = roleName.toLowerCase();
  if (r.includes('cashier') || r.includes('biller')) return Calculator;
  if (r.includes('captain') || r.includes('waiter') || r.includes('steward')) return ConciergeBell;
  if (r.includes('manager')) return UsersRound;
  if (r.includes('chef') || r.includes('kitchen')) return ChefHat;
  return UserRound;
}

/** The DinePOS logo at the top, the screen's content centred below (pairing, sign-in, lock). */
export function ShellFrame({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-full flex-col">
      <header className="px-4 pt-4">
        <BrandLogo size={32} />
      </header>
      <main className="flex flex-1 flex-col justify-center px-4 py-5">{children}</main>
    </div>
  );
}

/** Dots and a big pad: the PIN on a touch screen (used by sign-in and the lock screen). */
export function PinKeys({ pin, setPin, onSubmit, busy }: { pin: string; setPin: (v: string) => void; onSubmit: () => void; busy: boolean }) {
  const press = (d: string) => {
    if (pin.length < 6) setPin(pin + d);
  };
  const key = 'btn h-16 rounded-2xl text-2xl shadow-sm';
  return (
    <>
      <div className="my-5 flex justify-center gap-3.5" aria-label={`${pin.length} digits entered`}>
        {Array.from({ length: Math.max(4, pin.length) }, (_, i) => (
          <span key={i} className={`h-4 w-4 rounded-full border-2 ${i < pin.length ? 'border-primary bg-primary' : 'border-foreground/70'}`} />
        ))}
      </div>
      <div className="mx-auto grid w-full max-w-xs grid-cols-3 gap-2.5">
        {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((d) => (
          <button key={d} className={key} onClick={() => press(d)} aria-label={d}>
            {d}
          </button>
        ))}
        <button className={key} onClick={() => setPin(pin.slice(0, -1))} aria-label="Delete last digit">
          <Delete className="h-6 w-6" />
        </button>
        <button className={key} onClick={() => press('0')} aria-label="0">
          0
        </button>
        <button className={`${key} btn-primary text-xl`} onClick={onSubmit} disabled={pin.length < 4 || busy}>
          OK
        </button>
      </div>
    </>
  );
}

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

  if (!setup.data) return <p className="p-6 text-center text-muted-foreground">{setup.isError ? 'Cannot reach the outlet server.' : 'Connecting…'}</p>;
  if (!user) {
    return (
      <ShellFrame>
        <div className="mb-5 text-center">
          <div className="mx-auto mb-3 flex h-16 w-16 items-center justify-center rounded-2xl bg-primary/10 text-primary">
            <Store className="h-8 w-8" />
          </div>
          <h1 className="font-display text-2xl font-semibold">{setup.data.outletName}</h1>
          <p className="mt-1 text-muted-foreground">{question}</p>
        </div>
        <div className="mx-auto grid w-full max-w-xl grid-cols-2 gap-3 sm:grid-cols-3">
          {setup.data.users.map((u) => {
            const Icon = roleIcon(u.roleName);
            return (
              <button key={u.id} className="btn h-auto min-h-32 flex-col gap-1.5 rounded-2xl px-2 py-4 shadow-sm" onClick={() => setUser(u)} aria-label={u.name}>
                <Icon className="h-8 w-8 text-primary" />
                <span className="text-center text-base leading-tight">{u.name}</span>
                <span className="rounded-full bg-secondary px-2.5 py-0.5 text-xs font-medium text-muted-foreground">{u.roleName}</span>
              </button>
            );
          })}
        </div>
      </ShellFrame>
    );
  }
  return (
    <ShellFrame>
      <div className="text-center">
        <BrandMark size={60} className="mx-auto mb-3" />
        <h1 className="font-display text-2xl font-semibold">{setup.data.outletName}</h1>
        <p className="mt-1 text-sm text-muted-foreground">Enter the PIN for {user.name}</p>
      </div>
      {error ? (
        <p role="alert" className="mt-3 text-center font-semibold text-danger">
          {error}
        </p>
      ) : null}
      <PinKeys pin={pin} setPin={setPin} onSubmit={() => void submit()} busy={busy} />
      <button
        className="btn mx-auto mt-3 w-full max-w-xs rounded-2xl"
        onClick={() => {
          setUser(null);
          setPin('');
          setError(null);
        }}
      >
        <ArrowLeft className="h-5 w-5" /> Not {user.name.split(' ')[0]}?
      </button>
    </ShellFrame>
  );
}
