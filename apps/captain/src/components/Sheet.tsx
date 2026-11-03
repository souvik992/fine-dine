import { X } from 'lucide-react';
import type { ReactNode } from 'react';

/** A bottom sheet (one-handed reach on a phone). Tapping outside or × closes it. */
export function Sheet({ title, onClose, children, footer }: { title: string; onClose: () => void; children: ReactNode; footer?: ReactNode }) {
  return (
    <div className="fixed inset-0 z-30 flex flex-col justify-end bg-black/40" onClick={onClose}>
      <section role="dialog" aria-label={title} className="flex max-h-[88%] flex-col rounded-t-2xl bg-card" onClick={(e) => e.stopPropagation()}>
        <div className="overflow-y-auto p-5 pb-4">
          <div className="mx-auto mb-3 h-1.5 w-12 rounded-full bg-border" />
          <div className="mb-4 flex items-start gap-2">
            <h2 className="flex-1 font-display text-2xl font-semibold">{title}</h2>
            <button type="button" className="btn h-10 w-10 shrink-0 px-0" onClick={onClose} aria-label="Close">
              <X className="h-5 w-5" />
            </button>
          </div>
          {children}
        </div>
        {footer ? <div className="border-t border-border p-4 pb-6">{footer}</div> : null}
      </section>
    </div>
  );
}
