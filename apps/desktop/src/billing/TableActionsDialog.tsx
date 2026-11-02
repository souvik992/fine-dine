import type { FloorSnapshot, FloorTable, OrderSnapshot } from '@dinepos/shared';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { useApp } from '../app-context.js';
import { Modal } from '../components/Modal.js';

export type TableAction = 'move' | 'merge' | 'items';

const TITLE: Record<TableAction, string> = { move: 'Move to another table', merge: 'Merge another table here', items: 'Move items to another table' };

/**
 * Move table, merge tables, move items (P2-03). The kitchen gets a notice when sent items are involved; the move is
 * audited. Prices and KOTs stay as they were.
 */
export function TableActionsDialog({
  action,
  order,
  onClose,
  run,
}: {
  action: TableAction;
  order: OrderSnapshot;
  onClose: () => void;
  run: (type: string, payload: unknown, done?: string) => Promise<boolean>;
}) {
  const { api } = useApp();
  const floor = useQuery({ queryKey: ['floor'], queryFn: () => api.get<FloorSnapshot>('/v1/floor') });
  const lines = order.items.filter((i) => i.status !== 'cancelled');
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const here = order.table?.id;

  // Move: free tables. Merge / move items: other tables with an open order.
  const candidates = (floor.data?.tables ?? []).filter((t) =>
    action === 'move' ? t.state === 'FREE' || t.state === 'RESERVED' : t.id !== here && t.orderId && t.state !== 'FREE' && t.state !== 'BLOCKED',
  );

  const choose = async (t: FloorTable) => {
    setBusy(true);
    const ok =
      action === 'move'
        ? await run('MoveTable', { toTableId: t.id }, `Moved to ${t.label}.`)
        : action === 'merge'
          ? await run('MergeTables', { sourceOrderId: t.orderId }, `${t.label} merged into this table.`)
          : await run('TransferItems', { itemIds: [...picked], toOrderId: t.orderId }, `${picked.size} item${picked.size === 1 ? '' : 's'} moved to ${t.label}.`);
    setBusy(false);
    if (ok) onClose();
  };

  const toggle = (id: string) =>
    setPicked((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  const needItems = action === 'items' && picked.size === 0;

  return (
    <Modal title={TITLE[action]} onClose={onClose} wide>
      {action === 'items' ? (
        <>
          <p className="mb-2 text-sm font-semibold">1. Items to move</p>
          <ul className="mb-4 max-h-56 space-y-1 overflow-y-auto rounded-lg border border-border p-2" aria-label="Items to move">
            {lines.map((i) => (
              <li key={i.id}>
                <label className="flex items-center gap-2 rounded px-2 py-1 text-sm hover:bg-secondary">
                  <input type="checkbox" checked={picked.has(i.id)} onChange={() => toggle(i.id)} />
                  <span className="font-semibold tabular-nums">{i.qty} ×</span> {i.name}
                  <span className="ml-auto text-xs text-muted-foreground">{i.status === 'fired' ? `sent, KOT ${String(i.kotNo ?? 0).padStart(4, '0')}` : 'not sent'}</span>
                </label>
              </li>
            ))}
          </ul>
          <p className="mb-2 text-sm font-semibold">2. Move them to</p>
        </>
      ) : (
        <p className="mb-3 text-sm text-muted-foreground">
          {action === 'move'
            ? 'Choose a free table. The kitchen is told if food was already ordered.'
            : 'Choose the table to bring here. Its items and guests join this order and that table becomes free.'}
        </p>
      )}
      {floor.data && candidates.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border p-4 text-center text-sm text-muted-foreground">{action === 'move' ? 'No free table right now.' : 'No other table has an open order.'}</p>
      ) : null}
      <div className="grid grid-cols-5 gap-2" role="list" aria-label="Tables">
        {candidates.map((t) => (
          <button key={t.id} role="listitem" className="btn h-14 flex-col gap-0" disabled={busy || needItems} onClick={() => void choose(t)} aria-label={`Table ${t.label}`}>
            <span className="text-base font-bold">{t.label}</span>
            {t.covers ? <span className="text-xs font-normal text-muted-foreground">{t.covers} covers</span> : null}
          </button>
        ))}
      </div>
      {needItems ? <p className="mt-2 text-xs text-muted-foreground">Tick at least one item first.</p> : null}
    </Modal>
  );
}
