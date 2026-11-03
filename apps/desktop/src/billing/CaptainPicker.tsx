import type { OrderSnapshot, SetupState } from '@dinepos/shared';
import { useQuery } from '@tanstack/react-query';
import { UserRound } from 'lucide-react';
import { useApp } from '../app-context.js';

/** Who looks after this order (docs/09 "More… captain", AssignCaptain, P3-04). */
export function CaptainPicker({ order, disabled, run }: { order: OrderSnapshot; disabled: boolean; run: (type: string, payload: unknown, done?: string) => Promise<boolean> }) {
  const { api } = useApp();
  // The sign-in list: every active person, without needing the staff-admin right.
  const staff = useQuery({ queryKey: ['setup-state'], queryFn: () => api.get<SetupState>('/v1/setup-state'), staleTime: 60_000 });
  const people = staff.data?.users ?? [];
  return (
    <label className="flex items-center gap-1 text-sm text-muted-foreground" title="Captain looking after this table">
      <UserRound className="h-4 w-4" />
      <select
        className="h-8 rounded-md border border-border bg-card px-1 text-sm text-foreground"
        aria-label="Captain"
        disabled={disabled}
        value={order.captainId ?? ''}
        onChange={(e) => {
          const captainId = e.target.value || null;
          const name = people.find((p) => p.id === captainId)?.name;
          void run('AssignCaptain', { captainId }, name ? `${name} looks after this table.` : 'No captain on this table.');
        }}
      >
        <option value="">No captain</option>
        {people.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name}
          </option>
        ))}
      </select>
    </label>
  );
}
