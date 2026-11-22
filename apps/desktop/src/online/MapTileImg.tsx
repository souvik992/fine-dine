import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { useApp } from '../app-context.js';

/**
 * One 256 px map picture from the outlet server (it fetches OpenStreetMap tiles and keeps them, so maps work offline).
 * An <img src> cannot send this terminal's token, so each tile is fetched once and shown from memory; the last few
 * hundred are kept, older ones let go.
 */
const loaded = new Map<string, Promise<string>>();
const KEEP = 400;

function tileUrl(get: (path: string) => Promise<Blob>, path: string): Promise<string> {
  let p = loaded.get(path);
  if (p) {
    loaded.delete(path); // most recently used last
    loaded.set(path, p);
    return p;
  }
  p = get(path).then((b) => URL.createObjectURL(b));
  p.catch(() => loaded.delete(path)); // tried again next time
  loaded.set(path, p);
  while (loaded.size > KEEP) {
    const [oldest, url] = loaded.entries().next().value as [string, Promise<string>];
    loaded.delete(oldest);
    void url.then((u) => URL.revokeObjectURL(u)).catch(() => undefined);
  }
  return p;
}

export function MapTileImg({ path, className, style, onError }: { path: string; className?: string; style?: CSSProperties; onError?: () => void }) {
  const { api } = useApp();
  const [src, setSrc] = useState<string | null>(null);
  const failed = useRef(onError);
  failed.current = onError;
  useEffect(() => {
    let live = true;
    tileUrl((p) => api.getBlob(p), path)
      .then((u) => live && setSrc(u))
      .catch(() => live && failed.current?.());
    return () => {
      live = false;
    };
  }, [api, path]);
  return src ? <img src={src} alt="" draggable={false} className={className} style={{ width: 256, height: 256, ...style }} /> : null;
}
