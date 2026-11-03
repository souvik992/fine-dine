import type { Right } from '@dinepos/shared';
import { ArrowLeft, ChefHat, DatabaseBackup, LayoutGrid, MonitorSmartphone, ReceiptText, Store, Users, UtensilsCrossed } from 'lucide-react';
import { useState, type ComponentType } from 'react';
import { useApp } from '../app-context.js';
import { UserBadge } from '../components/UserBadge.js';
import { BackupSettings } from './BackupSettings.js';
import { BillDesignSettings } from './BillDesignSettings.js';
import { FloorSettings } from './FloorSettings.js';
import { KitchenSettings } from './KitchenSettings.js';
import { MenuSettings } from './MenuSettings.js';
import { OutletSettings } from './OutletSettings.js';
import { StaffSettings } from './StaffSettings.js';
import { TerminalSettings } from './TerminalSettings.js';

type SectionKey = 'outlet' | 'bill' | 'backups' | 'floor' | 'menu' | 'kitchen' | 'staff' | 'terminal';

const SECTIONS: Array<{ key: SectionKey; label: string; hint: string; icon: ComponentType<{ className?: string }>; right: Right | null }> = [
  { key: 'outlet', label: 'Outlet & bills', hint: 'Name, GSTIN, bill number, round-off, UPI', icon: Store, right: 'admin' },
  { key: 'bill', label: 'Bill design', hint: 'Logo, what the bill shows, footer, preview', icon: ReceiptText, right: 'admin' },
  { key: 'floor', label: 'Floor & tables', hint: 'Areas, tables and the floor layout', icon: LayoutGrid, right: 'admin' },
  { key: 'menu', label: 'Menu', hint: 'Categories, items, options and add-ons', icon: UtensilsCrossed, right: 'admin' },
  { key: 'kitchen', label: 'Kitchen & printers', hint: 'Stations, printers, test print', icon: ChefHat, right: 'admin' },
  { key: 'backups', label: 'Backups', hint: 'Every 15 minutes; copy folder; restore', icon: DatabaseBackup, right: 'admin' },
  { key: 'staff', label: 'Staff & roles', hint: 'People, PINs, rights and discount limits', icon: Users, right: 'users.manage' },
  { key: 'terminal', label: 'This terminal', hint: 'Outlet server address', icon: MonitorSmartphone, right: null },
];

/** Settings (like Tiffin POS): one section at a time, each shown only to roles that may change it. */
export function SettingsScreen({ onBack }: { onBack: () => void }) {
  const { session, can } = useApp();
  const visible = SECTIONS.filter((s) => s.right === null || (session && can(s.right)));
  const [active, setActive] = useState<SectionKey>(visible[0]!.key);
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
          {current.key === 'floor' ? <FloorSettings /> : null}
          {current.key === 'menu' ? <MenuSettings /> : null}
          {current.key === 'kitchen' ? <KitchenSettings /> : null}
          {current.key === 'staff' ? <StaffSettings /> : null}
          {current.key === 'terminal' ? <TerminalSettings onSaved={onBack} /> : null}
        </main>
      </div>
    </div>
  );
}
