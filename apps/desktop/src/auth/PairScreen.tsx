import { Link2, RefreshCw, Settings } from 'lucide-react';
import { useEffect, useState } from 'react';
import { ApiError } from '../api/client.js';
import { useApp } from '../app-context.js';

interface Ticket {
  requestId: string;
  secret: string;
  code: string;
  expiresAt: string;
}

/**
 * Pair this terminal (P2-02, docs/07): it asks the outlet server, shows a 6-digit code, and a manager approves the
 * code in Settings › Devices on a terminal that is already paired. The token is then collected and stored here.
 */
export function PairScreen({ onSettings }: { onSettings: () => void }) {
  const { api, serverUrl, setDeviceToken } = useApp();
  const [name, setName] = useState('');
  const [ticket, setTicket] = useState<Ticket | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [expired, setExpired] = useState(false);

  const ask = async () => {
    setError(null);
    setExpired(false);
    try {
      setTicket(await api.send<Ticket>('POST', '/v1/pairing-requests', { name: name.trim(), kind: 'terminal' }));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Cannot reach the outlet server.');
    }
  };

  // Ask every 2 seconds whether a manager has approved the code.
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
        // server restarting or network blip: keep asking
      }
      if (!stop) setTimeout(() => void tick(), 2000);
    };
    void tick();
    return () => {
      stop = true;
    };
  }, [api, ticket, setDeviceToken]);

  return (
    <div className="flex h-full flex-col items-center justify-center px-6">
      <button className="btn absolute right-4 top-4 h-10 w-10 px-0" onClick={onSettings} aria-label="Server settings" title="Server settings">
        <Settings className="h-5 w-5" />
      </button>
      <div className="w-full max-w-md rounded-2xl border border-border bg-card p-8 text-center">
        <Link2 className="mx-auto h-10 w-10 text-primary" />
        <h1 className="mt-3 font-display text-2xl font-semibold">Pair this terminal</h1>
        <p className="mt-1 text-sm text-muted-foreground">The outlet server at {serverUrl} does not know this terminal yet. Only paired terminals can see orders.</p>
        {!ticket || expired ? (
          <form
            className="mt-6 text-left"
            onSubmit={(e) => {
              e.preventDefault();
              if (name.trim()) void ask();
            }}
          >
            <label className="block text-sm font-semibold">
              Name for this terminal
              <input data-autofocus autoFocus className="input mt-1" maxLength={40} placeholder="Counter 2" value={name} onChange={(e) => setName(e.target.value)} aria-label="Terminal name" />
            </label>
            {expired ? <p className="mt-2 text-sm font-semibold text-danger">That code expired. Ask for a new one.</p> : null}
            {error ? (
              <p role="alert" className="mt-2 text-sm font-semibold text-danger">
                {error}
              </p>
            ) : null}
            <button type="submit" className="btn btn-primary mt-4 w-full" disabled={!name.trim()}>
              {expired ? 'Get a new code' : 'Get a pairing code'}
            </button>
          </form>
        ) : (
          <div className="mt-6" role="status">
            <p className="text-sm">Ask a manager to open Settings › Devices on a paired terminal and enter:</p>
            <p className="my-4 font-mono text-5xl font-bold tracking-[0.3em]" data-testid="pairing-code">
              {ticket.code}
            </p>
            <p className="flex items-center justify-center gap-2 text-sm text-muted-foreground">
              <RefreshCw className="h-4 w-4 animate-spin" /> Waiting for approval… (the code lasts 10 minutes)
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
