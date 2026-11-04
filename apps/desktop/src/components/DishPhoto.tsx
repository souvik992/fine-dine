import { useEffect, useState } from 'react';
import { useApp } from '../app-context.js';

/**
 * Dish photos come from the outlet server with this terminal's token (an <img src> cannot send it), so each is fetched
 * once and shown from memory. Names are the photo's content hash: a name never changes its picture, so the copy is
 * kept for the whole session.
 */
const loaded = new Map<string, Promise<string>>();

export function useDishPhoto(name: string | null | undefined): string | null {
  const { api } = useApp();
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!name) {
      setUrl(null);
      return;
    }
    let live = true;
    let p = loaded.get(name);
    if (!p) {
      p = api.getBlob(`/v1/menu/images/${encodeURIComponent(name)}`).then((b) => URL.createObjectURL(b));
      p.catch(() => loaded.delete(name)); // tried again next time
      loaded.set(name, p);
    }
    p.then((u) => live && setUrl(u)).catch(() => live && setUrl(null));
    return () => {
      live = false;
    };
  }, [api, name]);
  return url;
}

/** The dish's photo, or its first letter on a soft background while there is none (or it is loading). */
export function DishPhoto({ name, label, className = '' }: { name: string | null | undefined; label: string; className?: string }) {
  const url = useDishPhoto(name);
  return url ? (
    <img src={url} alt="" className={`object-cover ${className}`} draggable={false} />
  ) : (
    <span aria-hidden className={`flex items-center justify-center bg-secondary font-display text-2xl font-semibold text-muted-foreground ${className}`}>
      {label.trim().charAt(0).toUpperCase()}
    </span>
  );
}
