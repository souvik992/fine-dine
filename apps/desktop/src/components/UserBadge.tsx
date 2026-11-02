import { Lock } from 'lucide-react';
import { useEffect } from 'react';
import { useApp } from '../app-context.js';

/** Who is signed in, with a Lock button (Ctrl+L) that returns the terminal to the sign-in screen. */
export function UserBadge() {
  const { session, signOut } = useApp();
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.key.toLowerCase() === 'l') {
        e.preventDefault();
        signOut();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [signOut]);
  if (!session) return null;
  return (
    <div className="flex items-center gap-2">
      <span className="text-right text-xs leading-tight" data-testid="signed-in-user">
        <span className="block font-semibold">{session.user.name}</span>
        <span className="text-muted-foreground">{session.user.roleName}</span>
      </span>
      <button className="btn h-10 w-10 px-0" onClick={signOut} aria-label="Lock" title="Lock (Ctrl+L)">
        <Lock className="h-4 w-4" />
      </button>
    </div>
  );
}
