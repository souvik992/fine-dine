import type { OrderSnapshot } from '@dinepos/shared';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import { useApp } from '../app-context.js';
import { OrderSession } from './order-session.js';

/**
 * One OrderSession per open order. The query (refreshed by `order:<id>` stream events) feeds the session;
 * the session owns the snapshot shown on screen and flags changes made on another terminal.
 */
export function useOrderSession(orderId: string) {
  const { api } = useApp();
  const session = useMemo(() => new OrderSession(api, orderId), [api, orderId]);
  const [order, setOrder] = useState<OrderSnapshot | null>(null);
  const [changedElsewhere, setChangedElsewhere] = useState(false);

  const query = useQuery({ queryKey: ['order', orderId], queryFn: () => api.get<OrderSnapshot>(`/v1/orders/${orderId}`) });

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
    const t = setTimeout(() => setChangedElsewhere(false), 6_000);
    return () => clearTimeout(t);
  }, [changedElsewhere]);

  return { session, order, error: query.error, changedElsewhere, dismissChange: () => setChangedElsewhere(false) };
}
