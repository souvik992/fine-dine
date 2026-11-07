import { formatINR, REJECT_REASONS, type OnlineOrderView, type OnlineStatus, type OutletConfig, type RejectReason } from '@dinepos/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Bike, Check, Clock, Map as MapIcon, MapPin, Phone, ReceiptText, ShoppingBag, TriangleAlert, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { ApiError } from '../api/client.js';
import { useApp } from '../app-context.js';
import { Modal } from '../components/Modal.js';
import { SettleDialog } from '../billing/SettleDialog.js';
import { ChannelBadge } from './ChannelBadge.js';
import { DeliveryMap } from './DeliveryMap.js';
import { board, nextSteps, REJECT_LABEL, STATE_LABEL, timeLeft, type Column } from './online-model.js';

const COLUMNS: Array<[Column, string]> = [
  ['new', 'New'],
  ['kitchen', 'In the kitchen'],
  ['ready', 'Ready'],
  ['out', 'Out for delivery'],
];
const STEP_LABEL = { PREPARING: 'Preparing', READY: 'Ready', OUT_FOR_DELIVERY: 'Out for delivery', DELIVERED: 'Delivered', PICKED_UP: 'Collected' } as const;
const time = (ms: number) => new Date(ms).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: false });

/**
 * Online orders from the order hub (P4-06): accept (KOT + GST bill at DinePOS prices) or reject new orders, then move
 * them on until they are collected or delivered. Everything is a command; the hub hears it through the outbox.
 */
export function OnlineScreen({ onBack, onOpenOrder }: { onBack: () => void; onOpenOrder: (orderId: string) => void }) {
  const { api, can } = useApp();
  const qc = useQueryClient();
  const orders = useQuery({ queryKey: ['online-orders'], queryFn: () => api.get<{ orders: OnlineOrderView[] }>('/v1/online/orders'), refetchInterval: 15_000 });
  const status = useQuery({ queryKey: ['online'], queryFn: () => api.get<OnlineStatus>('/v1/online'), refetchInterval: 15_000 });
  const [now, setNow] = useState(() => Date.now());
  const [message, setMessage] = useState<{ text: string; error?: boolean } | null>(null);
  const [dialog, setDialog] = useState<{ kind: 'reject' | 'rider' | 'cancel' | 'payment'; order: OnlineOrderView; to?: 'DELIVERED' | 'PICKED_UP' } | null>(null);
  const config = useQuery({ queryKey: ['config'], queryFn: () => api.get<OutletConfig>('/v1/config'), staleTime: 60_000 });
  const storeLoc = config.data?.['online.settings'].serviceability.location ?? null;
  const [mapFor, setMapFor] = useState<OnlineOrderView | null>(null);
  const [priceOk, setPriceOk] = useState<Record<string, number>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [showDone, setShowDone] = useState(false);
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  const run = async (key: string, type: string, payload: Record<string, unknown>, done?: string) => {
    setBusy(key);
    setMessage(null);
    try {
      const res = await api.command(type, payload);
      if (done) setMessage({ text: done });
      return res;
    } catch (e) {
      if (e instanceof ApiError && (e.details as { reason?: string } | undefined)?.reason === 'price') {
        setPriceOk((m) => ({ ...m, [String(payload.onlineOrderId)]: (e.details as { posTotalPaise: number }).posTotalPaise }));
      }
      setMessage({ text: e instanceof ApiError ? e.message : 'Could not reach the outlet server.', error: true });
      return null;
    } finally {
      setBusy(null);
      await Promise.all(['online-orders', 'online', 'floor'].map((k) => qc.invalidateQueries({ queryKey: [k] })));
    }
  };

  const b = board(orders.data?.orders ?? []);
  const s = status.data;
  const manage = can('online.orders');

  const card = (o: OnlineOrderView) => {
    const ord = o.order;
    const left = o.state === 'SENT_TO_STORE' || o.state === 'RECEIVED' ? timeLeft(ord.acceptBy, now) : null;
    const differs = o.posTotalPaise !== null && o.posTotalPaise !== ord.total;
    return (
      <li key={o.id} className="rounded-xl border border-border bg-card shadow-sm" data-online={o.number}>
        <div className="flex items-start justify-between gap-2 border-b border-border px-3 py-2">
          <div>
            <p className="flex items-center gap-2">
              <ChannelBadge channel={ord.channel} />
              <span className="font-display text-xl font-semibold">{o.number}</span>
            </p>
            <p className="flex flex-wrap gap-1 text-xs font-bold">
              <span className="rounded bg-secondary px-1.5 py-0.5">{ord.fulfilment === 'DELIVERY' ? 'DELIVERY' : 'PICKUP'}</span>
              <span className={`rounded px-1.5 py-0.5 ${ord.payment === 'COD' ? 'bg-warn text-black' : 'bg-ok text-white'}`}>{ord.payment === 'COD' ? (ord.fulfilment === 'PICKUP' ? 'PAY AT PICKUP' : 'CASH ON DELIVERY') : ord.paid ? 'PAID ONLINE' : 'NOT PAID'}</span>
            </p>
          </div>
          <div className="text-right text-sm">
            <p className="font-semibold">{STATE_LABEL[o.state]}</p>
            <p className="text-muted-foreground">{time(ord.placedAt)}</p>
            {left ? <p className={`font-bold tabular-nums ${left.urgent ? 'text-danger' : 'text-warn'}`}>{left.text}</p> : null}
          </div>
        </div>
        {o.alert ? (
          <p role="alert" className="flex items-start gap-1.5 bg-warn/25 px-3 py-1.5 text-sm font-semibold">
            <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" /> {o.alert}
          </p>
        ) : null}
        <div className="space-y-1 px-3 py-2 text-sm">
          <p className="flex items-center gap-1.5">
            <Phone className="h-3.5 w-3.5 text-muted-foreground" /> {ord.customer.name ? `${ord.customer.name} · ` : ''}
            {ord.customer.mobile}
          </p>
          {ord.address ? (
            <p className="flex items-start gap-1.5">
              <MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              {[ord.address.line1, ord.address.line2, ord.address.landmark, `${ord.address.city} ${ord.address.pincode}`].filter(Boolean).join(', ')}
              {ord.distanceKm !== null ? ` (${ord.distanceKm} km)` : ''}
              {ord.location ? (
                <button className="ml-auto inline-flex shrink-0 items-center gap-1 rounded border border-border px-1.5 py-0.5 text-xs font-semibold hover:bg-secondary" onClick={() => setMapFor(o)} aria-label={`Map for ${o.number}`}>
                  <MapIcon className="h-3.5 w-3.5" /> Map
                </button>
              ) : null}
            </p>
          ) : null}
          {ord.rider ? (
            <p className="flex items-center gap-1.5">
              <Bike className="h-3.5 w-3.5 text-muted-foreground" /> {ord.rider.name}
              {ord.rider.phone ? ` · ${ord.rider.phone}` : ''}
            </p>
          ) : null}
          <ul className="border-t border-border pt-1">
            {ord.lines.map((l, i) => (
              <li key={i}>
                <span className="font-semibold tabular-nums">{l.qtyMilli / 1000} ×</span> {l.name}
                {l.modifiers.length ? <span className="text-muted-foreground"> + {l.modifiers.map((m) => m.name).join(', ')}</span> : null}
                {l.note ? <span className="block pl-5 font-semibold text-warn">! {l.note}</span> : null}
              </li>
            ))}
          </ul>
          {ord.note ? <p className="font-semibold">Note: {ord.note}</p> : null}
          <p className="flex justify-between border-t border-border pt-1 font-semibold">
            <span>Customer paid / pays</span>
            <span className="tabular-nums">{formatINR(ord.total)}</span>
          </p>
          {o.billNo ? (
            <p className={`flex justify-between ${differs ? 'font-bold text-danger' : 'text-muted-foreground'}`}>
              <span>Bill {o.billNo}</span>
              <span className="tabular-nums">{formatINR(o.posTotalPaise ?? 0)}</span>
            </p>
          ) : null}
        </div>
        {manage ? (
          <div className="flex flex-wrap gap-1.5 border-t border-border p-2">
            {o.state === 'SENT_TO_STORE' || o.state === 'RECEIVED' ? (
              <>
                {priceOk[o.id] !== undefined ? (
                  <button className="btn btn-primary h-10" disabled={busy === o.id} onClick={() => void run(o.id, 'AcceptOnlineOrder', { onlineOrderId: o.id, acceptPriceChange: true }, `${o.number} accepted at the DinePOS price.`)}>
                    <Check className="h-4 w-4" /> Accept at {formatINR(priceOk[o.id]!)}
                  </button>
                ) : (
                  <button className="btn btn-primary h-10" disabled={busy === o.id} onClick={() => void run(o.id, 'AcceptOnlineOrder', { onlineOrderId: o.id }, `${o.number} accepted: KOT sent, bill printed.`)}>
                    <Check className="h-4 w-4" /> Accept
                  </button>
                )}
                <button className="btn h-10" disabled={busy === o.id} onClick={() => setDialog({ kind: 'reject', order: o })}>
                  <X className="h-4 w-4" /> Reject
                </button>
              </>
            ) : null}
            {nextSteps(o).map((to) => (
              <button
                key={to}
                className="btn h-10"
                disabled={busy === o.id}
                onClick={() =>
                  to === 'OUT_FOR_DELIVERY'
                    ? setDialog({ kind: 'rider', order: o })
                    : (to === 'DELIVERED' || to === 'PICKED_UP') && o.order.payment === 'COD' && o.posTotalPaise !== null
                      ? setDialog({ kind: 'payment', order: o, to }) // how the customer paid: cash, card, UPI, split
                      : void run(o.id, 'AdvanceOnlineOrder', { onlineOrderId: o.id, to }, `${o.number}: ${STEP_LABEL[to].toLowerCase()}.`)
                }
              >
                {STEP_LABEL[to]}
              </button>
            ))}
            {o.localOrderId ? (
              <button className="btn h-10" onClick={() => onOpenOrder(o.localOrderId!)}>
                <ReceiptText className="h-4 w-4" /> Bill
              </button>
            ) : null}
            {o.billId && !['DELIVERED', 'PICKED_UP'].includes(o.state) && (o.state !== 'CANCELLED' || o.alert) ? (
              <button className="btn h-10 text-danger" onClick={() => setDialog({ kind: 'cancel', order: o })}>
                Cancel order
              </button>
            ) : null}
          </div>
        ) : null}
      </li>
    );
  };

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center gap-3 border-b border-border bg-card px-4 py-2.5">
        <button className="btn" onClick={onBack}>
          <ArrowLeft className="h-4 w-4" /> Floor
        </button>
        <h1 className="font-display text-xl font-semibold">Online orders</h1>
        {s ? (
          <span className="flex items-center gap-1.5 text-sm" data-testid="hub-status">
            <span className={`dot ${s.connection === 'connected' ? 'bg-ok' : s.connection === 'off' || s.connection === 'not-paired' ? 'bg-muted-foreground' : 'bg-warn'}`} />
            {s.connection === 'connected' ? `Connected to ${s.store?.name ?? 'the hub'}` : s.connection === 'not-paired' ? 'Not connected to an order hub (Settings › Online orders)' : s.connection === 'off' ? 'Online orders are off' : `Reconnecting… ${s.lastError ?? ''}`}
            {s.connection === 'connected' && !s.accepting ? <span className="ml-2 rounded bg-warn px-1.5 text-xs font-bold text-black">Not taking orders (no business day)</span> : null}
            {s.pendingActions ? <span className="ml-2 text-xs text-muted-foreground">{s.pendingActions} update{s.pendingActions === 1 ? '' : 's'} waiting to reach the hub</span> : null}
          </span>
        ) : null}
        <button className="btn ml-auto h-9" onClick={() => setShowDone((v) => !v)}>
          <Clock className="h-4 w-4" /> {showDone ? 'Hide' : 'Show'} finished ({b.done.length})
        </button>
      </header>
      {message ? (
        <p role={message.error ? 'alert' : 'status'} className={`px-4 py-2 text-sm font-semibold ${message.error ? 'bg-danger/15 text-danger' : 'bg-secondary'}`} onClick={() => setMessage(null)}>
          {message.text}
        </p>
      ) : null}
      <div className="grid min-h-0 flex-1 grid-cols-4 gap-3 overflow-hidden p-3">
        {COLUMNS.map(([k, label]) => (
          <section key={k} aria-label={label} className="flex min-h-0 flex-col">
            <h2 className="mb-2 flex items-center gap-1.5 text-sm font-bold uppercase tracking-wide text-muted-foreground">
              {k === 'new' ? <ShoppingBag className="h-4 w-4" /> : null}
              {label} · {b[k].length}
            </h2>
            <ul className="min-h-0 flex-1 space-y-3 overflow-y-auto pr-1">{b[k].map(card)}</ul>
          </section>
        ))}
      </div>
      {showDone ? (
        <section aria-label="Finished" className="max-h-[40%] overflow-y-auto border-t border-border bg-card p-3">
          <ul className="grid grid-cols-4 gap-3">{b.done.map(card)}</ul>
        </section>
      ) : null}

      {dialog?.kind === 'reject' ? <RejectDialog order={dialog.order} onClose={() => setDialog(null)} onReject={(reason, text) => void run(dialog.order.id, 'RejectOnlineOrder', { onlineOrderId: dialog.order.id, reason, reasonText: text }, `${dialog.order.number} rejected.`).then(() => setDialog(null))} /> : null}
      {dialog?.kind === 'rider' ? <RiderDialog order={dialog.order} onClose={() => setDialog(null)} onSend={(name, phone) => void run(dialog.order.id, 'AdvanceOnlineOrder', { onlineOrderId: dialog.order.id, to: 'OUT_FOR_DELIVERY', rider: { name, phone } }, `${dialog.order.number} is out for delivery.`).then(() => setDialog(null))} /> : null}
      {dialog?.kind === 'payment' && dialog.to ? (
        <SettleDialog
          title={`${dialog.order.number}: ${dialog.order.order.fulfilment === 'PICKUP' ? 'collected' : 'delivered'}. How did the customer pay?`}
          billNo={dialog.order.billNo ?? dialog.order.number}
          totalPaise={dialog.order.posTotalPaise!}
          modes={['cash', 'upi', 'card', 'other']}
          settle={async (tenders) => {
            const res = await api.command<{ changePaise: number }>('AdvanceOnlineOrder', { onlineOrderId: dialog.order.id, to: dialog.to, tenders });
            await Promise.all(['online-orders', 'online', 'floor'].map((k) => qc.invalidateQueries({ queryKey: [k] })));
            return res.result.changePaise;
          }}
          onClose={() => setDialog(null)}
          onDone={(change) => {
            setMessage({ text: `${dialog.order.number}: ${STEP_LABEL[dialog.to!].toLowerCase()}, paid.${change ? ` Give back ${formatINR(change)} change.` : ''}` });
            setDialog(null);
          }}
        />
      ) : null}
      {mapFor?.order.location ? <DeliveryMap order={mapFor} store={storeLoc ? { lat: storeLoc.lat, lng: storeLoc.lng } : null} onClose={() => setMapFor(null)} /> : null}
      {dialog?.kind === 'cancel' ? <CancelDialog order={dialog.order} onClose={() => setDialog(null)} onCancel={(reason) => void run(dialog.order.id, 'CancelOnlineOrder', { onlineOrderId: dialog.order.id, reason }, `${dialog.order.number} cancelled; its bill is void.`).then(() => setDialog(null))} /> : null}
    </div>
  );
}

function RejectDialog({ order, onClose, onReject }: { order: OnlineOrderView; onClose: () => void; onReject: (reason: RejectReason, text: string | null) => void }) {
  const [reason, setReason] = useState<RejectReason>('TOO_BUSY');
  const [text, setText] = useState('');
  return (
    <Modal title={`Reject ${order.number}`} onClose={onClose}>
      <p className="mb-3 text-sm text-muted-foreground">The customer is told at once; an online payment is refunded by the hub.</p>
      <div className="space-y-1.5" role="radiogroup" aria-label="Reason">
        {REJECT_REASONS.map((r) => (
          <label key={r} className="flex items-center gap-2">
            <input type="radio" name="reason" checked={reason === r} onChange={() => setReason(r)} /> {REJECT_LABEL[r]}
          </label>
        ))}
      </div>
      <input className="input mt-3" maxLength={200} placeholder="A word for the customer (optional)" value={text} onChange={(e) => setText(e.target.value)} aria-label="Message to the customer" />
      <div className="mt-4 flex justify-end gap-2">
        <button className="btn" onClick={onClose}>
          Back
        </button>
        <button className="btn btn-primary" onClick={() => onReject(reason, text.trim() || null)}>
          Reject order
        </button>
      </div>
    </Modal>
  );
}

function RiderDialog({ order, onClose, onSend }: { order: OnlineOrderView; onClose: () => void; onSend: (name: string, phone: string | null) => void }) {
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  return (
    <Modal title={`${order.number}: out for delivery`} onClose={onClose}>
      <p className="mb-3 text-sm text-muted-foreground">The customer sees the rider’s name and phone.</p>
      <input data-autofocus className="input mb-2" maxLength={60} placeholder="Rider’s name" value={name} onChange={(e) => setName(e.target.value)} aria-label="Rider name" />
      <input className="input" inputMode="tel" maxLength={20} placeholder="Rider’s phone (optional)" value={phone} onChange={(e) => setPhone(e.target.value)} aria-label="Rider phone" />
      <div className="mt-4 flex justify-end gap-2">
        <button className="btn" onClick={onClose}>
          Back
        </button>
        <button className="btn btn-primary" disabled={!name.trim()} onClick={() => onSend(name.trim(), phone.trim() || null)}>
          <Bike className="h-4 w-4" /> Send out
        </button>
      </div>
    </Modal>
  );
}

function CancelDialog({ order, onClose, onCancel }: { order: OnlineOrderView; onClose: () => void; onCancel: (reason: string) => void }) {
  const [reason, setReason] = useState('');
  return (
    <Modal title={`Cancel ${order.number}`} onClose={onClose}>
      <p className="mb-3 text-sm">
        Its bill {order.billNo} is voided (it keeps its number). {order.order.payment === 'ONLINE' ? 'The hub refunds the online payment.' : ''} This may need a manager’s PIN.
      </p>
      <input data-autofocus className="input" maxLength={200} placeholder="Why (required)" value={reason} onChange={(e) => setReason(e.target.value)} aria-label="Reason for cancelling" />
      <div className="mt-4 flex justify-end gap-2">
        <button className="btn" onClick={onClose}>
          Back
        </button>
        <button className="btn btn-primary" disabled={!reason.trim()} onClick={() => onCancel(reason.trim())}>
          Cancel order
        </button>
      </div>
    </Modal>
  );
}
