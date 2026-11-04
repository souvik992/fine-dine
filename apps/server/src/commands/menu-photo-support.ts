// Menu photos (see packages/shared/src/menu-photo.ts): checking the bytes, storing them once, dropping unused ones.
import { createHash } from 'node:crypto';
import { MENU_PHOTO_MAX_BYTES } from '@dinepos/shared';
import { PosError } from '../core/errors.js';
import type { Db } from '../db/connection.js';

const TYPES = { jpg: 'image/jpeg', png: 'image/png', webp: 'image/webp' } as const;

/** The format from the first bytes, ignoring any name or declared type (SVG and anything else are refused). */
export function sniffPhoto(b: Uint8Array): keyof typeof TYPES | null {
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'jpg';
  if (b.length >= 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 && b[4] === 0x0d && b[5] === 0x0a && b[6] === 0x1a && b[7] === 0x0a) return 'png';
  if (b.length >= 12 && Buffer.from(b.subarray(0, 4)).toString('latin1') === 'RIFF' && Buffer.from(b.subarray(8, 12)).toString('latin1') === 'WEBP') return 'webp';
  return null;
}

/** Stores the photo (once) and returns its name. */
export function storePhoto(db: Db, dataBase64: string, nowIso: string): string {
  const bytes = Buffer.from(dataBase64, 'base64');
  if (bytes.length > MENU_PHOTO_MAX_BYTES) throw new PosError('VALIDATION', 'That photo is too large. Use one under 600 KB.', { field: 'photo' });
  const kind = sniffPhoto(bytes);
  if (!kind) throw new PosError('VALIDATION', 'Use a JPG, PNG or WebP photo.', { field: 'photo' });
  const name = `${createHash('sha256').update(bytes).digest('hex')}.${kind}`;
  db.prepare('INSERT OR IGNORE INTO menu_image (name, content_type, bytes, created_at) VALUES (?, ?, ?, ?)').run(name, TYPES[kind], bytes, nowIso);
  return name;
}

/** A photo no dish shows any more is removed (the audit keeps which dish had which photo name). */
export function dropUnusedPhoto(db: Db, name: string | null): void {
  if (name) db.prepare('DELETE FROM menu_image WHERE name = ? AND NOT EXISTS (SELECT 1 FROM menu_item_image WHERE image_name = ?)').run(name, name);
}

export function photoOf(db: Db, itemId: string): string | null {
  return (db.prepare('SELECT image_name FROM menu_item_image WHERE item_id = ?').pluck().get(itemId) as string | undefined) ?? null;
}

export function requireItem(db: Db, itemId: string): string {
  const name = db.prepare('SELECT name FROM menu_item WHERE id = ?').pluck().get(itemId) as string | undefined;
  if (name === undefined) throw new PosError('NOT_FOUND', 'That dish does not exist.', { itemId });
  return name;
}
