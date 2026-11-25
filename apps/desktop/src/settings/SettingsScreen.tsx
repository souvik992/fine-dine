import type { Right } from '@dinepos/shared';
import { ArrowLeft, ChefHat, ChevronRight, CloudUpload, DatabaseBackup, KeyRound, LayoutGrid, MapPin, MapPinned, MonitorSmartphone, Printer, Puzzle, ShoppingBag, ReceiptText, Store, Ticket, Users, UtensilsCrossed } from 'lucide-react';
import { useState, type ComponentType } from 'react';
import { useApp } from '../app-context.js';
import { UserBadge } from '../components/UserBadge.js';
import { BackupSettings } from './BackupSettings.js';
import { BillDesignSettings } from './BillDesignSettings.js';
import { CouponSettings } from './CouponSettings.js';
import { DeviceSettings } from './DeviceSettings.js';
import { FloorSettings } from './FloorSettings.js';
import { KitchenSettings } from './KitchenSettings.js';
import { PrinterSettings } from './PrinterSettings.js';
import { MenuSettings } from './MenuSettings.js';
import { OutletSettings } from './OutletSettings.js';
import { CaptainSections } from './CaptainSections.js';
import { CloudSyncSettings } from './CloudSyncSettings.js';
import { LicenceSettings } from './LicenceSettings.js';
import { OnlineSettings } from './OnlineSettings.js';
import { StaffSettings } from './StaffSettings.js';
import { TerminalSettings } from './TerminalSettings.js';
import { AddonsSettings } from './AddonsSettings.js';
import { AddonView, useAddonRegistrations } from '../addons/runtime.js';

type SectionKey = 'outlet' | 'bill' | 'backups' | 'devices' | 'floor' | 'menu' | 'kitchen' | 'printers' | 'coupons' | 'staff' | 'sections' | 'licence' | 'online' | 'serviceability' | 'sync' | 'addons' | 'terminal' | `addon:${string}`;

const SECTIONS: Array<{ key: SectionKey; label: string; hint: string; icon: ComponentType<{ className?: string }>; right: Right | null }> = [
  { key: 'outlet', label: 'Outlet & bills', hint: 'Name, GSTIN, bill number, round-off, UPI', icon: Store, right: 'admin' },
  { key: 'bill', label: 'Bill design', hint: 'Logo, what the bill shows, footer, preview', icon: ReceiptText, right: 'admin' },
  { key: 'coupons', label: 'Coupons / Offers', hint: 'Coupon codes and offers for bills', icon: Ticket, right: 'admin' },
  { key: 'floor', label: 'Floor & tables', hint: 'Areas, tables and the floor layout', icon: LayoutGrid, right: 'admin' },
  { key: 'menu', label: 'Menu', hint: 'Categories, items, options and add-ons', icon: UtensilsCrossed, right: 'admin' },
  { key: 'kitchen', label: 'Kitchen', hint: 'Stations, kitchen screens (KDS)', icon: ChefHat, right: 'admin' },
  { key: 'printers', label: 'Printers', hint: 'USB, Wi-Fi and Bluetooth printers, tests, cash drawer', icon: Printer, right: 'admin' },
  { key: 'backups', label: 'Backups', hint: 'Every 15 minutes; copy folder; restore', icon: DatabaseBackup, right: 'admin' },
  { key: 'devices', label: 'Devices', hint: 'Pair terminals and phones; revoke', icon: MonitorSmartphone, right: 'admin' },
  { key: 'staff', label: 'Staff & roles', hint: 'People, PINs, rights and discount limits', icon: Users, right: 'users.manage' },
  { key: 'sections', label: 'Captain sections', hint: 'Who looks after which areas and tables', icon: MapPinned, right: 'staff.sections' },
  { key: 'online', label: 'Online orders', hint: 'Order hub, channels and menu sync, accepting, printing', icon: ShoppingBag, right: 'admin' },
  { key: 'serviceability', label: 'Serviceability', hint: 'Delivery areas and charges, store location, hours', icon: MapPin, right: 'admin' },
  { key: 'sync', label: 'Cloud sync', hint: 'Sales to the cloud, licence renewals, devices from anywhere', icon: CloudUpload, right: 'admin' },
  { key: 'licence', label: 'Licence', hint: 'Key, end date, seats; this PC’s hardware id', icon: KeyRound, right: 'admin' },
  { key: 'addons', label: 'Add-ons', hint: 'Installed add-ons and whether each is on', icon: Puzzle, right: 'admin' },
  { key: 'terminal', label: 'This terminal', hint: 'Outlet server address', icon: MonitorSmartphone, right: null },
];

/** Settings (like Tiffin POS): one section at a time, each shown only to roles that may change it. */
export function SettingsScreen({ onBack, initial }: { onBack: () => void; initial?: string }) {
  const { session, can } = useApp();
  // P5-01: add-ons' own settings sections, after DinePOS's
  const addonRegs = useAddonRegistrations();
  const addonSections = addonRegs.flatMap(([id, r]) => (r.settings ? [{ key: `addon:${id}` as SectionKey, label: r.settings.label, hint: r.settings.hint ?? 'Add-on', icon: Puzzle, right: r.settings.right ?? 'admin' }] : []));
  // This terminal first (it is the one anybody may open, signed in or not), then DinePOS's sections, then add-ons'
  const all = [SECTIONS[SECTIONS.length - 1]!, ...SECTIONS.slice(0, -1), ...addonSections];
  const visible = all.filter((s) => s.right === null || (session && can(s.right)));
  const [active, setActive] = useState<SectionKey>(visible.find((s) => s.key === initial)?.key ?? (visible.find((s) => s.key !== 'terminal') ?? visible[0]!).key);
  const current = visible.find((s) => s.key === active) ?? visible[0]!;
  // a phone shows the list of sections, then the chosen one full screen ("All settings" goes back); wider screens both
  const [listOnPhone, setListOnPhone] = useState(initial === undefined);

  return (
    <div className="flex h-full flex-col">
      <header className="appbar short:min-h-12">
        {/* a phone: the arrow goes back to the list from a section, and to the floor from the list */}
        <button className="btn h-10 w-10 px-0 md:hidden" onClick={listOnPhone ? onBack : () => setListOnPhone(true)} aria-label={listOnPhone ? (session ? 'Floor' : 'Back') : 'All settings'}>
          <ArrowLeft className="h-5 w-5" />
        </button>
        <button className="btn max-md:hidden" onClick={onBack}>
          <ArrowLeft className="h-4 w-4" /> {session ? 'Floor' : 'Back'}
        </button>
        <h1 className="min-w-0 truncate font-display text-xl font-semibold md:ml-1">
          <span className={listOnPhone ? '' : 'max-md:hidden'}>Settings</span>
          <span className={listOnPhone ? 'hidden' : 'md:hidden'}>{current.label}</span>
        </h1>
        <div className="ml-auto hidden sm:block [&_.text-muted-foreground]:text-primary-foreground/80">
          <UserBadge />
        </div>
      </header>
      <div className="flex min-h-0 flex-1">
        <nav className={`w-full shrink-0 flex-col overflow-y-auto border-border bg-card px-3 py-3 md:flex md:w-72 md:border-r md:bg-background ${listOnPhone ? 'flex' : 'hidden'}`} aria-label="Settings sections">
          {visible.map(({ key, label, hint, icon: Icon }) => {
            const on = key === current.key;
            const terminal = key === 'terminal';
            return (
              <button
                key={key}
                onClick={() => {
                  setActive(key);
                  setListOnPhone(false);
                }}
                aria-current={on ? 'page' : undefined}
                className={`flex w-full shrink-0 items-center gap-3.5 px-3 py-3 text-left transition-colors ${
                  terminal ? 'mb-2 rounded-xl border border-primary/25 bg-accent py-4' : 'border-b border-border last:border-b-0 md:mb-1 md:rounded-xl md:border md:border-transparent'
                } ${on ? 'md:!border-primary md:bg-accent' : 'hover:bg-secondary'}`}
              >
                <Icon className={`h-6 w-6 shrink-0 ${terminal || on ? 'text-primary' : 'text-foreground/80'}`} />
                <span className="min-w-0 flex-1">
                  <span className="block font-semibold">{label}</span>
                  <span className="block truncate text-xs text-muted-foreground">{hint}</span>
                </span>
                <ChevronRight className="h-5 w-5 shrink-0 text-muted-foreground" aria-hidden />
              </button>
            );
          })}
        </nav>
        {/* a phone: form fields side by side on a PC stack in one column */}
        <main className={`min-w-0 flex-1 overflow-y-auto px-4 py-4 md:block md:px-8 md:py-6 max-md:[&_.grid]:!grid-cols-1 ${listOnPhone ? 'hidden' : 'block'}`}>
          {current.key === 'outlet' ? <OutletSettings /> : null}
          {current.key === 'bill' ? <BillDesignSettings /> : null}
          {current.key === 'coupons' ? <CouponSettings /> : null}
          {current.key === 'backups' ? <BackupSettings /> : null}
          {current.key === 'devices' ? <DeviceSettings /> : null}
          {current.key === 'floor' ? <FloorSettings /> : null}
          {current.key === 'menu' ? <MenuSettings /> : null}
          {current.key === 'kitchen' ? <KitchenSettings /> : null}
          {current.key === 'printers' ? <PrinterSettings /> : null}
          {current.key === 'staff' ? <StaffSettings /> : null}
          {current.key === 'sections' ? <CaptainSections /> : null}
          {current.key === 'licence' ? <LicenceSettings /> : null}
          {current.key === 'online' ? <OnlineSettings key="orders" part="orders" /> : null}
          {current.key === 'serviceability' ? <OnlineSettings key="serviceability" part="serviceability" /> : null}
          {current.key === 'sync' ? <CloudSyncSettings /> : null}
          {current.key === 'addons' ? <AddonsSettings /> : null}
          {current.key.startsWith('addon:')
            ? addonRegs
                .filter(([id, r]) => `addon:${id}` === current.key && r.settings)
                .map(([id, r]) => <AddonView key={id} id={id} reg={r} Comp={r.settings!.Screen} nav={{ openOrder: () => onBack(), back: onBack }} />)
            : null}
          {current.key === 'terminal' ? <TerminalSettings onSaved={onBack} /> : null}
        </main>
      </div>
    </div>
  );
}
