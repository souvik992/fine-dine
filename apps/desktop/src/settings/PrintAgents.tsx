import { newId } from '@dinepos/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Server, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { useApp } from '../app-context.js';
import { Modal } from '../components/Modal.js';
import { DialogButtons, Empty, ErrorText, Field, SectionHeader, useSave } from './common.js';

export interface PrintAgentInfo {
  id: string;
  name: string;
  lastSeenAt: string | null;
  version: string | null;
  online: boolean;
  printers: Array<{ id: string; name: string }>;
}

export function usePrintAgents() {
  const { api } = useApp();
  return useQuery({ queryKey: ['print-agents'], queryFn: () => api.get<{ agents: PrintAgentInfo[] }>('/v1/print-agents'), refetchInterval: 10_000 });
}

/** The agent key: random, made here; DinePOS keeps only sha256('agent:' + key). */
async function makeKey(): Promise<{ key: string; hash: string }> {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  const key = `pa_${btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')}`;
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`agent:${key}`));
  return { key, hash: [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('') };
}

const seen = (iso: string | null) => (iso ? new Date(iso).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' }) : 'never');

/**
 * Settings › Kitchen & printers › Print agents (P6-03): a small program on a PC on the printers' network prints the
 * tickets of the printers assigned to it, when this outlet's server cannot reach them (DinePOS Cloud, another network).
 */
export function PrintAgents() {
  const agents = usePrintAgents();
  const qc = useQueryClient();
  const { save, busy, error } = useSave();
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const [made, setMade] = useState<{ name: string; key: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const list = agents.data?.agents ?? [];

  const add = async () => {
    const { key, hash } = await makeKey();
    if (await save('CreatePrintAgent', { id: newId(), name: name.trim(), keyHash: hash })) {
      setMade({ name: name.trim(), key });
      setAdding(false);
      setName('');
      await qc.invalidateQueries({ queryKey: ['print-agents'] });
    }
  };
  const remove = async (a: PrintAgentInfo) => {
    if (!window.confirm(`Remove the print agent "${a.name}"? Its key stops working; ${a.printers.length ? 'its printers are printed by this server again.' : 'it has no printers.'}`)) return;
    if (await save('RevokePrintAgent', { agentId: a.id })) await Promise.all(['print-agents', 'printers'].map((k) => qc.invalidateQueries({ queryKey: [k] })));
  };

  return (
    <div className="mt-10">
      <SectionHeader
        title="Print agents"
        subtitle="For printers this server cannot reach (the server in DinePOS Cloud, or on another network): install DinePOS Print Agent on a PC on the printers’ network, then choose it under “Printed by” on each printer."
        action={
          <button className="btn" onClick={() => setAdding(true)}>
            <Plus className="h-4 w-4" /> Add print agent
          </button>
        }
      />
      {agents.data && list.length === 0 ? <Empty>No print agents. Printers are printed by this server.</Empty> : null}
      <ul className="divide-y divide-border rounded-xl border border-border bg-card" aria-label="Print agents">
        {list.map((a) => (
          <li key={a.id} className="flex items-center gap-3 px-4 py-3" data-print-agent={a.name}>
            <Server className="h-5 w-5 text-muted-foreground" />
            <span className="flex-1">
              <span className="font-semibold">{a.name}</span>
              <span className={`ml-2 rounded-full px-2 py-0.5 text-xs font-bold ${a.online ? 'bg-ok/15 text-ok' : 'bg-danger/15 text-danger'}`}>{a.online ? 'Online' : 'Offline'}</span>
              <span className="ml-2 text-sm text-muted-foreground">
                {a.printers.length ? `Prints ${a.printers.map((p) => p.name).join(', ')}` : 'No printers yet'} · last seen {seen(a.lastSeenAt)}
                {a.version ? ` · v${a.version}` : ''}
              </span>
            </span>
            <button className="btn h-8" disabled={busy} onClick={() => void remove(a)} aria-label={`Remove ${a.name}`}>
              <Trash2 className="h-4 w-4" />
            </button>
          </li>
        ))}
      </ul>
      <ErrorText error={error} />

      {adding ? (
        <Modal title="Add print agent" onClose={() => setAdding(false)}>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void add();
            }}
          >
            <Field label="Name" hint="Where it runs, e.g. “Back office PC”.">
              <input className="input" autoFocus maxLength={40} value={name} onChange={(e) => setName(e.target.value)} />
            </Field>
            <ErrorText error={error} />
            <DialogButtons busy={busy} onCancel={() => setAdding(false)} label="Add" disabled={!name.trim()} />
          </form>
        </Modal>
      ) : null}

      {made ? (
        <Modal title={`Print agent “${made.name}” added`} onClose={() => setMade(null)}>
          <p className="text-sm">Copy this key now: it is shown only once. On the PC by the printers, run DinePOS-PrintAgent-Setup.exe and enter:</p>
          <ul className="mt-2 list-disc pl-5 text-sm">
            <li>the server address: this PC’s address on the outlet network, or the outlet’s DinePOS Cloud address (Settings › Cloud sync);</li>
            <li>this key:</li>
          </ul>
          <div className="mt-2 flex gap-2">
            <code className="flex-1 break-all rounded-lg border border-border bg-background px-3 py-2 text-sm" data-testid="agent-key">
              {made.key}
            </code>
            <button
              className="btn"
              onClick={() =>
                void navigator.clipboard.writeText(made.key).then(
                  () => setCopied(true),
                  () => undefined,
                )
              }
            >
              {copied ? 'Copied' : 'Copy'}
            </button>
          </div>
          <p className="mt-3 text-sm text-muted-foreground">Then choose this agent under “Printed by” on each printer it should print.</p>
          <div className="mt-4 flex justify-end">
            <button className="btn btn-primary" onClick={() => setMade(null)}>
              Done
            </button>
          </div>
        </Modal>
      ) : null}
    </div>
  );
}
