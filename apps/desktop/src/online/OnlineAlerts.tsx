import type { OnlineOrderView, OnlineStatus } from '@dinepos/shared';
import { useQuery } from '@tanstack/react-query';
import { AlarmClock, BellOff, ShoppingBag } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useApp } from '../app-context.js';
import { chimeUpdate, lateOrders, waitingCount } from './online-model.js';

/** How often the chime repeats while an order waits to be accepted. */
const RING_EVERY_MS = 3_000;
/** How often the late alarm repeats while an order is past its ready time. */
const LATE_EVERY_MS = 60_000;

let ctx: AudioContext | null = null;
function tones(freqs: number[], type: OscillatorType, step: number, gainPeak: number): void {
  try {
    ctx ??= new window.AudioContext();
    if (ctx.state === 'suspended') void ctx.resume();
    const a = ctx;
    freqs.forEach((hz, i) => {
      const osc = a.createOscillator();
      const gain = a.createGain();
      osc.type = type;
      osc.frequency.value = hz;
      const s = a.currentTime + i * step;
      gain.gain.setValueAtTime(0.0001, s);
      gain.gain.exponentialRampToValueAtTime(gainPeak, s + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, s + step - 0.01);
      osc.connect(gain).connect(a.destination);
      osc.start(s);
      osc.stop(s + step);
    });
  } catch {
    // no audio
  }
}
/** New order: three rising notes. */
const chime = () => tones([660, 990, 1320], 'sine', 0.15, 0.2);
/** Running late: three falling notes, harsher, so staff can tell them apart. */
const lateAlarm = () => tones([880, 660, 440], 'sawtooth', 0.28, 0.25);

/**
 * New online orders (P4-06): the chime repeats on every screen (the Online orders screen too) until no order waits to
 * be accepted, and sounds once for an order accepted automatically. The card with how many wait for an answer (the hub
 * rejects them after a few minutes) shows on every screen except the Online orders screen itself.
 * Orders past the ready time promised on accepting: a falling alarm when one goes late and every minute after, and a
 * "Running late" card (except on the Online orders screen, where the order's card turns red), until marked Ready or
 * silenced.
 */
export function OnlineAlerts({ onOpen, hidden }: { onOpen: () => void; hidden: boolean }) {
  const { api, can } = useApp();
  const allowed = can('online.orders');
  const status = useQuery({ queryKey: ['online'], queryFn: () => api.get<OnlineStatus>('/v1/online'), refetchInterval: 30_000, enabled: allowed });
  const on = allowed && Boolean(status.data?.paired);
  const orders = useQuery({ queryKey: ['online-orders'], queryFn: () => api.get<{ orders: OnlineOrderView[] }>('/v1/online/orders'), refetchInterval: 15_000, enabled: on });
  const list = orders.data?.orders;
  const waiting = waitingCount(list ?? []);
  const seen = useRef<Set<string> | null>(null);
  const [ringing, setRinging] = useState(false);

  useEffect(() => {
    if (!list) return;
    const next = chimeUpdate(seen.current, list);
    seen.current = next.seen;
    setRinging(next.ringing);
    if (next.chimeOnce && !next.ringing) chime(); // while ringing, the ringing already sounds
  }, [list]);

  const ring = on && ringing;
  useEffect(() => {
    if (!ring) return;
    chime();
    const t = setInterval(chime, RING_EVERY_MS);
    return () => clearInterval(t);
  }, [ring]);

  // late orders: time passes without new data, so check every few seconds
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!on) return;
    const t = setInterval(() => setNow(Date.now()), 5_000);
    return () => clearInterval(t);
  }, [on]);
  const late = on ? lateOrders(list ?? [], now) : [];
  const [silenced, setSilenced] = useState<ReadonlySet<string>>(new Set());
  const loudLate = late.filter((o) => !silenced.has(o.id));
  const loudKey = loudLate.map((o) => o.id).join(',');
  const lastLate = useRef<{ key: string; at: number }>({ key: '', at: 0 });
  useEffect(() => {
    if (!loudKey) return;
    const prev = lastLate.current;
    const newlyLate = loudKey.split(',').some((id) => !prev.key.split(',').includes(id));
    if (newlyLate || now - prev.at >= LATE_EVERY_MS) {
      lateAlarm();
      lastLate.current = { key: loudKey, at: now };
    } else lastLate.current = { ...prev, key: loudKey };
  }, [loudKey, now]);

  if (!on || hidden) return null;
  if (waiting > 0) {
    return (
      <button className="fixed right-4 top-16 z-40 flex items-center gap-2 rounded-xl border-2 border-primary bg-card px-4 py-2.5 font-bold shadow-lg" onClick={onOpen} data-testid="online-alert">
        <ShoppingBag className="h-5 w-5 animate-pulse text-primary" /> {waiting} new online order{waiting === 1 ? '' : 's'}
      </button>
    );
  }
  if (late.length === 0) return null;
  return (
    <div role="alert" className="fixed right-4 top-16 z-40 flex items-center gap-2 rounded-xl border-2 border-danger bg-card px-3 py-2 shadow-lg" data-testid="online-late">
      <button className="flex items-center gap-2 font-bold" onClick={onOpen}>
        <AlarmClock className={`h-5 w-5 text-danger ${loudLate.length ? 'animate-pulse' : ''}`} /> Running late: {late.map((o) => o.number).slice(0, 3).join(', ')}
        {late.length > 3 ? ` +${late.length - 3}` : ''}
      </button>
      {loudLate.length ? (
        <button className="btn h-9" onClick={() => setSilenced(new Set([...silenced, ...late.map((o) => o.id)]))} aria-label="Silence the late alarm">
          <BellOff className="h-4 w-4" /> Silence
        </button>
      ) : null}
    </div>
  );
}
