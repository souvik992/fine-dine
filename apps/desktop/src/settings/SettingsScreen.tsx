import type { Right } from '@dinepos/shared';
import { ArrowLeft, ChefHat, CloudUpload, DatabaseBackup, KeyRound, LayoutGrid, MapPinned, MonitorSmartphone, Puzzle, ShoppingBag, ReceiptText, Store, Users, UtensilsCrossed } from 'lucide-react';
import { useState, type ComponentType } from 'react';
import { useApp } from '../app-context.js';
import { UserBadge } from '../components/UserBadge.js';
import { BackupSettings } from './BackupSettings.js';
import { BillDesignSettings } from './BillDesignSettings.js';
import { DeviceSettings } from './DeviceSettings.js';
import { FloorSettings } from './FloorSettings.js';
import { KitchenSettings } from './KitchenSettings.js';
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

type SectionKey = 'outlet' | 'bill' | 'backups' | 'devices' | 'floor' | 'menu' | 'kitchen' | 'staff' | 'sections' | 'licence' | 'online' | 'sync' | 'addons' | 'terminal' | `addon:${string}`;

const SECTIONS: Array<{ key: SectionKey; label: string; hint: string; icon: ComponentType<{ className?: string }>; right: Right | null }> = [
  { key: 'outlet', label: 'Outlet & bills', hint: 'Name, GSTIN, bill number, round-off, UPI', icon: Store, right: 'admin' },
  { key: 'bill', label: 'Bill design', hint: 'Logo, what the bill shows, footer, preview', icon: ReceiptText, right: 'admin' },
  { key: 'floor', label: 'Floor & tables', hint: 'Areas, tables and the floor layout', icon: LayoutGrid, right: 'admin' },
  { key: 'menu', label: 'Menu', hint: 'Categories, items, options and add-ons', icon: UtensilsCrossed, right: 'admin' },
  { key: 'kitchen', label: 'Kitchen & printers', hint: 'Stations, printers, test print', icon: ChefHat, right: 'admin' },
  { key: 'backups', label: 'Backups', hint: 'Every 15 minutes; copy folder; restore', icon: DatabaseBackup, right: 'admin' },
  { key: 'devices', label: 'Devices', hint: 'Pair terminals and phones; revoke', icon: MonitorSmartphone, right: 'admin' },
  { key: 'staff', label: 'Staff & roles', hint: 'People, PINs, rights and discount limits', icon: Users, right: 'users.manage' },
  { key: 'sections', label: 'Captain sections', hint: 'Who looks after which areas and tables', icon: MapPinned, right: 'staff.sections' },
  { key: 'online', label: 'Online orders', hint: 'Order hub, delivery, charges, hours', icon: ShoppingBag, right: 'admin' },
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
  const all = [...SECTIONS.slice(0, -1), ...addonSections, SECTIONS[SECTIONS.length - 1]!];
  const visible = all.filter((s) => s.right === null || (session && can(s.right)));
  const [active, setActive] = useState<SectionKey>(visible.find((s) => s.key === initial)?.key ?? visible[0]!.key);
  const current = visible.find((s) => s.key === active) ?? visible[0]!;

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center gap-3 border-b border-border bg-card px-4 py-2.5">
        <button className="btn" onClick={onBack}>
          <ArrowLeft className="h-4 w-4" /> {session ? 'Floor' : 'Back'}
        </button>
        <h1 className="font-display text-xl font-semibold">Settings</h1>
        <div className="ml-auto">
          <UserBadge />
        </div>
      </header>
      <div className="flex min-h-0 flex-1">
        <nav className="w-64 shrink-0 overflow-y-auto border-r border-border bg-card p-2" aria-label="Settings sections">
          {visible.map(({ key, label, hint, icon: Icon }) => (
            <button
              key={key}
              onClick={() => setActive(key)}
              aria-current={key === current.key ? 'page' : undefined}
              className={`mb-1 flex w-full items-start gap-3 rounded-lg px-3 py-2.5 text-left ${key === current.key ? 'bg-foreground text-background' : 'hover:bg-secondary'}`}
            >
              <Icon className="mt-0.5 h-5 w-5 shrink-0" />
              <span>
                <span className="block text-sm font-semibold">{label}</span>
                <span className={`block text-xs ${key === current.key ? 'opacity-80' : 'text-muted-foreground'}`}>{hint}</span>
              </span>
            </button>
          ))}
        </nav>
        <main className="min-w-0 flex-1 overflow-y-auto px-8 py-6">
          {current.key === 'outlet' ? <OutletSettings /> : null}
          {current.key === 'bill' ? <BillDesignSettings /> : null}
          {current.key === 'backups' ? <BackupSettings /> : null}
          {current.key === 'devices' ? <DeviceSettings /> : null}
          {current.key === 'floor' ? <FloorSettings /> : null}
          {current.key === 'menu' ? <MenuSettings /> : null}
          {current.key === 'kitchen' ? <KitchenSettings /> : null}
          {current.key === 'staff' ? <StaffSettings /> : null}
          {current.key === 'sections' ? <CaptainSections /> : null}
          {current.key === 'licence' ? <LicenceSettings /> : null}
          {current.key === 'online' ? <OnlineSettings /> : null}
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
