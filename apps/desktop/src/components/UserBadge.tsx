import { Lock, LogOut } from 'lucide-react';
import { useApp } from '../app-context.js';

/**
 * Who is signed in, with Lock and Sign out (as in Tiffin POS). Nothing signs the terminal out or locks it by itself:
 * Lock keeps the sign-in until the same person's PIN; Sign out returns to the staff list.
 */
export function UserBadge() {
  const { session, lock, signOut } = useApp();
  if (!session) return null;
  return (
    <div className="flex items-center gap-2">
      <span className="text-right text-xs leading-tight" data-testid="signed-in-user">
        <span className="block font-semibold">{session.user.name}</span>
        <span className="text-muted-foreground">{session.user.roleName}</span>
      </span>
      <button className="btn h-10 w-10 px-0" onClick={() => void lock().catch(() => undefined)} aria-label="Lock" title="Lock the screen">
        <Lock className="h-4 w-4" />
      </button>
      <button className="btn h-10 w-10 px-0" onClick={signOut} aria-label="Sign out" title="Sign out">
        <LogOut className="h-4 w-4" />
      </button>
    </div>
  );
}
