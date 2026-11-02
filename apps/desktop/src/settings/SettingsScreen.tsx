import { ArrowLeft, CheckCircle2, PlugZap } from 'lucide-react';
import { useState } from 'react';
import { ApiClient, ApiError } from '../api/client.js';
import { normaliseServerUrl } from '../api/settings.js';
import { useApp } from '../app-context.js';

interface Health {
  ok: boolean;
  version: string;
  businessDate: string | null;
}

/** Terminal settings: which outlet server this terminal talks to (docs/01: static IP recommended). */
export function SettingsScreen({ onBack }: { onBack: () => void }) {
  const { serverUrl, setServerUrl } = useApp();
  const [value, setValue] = useState(serverUrl);
  const [state, setState] = useState<{ kind: 'idle' | 'testing' } | { kind: 'ok'; health: Health; url: string } | { kind: 'error'; message: string }>({ kind: 'idle' });

  const test = async (): Promise<string | null> => {
    let url: string;
    try {
      url = normaliseServerUrl(value);
    } catch (e) {
      setState({ kind: 'error', message: (e as Error).message });
      return null;
    }
    setState({ kind: 'testing' });
    try {
      const health = await new ApiClient({ baseUrl: url, timeoutMs: 4_000 }).get<Health>('/v1/health');
      setState({ kind: 'ok', health, url });
      return url;
    } catch (e) {
      setState({ kind: 'error', message: e instanceof ApiError ? e.message : 'The server did not answer.' });
      return null;
    }
  };

  return (
    <div className="mx-auto max-w-xl px-6 py-8">
      <button className="btn mb-6" onClick={onBack}>
        <ArrowLeft className="h-4 w-4" /> Back to floor
      </button>
      <h1 className="font-display text-3xl font-semibold">Terminal settings</h1>
      <p className="mb-6 mt-1 text-sm text-muted-foreground">This terminal is a client of the outlet server on the master PC.</p>

      <form
        className="rounded-xl border border-border bg-card p-5"
        onSubmit={(e) => {
          e.preventDefault();
          void test().then((url) => {
            if (url) {
              setServerUrl(url);
              onBack();
            }
          });
        }}
      >
        <label htmlFor="server" className="block text-sm font-semibold">
          Outlet server address
        </label>
        <p className="mb-2 text-xs text-muted-foreground">The master PC&apos;s IP address, e.g. 192.168.1.10. Port 7420 is added if you leave it out.</p>
        <input id="server" className="input" value={value} onChange={(e) => setValue(e.target.value)} spellCheck={false} autoComplete="off" />
        <div aria-live="polite" className="mt-3 min-h-6 text-sm">
          {state.kind === 'testing' ? <span className="text-muted-foreground">Checking…</span> : null}
          {state.kind === 'ok' ? (
            <span className="flex items-center gap-1.5 font-semibold text-ok">
              <CheckCircle2 className="h-4 w-4" /> Connected to DinePOS {state.health.version}
              {state.health.businessDate ? `, business date ${state.health.businessDate}` : ''}
            </span>
          ) : null}
          {state.kind === 'error' ? (
            <span role="alert" className="font-semibold text-danger">
              {state.message}
            </span>
          ) : null}
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <button type="button" className="btn" onClick={() => void test()} disabled={state.kind === 'testing'}>
            <PlugZap className="h-4 w-4" /> Test connection
          </button>
          <button type="submit" className="btn btn-primary" disabled={state.kind === 'testing'}>
            Save and connect
          </button>
        </div>
      </form>
    </div>
  );
}
