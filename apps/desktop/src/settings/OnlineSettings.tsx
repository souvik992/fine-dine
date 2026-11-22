import { formatINR, parseRupees, type ChannelSync, type OnlineSettings as Settings, type OnlineStatus, type OutletConfig, type SalesChannel, type Serviceability } from '@dinepos/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link2, Plus, SlidersHorizontal, Trash2, Unlink } from 'lucide-react';
import { useState } from 'react';
import { ApiError } from '../api/client.js';
import { useApp } from '../app-context.js';
import { ErrorText, Field, SectionHeader, Toggle, useSave } from './common.js';
import { MenuSyncDialog } from './MenuSyncDialog.js';
import { StoreLocationMap } from './StoreLocationMap.js';

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const rupees = (paise: number) => String(paise / 100);
const FEE_GST: Array<[number | null, string]> = [
  [null, 'Not set: no delivery or packaging charges'],
  [0, '0% (exempt)'],
  [500, '5%'],
  [1200, '12%'],
  [1800, '18%'],
];

/**
 * Online orders (P4-06): the link to the order hub, and what the outlet publishes there — accepting, channels,
 * pickup/delivery, payments, the GST on charges, delivery bands, pickup, packaging and opening hours.
 */
export function OnlineSettings({ part = 'orders' }: { part?: 'orders' | 'serviceability' }) {
  const { api } = useApp();
  const qc = useQueryClient();
  const config = useQuery({ queryKey: ['config'], queryFn: () => api.get<OutletConfig>('/v1/config') });
  const status = useQuery({ queryKey: ['online'], queryFn: () => api.get<OnlineStatus>('/v1/online'), refetchInterval: 10_000 });
  const [draft, setDraft] = useState<Settings | null>(null);
  const { save, busy, error, setError } = useSave();
  const [saved, setSaved] = useState(false);
  const [link, setLink] = useState('');
  const [linkError, setLinkError] = useState<string | null>(null);
  const [pairing, setPairing] = useState(false);
  const [syncing, setSyncing] = useState<SalesChannel | null>(null);
  if (!config.data) return <p className="text-muted-foreground">Loading…</p>;
  const s = draft ?? config.data['online.settings'];
  const set = (patch: Partial<Settings>) => {
    setSaved(false);
    setDraft({ ...s, ...patch });
  };
  const svc = s.serviceability;
  const setSvc = (patch: Partial<Serviceability>) => set({ serviceability: { ...svc, ...patch } });
  const money = (v: string) => {
    try {
      return parseRupees(v || '0');
    } catch {
      return 0;
    }
  };

  const pair = async () => {
    setPairing(true);
    setLinkError(null);
    try {
      await api.send('POST', '/v1/online/pair', { link: link.trim() });
      setLink('');
      await qc.invalidateQueries({ queryKey: ['online'] });
    } catch (e) {
      setLinkError(e instanceof ApiError ? e.message : 'Could not reach the outlet server.');
    } finally {
      setPairing(false);
    }
  };

  const st = status.data;
  const orders = part === 'orders';
  return (
    <div className="max-w-4xl">
      {orders ? (
        <SectionHeader title="Online orders" subtitle="Orders from your website, app, Swiggy and Zomato arrive through the order hub. Delivery areas, charges and hours are in Serviceability." />
      ) : (
        <SectionHeader title="Serviceability" subtitle="Where you deliver and what it costs, pickup, the store’s location and the hours you take online orders. The hub checks every order against these." />
      )}

      {orders ? (
      <div className="mb-8 rounded-xl border border-border bg-card p-4" data-testid="hub-link">
        {st?.paired ? (
          <div className="flex items-center gap-3">
            <Link2 className="h-5 w-5 text-ok" />
            <div className="flex-1">
              <p className="font-semibold">Connected to {st.store?.name ?? 'the order hub'}</p>
              <p className="text-sm text-muted-foreground">
                {st.hubUrl} · {st.connection === 'connected' ? 'live' : st.connection} {st.lastError ? `· ${st.lastError}` : ''} · menu version {st.menuVersion}
              </p>
            </div>
            <button className="btn" disabled={busy} onClick={() => void save('UnlinkOnlineHub', {})}>
              <Unlink className="h-4 w-4" /> Disconnect
            </button>
          </div>
        ) : (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void pair();
            }}
          >
            <Field label="Connection link from the order hub" hint="On the hub’s admin page: your store › Pair a POS. It looks like https://orders.example.in/connect/ABCD-EFGH and works once.">
              <input className="input" value={link} onChange={(e) => setLink(e.target.value)} placeholder="https://…/connect/…" aria-label="Connection link" />
            </Field>
            <ErrorText error={linkError} />
            <button type="submit" className="btn btn-primary mt-2" disabled={pairing || !link.trim()}>
              <Link2 className="h-4 w-4" /> Connect
            </button>
          </form>
        )}
      </div>
      ) : null}

      <form
        onSubmit={(e) => {
          e.preventDefault();
          setError(null);
          void save('SetConfig', { values: { 'online.settings': s } }).then((ok) => {
            if (ok) {
              setDraft(null);
              setSaved(true);
            }
          });
        }}
      >
        {orders ? (
        <>
        <div className="grid grid-cols-2 gap-x-8 gap-y-3">
          <Toggle checked={s.enabled} onChange={(v) => set({ enabled: v })} label="Take online orders" hint="Off: the hub shows the restaurant as closed online." />
          <Field label="Accepting">
            <select className="input" value={s.acceptMode} onChange={(e) => set({ acceptMode: e.target.value as Settings['acceptMode'] })} aria-label="Accepting">
              <option value="manual">By hand (staff accept or reject)</option>
              <option value="auto">Automatically (when the price matches)</option>
            </select>
          </Field>
          <Field label="Unanswered orders are rejected after (minutes)">
            <input className="input" inputMode="numeric" value={s.acceptTimeoutMin} onChange={(e) => set({ acceptTimeoutMin: Math.min(15, Math.max(2, Number(e.target.value) || 5)) })} aria-label="Reject after minutes" />
          </Field>
          <Field label="Kitchen time for delivery orders (minutes)">
            <input className="input" inputMode="numeric" value={s.prepMinutes} onChange={(e) => set({ prepMinutes: Math.min(180, Math.max(1, Number(e.target.value) || 20)) })} aria-label="Kitchen time" />
          </Field>
          <div className="space-y-1">
            <p className="text-sm font-semibold">Channels</p>
            {/* P6-06: Swiggy / Zomato through UrbanPiper on the order hub (the hub admin links the outlet there) */}
            {(['website', 'app', 'swiggy', 'zomato'] as const).map((c) => (
              <div key={c} className="flex items-center gap-2">
                <div className="flex-1">
                  <Toggle checked={s.channels[c]} onChange={(v) => set({ channels: { ...s.channels, [c]: v } })} label={CHANNEL_NAME[c]} />
                </div>
                <button type="button" className="btn h-8 px-2 text-xs" onClick={() => setSyncing(c)} title="Menu sync: which dishes this channel lists, and its prices" aria-label={`Menu sync for ${CHANNEL_NAME[c]}`}>
                  <SlidersHorizontal className="h-3.5 w-3.5" /> Menu sync{syncNote(config.data['online.menuSync'][c])}
                </button>
              </div>
            ))}
            {(s.channels.swiggy || s.channels.zomato) && (
              <p className="text-xs text-muted-foreground">Swiggy and Zomato bills are paid as “Other” (the platform pays later), except cash your own rider collects.</p>
            )}
          </div>
          <div className="space-y-1">
            <p className="text-sm font-semibold">Orders</p>
            <Toggle checked={s.fulfilment.pickup} onChange={(v) => set({ fulfilment: { ...s.fulfilment, pickup: v } })} label="Pickup" />
            <Toggle checked={s.fulfilment.delivery} onChange={(v) => set({ fulfilment: { ...s.fulfilment, delivery: v } })} label="Delivery (own riders)" />
          </div>
          <div className="space-y-1">
            <p className="text-sm font-semibold">Payment</p>
            <Toggle checked={s.payments.online} onChange={(v) => set({ payments: { ...s.payments, online: v } })} label="Pay online" />
            <Toggle checked={s.payments.cod} onChange={(v) => set({ payments: { ...s.payments, cod: v } })} label="Cash on delivery / at pickup" />
          </div>
        </div>

        <section className="mt-6 rounded-xl border border-border bg-card p-4" aria-label="Printing on accepting">
          <h3 className="mb-1 font-semibold">When an order is accepted, print</h3>
          <p className="mb-2 text-xs text-muted-foreground">By staff or automatically. Anything not printed here can be printed from the order card (Print bill, Print KOT).</p>
          <div className="space-y-1">
            <Toggle checked={s.printOnAccept.bill} onChange={(v) => set({ printOnAccept: { ...s.printOnAccept, bill: v } })} label="The bill" />
            <Toggle checked={s.printOnAccept.kot} onChange={(v) => set({ printOnAccept: { ...s.printOnAccept, kot: v } })} label="Kitchen tickets (KOT)" hint="On the stations’ printers, as set in Settings › Kitchen." />
          </div>
        </section>
        </>
        ) : (
        <>
        <div className="grid grid-cols-2 gap-x-8 gap-y-3">
          <Field label="GST on delivery and packaging charges" hint="Ask your CA. “Not set” blocks delivery and packaging charges.">
            <select className="input" value={s.feeTaxBp ?? ''} onChange={(e) => set({ feeTaxBp: e.target.value === '' ? null : Number(e.target.value) })} aria-label="GST on charges">
              {FEE_GST.map(([v, l]) => (
                <option key={l} value={v ?? ''}>
                  {l}
                </option>
              ))}
            </select>
          </Field>
        </div>

        <h3 className="mb-2 mt-8 font-semibold">Pickup and packaging</h3>
        <div className="grid grid-cols-3 gap-3">
          <Field label="Pickup: minimum order (₹)">
            <input className="input" inputMode="decimal" value={rupees(svc.pickup.minOrder)} onChange={(e) => setSvc({ pickup: { ...svc.pickup, minOrder: money(e.target.value) } })} aria-label="Pickup minimum" />
          </Field>
          <Field label="Pickup: ready in (minutes)">
            <input className="input" inputMode="numeric" value={svc.pickup.etaMinutes} onChange={(e) => setSvc({ pickup: { ...svc.pickup, etaMinutes: Math.min(240, Math.max(5, Number(e.target.value) || 20)) } })} aria-label="Pickup ready in" />
          </Field>
          <Field label="Packaging charge per order (₹)">
            <input className="input" inputMode="decimal" value={rupees(svc.packagingFee)} onChange={(e) => setSvc({ packagingFee: Math.min(500_00, money(e.target.value)) })} aria-label="Packaging charge" />
          </Field>
        </div>

        <h3 className="mb-2 mt-8 font-semibold">Delivery</h3>
        <div className="grid grid-cols-3 gap-3">
          <Field label="Store latitude">
            <input className="input" inputMode="decimal" value={svc.location?.lat ?? ''} onChange={(e) => setSvc({ location: { lat: Number(e.target.value), lng: svc.location?.lng ?? 0, label: svc.location?.label ?? '' } })} placeholder="22.5726" aria-label="Latitude" />
          </Field>
          <Field label="Store longitude">
            <input className="input" inputMode="decimal" value={svc.location?.lng ?? ''} onChange={(e) => setSvc({ location: { lat: svc.location?.lat ?? 0, lng: Number(e.target.value), label: svc.location?.label ?? '' } })} placeholder="88.3639" aria-label="Longitude" />
          </Field>
          <Field label="Selected address">
            <input
              className="input bg-secondary"
              readOnly
              value={svc.location?.label ?? ''}
              placeholder="Search the area below or click the map"
              title={svc.location?.label || undefined}
              aria-label="Selected address"
            />
          </Field>
        </div>
        <StoreLocationMap
          location={svc.location}
          bandsKm={svc.zones.map((z) => z.upToKm)}
          roadFactor={svc.roadFactor}
          onPick={(p, address) => setSvc({ location: { lat: p.lat, lng: p.lng, label: address } })}
        />
        <table className="mt-3 w-full text-sm" aria-label="Delivery bands">
          <thead className="text-left text-muted-foreground">
            <tr>
              <th className="py-1">Up to (km)</th>
              <th>Delivery charge (₹)</th>
              <th>Minimum order (₹)</th>
              <th>Free above (₹, blank = never)</th>
              <th>Delivery time (min)</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {svc.zones.map((z, i) => {
              const setZone = (patch: Partial<typeof z>) => setSvc({ zones: svc.zones.map((x, j) => (j === i ? { ...x, ...patch } : x)) });
              return (
                <tr key={i}>
                  <td className="pr-2">
                    <input className="input h-9" inputMode="decimal" value={z.upToKm} onChange={(e) => setZone({ upToKm: Number(e.target.value) })} aria-label={`Band ${i + 1} up to km`} />
                  </td>
                  <td className="pr-2">
                    <input className="input h-9" inputMode="decimal" value={rupees(z.deliveryFee)} onChange={(e) => setZone({ deliveryFee: money(e.target.value) })} aria-label={`Band ${i + 1} delivery charge`} />
                  </td>
                  <td className="pr-2">
                    <input className="input h-9" inputMode="decimal" value={rupees(z.minOrder)} onChange={(e) => setZone({ minOrder: money(e.target.value) })} aria-label={`Band ${i + 1} minimum order`} />
                  </td>
                  <td className="pr-2">
                    <input className="input h-9" inputMode="decimal" value={z.freeDeliveryAbove === null ? '' : rupees(z.freeDeliveryAbove)} onChange={(e) => setZone({ freeDeliveryAbove: e.target.value.trim() ? money(e.target.value) : null })} aria-label={`Band ${i + 1} free above`} />
                  </td>
                  <td className="pr-2">
                    <input className="input h-9" inputMode="numeric" value={z.etaMinutes} onChange={(e) => setZone({ etaMinutes: Math.min(240, Math.max(5, Number(e.target.value) || 30)) })} aria-label={`Band ${i + 1} delivery time`} />
                  </td>
                  <td>
                    <button type="button" className="btn h-9 w-9 px-0" onClick={() => setSvc({ zones: svc.zones.filter((_, j) => j !== i) })} aria-label={`Remove band ${i + 1}`}>
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {svc.zones.length < 6 ? (
          <button type="button" className="btn mt-2 h-9" onClick={() => setSvc({ zones: [...svc.zones, { upToKm: (svc.zones.at(-1)?.upToKm ?? 0) + 3, deliveryFee: 4000, minOrder: 20000, freeDeliveryAbove: null, etaMinutes: 50 }] })}>
            <Plus className="h-4 w-4" /> Add a band
          </button>
        ) : null}
        {svc.zones[0] ? <p className="mt-1 text-xs text-muted-foreground">First band: {formatINR(svc.zones[0].deliveryFee)} up to {svc.zones[0].upToKm} km. Distance is the road estimate the hub works out.</p> : null}
        <div className="mt-3 max-w-xs">
          <Field label="Road factor" hint="Road distance ÷ straight-line distance, used when the hub has no road map (1.30 is usual in cities).">
            <input
              className="input"
              inputMode="decimal"
              value={svc.roadFactor}
              onChange={(e) => setSvc({ roadFactor: Math.min(2, Math.max(1, Number(e.target.value) || 1.3)) })}
              aria-label="Road factor"
            />
          </Field>
        </div>

        <div className="mb-2 mt-8 flex items-center gap-3">
          <h3 className="font-semibold">Opening hours (online)</h3>
          {/* Monday is key 1 (0 = Sunday) */}
          <button
            type="button"
            className="btn h-8 px-3 text-xs"
            onClick={() => {
              const monday = svc.hours['1' as unknown as keyof Serviceability['hours']];
              setSvc({ hours: Object.fromEntries(DAYS.map((_, d) => [String(d), monday.map((s) => ({ ...s }))])) as Serviceability['hours'] });
            }}
          >
            Copy Monday to all days
          </button>
        </div>
        <table className="text-sm" aria-label="Opening hours">
          <tbody>
            {DAYS.map((name, d) => {
              const key = String(d) as unknown as keyof Serviceability['hours'];
              const slots = svc.hours[key];
              const setSlots = (next: typeof slots) => setSvc({ hours: { ...svc.hours, [key]: next } });
              return (
                <tr key={d}>
                  <td className="w-28 py-1 font-semibold">{name}</td>
                  {slots.map((sl, i) => (
                    <td key={i} className="whitespace-nowrap py-1 pr-3">
                      <input type="time" className="input h-9 w-36" value={sl.open} onChange={(e) => setSlots(slots.map((x, j) => (j === i ? { ...x, open: e.target.value } : x)))} aria-label={`${name} opens ${i + 1}`} />
                      <span className="px-1">–</span>
                      <input type="time" className="input h-9 w-36" value={sl.close} onChange={(e) => setSlots(slots.map((x, j) => (j === i ? { ...x, close: e.target.value } : x)))} aria-label={`${name} closes ${i + 1}`} />
                    </td>
                  ))}
                  <td className="py-1">
                    <div className="flex gap-2">
                    {slots.length < 2 ? (
                      <button type="button" className="btn h-8 px-2 text-xs" onClick={() => setSlots([...slots, { open: '19:00', close: '23:00' }])}>
                        + second time
                      </button>
                    ) : null}
                    {slots.length > 0 ? (
                      <button type="button" className="btn h-8 px-2 text-xs" onClick={() => setSlots(slots.slice(0, -1))}>
                        {slots.length === 1 ? 'Closed' : 'Remove'}
                      </button>
                    ) : (
                      <button type="button" className="btn h-8 px-2 text-xs" onClick={() => setSlots([{ open: '12:00', close: '23:00' }])}>
                        Open this day
                      </button>
                    )}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        </>
        )}

        <ErrorText error={error} />
        <div className="mt-6 flex items-center gap-3">
          <button type="submit" className="btn btn-primary" disabled={busy}>
            Save
          </button>
          {saved ? <span className="text-sm font-semibold text-ok">Saved: the hub gets the changes within seconds.</span> : null}
        </div>
      </form>
      {syncing ? <MenuSyncDialog channel={syncing} hubConnected={st?.connection === 'connected'} onClose={() => setSyncing(null)} /> : null}
    </div>
  );
}

const CHANNEL_NAME: Record<SalesChannel, string> = { website: 'Website', app: 'App', swiggy: 'Swiggy', zomato: 'Zomato' };

/** " · 12 dishes" / " · +15%" beside a channel's Menu sync button, when it is not "everything at the POS price". */
function syncNote(c: ChannelSync): string {
  const what = c.mode === 'all' ? '' : c.mode === 'include' ? `only ${c.items.length}` : `${c.items.length} left out`;
  const price = c.pricing === 'custom' ? (c.markupBp ? `${c.markupBp > 0 ? '+' : ''}${c.markupBp / 100}%` : 'own prices') : '';
  const note = [what, price].filter(Boolean).join(', ');
  return note ? ` · ${note}` : '';
}
