import { formatINR, parseRupees, type OnlineSettings as Settings, type OnlineStatus, type OutletConfig, type Serviceability } from '@dinepos/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link2, Plus, Trash2, Unlink } from 'lucide-react';
import { useState } from 'react';
import { ApiError } from '../api/client.js';
import { useApp } from '../app-context.js';
import { ErrorText, Field, SectionHeader, Toggle, useSave } from './common.js';
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
export function OnlineSettings() {
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
  return (
    <div className="max-w-4xl">
      <SectionHeader title="Online orders" subtitle="Orders from your website and app arrive through the order hub. Accepting prints the KOT and the GST bill here." />

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
            <Toggle checked={s.channels.website} onChange={(v) => set({ channels: { ...s.channels, website: v } })} label="Website" />
            <Toggle checked={s.channels.app} onChange={(v) => set({ channels: { ...s.channels, app: v } })} label="App" />
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
          <Field label="GST on delivery and packaging charges" hint="Ask your CA. Until it is set, no charges can be added.">
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
          <Field label="Address shown to customers">
            <input className="input" maxLength={200} value={svc.location?.label ?? ''} onChange={(e) => setSvc({ location: { lat: svc.location?.lat ?? 0, lng: svc.location?.lng ?? 0, label: e.target.value } })} aria-label="Store address" />
          </Field>
        </div>
        <StoreLocationMap
          location={svc.location}
          bandsKm={svc.zones.map((z) => z.upToKm)}
          roadFactor={svc.roadFactor}
          onPick={(p) => setSvc({ location: { lat: p.lat, lng: p.lng, label: svc.location?.label ?? '' } })}
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

        <h3 className="mb-2 mt-8 font-semibold">Opening hours (online)</h3>
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
                    <td key={i} className="pr-3">
                      <input type="time" className="input h-9 w-28" value={sl.open} onChange={(e) => setSlots(slots.map((x, j) => (j === i ? { ...x, open: e.target.value } : x)))} aria-label={`${name} opens ${i + 1}`} />
                      <span className="px-1">–</span>
                      <input type="time" className="input h-9 w-28" value={sl.close} onChange={(e) => setSlots(slots.map((x, j) => (j === i ? { ...x, close: e.target.value } : x)))} aria-label={`${name} closes ${i + 1}`} />
                    </td>
                  ))}
                  <td>
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
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>

        <ErrorText error={error} />
        <div className="mt-6 flex items-center gap-3">
          <button type="submit" className="btn btn-primary" disabled={busy}>
            Save
          </button>
          {saved ? <span className="text-sm font-semibold text-ok">Saved: the hub gets the changes within seconds.</span> : null}
        </div>
      </form>
    </div>
  );
}
