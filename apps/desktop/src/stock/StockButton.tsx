import { Package } from 'lucide-react';
import { useStock } from './common.js';

/** Floor header button; the badge counts materials that are low or need a count. Render only for stock.manage. */
export function StockButton({ onClick }: { onClick: () => void }) {
  const stock = useStock();
  const attention = (stock.data?.items ?? []).filter((i) => i.active && (i.low || i.negative)).length;
  return (
    <button className="btn relative h-10" onClick={onClick} title={attention ? `${attention} material(s) low or need a count` : 'Stock, purchases and recipes'}>
      <Package className="h-4 w-4" /> Stock
      {attention ? (
        <span className="absolute -right-1.5 -top-1.5 min-w-5 rounded-full bg-danger px-1 text-center text-xs font-bold leading-5 text-white" aria-label={`${attention} need attention`}>
          {attention}
        </span>
      ) : null}
    </button>
  );
}
