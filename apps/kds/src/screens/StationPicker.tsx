import type { MenuSnapshot } from '@dinepos/shared';
import { useShell } from '@dinepos/web-shell';
import { useQuery } from '@tanstack/react-query';
import { ChefHat, MonitorCheck } from 'lucide-react';

/** First run (docs/09 KDS): which station this screen shows. Stations set up for a screen come first. */
export function StationPicker({ onPick }: { onPick: (stationId: string) => void }) {
  const { api } = useShell();
  const menu = useQuery({ queryKey: ['menu'], queryFn: () => api.get<MenuSnapshot>('/v1/menu') });
  const stations = [...(menu.data?.stations ?? [])].sort((a, b) => Number(b.hasKds) - Number(a.hasKds) || a.name.localeCompare(b.name));
  return (
    <main className="mx-auto flex min-h-full max-w-2xl flex-col justify-center px-6 py-10">
      <ChefHat className="mx-auto h-12 w-12 text-primary" />
      <h1 className="mt-3 text-center font-display text-3xl font-semibold">Which station is this screen for?</h1>
      <p className="mt-2 text-center text-muted-foreground">It shows the tickets of that station. You can change it later.</p>
      <ul className="mt-8 grid grid-cols-2 gap-3" aria-label="Stations">
        {stations.map((s) => (
          <li key={s.id}>
            <button className="btn h-20 w-full flex-col gap-0 text-xl" onClick={() => onPick(s.id)}>
              {s.name}
              {s.hasKds ? (
                <span className="flex items-center gap-1 text-xs font-normal text-muted-foreground">
                  <MonitorCheck className="h-3.5 w-3.5" /> set up for a screen
                </span>
              ) : null}
            </button>
          </li>
        ))}
      </ul>
      {menu.isError ? <p className="mt-6 text-center text-danger">Cannot reach the outlet server.</p> : null}
      {menu.data && stations.length === 0 ? <p className="mt-6 text-center text-muted-foreground">No kitchen stations yet. Add them in Settings › Kitchen & printers.</p> : null}
    </main>
  );
}
