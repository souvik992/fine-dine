// Table QR add-on: screens in the DinePOS terminal (loaded after the terminal checked the signature, ADR-0004).
// Uses the terminal's React (window.__DINEPOS__), the terminal's .btn/.input classes and its own `qr:` utilities.
import qrcode from 'qrcode-generator';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { formatRupees, type QrSettings, type RequestKind, type RequestStatus } from '../logic.js';
import './ui.css';

interface Host {
  api: { get<T>(path: string): Promise<T>; post<T>(path: string, body?: unknown): Promise<T> };
  can(right: string, withPin?: boolean): boolean;
  back: () => void;
}
interface Request {
  id: string;
  tableId: string;
  table: string;
  kind: RequestKind;
  status: RequestStatus;
  lines: Array<{ label: string; qty: number; note: string | null; amountPaise: number }>;
  amountPaise: number | null;
  covers: number | null;
  note: string | null;
  reason: string | null;
  createdAt: string;
  handledAt: string | null;
  handledBy: string | null;
}
interface SettingsData {
  settings: QrSettings;
  upiReady: boolean;
  outletName: string;
  baseUrl: string;
  addresses: string[];
  port: number;
  tables: Array<{ id: string; label: string; area: string; url: string | null }>;
}

const message = (e: unknown) => (e instanceof Error ? e.message : 'Could not reach the outlet server.');
const ago = (iso: string) => {
  const m = Math.max(0, Math.floor((Date.now() - Date.parse(iso)) / 60_000));
  return m < 1 ? 'just now' : `${m} min ago`;
};
const KIND: Record<RequestKind, string> = { order: 'QR order', waiter: 'Waiter called', pay: 'Says paid' };

function chime(): void {
  try {
    const ctx = new AudioContext();
    [660, 990, 660].forEach((hz, i) => {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.frequency.value = hz;
      g.gain.setValueAtTime(0.0001, ctx.currentTime + i * 0.2);
      g.gain.exponentialRampToValueAtTime(0.2, ctx.currentTime + i * 0.2 + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + i * 0.2 + 0.18);
      o.connect(g).connect(ctx.destination);
      o.start(ctx.currentTime + i * 0.2);
      o.stop(ctx.currentTime + i * 0.2 + 0.2);
    });
    setTimeout(() => void ctx.close(), 1000);
  } catch {
    // no audio
  }
}

/** The requests list, refreshed every few seconds (and right after an action). */
function useRequests(host: Host, everyMs = 4000) {
  const [data, setData] = useState<{ requests: Request[]; settings: QrSettings } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => {
    try {
      setData(await host.api.get('/requests'));
      setError(null);
    } catch (e) {
      setError(message(e));
    }
  }, [host]);
  useEffect(() => {
    void load();
    const t = setInterval(() => void load(), everyMs);
    return () => clearInterval(t);
  }, [load, everyMs]);
  return { data, error, reload: load };
}

/** Accept / reject / done / confirm for one request. */
function Actions({ host, r, onDone }: { host: Host; r: Request; onDone: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState('');
  const act = async (path: string, body?: unknown) => {
    setBusy(true);
    setError(null);
    try {
      await host.api.post(`/requests/${r.id}/${path}`, body ?? {});
      setRejecting(false);
      onDone();
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  };
  if (r.status !== 'pending') return null;
  return (
    <div className="qr:mt-2 qr:space-y-2">
      {rejecting ? (
        <form
          className="qr:flex qr:gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            void act('reject', { reason });
          }}
        >
          <input className="input" autoFocus placeholder={r.kind === 'pay' ? 'e.g. Money not received' : 'Why, for the guest'} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={120} />
          <button className="btn" disabled={busy || !reason.trim()}>
            Send
          </button>
          <button type="button" className="btn" onClick={() => setRejecting(false)}>
            Back
          </button>
        </form>
      ) : (
        <div className="qr:flex qr:flex-wrap qr:gap-2">
          {r.kind === 'order' ? (
            <>
              <button className="btn btn-primary" disabled={busy || !host.can('kot.fire')} onClick={() => void act('accept')} data-qr-action="accept">
                Accept · send KOT
              </button>
              <button className="btn" disabled={busy || !host.can('order.edit')} onClick={() => setRejecting(true)}>
                Reject
              </button>
            </>
          ) : r.kind === 'waiter' ? (
            <button className="btn btn-primary" disabled={busy} onClick={() => void act('done')} data-qr-action="done">
              On my way · done
            </button>
          ) : (
            <>
              <button className="btn btn-primary" disabled={busy || !host.can('bill.settle')} onClick={() => void act('confirm-pay')} data-qr-action="confirm-pay">
                Money received · settle UPI
              </button>
              <button className="btn" disabled={busy || !host.can('order.edit')} onClick={() => setRejecting(true)}>
                Not received
              </button>
            </>
          )}
        </div>
      )}
      {error ? (
        <p role="alert" className="qr:text-sm qr:font-semibold qr:text-danger">
          {error}
        </p>
      ) : null}
    </div>
  );
}

function RequestCard({ host, r, onDone, compact }: { host: Host; r: Request; onDone: () => void; compact?: boolean }) {
  return (
    <li className={`qr:rounded-xl qr:border qr:bg-card qr:p-3 ${r.status === 'pending' ? (r.kind === 'pay' ? 'qr:border-warn' : 'qr:border-danger') : 'qr:border-border qr:opacity-80'}`} data-qr-request={r.kind}>
      <div className="qr:flex qr:items-baseline qr:gap-2">
        <span className="qr:text-lg qr:font-bold">{r.table}</span>
        <span className={`qr:rounded qr:px-1.5 qr:text-xs qr:font-bold ${r.status === 'pending' ? (r.kind === 'pay' ? 'qr:bg-warn qr:text-black' : 'qr:bg-danger qr:text-white') : 'qr:bg-black/10'}`}>{KIND[r.kind]}</span>
        <span className="qr:ml-auto qr:text-xs qr:text-muted-foreground">{ago(r.createdAt)}</span>
      </div>
      {r.kind === 'order' ? (
        <ul className="qr:mt-1 qr:text-sm">
          {r.lines.slice(0, compact ? 4 : 50).map((l, i) => (
            <li key={i}>
              <b className="qr:tabular-nums">{l.qty} ×</b> {l.label}
              {l.note ? <span className="qr:text-warn"> · {l.note}</span> : null}
            </li>
          ))}
          {compact && r.lines.length > 4 ? <li className="qr:text-muted-foreground">+ {r.lines.length - 4} more</li> : null}
          <li className="qr:mt-1 qr:text-xs qr:text-muted-foreground">
            {r.covers ? `${r.covers} guests · ` : ''}about {formatRupees(r.amountPaise ?? 0)} before tax
          </li>
        </ul>
      ) : null}
      {r.kind === 'pay' ? <p className="qr:mt-1 qr:text-sm">The guest says they paid {formatRupees(r.amountPaise ?? 0)} by UPI. Check your bank app or soundbox first.</p> : null}
      {r.status !== 'pending' ? (
        <p className="qr:mt-1 qr:text-xs qr:text-muted-foreground">
          {r.status === 'accepted' ? 'Accepted' : r.status === 'rejected' ? `Rejected: ${r.reason ?? ''}` : 'Done'}
          {r.handledBy ? ` by ${r.handledBy}` : ''}
        </p>
      ) : null}
      <Actions host={host} r={r} onDone={onDone} />
    </li>
  );
}

/** Always on: a stack of waiting guest requests in the corner, with a chime for each new one. */
function Alerts({ host }: { host: Host }) {
  const { data, reload } = useRequests(host);
  const seen = useRef<Set<string> | null>(null);
  const [hidden, setHidden] = useState(false);
  const pending = (data?.requests ?? []).filter((r) => r.status === 'pending');
  useEffect(() => {
    if (!data) return;
    const ids = new Set(pending.map((r) => r.id));
    if (seen.current && [...ids].some((id) => !seen.current!.has(id))) {
      chime();
      setHidden(false);
    }
    seen.current = ids;
  }, [data]);
  if (!pending.length || !data?.settings.enabled) return null;
  if (hidden) {
    return (
      <button className="btn btn-primary qr:fixed qr:bottom-4 qr:left-4 qr:z-40 qr:shadow-xl" onClick={() => setHidden(false)} data-qr-alerts-collapsed>
        Table QR · {pending.length} waiting
      </button>
    );
  }
  return (
    <aside className="qr:fixed qr:bottom-4 qr:left-4 qr:z-40 qr:w-96 qr:max-w-[calc(100vw-2rem)] qr:rounded-2xl qr:border qr:border-border qr:bg-background qr:p-3 qr:shadow-2xl" aria-label="Table QR requests" data-qr-alerts>
      <div className="qr:mb-2 qr:flex qr:items-center">
        <p className="qr:font-bold">Table QR · {pending.length} waiting</p>
        <button className="btn qr:ml-auto qr:h-8" onClick={() => setHidden(true)}>
          Hide
        </button>
      </div>
      <ul className="qr:max-h-[60vh] qr:space-y-2 qr:overflow-y-auto">
        {pending.slice(0, 5).map((r) => (
          <RequestCard key={r.id} host={host} r={r} onDone={() => void reload()} compact />
        ))}
      </ul>
      {pending.length > 5 ? <p className="qr:mt-2 qr:text-sm qr:text-muted-foreground">+ {pending.length - 5} more on the Table QR screen</p> : null}
    </aside>
  );
}

/** Full screen: waiting requests first, then the last hours' handled ones. */
function Screen({ host }: { host: Host }) {
  const { data, error, reload } = useRequests(host);
  const list = data?.requests ?? [];
  return (
    <div className="qr:flex qr:h-full qr:flex-col">
      <header className="qr:flex qr:items-center qr:gap-3 qr:border-b qr:border-border qr:bg-card qr:px-4 qr:py-2.5">
        <button className="btn" onClick={host.back}>
          ← Floor
        </button>
        <h1 className="qr:font-display qr:text-xl qr:font-semibold">Table QR</h1>
        {data && !data.settings.enabled ? <span className="qr:text-sm qr:text-danger">Switched off in Settings › Table QR: guests cannot order.</span> : null}
        <span className="qr:ml-auto qr:text-sm qr:text-muted-foreground">{data ? `${data.settings.acceptMode === 'auto' ? 'Orders go to the kitchen at once' : 'Staff accept each order'}` : ''}</span>
      </header>
      <main className="qr:min-h-0 qr:flex-1 qr:overflow-y-auto qr:p-5">
        {error ? <p role="alert" className="qr:text-danger">{error}</p> : null}
        {data && list.length === 0 ? <p className="qr:mt-16 qr:text-center qr:text-muted-foreground">Nothing from the tables yet. Guest orders, waiter calls and payments appear here.</p> : null}
        <ul className="qr:grid qr:grid-cols-[repeat(auto-fill,minmax(320px,1fr))] qr:items-start qr:gap-3">
          {list.map((r) => (
            <RequestCard key={r.id} host={host} r={r} onDone={() => void reload()} />
          ))}
        </ul>
      </main>
    </div>
  );
}

function qrImage(url: string): string {
  const q = qrcode(0, 'M');
  q.addData(url);
  q.make();
  return q.createDataURL(6, 2);
}

function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="qr:block qr:space-y-1">
      <span className="qr:block qr:text-sm qr:font-semibold">{label}</span>
      {children}
      {hint ? <span className="qr:block qr:text-xs qr:text-muted-foreground">{hint}</span> : null}
    </label>
  );
}

/** Settings › Table QR: switch on, how orders are accepted, UPI, the address in the codes, and the printable codes. */
function Settings({ host }: { host: Host }) {
  const [data, setData] = useState<SettingsData | null>(null);
  const [form, setForm] = useState<QrSettings | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ text: string; error?: boolean } | null>(null);
  const load = useCallback(async () => {
    const d = await host.api.get<SettingsData>('/settings');
    setData(d);
    setForm(d.settings);
  }, [host]);
  useEffect(() => {
    load().catch((e) => setNote({ text: message(e), error: true }));
  }, [load]);
  if (!data || !form) return <p className="qr:text-muted-foreground">{note?.text ?? 'Loading…'}</p>;

  const run = async (fn: () => Promise<unknown>, ok: string) => {
    setBusy(true);
    setNote(null);
    try {
      await fn();
      await load();
      setNote({ text: ok });
    } catch (e) {
      setNote({ text: message(e), error: true });
    } finally {
      setBusy(false);
    }
  };
  const withCodes = data.tables.filter((t) => t.url);
  const addressChoices = data.addresses.map((a) => `http://${a}:${data.port}`);

  return (
    <section className="qr:max-w-4xl qr:space-y-6">
      <div>
        <h2 className="qr:font-display qr:text-2xl qr:font-semibold">Table QR</h2>
        <p className="qr:text-sm qr:text-muted-foreground">Guests scan the code on their table to see the menu, order, call a waiter, ask for the bill and pay by UPI. Phones must be on the outlet’s Wi-Fi.</p>
      </div>

      <form
        className="qr:space-y-4 qr:rounded-xl qr:border qr:border-border qr:bg-card qr:p-5"
        onSubmit={(e) => {
          e.preventDefault();
          void run(() => host.api.post('/settings', form), 'Saved.');
        }}
      >
        <label className="qr:flex qr:items-center qr:gap-3">
          <input type="checkbox" checked={form.enabled} onChange={(e) => setForm({ ...form, enabled: e.target.checked })} className="qr:h-5 qr:w-5" />
          <span className="qr:font-semibold">Take orders from table QR codes</span>
        </label>
        <fieldset className="qr:space-y-2">
          <legend className="qr:text-sm qr:font-semibold">When a guest orders</legend>
          <label className="qr:flex qr:items-start qr:gap-2">
            <input type="radio" name="mode" checked={form.acceptMode === 'staff'} onChange={() => setForm({ ...form, acceptMode: 'staff' })} className="qr:mt-1" />
            <span>
              <b>A captain or cashier accepts it first</b> (recommended). It waits on this screen and on the table tile; Accept sends the KOT.
            </span>
          </label>
          <label className="qr:flex qr:items-start qr:gap-2">
            <input type="radio" name="mode" checked={form.acceptMode === 'auto'} onChange={() => setForm({ ...form, acceptMode: 'auto' })} className="qr:mt-1" />
            <span>
              <b>Straight to the kitchen.</b> The KOT prints at once; a table nobody seated is seated for the guests.
            </span>
          </label>
        </fieldset>
        <label className="qr:flex qr:items-start qr:gap-3">
          <input type="checkbox" checked={form.payOnline} onChange={(e) => setForm({ ...form, payOnline: e.target.checked })} className="qr:mt-1 qr:h-5 qr:w-5" />
          <span>
            <b>Guests may pay a printed bill by UPI</b> from their phone (their UPI app opens with the exact amount; the cashier confirms once the money is in).
            {!data.upiReady ? <span className="qr:block qr:text-sm qr:text-danger">Set the outlet’s UPI ID first in Settings › Outlet & bills.</span> : null}
          </span>
        </label>
        <Field label="Address in the codes" hint="The main PC’s address on the outlet Wi-Fi. Keep this PC’s address fixed (reserve it in the router), or the printed codes stop working.">
          <select className="input" value={form.baseUrl} onChange={(e) => setForm({ ...form, baseUrl: e.target.value })}>
            <option value="">Automatic ({data.baseUrl || 'no network address found'})</option>
            {addressChoices.map((a) => (
              <option key={a} value={a}>
                {a}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Welcome line" hint="Shown at the top of the guest menu, e.g. “Order here, pay at the counter”.">
          <input className="input" maxLength={200} value={form.welcome} onChange={(e) => setForm({ ...form, welcome: e.target.value })} />
        </Field>
        <div className="qr:flex qr:items-center qr:gap-3">
          <button className="btn btn-primary" disabled={busy}>
            Save
          </button>
          {note ? <span className={`qr:text-sm ${note.error ? 'qr:text-danger' : 'qr:text-ok'}`}>{note.text}</span> : null}
        </div>
      </form>

      <div className="qr:rounded-xl qr:border qr:border-border qr:bg-card qr:p-5">
        <div className="qr:mb-3 qr:flex qr:flex-wrap qr:items-center qr:gap-2">
          <h3 className="qr:mr-auto qr:font-semibold">Codes for the tables ({withCodes.length} of {data.tables.length})</h3>
          <button className="btn" disabled={busy} onClick={() => void run(() => host.api.post('/codes', {}), 'Codes made for the tables that had none.')}>
            Make missing codes
          </button>
          <button className="btn btn-primary" disabled={!withCodes.length} onClick={() => window.print()}>
            Print codes
          </button>
        </div>
        <ul className="qr:grid qr:grid-cols-[repeat(auto-fill,minmax(150px,1fr))] qr:gap-3">
          {data.tables.map((t) => (
            <li key={t.id} className="qr:rounded-lg qr:border qr:border-border qr:p-2 qr:text-center" data-qr-table={t.label}>
              <p className="qr:font-bold">{t.label}</p>
              <p className="qr:text-xs qr:text-muted-foreground">{t.area}</p>
              {t.url ? <img src={qrImage(t.url)} alt={`QR code for ${t.label}`} className="qr:mx-auto qr:my-1 qr:w-28" /> : <p className="qr:my-6 qr:text-xs qr:text-muted-foreground">No code yet</p>}
              {t.url ? (
                <button
                  className="btn qr:h-8 qr:w-full qr:text-xs"
                  disabled={busy}
                  title="Makes a new code; the old printed one stops working"
                  onClick={() => {
                    if (window.confirm(`Make a new code for ${t.label}? The printed one stops working.`)) void run(() => host.api.post('/codes', { tableIds: [t.id], renew: true }), `New code for ${t.label}. Print it.`);
                  }}
                >
                  New code
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      </div>

      {/* printed instead of the screen (ui.css); straight under <body> so no scrolling box clips it */}
      {createPortal(
      <div className="tableqr-print" aria-hidden>
        {withCodes.map((t) => (
          <div key={t.id} className="tableqr-card">
            <p className="tableqr-outlet">{data.outletName}</p>
            <img src={qrImage(t.url!)} alt="" />
            <p className="tableqr-table">Table {t.label}</p>
            <p className="tableqr-hint">Scan to see the menu and order · connect to our Wi-Fi first</p>
          </div>
        ))}
      </div>,
      document.body,
      )}
    </section>
  );
}

window.__DINEPOS__?.register('tableqr', {
  nav: { label: 'Table QR', title: 'Orders, waiter calls and payments from table QR codes', Screen },
  settings: { label: 'Table QR', hint: 'Guest ordering from table codes, UPI, print codes', right: 'admin', Screen: Settings },
  overlay: Alerts,
});

declare global {
  interface Window {
    __DINEPOS__?: { register(id: string, reg: unknown): void };
  }
}
