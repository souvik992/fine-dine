import type { FloorTable } from '@dinepos/shared';
import { newId } from '@dinepos/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Minus, Plus } from 'lucide-react';
import { useRef, useState } from 'react';
import { ApiError } from '../api/client.js';
import { useApp } from '../app-context.js';
import { Modal } from '../components/Modal.js';

/** Seat guests at a free table (OpenTable). One commandId per dialog, so a double click cannot open twice. */
export function SeatDialog({ table, onClose }: { table: FloorTable; onClose: () => void }) {
  const { api } = useApp();
  const qc = useQueryClient();
  const [covers, setCovers] = useState(Math.min(table.seats ?? 2, 2));
  const commandId = useRef(newId());

  const seat = useMutation({
    mutationFn: () => api.command('OpenTable', { tableId: table.id, covers }, { commandId: commandId.current }),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['floor'] });
      onClose();
    },
  });
  const error = seat.error instanceof ApiError ? seat.error.message : seat.error ? 'Could not seat the table.' : null;
  const change = (d: number) => setCovers((c) => Math.min(99, Math.max(1, c + d)));

  return (
    <Modal title={`Seat table ${table.label}`} onClose={onClose}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          seat.mutate();
        }}
      >
        <label className="mb-2 block text-sm font-semibold" htmlFor="covers">
          Covers (guests)
        </label>
        <div className="flex items-center gap-2">
          <button type="button" className="btn h-12 w-12 px-0" onClick={() => change(-1)} aria-label="One fewer guest">
            <Minus className="h-5 w-5" />
          </button>
          <input
            id="covers"
            className="input h-12 text-center text-xl font-semibold tabular-nums"
            inputMode="numeric"
            value={covers}
            onChange={(e) => {
              const n = Number(e.target.value.replace(/\D/g, ''));
              setCovers(Number.isFinite(n) && n > 0 ? Math.min(99, n) : 1);
            }}
            onKeyDown={(e) => {
              if (e.key === 'ArrowUp') change(1);
              if (e.key === 'ArrowDown') change(-1);
            }}
          />
          <button type="button" className="btn h-12 w-12 px-0" onClick={() => change(1)} aria-label="One more guest">
            <Plus className="h-5 w-5" />
          </button>
        </div>
        {error ? (
          <p role="alert" className="mt-3 text-sm font-semibold text-danger">
            {error}
          </p>
        ) : null}
        <div className="mt-5 flex justify-end gap-2">
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn btn-primary" disabled={seat.isPending}>
            {seat.isPending ? 'Seating…' : 'Seat guests'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
