import { ChevronDown, Lock, LogOut } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useApp } from '../app-context.js';

/**
 * Phones: the outlet's name on the top bar opens who is signed in, with Lock and Sign out (on wider screens the
 * staff badge shows them all the time).
 */
export function AccountMenu({ outletName }: { outletName: string }) {
  const { session, lock, signOut } = useApp();
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => {
      if (!box.current?.contains(e.target as Node)) setOpen(false);
    };
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    window.addEventListener('pointerdown', away);
    window.addEventListener('keydown', esc);
    return () => {
      window.removeEventListener('pointerdown', away);
      window.removeEventListener('keydown', esc);
    };
  }, [open]);
  if (!session) return null;

  return (
    <div ref={box} className="relative min-w-0">
      <button className="flex h-10 min-w-0 max-w-full items-center gap-1 rounded-lg px-1.5 text-sm font-semibold hover:bg-white/10" onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-haspopup="menu" title="Who is signed in">
        <span className="truncate">{outletName}</span>
        <ChevronDown className="h-4 w-4 shrink-0" aria-hidden />
      </button>
      {open ? (
        <div role="menu" className="absolute left-0 top-11 z-40 w-60 rounded-xl border border-border bg-card p-2 text-foreground shadow-xl">
          <div className="px-2 pb-2 pt-1" data-testid="signed-in-user">
            <div className="font-semibold">{session.user.name}</div>
            <div className="text-xs text-muted-foreground">{session.user.roleName}</div>
          </div>
          <button role="menuitem" className="flex w-full items-center gap-2 rounded-lg px-2 py-2.5 text-sm font-semibold hover:bg-secondary" onClick={() => void lock().catch(() => undefined)}>
            <Lock className="h-4 w-4" /> Lock the screen
          </button>
          <button role="menuitem" className="flex w-full items-center gap-2 rounded-lg px-2 py-2.5 text-sm font-semibold hover:bg-secondary" onClick={signOut}>
            <LogOut className="h-4 w-4" /> Sign out
          </button>
        </div>
      ) : null}
    </div>
  );
}
