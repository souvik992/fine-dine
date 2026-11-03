import { OrderSession, type ConflictInfo } from '@dinepos/client';
import type { OrderSnapshot } from '@dinepos/shared';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import { useApp } from './app-context.js';

/**
 * One OrderSession per open order, as on the terminal: `order:<id>` stream events refetch the query, the session
 * keeps the newest snapshot and queues this phone's commands on it.
 */
export function useOrderSession(orderId: string) {
  const { api } = useApp();
  const session = useMemo(() => new OrderSession(api, orderId), [api, orderId]);
  const [order, setOrder] = useState<OrderSnapshot | null>(null);
  const [changedElsewhere, setChangedElsewhere] = useState(false);
  const [conflict, setConflict] = useState<ConflictInfo | null>(null);
  const query = useQuery({ queryKey: ['order', orderId], queryFn: () => api.get<OrderSnapshot>(`/v1/orders/${orderId}`) });

  useEffect(() => session.onConflict(setConflict), [session]);
  useEffect(
    () =>
      session.subscribe((s, info) => {
        setOrder(s);
        if (info.external) setChangedElsewhere(true);
      }),
    [session],
  );
  useEffect(() => {
    if (query.data) session.receive(query.data);
  }, [query.data, session]);
  useEffect(() => {
    if (!changedElsewhere) return;
    const t = setTimeout(() => setChangedElsewhere(false), 5_000);
    return () => clearTimeout(t);
  }, [changedElsewhere]);

  return { session, order, error: query.error, changedElsewhere, conflict, dismissConflict: () => setConflict(null) };
}
