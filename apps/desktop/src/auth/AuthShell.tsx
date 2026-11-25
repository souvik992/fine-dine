import { Calculator, ChefHat, ConciergeBell, Settings, UserRound, UsersRound } from 'lucide-react';
import type { ComponentType, ReactNode } from 'react';
import { BrandLogo } from '../components/Brand.js';

/**
 * The screens before sign-in (setup, staff list, PIN, lock): the DinePOS logo top left, terminal settings top right,
 * the rest centred. Scrolls on a phone held sideways instead of cutting anything off.
 */
export function AuthShell({ onSettings, children }: { onSettings?: () => void; children: ReactNode }) {
  return (
    <div className="flex h-full flex-col overflow-y-auto bg-background">
      <header className="flex shrink-0 items-center justify-between px-4 pt-4 short:pt-2 sm:px-6">
        <BrandLogo size={34} />
        {onSettings ? (
          <button className="btn h-11 w-11 rounded-xl px-0" onClick={onSettings} aria-label="Terminal settings" title="Terminal settings">
            <Settings className="h-5 w-5" />
          </button>
        ) : null}
      </header>
      <main className="flex flex-1 flex-col items-center justify-center px-4 py-6 short:py-3 sm:px-6">{children}</main>
    </div>
  );
}

/** The outlet (or other) badge above a sign-in heading. */
export function AuthBadge({ children }: { children: ReactNode }) {
  return <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-accent text-primary short:mb-2 short:h-12 short:w-12">{children}</div>;
}

/** An icon for a role by its name (roles are the outlet's own; unknown ones get a person). */
export function roleIcon(roleName: string): ComponentType<{ className?: string }> {
  const r = roleName.toLowerCase();
  if (r.includes('cashier') || r.includes('biller')) return Calculator;
  if (r.includes('captain') || r.includes('waiter') || r.includes('steward')) return ConciergeBell;
  if (r.includes('manager')) return UsersRound;
  if (r.includes('chef') || r.includes('kitchen')) return ChefHat;
  return UserRound;
}

/** Heading on the left and the PIN pad on the right on a phone held sideways; one above the other elsewhere. */
export function PinLayout({ heading, children }: { heading: ReactNode; children: ReactNode }) {
  return (
    <div className="flex w-full max-w-md flex-col items-center short:max-w-2xl short:flex-row short:items-center short:justify-center short:gap-10">
      <div className="mb-6 text-center short:mb-0 short:max-w-60">{heading}</div>
      <div className="w-full max-w-[19rem]">{children}</div>
    </div>
  );
}
