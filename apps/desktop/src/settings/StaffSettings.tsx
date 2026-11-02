import { newId, RIGHT_LABELS, RIGHTS, type RoleInfo, type RoleRight, type StaffMember } from '@dinepos/shared';
import { useQuery } from '@tanstack/react-query';
import { KeyRound, Plus, ShieldCheck, UserRound } from 'lucide-react';
import { useState } from 'react';
import { useApp } from '../app-context.js';
import { bpToPercentText, percentToBp } from '../billing/money-input.js';
import { Modal } from '../components/Modal.js';
import { DialogButtons, ErrorText, Field, SectionHeader, Toggle, useSave } from './common.js';

/** Staff & roles (docs/07): people sign in with name + PIN; roles decide what they may do. */
export function StaffSettings() {
  const { api } = useApp();
  const staff = useQuery({ queryKey: ['staff'], queryFn: () => api.get<{ staff: StaffMember[] }>('/v1/staff') });
  const roles = useQuery({ queryKey: ['roles'], queryFn: () => api.get<{ roles: RoleInfo[] }>('/v1/roles') });
  const [editing, setEditing] = useState<StaffMember | 'new' | null>(null);
  const [editingRole, setEditingRole] = useState<RoleInfo | 'new' | null>(null);
  if (!staff.data || !roles.data) return <p className="text-muted-foreground">Loading…</p>;

  return (
    <div className="max-w-4xl">
      <SectionHeader
        title="Staff"
        subtitle="Each person signs in by tapping their name and typing their PIN."
        action={
          <button className="btn btn-primary" onClick={() => setEditing('new')}>
            <Plus className="h-4 w-4" /> Add person
          </button>
        }
      />
      <ul className="mb-10 divide-y divide-border rounded-xl border border-border bg-card" aria-label="Staff list">
        {staff.data.staff.map((s) => (
          <li key={s.id} className="flex items-center gap-3 px-4 py-3">
            <UserRound className="h-5 w-5 text-muted-foreground" />
            <span className="flex-1">
              <span className={`font-semibold ${s.active ? '' : 'text-muted-foreground line-through'}`}>{s.name}</span>
              <span className="ml-2 text-sm text-muted-foreground">{s.roleName}</span>
              {s.locked ? <span className="ml-2 rounded bg-danger px-1.5 py-0.5 text-xs font-bold text-white">Locked: set a new PIN</span> : null}
              {!s.active ? <span className="ml-2 text-xs text-muted-foreground">(not active)</span> : null}
            </span>
            <button className="btn" onClick={() => setEditing(s)}>
              Edit
            </button>
          </li>
        ))}
      </ul>

      <SectionHeader
        title="Roles"
        subtitle="What each role may do, which actions need a manager's PIN, and the highest discount without approval."
        action={
          <button className="btn" onClick={() => setEditingRole('new')}>
            <Plus className="h-4 w-4" /> Add role
          </button>
        }
      />
      <ul className="grid grid-cols-2 gap-3" aria-label="Roles">
        {roles.data.roles.map((r) => (
          <li key={r.id}>
            <button className="flex w-full items-start gap-3 rounded-xl border border-border bg-card p-4 text-left hover:border-ring" onClick={() => setEditingRole(r)}>
              <ShieldCheck className="mt-0.5 h-5 w-5 text-primary" />
              <span>
                <span className="block font-semibold">{r.name}</span>
                <span className="block text-xs text-muted-foreground">
                  {r.members} {r.members === 1 ? 'person' : 'people'} · {r.rights.length} rights · discount up to {bpToPercentText(r.discountLimitBp)}%
                </span>
              </span>
            </button>
          </li>
        ))}
      </ul>

      {editing ? <PersonDialog person={editing === 'new' ? null : editing} roles={roles.data.roles} onClose={() => setEditing(null)} /> : null}
      {editingRole ? <RoleDialog role={editingRole === 'new' ? null : editingRole} onClose={() => setEditingRole(null)} /> : null}
    </div>
  );
}

function PersonDialog({ person, roles, onClose }: { person: StaffMember | null; roles: RoleInfo[]; onClose: () => void }) {
  const { save, busy, error } = useSave();
  const [name, setName] = useState(person?.name ?? '');
  const [roleId, setRoleId] = useState(person?.roleId ?? roles.find((r) => r.name === 'Cashier')?.id ?? roles[0]!.id);
  const [pin, setPin] = useState('');
  const [pin2, setPin2] = useState('');
  const [active, setActive] = useState(person?.active ?? true);
  const pinOk = pin === '' ? Boolean(person) : /^\d{4,6}$/.test(pin) && pin === pin2;

  return (
    <Modal title={person ? `Edit ${person.name}` : 'Add a person'} onClose={onClose}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (!name.trim() || !pinOk) return;
          void save('UpsertUser', { id: person?.id ?? newId(), name: name.trim(), roleId, active, ...(pin ? { pin } : {}) }).then((ok) => ok && onClose());
        }}
      >
        <div className="space-y-3">
          <Field label="Name (as shown on the sign-in screen)">
            <input data-autofocus className="input" value={name} maxLength={40} onChange={(e) => setName(e.target.value)} />
          </Field>
          <Field label="Role">
            <select className="input" value={roleId} onChange={(e) => setRoleId(e.target.value)}>
              {roles.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
            </select>
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label={person ? 'New PIN (optional)' : 'PIN (4–6 digits)'} hint={person ? 'Also unlocks a locked person.' : undefined}>
              <input className="input" type="password" inputMode="numeric" maxLength={6} autoComplete="new-password" value={pin} onChange={(e) => setPin(e.target.value)} />
            </Field>
            <Field label="Type it again">
              <input className="input" type="password" inputMode="numeric" maxLength={6} autoComplete="new-password" value={pin2} onChange={(e) => setPin2(e.target.value)} />
            </Field>
          </div>
          {pin && !pinOk ? <p className="text-sm font-semibold text-danger">The PIN needs 4 to 6 digits, typed the same twice.</p> : null}
          {person ? <Toggle checked={active} onChange={setActive} label="Active" hint="Inactive people cannot sign in; their history stays." /> : null}
          <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <KeyRound className="h-3.5 w-3.5" /> PINs are stored only as a secure hash. Changing a PIN or role signs the person out.
          </p>
        </div>
        <ErrorText error={error} />
        <DialogButtons busy={busy} onCancel={onClose} disabled={!name.trim() || !pinOk} />
      </form>
    </Modal>
  );
}

function RoleDialog({ role, onClose }: { role: RoleInfo | null; onClose: () => void }) {
  const { save, busy, error } = useSave();
  const [name, setName] = useState(role?.name ?? '');
  const [limit, setLimit] = useState(bpToPercentText(role?.discountLimitBp ?? 0));
  const [rights, setRights] = useState<Map<RoleRight['right'], boolean>>(new Map((role?.rights ?? []).map((r) => [r.right, r.needsPin])));
  const limitBp = percentToBp(limit);

  const toggle = (right: RoleRight['right'], allowed: boolean) => {
    const next = new Map(rights);
    if (allowed) next.set(right, false);
    else next.delete(right);
    setRights(next);
  };
  const setPin = (right: RoleRight['right'], needsPin: boolean) => setRights(new Map(rights).set(right, needsPin));

  return (
    <Modal title={role ? `Role: ${role.name}` : 'Add a role'} onClose={onClose} wide>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (!name.trim() || limitBp === null) return;
          void save('UpsertRole', {
            id: role?.id ?? newId(),
            name: name.trim(),
            discountLimitBp: limitBp,
            rights: RIGHTS.filter((r) => rights.has(r)).map((r) => ({ right: r, needsPin: rights.get(r)! })),
          }).then((ok) => ok && onClose());
        }}
      >
        <div className="mb-4 grid grid-cols-2 gap-3">
          <Field label="Role name">
            <input className="input" value={name} maxLength={30} onChange={(e) => setName(e.target.value)} />
          </Field>
          <Field label="Highest bill discount without a manager PIN (%)">
            <input className="input" value={limit} inputMode="decimal" onChange={(e) => setLimit(e.target.value)} />
          </Field>
        </div>
        <table className="w-full text-sm" aria-label="Rights">
          <thead>
            <tr className="text-left text-xs uppercase tracking-wide text-muted-foreground">
              <th className="py-1 font-semibold">May do</th>
              <th className="w-24 py-1 text-center font-semibold">Allowed</th>
              <th className="w-36 py-1 text-center font-semibold">Needs manager PIN</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {RIGHTS.map((r) => (
              <tr key={r}>
                <td className="py-1.5">{RIGHT_LABELS[r]}</td>
                <td className="text-center">
                  <input type="checkbox" aria-label={`${RIGHT_LABELS[r]}: allowed`} checked={rights.has(r)} onChange={(e) => toggle(r, e.target.checked)} />
                </td>
                <td className="text-center">
                  <input type="checkbox" aria-label={`${RIGHT_LABELS[r]}: needs manager PIN`} disabled={!rights.has(r)} checked={rights.get(r) ?? false} onChange={(e) => setPin(r, e.target.checked)} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {limitBp === null ? <p className="mt-2 text-sm font-semibold text-danger">The discount limit is a percentage from 0 to 100.</p> : null}
        <ErrorText error={error} />
        <DialogButtons busy={busy} onCancel={onClose} disabled={!name.trim() || limitBp === null} />
      </form>
    </Modal>
  );
}
