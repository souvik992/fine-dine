import type { OnlineOrderView, OnlineStatus } from '@dinepos/shared';
import { useQuery } from '@tanstack/react-query';
import { ShoppingBag } from 'lucide-react';
import { useEffect, useRef } from 'react';
import { useApp } from '../app-context.js';
import { waitingCount } from './online-model.js';

function chime(): void {
  try {
    const ctx = new window.AudioContext();
    [660, 990, 1320].forEach((hz, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.frequency.value = hz;
      gain.gain.setValueAtTime(0.0001, ctx.currentTime + i * 0.15);
      gain.gain.exponentialRampToValueAtTime(0.2, ctx.currentTime + i * 0.15 + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + i * 0.15 + 0.14);
      osc.connect(gain).connect(ctx.destination);
      osc.start(ctx.currentTime + i * 0.15);
      osc.stop(ctx.currentTime + i * 0.15 + 0.16);
    });
    setTimeout(() => void ctx.close(), 900);
  } catch {
    // no audio
  }
}

/**
 * New online orders (P4-06), on every screen except the Online orders screen itself: a card with how many wait for
 * an answer (the hub rejects them after a few minutes) and a chime when one arrives.
 */
export function OnlineAlerts({ onOpen, hidden }: { onOpen: () => void; hidden: boolean }) {
  const { api, can } = useApp();
  const allowed = can('online.orders');
  const status = useQuery({ queryKey: ['online'], queryFn: () => api.get<OnlineStatus>('/v1/online'), refetchInterval: 30_000, enabled: allowed });
  const on = allowed && Boolean(status.data?.paired);
  const orders = useQuery({ queryKey: ['online-orders'], queryFn: () => api.get<{ orders: OnlineOrderView[] }>('/v1/online/orders'), refetchInterval: 15_000, enabled: on });
  const waiting = waitingCount(orders.data?.orders ?? []);
  const last = useRef(0);
  useEffect(() => {
    if (waiting > last.current) chime();
    last.current = waiting;
  }, [waiting]);
  if (!on || waiting === 0 || hidden) return null;
  return (
    <button className="fixed right-4 top-16 z-40 flex items-center gap-2 rounded-xl border-2 border-primary bg-card px-4 py-2.5 font-bold shadow-lg" onClick={onOpen} data-testid="online-alert">
      <ShoppingBag className="h-5 w-5 text-primary" /> {waiting} new online order{waiting === 1 ? '' : 's'}
    </button>
  );
}
