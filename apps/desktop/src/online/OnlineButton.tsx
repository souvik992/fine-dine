import type { OnlineOrderView } from '@dinepos/shared';
import { useQuery } from '@tanstack/react-query';
import { Globe } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useApp } from '../app-context.js';
import { autoAcceptedSince, waitingCount } from './online-model.js';

const BLINK_MS = 5_000;

/** Floor header: Online Orders, with how many wait to be accepted, and a dot that blinks a few seconds when one was accepted automatically. */
export function OnlineButton({ onClick }: { onClick: () => void }) {
  const { api } = useApp();
  const orders = useQuery({ queryKey: ['online-orders'], queryFn: () => api.get<{ orders: OnlineOrderView[] }>('/v1/online/orders'), refetchInterval: 15_000 });
  const list = orders.data?.orders;
  const waiting = waitingCount(list ?? []);
  const seen = useRef<Set<string> | null>(null);
  const [blinking, setBlinking] = useState(false);
  useEffect(() => {
    if (!list) return;
    const auto = autoAcceptedSince(seen.current, list);
    seen.current = new Set([...(seen.current ?? []), ...list.map((o) => o.id)]);
    if (auto.length === 0) return;
    setBlinking(true);
    const t = setTimeout(() => setBlinking(false), BLINK_MS);
    return () => clearTimeout(t);
  }, [list]);
  return (
    <button className="btn relative h-10" onClick={onClick} title={`Orders from the website and app · ${waiting} waiting to be accepted`}>
      <Globe className="h-4 w-4" /> Online Orders
      {waiting ? (
        <span className="rounded-full bg-primary px-1.5 text-xs font-bold tabular-nums text-primary-foreground" aria-label={`${waiting} not accepted`} data-online-waiting>
          {waiting}
        </span>
      ) : null}
      {blinking ? (
        <span className="absolute -right-1 -top-1 flex h-3 w-3" aria-label="An order was accepted automatically" data-online-auto-accepted>
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-ok opacity-75" />
          <span className="relative inline-flex h-3 w-3 rounded-full bg-ok" />
        </span>
      ) : null}
    </button>
  );
}
