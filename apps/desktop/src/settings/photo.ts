// Dish photos are prepared in the browser (from TiffinPOS): shrunk to at most 1024 px and re-encoded as WebP, so a
// 3-5 MB phone photo becomes about 20-80 KB and the server needs no image library. Re-encoding also drops camera
// metadata such as the GPS location.
import { MENU_PHOTO_MAX_BYTES } from '@dinepos/shared';

export const PHOTO_MAX_SIDE = 1024;
const QUALITY = 0.88;
const MAX_INPUT_BYTES = 15_000_000;
const ACCEPTED = ['image/jpeg', 'image/png', 'image/webp'];

export interface PreparedPhoto {
  dataBase64: string;
  bytes: number;
  originalBytes: number;
}

/** Largest size that fits inside max x max, keeping the aspect ratio and never enlarging. */
export function fitWithin(w: number, h: number, max = PHOTO_MAX_SIDE): { w: number; h: number } {
  const scale = Math.min(1, max / Math.max(w, h));
  return { w: Math.max(1, Math.round(w * scale)), h: Math.max(1, Math.round(h * scale)) };
}

/** "47 KB", "3.2 MB". */
export function sizeText(bytes: number): string {
  return bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

export async function preparePhoto(file: File): Promise<PreparedPhoto> {
  if (!ACCEPTED.includes(file.type)) throw new Error('Use a JPG, PNG or WebP photo. (iPhone HEIC photos: export as JPG first.)');
  if (file.size > MAX_INPUT_BYTES) throw new Error('That file is too large. Use a photo under 15 MB.');
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    throw new Error('That photo could not be opened. Try another one.');
  }
  const { w, h } = fitWithin(bitmap.width, bitmap.height);
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const g = canvas.getContext('2d');
  if (!g) throw new Error('This computer cannot prepare photos.');
  g.fillStyle = '#ffffff'; // a transparent PNG gets a white background
  g.fillRect(0, 0, w, h);
  g.imageSmoothingEnabled = true;
  g.imageSmoothingQuality = 'high';
  g.drawImage(bitmap, 0, 0, w, h);
  bitmap.close();
  const blob = (await toBlob(canvas, 'image/webp')) ?? (await toBlob(canvas, 'image/jpeg'));
  if (!blob) throw new Error('This computer cannot prepare photos.');
  if (blob.size > MENU_PHOTO_MAX_BYTES) throw new Error('This photo is still too large after shrinking. Try a simpler or smaller one.');
  return { dataBase64: toBase64(new Uint8Array(await blob.arrayBuffer())), bytes: blob.size, originalBytes: file.size };
}

function toBlob(c: HTMLCanvasElement, type: string): Promise<Blob | null> {
  return new Promise((resolve) => c.toBlob((b) => resolve(b && b.type === type ? b : null), type, QUALITY));
}

function toBase64(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}
