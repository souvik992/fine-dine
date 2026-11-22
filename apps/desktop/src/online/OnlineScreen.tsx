import { formatINR, REJECT_REASONS, type HubOrder, type OnlineOrderView, type OnlineStatus, type OutletConfig, type RejectReason } from '@dinepos/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { AlarmClock, ArrowLeft, Bike, CheckCircle2, ChefHat, CircleAlert, Clock, Inbox, Map as MapIcon, PackageCheck, Printer, ReceiptText, Wifi, WifiOff } from 'lucide-react';
import { useEffect, useState } from 'react';
import { ApiError } from '../api/client.js';
import { useApp } from '../app-context.js';
import { Modal } from '../components/Modal.js';
import { SettleDialog } from '../billing/SettleDialog.js';
import { ChannelBadge, channelStripe } from './ChannelBadge.js';
import { DeliveryMap } from './DeliveryMap.js';
import { board, nextSteps, prepClock, REJECT_LABEL, STATE_LABEL, timeLeft, type Column } from './online-model.js';

const COLUMNS: Array<[Column, string, typeof Inbox]> = [
  ['new', 'New', Inbox],
  ['kitchen', 'Preparing', ChefHat],
  ['ready', 'Ready', PackageCheck],
  ['out', 'On the way', Bike],
];
const STEP_LABEL = { PREPARING: 'Preparing', READY: 'Ready', OUT_FOR_DELIVERY: 'Out for delivery', DELIVERED: 'Delivered', PICKED_UP: 'Collected' } as const;
const ago = (ms: number, now: number) => {
  const m = Math.max(0, Math.round((now - ms) / 60_000));
  return m < 1 ? 'just now' : `${m} min ago`;
};
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
    const x = ord.external ?? null;
    const platform = ord.channel === 'zomato' ? 'Zomato' : 'Swiggy';
    const isNew = o.state === 'SENT_TO_STORE' || o.state === 'RECEIVED';
    const left = isNew ? timeLeft(ord.acceptBy, now) : null;
    const clock = prepClock(o.state, ord.etaAt, now);
    const differs = o.posTotalPaise !== null && o.posTotalPaise !== ord.total;
    const finished = b.done.includes(o);
    const payLine = x
      ? ord.payment === 'COD' && x.deliveredBy === 'store'
        ? 'Collect on delivery'
        : `Paid through ${platform}`
      : ord.payment === 'COD'
        ? ord.fulfilment === 'PICKUP'
          ? 'Pay at pickup'
          : 'Collect on delivery'
        : ord.paid
          ? 'Paid online'
          : 'Not paid yet';
    return (
      <li
        key={o.id}
        className={`rounded-xl border border-l-4 p-3 text-sm ${isNew ? 'border-primary bg-accent/40' : clock?.late ? 'border-danger bg-danger/5' : 'border-border bg-background'} ${channelStripe(ord.channel)}`}
        data-online={o.number}
        aria-label={`Order ${o.number}`}
      >
        <div className="mb-1 flex flex-wrap items-center gap-2">
          <ChannelBadge channel={ord.channel} size="md" />
          <b className="text-base">{o.number}</b>
          <span className="rounded-full bg-muted px-2 py-0.5 text-xs">{ord.fulfilment === 'DELIVERY' ? `Delivery${ord.distanceKm !== null ? ` · ${ord.distanceKm} km` : ''}` : 'Pickup'}</span>
          <span className="ml-auto text-xs text-muted-foreground" title={time(ord.placedAt)}>
            {finished ? STATE_LABEL[o.state] : ago(ord.placedAt, now)}
          </span>
        </div>
        {left ? (
          <p className={`mb-1 flex items-center gap-1 text-xs font-semibold tabular-nums ${left.urgent ? 'text-danger' : 'text-primary'}`}>
            <Clock className="h-3.5 w-3.5" /> Accept within {left.text.replace(' left', '')}
          </p>
        ) : null}
        {clock ? (
          <p
            role={clock.late ? 'alert' : undefined}
            aria-label={`Preparation time for ${o.number}: ${clock.text}`}
            data-prep-clock
            className={`mb-1 flex w-fit items-center gap-1.5 rounded-lg px-2 py-1 text-sm font-bold tabular-nums ${clock.late ? 'animate-pulse bg-danger text-white' : clock.soon ? 'bg-danger/10 text-danger' : 'bg-primary/10 text-primary'}`}
          >
            <AlarmClock className="h-4 w-4" /> {clock.text}
          </p>
        ) : null}
        <p className="font-medium">
          {ord.customer.name ?? 'Customer'} · {ord.customer.mobile}
          {ord.customer.verified ? ' ✓' : ''}
        </p>
        {ord.address ? (
          <p className="flex items-start gap-2 text-xs text-muted-foreground">
            <span className="flex-1">{[ord.address.line1, ord.address.line2, ord.address.landmark, `${ord.address.city} ${ord.address.pincode}`].filter(Boolean).join(', ')}</span>
            {ord.location ? (
              <button
                className="inline-flex shrink-0 items-center gap-1 rounded-md border border-border bg-card px-1.5 py-0.5 font-semibold text-foreground hover:bg-secondary"
                onClick={() => setMapFor(o)}
                aria-label={`Map for ${o.number}`}
              >
                <MapIcon className="h-3.5 w-3.5" /> Map
              </button>
            ) : null}
          </p>
        ) : null}
        <ul className="my-2 space-y-0.5">
          {ord.lines.map((l, i) => (
            <li key={i} className="flex gap-2">
              <span className="tabular-nums">{l.qtyMilli / 1000} ×</span>
              <span className="flex-1">
                {l.name}
                {l.modifiers.length ? <span className="text-xs text-muted-foreground"> + {l.modifiers.map((m) => m.name).join(', ')}</span> : null}
                {l.note ? <span className="block text-xs italic">“{l.note}”</span> : null}
              </span>
              <span className="tabular-nums">{formatINR(l.lineTotal)}</span>
            </li>
          ))}
        </ul>
        {ord.note ? <p className="mb-1 text-xs italic">Note: “{ord.note}”</p> : null}
        {x ? (
          <div className="mb-1 rounded-lg bg-muted p-2 text-xs" aria-label={`${platform} details`}>
            <div className="flex flex-wrap gap-x-3">
              <span>
                {platform} order <b>{x.orderId}</b>
              </span>
              {x.otp ? (
                <span>
                  OTP <b className="tracking-widest">{x.otp}</b>
                </span>
              ) : null}
              <span>{x.deliveredBy === 'platform' ? `${platform} rider delivers` : 'Your rider delivers'}</span>
            </div>
            {x.notes.map((n, i) => (
              <div key={i} className="font-medium text-primary">
                {n}
              </div>
            ))}
          </div>
        ) : null}
        <div className="border-t border-border pt-1 text-xs">
          {ord.deliveryFee > 0 ? (
            <div className="flex justify-between">
              <span>Delivery</span>
              <span className="tabular-nums">{formatINR(ord.deliveryFee)}</span>
            </div>
          ) : null}
          {ord.packagingFee > 0 ? (
            <div className="flex justify-between">
              <span>Packaging</span>
              <span className="tabular-nums">{formatINR(ord.packagingFee)}</span>
            </div>
          ) : null}
          <div className="flex justify-between text-sm font-semibold">
            <span>{payLine}</span>
            <span className="tabular-nums">{formatINR(ord.total)}</span>
          </div>
          {o.billNo ? (
            <div className={`flex justify-between ${differs ? 'font-bold text-danger' : 'text-muted-foreground'}`}>
              <span>
                Bill {o.billNo}
                {ord.prepMinutes ? ` · ready in ${ord.prepMinutes} min` : ''}
              </span>
              <span className="tabular-nums">{formatINR(o.posTotalPaise ?? 0)}</span>
            </div>
          ) : null}
          {ord.rider ? (
            <div className="text-muted-foreground">
              Rider: {ord.rider.name}
              {ord.rider.phone ? ` (${ord.rider.phone})` : ''}
            </div>
          ) : null}
        </div>
        {o.alert ? (
          <p role="alert" className="mt-2 flex gap-1 rounded-lg bg-primary/10 p-2 text-xs font-semibold text-primary">
            <CircleAlert className="h-4 w-4 shrink-0" /> {o.alert}
          </p>
        ) : null}
        {manage ? (
          <>
            <div className="mt-2 flex flex-wrap gap-2">
              {isNew ? (
                <>
                  {priceOk[o.id] !== undefined ? (
                    <button
                      className="btn btn-primary h-9"
                      disabled={busy === o.id}
                      onClick={() => void run(o.id, 'AcceptOnlineOrder', { onlineOrderId: o.id, acceptPriceChange: true }, `${o.number} accepted at the DinePOS price.`)}
                    >
                      <CheckCircle2 className="h-4 w-4" /> Accept at {formatINR(priceOk[o.id]!)}
                    </button>
                  ) : (
                    <button className="btn btn-primary h-9" disabled={busy === o.id} onClick={() => void run(o.id, 'AcceptOnlineOrder', { onlineOrderId: o.id }, `${o.number} accepted.`)}>
                      <CheckCircle2 className="h-4 w-4" /> Accept
                    </button>
                  )}
                  <button className="btn h-9" disabled={busy === o.id} onClick={() => setDialog({ kind: 'reject', order: o })}>
                    Reject
                  </button>
                </>
              ) : null}
              {nextSteps(o).map((to, i) => (
                <button
                  key={to}
                  className={`btn h-9 ${i === 0 ? 'btn-primary' : ''}`}
                  disabled={busy === o.id}
                  onClick={() =>
                    to === 'OUT_FOR_DELIVERY'
                      ? setDialog({ kind: 'rider', order: o })
                      : (to === 'DELIVERED' || to === 'PICKED_UP') && o.order.payment === 'COD' && o.posTotalPaise !== null
                        ? setDialog({ kind: 'payment', order: o, to }) // how the customer paid: cash, card, UPI, split
                        : void run(o.id, 'AdvanceOnlineOrder', { onlineOrderId: o.id, to }, `${o.number}: ${STEP_LABEL[to].toLowerCase()}.`)
                  }
                >
                  {to === 'OUT_FOR_DELIVERY' ? <Bike className="h-4 w-4" /> : null}
                  {STEP_LABEL[to]}
                </button>
              ))}
              {o.billId && !['DELIVERED', 'PICKED_UP'].includes(o.state) && (o.state !== 'CANCELLED' || o.alert) ? (
                <button className="btn h-9 text-danger" onClick={() => setDialog({ kind: 'cancel', order: o })}>
                  Cancel order
                </button>
              ) : null}
            </div>
            {o.localOrderId ? (
              <div className="mt-2 flex flex-wrap gap-2" aria-label={`Bill and KOT of ${o.number}`}>
                <button className="btn h-8 px-3 text-xs" onClick={() => onOpenOrder(o.localOrderId!)}>
                  <ReceiptText className="h-3.5 w-3.5" /> Open bill
                </button>
                {/* Settings › Online orders › When an order is accepted, print: what did not print, prints from here */}
                {!o.kotPrinted && o.state !== 'CANCELLED' ? (
                  <button className="btn h-8 px-3 text-xs" disabled={busy === o.id} onClick={() => void run(o.id, 'PrintOnlineOrder', { onlineOrderId: o.id, what: 'kot' }, `${o.number}: KOT printed.`)}>
                    <ChefHat className="h-3.5 w-3.5" /> KOT
                  </button>
                ) : null}
                {o.billId && !o.billPrinted && o.state !== 'CANCELLED' ? (
                  <button className="btn h-8 px-3 text-xs" disabled={busy === o.id} onClick={() => void run(o.id, 'PrintOnlineOrder', { onlineOrderId: o.id, what: 'bill' }, `${o.number}: bill printed.`)}>
                    <Printer className="h-3.5 w-3.5" /> Bill
                  </button>
                ) : null}
              </div>
            ) : null}
          </>
        ) : null}
      </li>
    );
  };

  const onlineSettings = config.data?.['online.settings'];
  const channels = onlineSettings ? (Object.keys(onlineSettings.channels) as Array<HubOrder['channel']>).filter((c) => onlineSettings.channels[c]) : [];
  const live = s?.connection === 'connected';

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center gap-3 border-b border-border bg-card px-4 py-2.5">
        <button className="btn" onClick={onBack}>
          <ArrowLeft className="h-4 w-4" /> Floor
        </button>
        <h1 className="font-display text-xl font-semibold">Online orders</h1>
      </header>
      <div className="flex flex-wrap items-center gap-2 px-4 pt-3 text-sm">
        {s ? (
          <span className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold ${live ? 'bg-ok/15 text-ok' : 'bg-danger/10 text-danger'}`} data-testid="hub-status">
            {live ? <Wifi className="h-3.5 w-3.5" /> : <WifiOff className="h-3.5 w-3.5" />}
            {live
              ? `Connected to the order hub${s.store?.name ? ` (${s.store.name})` : ''}`
              : s.connection === 'not-paired'
                ? 'Not connected to an order hub'
                : s.connection === 'off'
                  ? 'Online orders are off'
                  : `Reconnecting… ${s.lastError ?? ''}`}
          </span>
        ) : null}
        {channels.map((c) => (
          <ChannelBadge key={c} channel={c} />
        ))}
        {s?.pendingActions ? (
          <span className="text-xs text-muted-foreground">
            {s.pendingActions} update{s.pendingActions === 1 ? '' : 's'} waiting to reach the hub
          </span>
        ) : null}
      </div>
      {s?.connection === 'not-paired' ? (
        <p className="mx-4 mt-3 rounded-xl border border-border bg-card p-3 text-sm">
          Connect this outlet to your order hub in <b>Settings › Online orders</b>.
        </p>
      ) : null}
      {live && !s.accepting ? (
        <p role="alert" className="mx-4 mt-3 rounded-xl border border-danger/40 bg-danger/10 p-3 text-sm text-danger">
          No business day is open, so customers cannot order online right now.
        </p>
      ) : null}
      {message ? (
        <p
          role={message.error ? 'alert' : 'status'}
          className={`mx-4 mt-3 rounded-xl px-3 py-2 text-sm font-semibold ${message.error ? 'bg-danger/15 text-danger' : 'bg-secondary'}`}
          onClick={() => setMessage(null)}
        >
          {message.text}
        </p>
      ) : null}
      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        <div className="grid gap-3 lg:grid-cols-2 xl:grid-cols-4">
          {COLUMNS.map(([k, label, Icon]) => (
            <section key={k} aria-label={label} className="min-h-[55vh] rounded-2xl border border-border bg-card p-3">
              <h2 className="mb-2 flex items-center gap-2 font-semibold">
                <Icon className="h-4 w-4 text-primary" />
                {label}
                <span className="ml-auto rounded-full bg-muted px-2 text-xs">{b[k].length}</span>
              </h2>
              {b[k].length === 0 ? <p className="mt-8 text-center text-sm text-muted-foreground">No orders.</p> : null}
              <ul className="space-y-3">{b[k].map(card)}</ul>
            </section>
          ))}
        </div>
        {b.done.length > 0 ? (
          <section aria-label="Finished" className="mt-4 rounded-2xl border border-border bg-card p-3">
            <h2 className="mb-2 flex items-center gap-2 font-semibold">
              Finished recently
              {b.done.length > 4 ? (
                <button className="btn ml-auto h-8 px-3 text-xs" onClick={() => setShowDone((v) => !v)}>
                  {showDone ? 'Show less' : `Show all ${b.done.length}`}
                </button>
              ) : null}
            </h2>
            <ul className="grid gap-3 lg:grid-cols-2 xl:grid-cols-4">{(showDone ? b.done : b.done.slice(0, 4)).map(card)}</ul>
          </section>
        ) : null}
      </div>

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
