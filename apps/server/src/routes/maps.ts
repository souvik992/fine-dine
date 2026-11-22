// Maps for Settings › Serviceability and the online order map (as quickPOS ODS): the outlet server fetches the map
// pictures (OpenStreetMap tiles) and saves them on disk, so maps keep working without internet and every terminal shares
// one copy; and it runs the wider place search (Nominatim, on Enter), which wants a real User-Agent a browser page
// cannot set. Read only (nothing in the database changes). Light, on-demand use only, as the OSM policies ask.
import { mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { PosError } from '../core/errors.js';

export interface MapRouteDeps {
  /** Where tiles are kept (<data dir>/tiles); absent: nothing is saved (tests, or no data folder). */
  dir?: string;
  fetch?: typeof fetch;
  now?: () => Date;
}

const USER_AGENT = 'DinePOS/0.1 (restaurant point of sale; delivery area map)';
const TILE_HOST = 'https://tile.openstreetmap.org';
/** A saved tile older than this is fetched again when possible; without internet the old one is still shown. */
const FRESH_MS = 30 * 86_400_000;

/** z/x/y of a real tile (0 ≤ x, y < 2^z, zoom 1–19), or null. */
export function tileOf(z: string, x: string, y: string): { z: number; x: number; y: number } | null {
  const [zn, xn, yn] = [z, x.replace(/\.png$/, ''), y.replace(/\.png$/, '')].map((v) => (/^\d{1,7}$/.test(v) ? Number(v) : NaN)) as [number, number, number];
  if (!Number.isInteger(zn) || zn < 1 || zn > 19) return null;
  const n = 2 ** zn;
  if (!Number.isInteger(xn) || !Number.isInteger(yn) || xn >= n || yn >= n) return null;
  return { z: zn, x: xn, y: yn };
}

/** Places from a Nominatim answer, in India only (name, lat, lng; 6 decimals). */
export function parseNominatim(body: unknown): Array<{ name: string; lat: number; lng: number }> {
  if (!Array.isArray(body)) return [];
  const out: Array<{ name: string; lat: number; lng: number }> = [];
  for (const r of body as Array<Record<string, unknown>>) {
    const lat = Number(r?.lat);
    const lng = Number(r?.lon);
    const name = typeof r?.display_name === 'string' ? r.display_name.replace(/, India$/, '').slice(0, 200) : '';
    if (!name || !Number.isFinite(lat) || !Number.isFinite(lng) || lat < 6 || lat > 38 || lng < 68 || lng > 98) continue;
    if (out.some((p) => p.name === name)) continue;
    out.push({ name, lat: Math.round(lat * 1e6) / 1e6, lng: Math.round(lng * 1e6) / 1e6 });
  }
  return out;
}

export function mapRoutes(app: FastifyInstance, deps: MapRouteDeps): void {
  const get = deps.fetch ?? fetch;
  const now = deps.now ?? (() => new Date());

  app.get<{ Params: { z: string; x: string; y: string } }>('/v1/maps/tiles/:z/:x/:y', async (req, reply) => {
    const t = tileOf(req.params.z, req.params.x, req.params.y);
    if (!t) throw new PosError('VALIDATION', 'Not a map tile.');
    const file = deps.dir ? path.join(deps.dir, 'osm', String(t.z), String(t.x), `${t.y}.png`) : null;
    let saved: Buffer | null = null;
    let fresh = false;
    if (file) {
      try {
        fresh = now().getTime() - statSync(file).mtimeMs < FRESH_MS;
        saved = readFileSync(file);
      } catch {
        // not saved yet
      }
    }
    if (!saved || !fresh) {
      try {
        const r = await get(`${TILE_HOST}/${t.z}/${t.x}/${t.y}.png`, { headers: { 'user-agent': USER_AGENT, accept: 'image/png' }, signal: AbortSignal.timeout(8_000) });
        if (!r.ok) throw new Error(String(r.status));
        const bytes = Buffer.from(await r.arrayBuffer());
        if (bytes.length > 0 && bytes.length < 512 * 1024) {
          saved = bytes;
          if (file) {
            mkdirSync(path.dirname(file), { recursive: true });
            writeFileSync(file, bytes);
          }
        }
      } catch {
        // offline or refused: an older copy still serves
      }
    }
    if (!saved) throw new PosError('INVALID_STATE', 'This part of the map is not saved yet. It shows once this PC is on the internet.', { reason: 'map_offline' });
    void reply.header('content-type', 'image/png').header('cache-control', 'private, max-age=86400');
    return reply.send(saved);
  });

  // the wider search (Enter, when typing found nothing): Nominatim, near the store when it is known
  app.get<{ Querystring: { q?: string; near?: string } }>('/v1/maps/places', async (req) => {
    const q = (req.query.q ?? '').trim().slice(0, 120);
    if (q.length < 3) return { places: [] };
    const near = /^(-?\d{1,2}(\.\d+)?),(-?\d{1,3}(\.\d+)?)$/.exec(req.query.near ?? '');
    const box = near ? `&viewbox=${Number(near[3]) - 0.5},${Number(near[1]) + 0.5},${Number(near[3]) + 0.5},${Number(near[1]) - 0.5}` : '';
    try {
      const r = await get(`https://nominatim.openstreetmap.org/search?format=jsonv2&countrycodes=in&limit=8${box}&q=${encodeURIComponent(q)}`, {
        headers: { 'user-agent': USER_AGENT, accept: 'application/json' },
        signal: AbortSignal.timeout(8_000),
      });
      if (!r.ok) throw new Error(String(r.status));
      return { places: parseNominatim(await r.json()) };
    } catch {
      throw new PosError('INVALID_STATE', 'Could not search (no internet?). Drag and zoom the map, or paste the coordinates.', { reason: 'map_offline' });
    }
  });
}
