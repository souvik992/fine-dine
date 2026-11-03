import { ApiError } from '@dinepos/client';
import { Smartphone } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useApp } from '../app-context.js';

interface Ticket {
  requestId: string;
  secret: string;
  code: string;
}

/** Pair this phone (P2-02): a name, then a 6-digit code that a manager approves in Settings › Devices on a terminal. */
export function PairScreen() {
  const { api, setDeviceToken } = useApp();
  const [name, setName] = useState('');
  const [ticket, setTicket] = useState<Ticket | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [expired, setExpired] = useState(false);

  const ask = async () => {
    setError(null);
    setExpired(false);
    try {
      setTicket(await api.send<Ticket>('POST', '/v1/pairing-requests', { name: name.trim(), kind: 'captain' }));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Cannot reach the outlet server. Is this phone on the shop Wi-Fi?');
    }
  };

  useEffect(() => {
    if (!ticket) return;
    let stop = false;
    const tick = async () => {
      if (stop) return;
      try {
        const r = await api.send<{ status: string; deviceToken?: string }>('POST', `/v1/pairing-requests/${ticket.requestId}/collect`, { secret: ticket.secret });
        if (r.status === 'paired' && r.deviceToken) return setDeviceToken(r.deviceToken);
        if (r.status === 'expired') return setExpired(true);
      } catch {
        // Wi-Fi blip: keep asking
      }
      if (!stop) setTimeout(() => void tick(), 2000);
    };
    void tick();
    return () => {
      stop = true;
    };
  }, [api, ticket, setDeviceToken]);

  return (
    <main className="flex min-h-full flex-col justify-center px-5 py-8">
      <Smartphone className="mx-auto h-12 w-12 text-primary" />
      <h1 className="mt-3 text-center font-display text-3xl font-semibold">Pair this phone</h1>
      <p className="mt-2 text-center text-muted-foreground">Only paired phones can take orders.</p>
      {!ticket || expired ? (
        <form
          className="mt-8"
          onSubmit={(e) => {
            e.preventDefault();
            if (name.trim()) void ask();
          }}
        >
          <label className="block font-semibold">
            Name for this phone
            <input autoFocus className="input mt-2" maxLength={40} placeholder="Ravi's phone" value={name} onChange={(e) => setName(e.target.value)} aria-label="Phone name" />
          </label>
          {expired ? <p className="mt-3 font-semibold text-danger">That code expired. Ask for a new one.</p> : null}
          {error ? (
            <p role="alert" className="mt-3 font-semibold text-danger">
              {error}
            </p>
          ) : null}
          <button type="submit" className="btn btn-primary mt-5 w-full" disabled={!name.trim()}>
            {expired ? 'Get a new code' : 'Get a pairing code'}
          </button>
        </form>
      ) : (
        <div className="mt-8 text-center" role="status">
          <p>Ask a manager to open Settings › Devices on a billing terminal and approve:</p>
          <p className="my-6 font-mono text-5xl font-bold tracking-[0.25em]" data-testid="pairing-code">
            {ticket.code}
          </p>
          <p className="text-muted-foreground">Waiting for approval… (10 minutes)</p>
        </div>
      )}
    </main>
  );
}
