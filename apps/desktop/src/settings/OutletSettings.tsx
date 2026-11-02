import type { OutletConfig } from '@dinepos/shared';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { useApp } from '../app-context.js';
import { bpToPercentText, percentToBp } from '../billing/money-input.js';
import { ErrorText, Field, SectionHeader, useCatalog, useSave } from './common.js';

interface Form {
  name: string;
  address: string;
  phone: string;
  gstin: string;
  fssai: string;
  prefix: string;
  roundOffStep: '0' | '50' | '100';
  roundOffTie: 'up' | 'down';
  serviceCharge: string;
  upiVpa: string;
  upiPayee: string;
  billPrinterId: string;
  defaultStationId: string;
}

const lines = (s: string) => s.split('\n').map((l) => l.trim()).filter(Boolean);
const orNull = (s: string) => (s.trim() ? s.trim() : null);

function toForm(c: OutletConfig): Form {
  return {
    name: c['outlet.name'],
    address: c['outlet.addressLines'].join('\n'),
    phone: c['outlet.phone'] ?? '',
    gstin: c['outlet.gstin'] ?? '',
    fssai: c['outlet.fssai'] ?? '',
    prefix: c['bill.prefix'],
    roundOffStep: String(c['bill.roundOffStep']) as Form['roundOffStep'],
    roundOffTie: c['bill.roundOffTie'],
    serviceCharge: bpToPercentText(c['bill.serviceChargeBp']),
    upiVpa: c['bill.upiVpa'] ?? '',
    upiPayee: c['bill.upiPayeeName'] ?? '',
    billPrinterId: c['bill.printerId'] ?? '',
    defaultStationId: c['kot.default_station_id'] ?? '',
  };
}

/** Outlet & bills: what is printed on every bill, and how bills are numbered and rounded (docs/08). */
export function OutletSettings() {
  const { api } = useApp();
  const config = useQuery({ queryKey: ['config'], queryFn: () => api.get<OutletConfig>('/v1/config') });
  const catalog = useCatalog();
  const { save, busy, error, setError } = useSave();
  const [form, setForm] = useState<Form | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (config.data && !form) setForm(toForm(config.data));
  }, [config.data, form]);
  if (!form || !config.data) return <p className="text-muted-foreground">Loading…</p>;

  const set = (patch: Partial<Form>) => {
    setForm({ ...form, ...patch });
    setSaved(false);
  };
  const scBp = percentToBp(form.serviceCharge);

  const submit = async () => {
    if (scBp === null || scBp > 2000) {
      setError('Service charge must be between 0 and 20%.');
      return;
    }
    const next: Partial<OutletConfig> = {
      'outlet.name': form.name.trim(),
      'outlet.addressLines': lines(form.address).slice(0, 4),
      'outlet.phone': orNull(form.phone),
      'outlet.gstin': orNull(form.gstin.toUpperCase()),
      'outlet.fssai': orNull(form.fssai),
      'bill.prefix': form.prefix.trim().toUpperCase(),
      'bill.roundOffStep': Number(form.roundOffStep) as 0 | 50 | 100,
      'bill.roundOffTie': form.roundOffTie,
      'bill.serviceChargeBp': scBp,
      'bill.upiVpa': orNull(form.upiVpa),
      'bill.upiPayeeName': orNull(form.upiPayee),
      'bill.printerId': orNull(form.billPrinterId),
      'kot.default_station_id': orNull(form.defaultStationId),
    };
    const before = config.data;
    const values = Object.fromEntries(Object.entries(next).filter(([k, v]) => JSON.stringify(before[k as keyof OutletConfig]) !== JSON.stringify(v)));
    if (Object.keys(values).length === 0) {
      setSaved(true);
      return;
    }
    if (await save('SetConfig', { values })) setSaved(true);
  };

  const printers = catalog.data?.printers.filter((p) => p.role !== 'kot') ?? [];
  return (
    <form
      className="max-w-3xl"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <SectionHeader title="Outlet & bills" subtitle="Printed on every bill. Ask your CA to check the GST details." />
      <fieldset className="grid grid-cols-2 gap-4 rounded-xl border border-border bg-card p-5">
        <legend className="px-1 text-sm font-bold">Outlet</legend>
        <Field label="Restaurant name">
          <input className="input" value={form.name} maxLength={60} onChange={(e) => set({ name: e.target.value })} />
        </Field>
        <Field label="Phone">
          <input className="input" value={form.phone} maxLength={32} onChange={(e) => set({ phone: e.target.value })} />
        </Field>
        <Field label="Address" hint="Up to 4 lines, as printed.">
          <textarea className="input h-24 py-2" value={form.address} onChange={(e) => set({ address: e.target.value })} />
        </Field>
        <div className="space-y-4">
          <Field label="GSTIN" hint="Checked before saving (typos are caught).">
            <input className="input uppercase" value={form.gstin} maxLength={15} onChange={(e) => set({ gstin: e.target.value })} />
          </Field>
          <Field label="FSSAI licence number">
            <input className="input" value={form.fssai} maxLength={14} inputMode="numeric" onChange={(e) => set({ fssai: e.target.value })} />
          </Field>
        </div>
      </fieldset>

      <fieldset className="mt-4 grid grid-cols-2 gap-4 rounded-xl border border-border bg-card p-5">
        <legend className="px-1 text-sm font-bold">Bills</legend>
        <Field label="Bill number prefix" hint={`Bills look like ${form.prefix.trim().toUpperCase() || 'B'}/26-27/000001 (1–3 letters or digits).`}>
          <input className="input uppercase" value={form.prefix} maxLength={3} onChange={(e) => set({ prefix: e.target.value })} />
        </Field>
        <Field label="Service charge (%)" hint="Added only when the guest agrees, bill by bill. 0 turns it off.">
          <input className="input" value={form.serviceCharge} inputMode="decimal" onChange={(e) => set({ serviceCharge: e.target.value })} />
        </Field>
        <Field label="Round the total to">
          <select className="input" value={form.roundOffStep} onChange={(e) => set({ roundOffStep: e.target.value as Form['roundOffStep'] })}>
            <option value="100">Nearest ₹1</option>
            <option value="50">Nearest 50 paise</option>
            <option value="0">Do not round</option>
          </select>
        </Field>
        <Field label="Exactly half way (e.g. ₹101.50)">
          <select className="input" value={form.roundOffTie} onChange={(e) => set({ roundOffTie: e.target.value as Form['roundOffTie'] })} disabled={form.roundOffStep === '0'}>
            <option value="up">Round up</option>
            <option value="down">Round down</option>
          </select>
        </Field>
        <Field label="UPI id for the payment QR" hint="Leave empty to print no QR.">
          <input className="input" value={form.upiVpa} placeholder="restaurant@okbank" onChange={(e) => set({ upiVpa: e.target.value })} />
        </Field>
        <Field label="UPI payee name">
          <input className="input" value={form.upiPayee} maxLength={40} onChange={(e) => set({ upiPayee: e.target.value })} />
        </Field>
        <Field label="Bill printer" hint="Logo, footer and what the bill shows are in Bill design.">
          <select className="input" value={form.billPrinterId} onChange={(e) => set({ billPrinterId: e.target.value })}>
            <option value="">First printer set for bills</option>
            {printers.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Kitchen station for items without one">
          <select className="input" value={form.defaultStationId} onChange={(e) => set({ defaultStationId: e.target.value })}>
            <option value="">None (refuse to send)</option>
            {catalog.data?.stations.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </Field>
      </fieldset>

      <ErrorText error={error} />
      <div className="mt-5 flex items-center gap-3">
        <button type="submit" className="btn btn-primary" disabled={busy}>
          {busy ? 'Saving…' : 'Save'}
        </button>
        {saved ? <span className="text-sm font-semibold text-ok" role="status">Saved</span> : null}
      </div>
    </form>
  );
}
