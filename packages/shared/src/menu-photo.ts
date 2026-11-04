// Menu photos: one per dish, sent resized from the browser (WebP, at most 1024 px), stored on the outlet server by the
// SHA-256 of their bytes ("<sha256>.webp"), so the same photo is stored once and a name never changes its content.
import { z } from 'zod';
import { ulidSchema } from './schemas/envelope.js';

/** Largest photo accepted (after the browser resized it; a typical one is 20-80 KB). */
export const MENU_PHOTO_MAX_BYTES = 600_000;
export const MENU_PHOTO_NAME = /^[0-9a-f]{64}\.(jpg|png|webp)$/;

export const setItemImageSchema = z
  .object({
    itemId: ulidSchema,
    /** The photo's bytes, base64. */
    dataBase64: z.string().min(16).max(Math.ceil(MENU_PHOTO_MAX_BYTES / 3) * 4 + 4).regex(/^[A-Za-z0-9+/]+={0,2}$/),
  })
  .strict();
export const removeItemImageSchema = z.object({ itemId: ulidSchema }).strict();
export type SetItemImagePayload = z.infer<typeof setItemImageSchema>;

/** "Paneer_Tikka (1).JPG" -> "paneer tikka". */
export function photoKey(fileName: string): string {
  return fileName
    .replace(/\.[a-z0-9]{2,5}$/i, '')
    .toLowerCase()
    .replace(/\s*\(\d+\)\s*$/, '')
    .replace(/\s+copy$/, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

export interface PhotoMatch {
  file: string;
  itemId: string | null;
  /** How it matched, or why not: 'duplicate' = an earlier photo in this batch already took that dish. */
  how: 'name' | 'code' | 'none' | 'duplicate' | 'ambiguous';
  duplicateOf?: string;
}

/**
 * Bulk photos (from TiffinPOS): which dish each photo file is for, by its file name ("Paneer Tikka.jpg", or the short
 * code "PT.jpg"), ignoring case, spaces and punctuation. Anything unclear is left for the person to choose.
 */
export function matchPhotos(files: readonly string[], items: ReadonlyArray<{ id: string; name: string; shortCode?: string | null }>): PhotoMatch[] {
  const squash = (s: string) => s.replace(/ /g, '');
  const byName = new Map<string, string[]>();
  const add = (k: string, id: string) => {
    if (!k) return;
    const l = byName.get(k) ?? [];
    if (!l.includes(id)) l.push(id);
    byName.set(k, l);
  };
  for (const i of items) {
    const k = photoKey(i.name);
    add(k, i.id);
    add(squash(k), i.id);
  }
  const byCode = new Map(items.filter((i) => i.shortCode).map((i) => [photoKey(i.shortCode!), i.id]));
  const taken = new Map<string, string>();
  return files.map((file) => {
    const k = photoKey(file);
    const named = byName.get(k) ?? byName.get(squash(k));
    let itemId: string | null = null;
    let how: PhotoMatch['how'] = 'none';
    if (named && named.length > 1) how = 'ambiguous';
    else if (named?.length === 1) {
      itemId = named[0]!;
      how = 'name';
    } else if (byCode.has(k)) {
      itemId = byCode.get(k)!;
      how = 'code';
    }
    if (itemId && taken.has(itemId)) return { file, itemId: null, how: 'duplicate', duplicateOf: taken.get(itemId)! };
    if (itemId) taken.set(itemId, file);
    return { file, itemId, how };
  });
}
