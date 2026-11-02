import { ArrowLeft, BarChart3, BookOpen, Boxes, Truck } from 'lucide-react';
import { useState, type ComponentType } from 'react';
import { UserBadge } from '../components/UserBadge.js';
import { MaterialsTab } from './MaterialsTab.js';
import { PurchasesTab } from './PurchasesTab.js';
import { RecipesTab } from './RecipesTab.js';
import { UsageTab } from './UsageTab.js';

type Tab = 'materials' | 'purchases' | 'recipes' | 'usage';

const TABS: Array<{ key: Tab; label: string; icon: ComponentType<{ className?: string }> }> = [
  { key: 'materials', label: 'Materials', icon: Boxes },
  { key: 'purchases', label: 'Purchases', icon: Truck },
  { key: 'recipes', label: 'Recipes', icon: BookOpen },
  { key: 'usage', label: 'Usage report', icon: BarChart3 },
];

const TAB_KEY = 'dinepos.stockTab';

/** Inventory (docs/09 §8): raw materials, supplier purchases, recipes and consumption. Needs the stock.manage right. */
export function StockScreen({ onBack }: { onBack: () => void }) {
  const [tab, setTabState] = useState<Tab>(() => {
    try {
      const t = sessionStorage.getItem(TAB_KEY);
      return TABS.some((x) => x.key === t) ? (t as Tab) : 'materials';
    } catch {
      return 'materials';
    }
  });
  const setTab = (t: Tab) => {
    setTabState(t);
    try {
      sessionStorage.setItem(TAB_KEY, t);
    } catch {
      // per-window convenience only
    }
  };

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center gap-3 border-b border-border bg-card px-4 py-2.5">
        <button className="btn" onClick={onBack}>
          <ArrowLeft className="h-4 w-4" /> Floor
        </button>
        <h1 className="font-display text-xl font-semibold">Stock</h1>
        <nav role="tablist" aria-label="Stock sections" className="ml-4 flex gap-1">
          {TABS.map(({ key, label, icon: Icon }) => (
            <button key={key} role="tab" className="tab inline-flex items-center gap-1.5" aria-selected={tab === key} onClick={() => setTab(key)}>
              <Icon className="h-4 w-4" /> {label}
            </button>
          ))}
        </nav>
        <div className="ml-auto">
          <UserBadge />
        </div>
      </header>
      <main className="min-h-0 flex-1 overflow-y-auto p-6">
        <div className="mx-auto max-w-6xl">
          {tab === 'materials' ? <MaterialsTab /> : null}
          {tab === 'purchases' ? <PurchasesTab /> : null}
          {tab === 'recipes' ? <RecipesTab /> : null}
          {tab === 'usage' ? <UsageTab /> : null}
        </div>
      </main>
    </div>
  );
}
