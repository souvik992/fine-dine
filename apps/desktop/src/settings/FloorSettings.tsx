import { newId } from '@dinepos/shared';
import { Ban, CalendarClock, LayoutGrid, Plus, Save } from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { Modal } from '../components/Modal.js';
import { DialogButtons, Empty, ErrorText, Field, SectionHeader, useCatalog, useSave, type AdminCatalog } from './common.js';
import { bulkLabels, canvasSize, nextFreeSlot, snap, TILE_H, TILE_W } from './layout-model.js';

type Table = AdminCatalog['tables'][number];
type Area = AdminCatalog['areas'][number];

/** Floor & tables: areas, tables and a drag-and-drop layout the floor screen shows (docs/09 "saved floor layout"). */
export function FloorSettings() {
  const catalog = useCatalog();
  const [areaId, setAreaId] = useState<string | null>(null);
  const [editArea, setEditArea] = useState<Area | 'new' | null>(null);
  const [editTable, setEditTable] = useState<Table | 'new' | null>(null);
  const [bulk, setBulk] = useState(false);
  if (!catalog.data) return <p className="text-muted-foreground">Loading…</p>;
  const { areas, tables } = catalog.data;
  const area = areas.find((a) => a.id === areaId) ?? areas[0] ?? null;
  const inArea = tables.filter((t) => t.areaId === area?.id);

  return (
    <div>
      <SectionHeader
        title="Floor & tables"
        subtitle="Areas (Main hall, Terrace…) hold tables. Drag tables to match the room; the floor screen shows the same layout."
        action={
          <button className="btn" onClick={() => setEditArea('new')}>
            <Plus className="h-4 w-4" /> Add area
          </button>
        }
      />
      {areas.length === 0 ? (
        <Empty>No areas yet. Add your first area, then its tables.</Empty>
      ) : (
        <>
          <div className="mb-4 flex flex-wrap items-center gap-2" role="tablist" aria-label="Areas">
            {areas.map((a) => (
              <button key={a.id} role="tab" className="tab" aria-selected={a.id === area?.id} onClick={() => setAreaId(a.id)}>
                {a.name}
              </button>
            ))}
            {area ? (
              <button className="btn ml-2 h-9" onClick={() => setEditArea(area)}>
                Rename “{area.name}”
              </button>
            ) : null}
            <span className="ml-auto flex gap-2">
              <button className="btn h-9" onClick={() => setBulk(true)} disabled={!area}>
                <Plus className="h-4 w-4" /> Several tables
              </button>
              <button className="btn btn-primary h-9" onClick={() => setEditTable('new')} disabled={!area}>
                <Plus className="h-4 w-4" /> Add table
              </button>
            </span>
          </div>
          {area ? <LayoutEditor key={area.id} tables={inArea} areaId={area.id} onEdit={setEditTable} /> : null}
        </>
      )}

      {editArea ? <AreaDialog area={editArea === 'new' ? null : editArea} nextSort={areas.length} onClose={() => setEditArea(null)} onCreated={setAreaId} /> : null}
      {editTable && area ? <TableDialog table={editTable === 'new' ? null : editTable} areaId={area.id} areaTables={inArea} onClose={() => setEditTable(null)} /> : null}
      {bulk && area ? <BulkTablesDialog areaId={area.id} areaTables={inArea} onClose={() => setBulk(false)} /> : null}
    </div>
  );
}

interface Pos {
  x: number;
  y: number;
}

/** Drag tables on a snapping grid; unplaced tables wait in a tray. "Save layout" stores every moved table. */
function LayoutEditor({ tables, areaId, onEdit }: { tables: Table[]; areaId: string; onEdit: (t: Table) => void }) {
  const { save, busy, error } = useSave();
  const [moves, setMoves] = useState<Map<string, Pos>>(new Map());
  const [dragging, setDragging] = useState<{ id: string; dx: number; dy: number } | null>(null);
  const canvas = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);
  const pos = (t: Table): Pos | null => moves.get(t.id) ?? (t.layoutX !== null && t.layoutY !== null ? { x: t.layoutX, y: t.layoutY } : null);
  const placed = tables.map((t) => ({ id: t.id, layoutX: pos(t)?.x ?? null, layoutY: pos(t)?.y ?? null }));
  const size = canvasSize(placed);
  const unplaced = tables.filter((t) => !pos(t));

  useEffect(() => {
    const el = canvas.current;
    if (!el) return;
    const fit = () => setScale(Math.min(1, el.clientWidth / size.w));
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, [size.w]);

  const toCanvas = (e: { clientX: number; clientY: number }): Pos => {
    const r = canvas.current!.getBoundingClientRect();
    return { x: (e.clientX - r.left) / scale, y: (e.clientY - r.top) / scale };
  };
  const onDown = (t: Table) => (e: ReactPointerEvent) => {
    const p = pos(t);
    if (!p) return;
    const c = toCanvas(e);
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    setDragging({ id: t.id, dx: c.x - p.x, dy: c.y - p.y });
  };
  const onMove = (e: ReactPointerEvent) => {
    if (!dragging) return;
    const c = toCanvas(e);
    setMoves(new Map(moves).set(dragging.id, snap(c.x - dragging.dx, c.y - dragging.dy)));
  };
  const place = (t: Table) => setMoves(new Map(moves).set(t.id, nextFreeSlot(placed, size.w)));
  const placeAll = () => {
    const next = new Map(moves);
    const current = [...placed];
    for (const t of unplaced) {
      const slot = nextFreeSlot(current, size.w);
      next.set(t.id, slot);
      current.push({ id: t.id, layoutX: slot.x, layoutY: slot.y });
    }
    setMoves(next);
  };

  const saveLayout = async () => {
    for (const t of tables) {
      const m = moves.get(t.id);
      if (!m) continue;
      const ok = await save('UpsertTable', { id: t.id, areaId, label: t.label, seats: t.seats, layoutX: m.x, layoutY: m.y, status: t.status });
      if (!ok) return;
    }
    setMoves(new Map());
  };

  return (
    <div>
      {unplaced.length ? (
        <div className="mb-3 rounded-xl border border-dashed border-border bg-card p-3" aria-label="Tables not placed yet">
          <div className="mb-2 flex items-center justify-between text-sm">
            <span className="font-semibold">Not placed on the layout yet</span>
            <button className="btn h-8" onClick={placeAll}>
              <LayoutGrid className="h-4 w-4" /> Place all
            </button>
          </div>
          <div className="flex flex-wrap gap-2">
            {unplaced.map((t) => (
              <button key={t.id} className="btn h-9" onClick={() => place(t)} title="Put it on the layout">
                {t.label}
              </button>
            ))}
          </div>
        </div>
      ) : null}

      <div ref={canvas} className="relative w-full overflow-hidden rounded-xl border border-border" style={{ height: size.h * scale, backgroundImage: 'radial-gradient(var(--border) 1px, transparent 1px)', backgroundSize: `${20 * scale}px ${20 * scale}px` }} onPointerMove={onMove} onPointerUp={() => setDragging(null)} aria-label="Floor layout">
        {tables.map((t) => {
          const p = pos(t);
          if (!p) return null;
          return (
            <div
              key={t.id}
              role="button"
              tabIndex={0}
              data-layout-table={t.label}
              onPointerDown={onDown(t)}
              onDoubleClick={() => onEdit(t)}
              onKeyDown={(e) => e.key === 'Enter' && onEdit(t)}
              className={`absolute flex cursor-grab select-none flex-col items-center justify-center rounded-xl border-2 bg-card shadow-sm ${dragging?.id === t.id ? 'cursor-grabbing border-ring' : moves.has(t.id) ? 'border-primary' : 'border-border'} ${t.status === 'blocked' ? 'opacity-60' : ''}`}
              style={{ left: p.x * scale, top: p.y * scale, width: TILE_W * scale, height: TILE_H * scale }}
              title="Drag to move · double-click to edit"
            >
              <span className="font-display text-xl font-semibold">{t.label}</span>
              <span className="flex items-center gap-1 text-xs text-muted-foreground">
                {t.seats ? `${t.seats} seats` : ''}
                {t.status === 'blocked' ? <Ban className="h-3 w-3" aria-label="Blocked" /> : null}
                {t.status === 'reserved' ? <CalendarClock className="h-3 w-3" aria-label="Reserved" /> : null}
              </span>
            </div>
          );
        })}
      </div>
      <div className="mt-3 flex items-center gap-3">
        <button className="btn btn-primary" onClick={() => void saveLayout()} disabled={busy || moves.size === 0}>
          <Save className="h-4 w-4" /> {busy ? 'Saving…' : `Save layout${moves.size ? ` (${moves.size} moved)` : ''}`}
        </button>
        {moves.size ? (
          <button className="btn" onClick={() => setMoves(new Map())}>
            Undo changes
          </button>
        ) : null}
        <span className="text-xs text-muted-foreground">Drag to move. Double-click a table to change its name, seats or status.</span>
      </div>
      <ErrorText error={error} />
    </div>
  );
}

function AreaDialog({ area, nextSort, onClose, onCreated }: { area: Area | null; nextSort: number; onClose: () => void; onCreated: (id: string) => void }) {
  const { save, busy, error } = useSave();
  const [name, setName] = useState(area?.name ?? '');
  const [sort, setSort] = useState(String(area?.sort ?? nextSort));
  return (
    <Modal title={area ? `Area: ${area.name}` : 'Add an area'} onClose={onClose}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          const id = area?.id ?? newId();
          void save('UpsertArea', { id, name: name.trim(), sort: Number(sort) || 0, priceListId: area?.priceListId ?? null, taxProfileId: area?.taxProfileId ?? null }).then((ok) => {
            if (!ok) return;
            if (!area) onCreated(id);
            onClose();
          });
        }}
      >
        <div className="grid grid-cols-3 gap-3">
          <div className="col-span-2">
            <Field label="Name">
              <input data-autofocus className="input" value={name} maxLength={80} placeholder="Main hall" onChange={(e) => setName(e.target.value)} />
            </Field>
          </div>
          <Field label="Order" hint="Tabs are sorted by this.">
            <input className="input" inputMode="numeric" value={sort} onChange={(e) => setSort(e.target.value.replace(/\D/g, ''))} />
          </Field>
        </div>
        <ErrorText error={error} />
        <DialogButtons busy={busy} onCancel={onClose} disabled={!name.trim()} />
      </form>
    </Modal>
  );
}

function TableDialog({ table, areaId, areaTables, onClose }: { table: Table | null; areaId: string; areaTables: Table[]; onClose: () => void }) {
  const { save, busy, error } = useSave();
  const [label, setLabel] = useState(table?.label ?? '');
  const [seats, setSeats] = useState(String(table?.seats ?? 4));
  const [status, setStatus] = useState<Table['status']>(table?.status ?? 'active');
  const slot = useMemo(() => nextFreeSlot(areaTables), [areaTables]);
  return (
    <Modal title={table ? `Table ${table.label}` : 'Add a table'} onClose={onClose}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void save('UpsertTable', {
            id: table?.id ?? newId(),
            areaId,
            label: label.trim(),
            seats: Number(seats) || null,
            layoutX: table ? table.layoutX : slot.x,
            layoutY: table ? table.layoutY : slot.y,
            status,
          }).then((ok) => ok && onClose());
        }}
      >
        <div className="grid grid-cols-2 gap-3">
          <Field label="Table name" hint="Short, as staff say it: T7, R2, Patio 1.">
            <input data-autofocus className="input" value={label} maxLength={12} onChange={(e) => setLabel(e.target.value)} />
          </Field>
          <Field label="Seats">
            <input className="input" inputMode="numeric" value={seats} onChange={(e) => setSeats(e.target.value.replace(/\D/g, ''))} />
          </Field>
        </div>
        <fieldset className="mt-3">
          <legend className="mb-1 text-sm font-semibold">Status</legend>
          <div className="flex gap-2" role="radiogroup">
            {(['active', 'reserved', 'blocked'] as const).map((s) => (
              <button key={s} type="button" role="radio" aria-checked={status === s} onClick={() => setStatus(s)} className={`h-9 rounded-md px-3 text-sm font-semibold ${status === s ? 'bg-foreground text-background' : 'bg-secondary'}`}>
                {s === 'active' ? 'In use' : s === 'reserved' ? 'Reserved' : 'Blocked'}
              </button>
            ))}
          </div>
          {table?.occupied && status !== 'active' ? <p className="mt-2 text-sm text-danger">This table has guests; settle or move them first.</p> : null}
        </fieldset>
        <ErrorText error={error} />
        <DialogButtons busy={busy} onCancel={onClose} disabled={!label.trim()} />
      </form>
    </Modal>
  );
}

function BulkTablesDialog({ areaId, areaTables, onClose }: { areaId: string; areaTables: Table[]; onClose: () => void }) {
  const { save, busy, error } = useSave();
  const [prefix, setPrefix] = useState('T');
  const [from, setFrom] = useState(String(areaTables.length + 1));
  const [to, setTo] = useState(String(areaTables.length + 4));
  const [seats, setSeats] = useState('4');
  const labels = bulkLabels(prefix, Number(from), Number(to), areaTables.map((t) => t.label));
  return (
    <Modal title="Add several tables" onClose={onClose}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void (async () => {
            const placed = areaTables.map((t) => ({ id: t.id, layoutX: t.layoutX, layoutY: t.layoutY }));
            for (const label of labels) {
              const slot = nextFreeSlot(placed);
              const id = newId();
              if (!(await save('UpsertTable', { id, areaId, label, seats: Number(seats) || null, layoutX: slot.x, layoutY: slot.y, status: 'active' }))) return;
              placed.push({ id, layoutX: slot.x, layoutY: slot.y });
            }
            onClose();
          })();
        }}
      >
        <div className="grid grid-cols-4 gap-3">
          <Field label="Prefix">
            <input data-autofocus className="input" value={prefix} maxLength={6} onChange={(e) => setPrefix(e.target.value)} />
          </Field>
          <Field label="From">
            <input className="input" inputMode="numeric" value={from} onChange={(e) => setFrom(e.target.value.replace(/\D/g, ''))} />
          </Field>
          <Field label="To">
            <input className="input" inputMode="numeric" value={to} onChange={(e) => setTo(e.target.value.replace(/\D/g, ''))} />
          </Field>
          <Field label="Seats">
            <input className="input" inputMode="numeric" value={seats} onChange={(e) => setSeats(e.target.value.replace(/\D/g, ''))} />
          </Field>
        </div>
        <p className="mt-3 text-sm text-muted-foreground">{labels.length ? `Adds ${labels.join(', ')}.` : 'Nothing to add (check the numbers; up to 100 at once).'}</p>
        <ErrorText error={error} />
        <DialogButtons busy={busy} onCancel={onClose} label={`Add ${labels.length} tables`} disabled={labels.length === 0} />
      </form>
    </Modal>
  );
}
