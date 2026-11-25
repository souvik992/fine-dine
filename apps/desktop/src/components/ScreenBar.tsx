import { ArrowLeft } from 'lucide-react';
import type { ReactNode } from 'react';
import { UserBadge } from './UserBadge.js';

/**
 * The top of a screen opened from the floor (Reports, Stock, Bookings, Online orders): the brand-coloured bar with
 * the way back and the title (as Floor and Settings), and the screen's own tabs or filters on a light row below.
 * On a phone the back button is just the arrow (its name stays for screen readers) and the staff badge is left out.
 */
export function ScreenBar({ title, onBack, backLabel = 'Floor', right, badge = true, children }: { title: string; onBack: () => void; backLabel?: string; right?: ReactNode; badge?: boolean; children?: ReactNode }) {
  return (
    <header className="shrink-0">
      <div className="appbar short:min-h-12 sm:px-4">
        <button className="btn h-10 w-10 px-0 sm:w-auto sm:px-4" onClick={onBack} aria-label={backLabel}>
          <ArrowLeft className="h-4 w-4" />
          <span className="max-sm:hidden">{backLabel}</span>
        </button>
        <h1 className="min-w-0 truncate font-display text-xl font-semibold sm:ml-1">{title}</h1>
        <div className="ml-auto flex shrink-0 items-center gap-2">
          {right}
          {badge ? (
            <div className="hidden sm:block [&_.text-muted-foreground]:text-primary-foreground/80">
              <UserBadge />
            </div>
          ) : null}
        </div>
      </div>
      {children ? <div className="flex flex-wrap items-center gap-2 border-b border-border bg-card px-3 py-2 sm:px-4">{children}</div> : null}
    </header>
  );
}
