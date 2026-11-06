import qrcode from 'qrcode-generator';
import { AlertTriangle, CircleCheck, Cloud, DatabaseBackup, FolderOpen, Monitor, Play, Power, Printer, QrCode, RotateCcw, Server, Smartphone, Square, TabletSmartphone } from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';

type Phase = 'starting' | 'running' | 'stopping' | 'stopped' | 'crashed' | 'external';
interface LogLine {
  at: string;
  level: 'info' | 'warn' | 'error';
  text: string;
}
interface Health {
  version?: string;
  businessDate?: string | null;
  uptimeSec?: number;
  licence?: { state: string; message: string; daysLeft?: number; canOpenDay?: boolean };
  backup?: { lastAt: string | null; ageMin: number | null; ok: boolean; error: string | null };
}
export interface Snapshot {
  phase: Phase;
  pid: number | null;
  restarts: number;
  lastExit: string | null;
  port: number;
  dataDir: string;
  addresses: string[];
  health: Health | null;
  devices: Array<{ id: string; name: string; kind: string; lastSeenAt: string | null; master?: boolean; revokedAt?: string | null }>;
  pendingPairings: number;
  printers: Array<{ id: string; name: string; status: string; lastError?: string; agent?: { name: string } }>;
  cloud: { enabled: boolean; paired: boolean; connection: string; deviceUrl: string | null } | null;
  log: LogLine[];
  version: string;
}
interface Bridge {
  snapshot(): Promise<Snapshot>;
  start(): Promise<void>;
  stop(): Promise<void>;
  restart(): Promise<void>;
  openData(): Promise<void>;
  openLogs(): Promise<void>;
  openTerminal(): Promise<void>;
  quit(): Promise<void>;
}
declare global {
  interface Window {
    dineposServer?: Bridge;
  }
}

const PHASE: Record<Phase, { label: string; tone: string }> = {
  running: { label: 'Running', tone: 'bg-ok text-white' },
  starting: { label: 'Starting…', tone: 'bg-warn text-black' },
  stopping: { label: 'Stopping…', tone: 'bg-warn text-black' },
  stopped: { label: 'Stopped', tone: 'bg-danger text-white' },
  crashed: { label: 'Stopped by itself: restarting', tone: 'bg-danger text-white' },
  external: { label: 'Running (started elsewhere)', tone: 'bg-ok text-white' },
};
const KIND: Record<string, string> = { terminal: 'Billing terminal', captain: 'Captain phone', kds: 'Kitchen screen' };

export function ago(iso: string | null | undefined, now = Date.now()): string {
  if (!iso) return 'never';
  const s = Math.max(0, Math.round((now - Date.parse(iso)) / 1000));
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86_400) return `${Math.floor(s / 3600)} h ago`;
  return `${Math.floor(s / 86_400)} d ago`;
}
export function uptime(sec: number | undefined): string {
  if (sec === undefined) return '';
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  return h ? `${h} h ${m} min` : `${m} min`;
}
function qr(text: string): string {
  const q = qrcode(0, 'M');
  q.addData(text);
  q.make();
  return q.createDataURL(4, 1);
}

function Card({ title, icon, children, action, className = '' }: { title: string; icon: ReactNode; children: ReactNode; action?: ReactNode; className?: string }) {
  return (
    <section className={`rounded-xl border border-border bg-card p-4 ${className}`} aria-label={title}>
      <div className="mb-3 flex items-center gap-2">
        <span className="text-muted-foreground">{icon}</span>
        <h2 className="font-semibold">{title}</h2>
        <span className="ml-auto">{action}</span>
      </div>
      {children}
    </section>
  );
}

function Dot({ ok }: { ok: boolean }) {
  return <span className={`inline-block h-2.5 w-2.5 shrink-0 rounded-full ${ok ? 'bg-ok' : 'bg-danger'}`} aria-hidden />;
}

export function ServerPanel({ bridge }: { bridge: Bridge }) {
  const [s, setS] = useState<Snapshot | null>(null);
  const [busy, setBusy] = useState(false);
  const [problemsOnly, setProblemsOnly] = useState(false);
  const logEnd = useRef<HTMLDivElement>(null);
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const next = await bridge.snapshot();
        if (alive) setS(next);
      } catch {
        // the main process is closing
      }
      setNow(Date.now());
    };
    void load();
    const t = setInterval(() => void load(), 1000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [bridge]);
  const lines = useMemo(() => (s ? (problemsOnly ? s.log.filter((l) => l.level !== 'info') : s.log).slice(-300) : []), [s, problemsOnly]);
  // keep the log box at its newest line (only the box scrolls, never the window)
  useEffect(() => {
    const box = logEnd.current?.parentElement;
    if (box) box.scrollTop = box.scrollHeight;
  }, [lines.length]);

  if (!s) return <main className="flex h-full items-center justify-center text-muted-foreground">Starting DinePOS Server…</main>;
  const act = async (fn: () => Promise<void>) => {
    setBusy(true);
    try {
      await fn();
    } finally {
      setBusy(false);
    }
  };
  const running = s.phase === 'running' || s.phase === 'external';
  const h = s.health;
  const devices = s.devices.filter((d) => !d.revokedAt && !d.master);
  const online = (d: { lastSeenAt: string | null }) => !!d.lastSeenAt && now - Date.parse(d.lastSeenAt) < 3 * 60_000;
  const addresses = s.addresses.length ? s.addresses : ['127.0.0.1'];
  const printerProblems = s.printers.filter((p) => p.status !== 'ok').length;

  return (
    <div className="flex h-full flex-col">
      <header className="flex flex-wrap items-center gap-3 border-b border-border bg-card px-5 py-3">
        <Server className="h-6 w-6 text-primary" />
        <h1 className="font-display text-2xl font-semibold">DinePOS Server</h1>
        <span className={`rounded-full px-3 py-1 text-sm font-bold ${PHASE[s.phase].tone}`} data-testid="server-phase">
          {PHASE[s.phase].label}
        </span>
        <span className="text-sm text-muted-foreground">
          v{h?.version ?? s.version}
          {running && h?.uptimeSec !== undefined ? ` · up ${uptime(h.uptimeSec)}` : ''}
          {s.restarts ? ` · restarted ${s.restarts}×` : ''}
        </span>
        <span className="ml-auto flex flex-wrap gap-2">
          <button className="btn" disabled={busy || !running} onClick={() => void bridge.openTerminal()} title="Open the billing app on this PC">
            <Monitor className="h-4 w-4" /> Open billing
          </button>
          {s.phase === 'external' ? null : (
            <button className="btn" disabled={busy || s.phase === 'stopped' || s.phase === 'stopping'} onClick={() => void act(() => bridge.restart())}>
              <RotateCcw className="h-4 w-4" /> Restart
            </button>
          )}
          {s.phase === 'stopped' ? (
            <button className="btn btn-primary" disabled={busy} onClick={() => void act(() => bridge.start())}>
              <Play className="h-4 w-4" /> Start
            </button>
          ) : s.phase === 'external' ? null : (
            <button
              className="btn"
              disabled={busy || s.phase === 'stopping'}
              onClick={() => {
                if (window.confirm('Stop the server? Billing terminals, captain phones and kitchen screens stop working until you start it again.')) void act(() => bridge.stop());
              }}
            >
              <Square className="h-4 w-4" /> Stop
            </button>
          )}
          <button className="btn" onClick={() => void bridge.quit()} title="Stop the server and close this window">
            <Power className="h-4 w-4" /> Quit
          </button>
        </span>
      </header>

      <main className="min-h-0 flex-1 overflow-y-auto p-5">
        {s.phase === 'crashed' && s.lastExit ? (
          <p role="alert" className="mb-4 flex items-center gap-2 rounded-xl bg-danger/10 px-4 py-3 text-sm font-semibold text-danger">
            <AlertTriangle className="h-4 w-4" /> The server stopped by itself ({s.lastExit}). It is being started again; see the log below.
          </p>
        ) : null}
        {s.phase === 'stopped' ? (
          <p role="status" className="mb-4 rounded-xl bg-danger/10 px-4 py-3 text-sm font-semibold text-danger">
            The server is stopped: billing terminals, captain phones and kitchen screens cannot work. Press Start.
          </p>
        ) : null}
        {s.phase === 'external' ? (
          <p role="status" className="mb-4 rounded-xl bg-warn/15 px-4 py-3 text-sm">A DinePOS server started elsewhere on this PC is running. It is shown here; close it there to run it from this window.</p>
        ) : null}

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          <Card title="Today" icon={<CircleCheck className="h-5 w-5" />}>
            {h ? (
              <dl className="space-y-1 text-sm">
                <div className="flex justify-between gap-2">
                  <dt className="text-muted-foreground">Business day</dt>
                  <dd className="font-semibold" data-testid="business-day">{h.businessDate ?? 'None open'}</dd>
                </div>
                <div className="flex justify-between gap-2">
                  <dt className="text-muted-foreground">Licence</dt>
                  <dd className={`text-right font-semibold ${h.licence && h.licence.canOpenDay === false ? 'text-danger' : ''}`}>
                    {h.licence ? `${h.licence.state}${h.licence.daysLeft !== undefined ? ` · ${h.licence.daysLeft} days left` : ''}` : '—'}
                  </dd>
                </div>
                {h.licence && h.licence.canOpenDay === false ? <p className="text-xs text-danger">{h.licence.message}</p> : null}
                <div className="flex justify-between gap-2">
                  <dt className="text-muted-foreground">Port</dt>
                  <dd className="font-mono">{s.port}</dd>
                </div>
              </dl>
            ) : (
              <p className="text-sm text-muted-foreground">{running ? 'Waiting for the server…' : 'The server is not running.'}</p>
            )}
          </Card>

          <Card
            title="Backups"
            icon={<DatabaseBackup className="h-5 w-5" />}
            action={
              <button className="btn h-8 text-xs" onClick={() => void bridge.openData()}>
                <FolderOpen className="h-4 w-4" /> Data folder
              </button>
            }
          >
            {h?.backup ? (
              <div className="space-y-1 text-sm">
                <p className="flex items-center gap-2">
                  <Dot ok={h.backup.ok} /> <span className="font-semibold">{h.backup.ok ? 'Backed up' : 'Backups need attention'}</span>
                </p>
                <p className="text-muted-foreground">Last backup {ago(h.backup.lastAt, now)} (every 15 minutes)</p>
                {h.backup.error ? <p className="text-danger">{h.backup.error}</p> : null}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">—</p>
            )}
            <p className="mt-2 break-all text-xs text-muted-foreground">{s.dataDir}</p>
          </Card>

          <Card title="DinePOS Cloud" icon={<Cloud className="h-5 w-5" />}>
            {!s.cloud || !s.cloud.paired ? (
              <p className="text-sm text-muted-foreground">Not connected (Settings › Online orders › Order hub in the billing app).</p>
            ) : (
              <div className="space-y-1 text-sm">
                <p className="flex items-center gap-2">
                  <Dot ok={!s.cloud.enabled || s.cloud.connection === 'connected'} /> Devices from anywhere: <b>{s.cloud.enabled ? s.cloud.connection : 'off'}</b>
                </p>
                {s.cloud.enabled && s.cloud.deviceUrl ? <p className="break-all font-mono text-xs">{s.cloud.deviceUrl}</p> : null}
              </div>
            )}
          </Card>

          <Card title="Connect devices on this network" icon={<QrCode className="h-5 w-5" />} className="lg:col-span-3">
            {s.pendingPairings ? (
              <p className="mb-3 rounded-lg bg-warn/15 px-3 py-2 text-sm font-semibold" data-testid="pending-pairings">
                {s.pendingPairings} device{s.pendingPairings === 1 ? '' : 's'} waiting to be paired: approve in the billing app (Settings › Devices).
              </p>
            ) : null}
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
              {addresses.map((ip) => {
                const base = `http://${ip}:${s.port}`;
                return (
                  <div key={ip} className="rounded-lg border border-border p-3" data-address={ip}>
                    <p className="text-xs text-muted-foreground">Server address (billing terminals, DinePOS Kitchen, print agents)</p>
                    <p className="mb-3 font-mono text-lg font-bold" data-testid="server-address">{base}</p>
                    <div className="flex gap-4">
                      <figure className="text-center">
                        <img src={qr(`${base}/captain`)} alt={`QR code for ${base}/captain`} className="h-28 w-28" />
                        <figcaption className="mt-1 flex items-center justify-center gap-1 text-xs font-semibold">
                          <Smartphone className="h-3.5 w-3.5" /> Captain phone
                        </figcaption>
                      </figure>
                      <figure className="text-center">
                        <img src={qr(`${base}/kds`)} alt={`QR code for ${base}/kds`} className="h-28 w-28" />
                        <figcaption className="mt-1 flex items-center justify-center gap-1 text-xs font-semibold">
                          <TabletSmartphone className="h-3.5 w-3.5" /> Kitchen screen
                        </figcaption>
                      </figure>
                    </div>
                  </div>
                );
              })}
            </div>
            <p className="mt-3 text-xs text-muted-foreground">Phones and screens must be on the same Wi-Fi. Keep this PC’s address fixed (reserve it in the router).</p>
          </Card>

          <Card title={`Devices (${devices.length})`} icon={<Smartphone className="h-5 w-5" />}>
            {devices.length === 0 ? <p className="text-sm text-muted-foreground">No paired devices yet.</p> : null}
            <ul className="space-y-1.5 text-sm">
              {devices.slice(0, 12).map((d) => (
                <li key={d.id} className="flex items-center gap-2">
                  <Dot ok={online(d)} />
                  <span className="flex-1 truncate font-semibold">{d.name}</span>
                  <span className="text-xs text-muted-foreground">
                    {KIND[d.kind] ?? d.kind} · {ago(d.lastSeenAt, now)}
                  </span>
                </li>
              ))}
            </ul>
          </Card>

          <Card title={`Printers${printerProblems ? ` (${printerProblems} not printing)` : ''}`} icon={<Printer className="h-5 w-5" />} className="lg:col-span-2">
            {s.printers.length === 0 ? <p className="text-sm text-muted-foreground">No printers set up (Settings › Kitchen & printers).</p> : null}
            <ul className="grid grid-cols-1 gap-1.5 text-sm md:grid-cols-2">
              {s.printers.map((p) => (
                <li key={p.id} className="flex items-start gap-2" title={p.lastError}>
                  <span className="mt-1.5">
                    <Dot ok={p.status === 'ok'} />
                  </span>
                  <span>
                    <span className="font-semibold">{p.name}</span>
                    {p.agent ? <span className="text-xs text-muted-foreground"> · via {p.agent.name}</span> : null}
                    {p.status !== 'ok' && p.lastError ? <span className="block text-xs text-danger">{p.lastError}</span> : null}
                  </span>
                </li>
              ))}
            </ul>
          </Card>

          <Card
            title="Log"
            icon={<AlertTriangle className="h-5 w-5" />}
            className="lg:col-span-3"
            action={
              <span className="flex gap-2">
                <button className="tab h-8" aria-selected={!problemsOnly} role="tab" onClick={() => setProblemsOnly(false)}>
                  All
                </button>
                <button className="tab h-8" aria-selected={problemsOnly} role="tab" onClick={() => setProblemsOnly(true)}>
                  Problems
                </button>
                <button className="btn h-8 text-xs" onClick={() => void bridge.openLogs()}>
                  <FolderOpen className="h-4 w-4" /> Log files
                </button>
              </span>
            }
          >
            <div className="h-64 overflow-y-auto rounded-lg bg-foreground/95 p-3 font-mono text-xs leading-relaxed text-background" data-testid="server-log">
              {lines.length === 0 ? <p className="opacity-60">{problemsOnly ? 'No problems.' : 'Nothing yet.'}</p> : null}
              {lines.map((l, i) => (
                <p key={i} className={l.level === 'error' ? 'text-red-300' : l.level === 'warn' ? 'text-amber-200' : ''}>
                  <span className="opacity-50">{new Date(l.at).toLocaleTimeString('en-IN', { hour12: false })}</span> {l.text}
                </p>
              ))}
              <div ref={logEnd} />
            </div>
          </Card>
        </div>
        <p className="mt-4 text-center text-xs text-muted-foreground">Closing this window keeps the server running (DinePOS icon by the clock). Quit stops it.</p>
      </main>
    </div>
  );
}
