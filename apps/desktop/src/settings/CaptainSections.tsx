import type { CaptainSection, CaptainSections as SectionsResponse, FloorSnapshot, LoginUser } from '@dinepos/shared';
import { useQuery } from '@tanstack/react-query';
import { MapPinned } from 'lucide-react';
import { useState } from 'react';
import { useApp } from '../app-context.js';
import { Modal } from '../components/Modal.js';
import { DialogButtons, ErrorText, SectionHeader, useSave } from './common.js';

/** "Main Hall · T9, R2", or null for no section. */
export function sectionText(section: CaptainSection | undefined, floor: FloorSnapshot | undefined): string | null {
  if (!section || (!section.areaIds.length && !section.tableIds.length)) return null;
  const areas = section.areaIds.map((id) => floor?.areas.find((a) => a.id === id)?.name ?? 'Area');
  const tables = section.tableIds.map((id) => floor?.tables.find((t) => t.id === id)?.label ?? 'Table');
  return [...areas, ...tables].join(', ');
}

/**
 * Captain sections (P3-04): the areas and tables each person who takes orders looks after. Their phone opens on
 * "My tables", and a table opened without a captain gets the one whose section holds it.
 */
export function CaptainSections() {
  const { api } = useApp();
  const sections = useQuery({ queryKey: ['captain-sections'], queryFn: () => api.get<SectionsResponse>('/v1/captain-sections') });
  const floor = useQuery({ queryKey: ['floor'], queryFn: () => api.get<FloorSnapshot>('/v1/floor') });
  const [editing, setEditing] = useState<LoginUser | null>(null);
  // Active people whose role can seat tables and take orders.
  const people = sections.data?.people ?? [];
  const byUser = new Map((sections.data?.sections ?? []).map((s) => [s.userId, s]));

  return (
    <div className="max-w-4xl">
      <SectionHeader title="Captain sections" subtitle="Which areas and tables each person looks after. Their phone opens on “My tables”, and new orders there are theirs." />
      <ul className="divide-y divide-border rounded-xl border border-border bg-card" aria-label="Captain sections">
        {people.map((p) => {
          const text = sectionText(byUser.get(p.id), floor.data);
          return (
            <li key={p.id} className="flex items-center gap-3 px-4 py-3" data-section={p.name}>
              <MapPinned className="h-5 w-5 text-muted-foreground" />
              <span className="flex-1">
                <span className="font-semibold">{p.name}</span>
                <span className="ml-2 text-sm text-muted-foreground">{p.roleName}</span>
                <span className={`block text-sm ${text ? '' : 'text-muted-foreground'}`}>{text ?? 'No section'}</span>
              </span>
              <button className="btn" onClick={() => setEditing(p)} disabled={!floor.data}>
                Set section
              </button>
            </li>
          );
        })}
      </ul>
      {editing && floor.data ? <SectionDialog person={editing} floor={floor.data} section={byUser.get(editing.id)} onClose={() => setEditing(null)} /> : null}
    </div>
  );
}

function SectionDialog({ person, floor, section, onClose }: { person: LoginUser; floor: FloorSnapshot; section: CaptainSection | undefined; onClose: () => void }) {
  const { save, busy, error } = useSave();
  const [areas, setAreas] = useState(new Set(section?.areaIds ?? []));
  const [tables, setTables] = useState(new Set(section?.tableIds ?? []));
  const flip = (set: Set<string>, id: string) => {
    const n = new Set(set);
    if (n.has(id)) n.delete(id);
    else n.add(id);
    return n;
  };

  return (
    <Modal title={`${person.name}: section`} onClose={onClose} wide>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void save('SetCaptainSection', { userId: person.id, areaIds: [...areas], tableIds: [...tables] }).then((ok) => ok && onClose());
        }}
      >
        <p className="mb-3 text-sm text-muted-foreground">Pick whole areas, or single tables. A whole area includes tables added to it later.</p>
        <div className="max-h-[55vh] space-y-4 overflow-y-auto pr-1">
          {floor.areas.map((a) => {
            const whole = areas.has(a.id);
            return (
              <fieldset key={a.id}>
                <legend className="mb-2 flex w-full items-center justify-between">
                  <span className="font-semibold">{a.name}</span>
                  <label className="flex items-center gap-2 text-sm">
                    <input type="checkbox" checked={whole} onChange={() => setAreas((s) => flip(s, a.id))} aria-label={`All of ${a.name}`} /> Whole area
                  </label>
                </legend>
                <div className="flex flex-wrap gap-2">
                  {floor.tables
                    .filter((t) => t.areaId === a.id)
                    .map((t) => {
                      const on = whole || tables.has(t.id);
                      return (
                        <button
                          type="button"
                          key={t.id}
                          role="checkbox"
                          aria-checked={on}
                          disabled={whole}
                          onClick={() => setTables((s) => flip(s, t.id))}
                          className={`h-10 min-w-12 rounded-lg border-2 px-3 font-semibold ${on ? 'border-primary bg-primary/10' : 'border-border bg-card hover:bg-secondary'}`}
                        >
                          {t.label}
                        </button>
                      );
                    })}
                </div>
              </fieldset>
            );
          })}
        </div>
        <ErrorText error={error} />
        <DialogButtons busy={busy} onCancel={onClose} />
      </form>
    </Modal>
  );
}
