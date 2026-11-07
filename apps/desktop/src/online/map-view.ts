// Pure helpers for the delivery map on the Online orders screen (tested). Web Mercator, 256 px OpenStreetMap tiles.

export interface LatLng {
  lat: number;
  lng: number;
}

export const TILE = 256;
export const TILE_HOST = 'https://tile.openstreetmap.org';
const MIN_ZOOM = 11;
const MAX_ZOOM = 17;

/** World pixel position of a point at a zoom level. */
export function project(p: LatLng, zoom: number): { x: number; y: number } {
  const size = TILE * 2 ** zoom;
  const s = Math.sin((Math.max(-85, Math.min(85, p.lat)) * Math.PI) / 180);
  return { x: ((p.lng + 180) / 360) * size, y: (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * size };
}

/** The point at a world pixel position (inverse of `project`). */
export function unproject(x: number, y: number, zoom: number): LatLng {
  const size = TILE * 2 ** zoom;
  const lng = (x / size) * 360 - 180;
  const lat = (Math.atan(Math.sinh(Math.PI * (1 - (2 * y) / size))) * 180) / Math.PI;
  return { lat: Math.round(lat * 1e6) / 1e6, lng: Math.round(lng * 1e6) / 1e6 };
}

/** Pixels per kilometre on the ground at a latitude and zoom (for band rings). */
export function pxPerKm(lat: number, zoom: number): number {
  return (TILE * 2 ** zoom) / (40_075.016686 * Math.cos((lat * Math.PI) / 180));
}

export interface MapTile {
  key: string;
  src: string;
  left: number;
  top: number;
}

export interface MapView {
  zoom: number;
  tiles: MapTile[];
  /** Each point's position in the box, in px from the top-left corner. */
  pins: Array<{ x: number; y: number }>;
}

/**
 * The tiles and pin positions for a `width` × `height` box that shows every point (the customer, and the store when
 * its location is set): the closest zoom that fits them with a margin, centred between them.
 */
export function mapView(points: readonly LatLng[], width: number, height: number, margin = 48): MapView {
  if (!points.length) throw new Error('mapView needs a point');
  let zoom = MAX_ZOOM;
  for (; zoom > MIN_ZOOM; zoom--) {
    const px = points.map((p) => project(p, zoom));
    const w = Math.max(...px.map((p) => p.x)) - Math.min(...px.map((p) => p.x));
    const h = Math.max(...px.map((p) => p.y)) - Math.min(...px.map((p) => p.y));
    if (w <= width - 2 * margin && h <= height - 2 * margin) break;
  }
  const px = points.map((p) => project(p, zoom));
  const centre = unproject((Math.max(...px.map((p) => p.x)) + Math.min(...px.map((p) => p.x))) / 2, (Math.max(...px.map((p) => p.y)) + Math.min(...px.map((p) => p.y))) / 2, zoom);
  return viewAt(centre, zoom, width, height, points);
}

/** The tiles for a box centred on `centre` at `zoom`, and where `points` fall in it. */
export function viewAt(centre: LatLng, zoom: number, width: number, height: number, points: readonly LatLng[] = []): MapView {
  const c = project(centre, zoom);
  const ox = c.x - width / 2;
  const oy = c.y - height / 2;
  const n = 2 ** zoom;
  const tiles: MapTile[] = [];
  for (let ty = Math.floor(oy / TILE); ty * TILE < oy + height; ty++) {
    if (ty < 0 || ty >= n) continue;
    for (let tx = Math.floor(ox / TILE); tx * TILE < ox + width; tx++) {
      const wx = ((tx % n) + n) % n;
      tiles.push({ key: `${zoom}/${tx}/${ty}`, src: `${TILE_HOST}/${zoom}/${wx}/${ty}.png`, left: Math.round(tx * TILE - ox), top: Math.round(ty * TILE - oy) });
    }
  }
  return { zoom, tiles, pins: points.map((p) => project(p, zoom)).map((p) => ({ x: Math.round(p.x - ox), y: Math.round(p.y - oy) })) };
}

/** The point under a pixel of a box centred on `centre` at `zoom` (a click on the map). */
export function pointAt(centre: LatLng, zoom: number, width: number, height: number, x: number, y: number): LatLng {
  const c = project(centre, zoom);
  return unproject(c.x - width / 2 + x, c.y - height / 2 + y, zoom);
}

const ll = (p: LatLng) => `${p.lat},${p.lng}`;

/** Directions for the rider (opens in the PC's browser or on a phone): from the store when known. */
export function directionsUrl(to: LatLng, from: LatLng | null): string {
  return `https://www.google.com/maps/dir/?api=1${from ? `&origin=${ll(from)}` : ''}&destination=${ll(to)}&travelmode=driving`;
}

export function openStreetMapUrl(p: LatLng): string {
  return `https://www.openstreetmap.org/?mlat=${p.lat}&mlon=${p.lng}#map=17/${p.lat}/${p.lng}`;
}

// ---------------------------------------------------------------- place search (Photon, OpenStreetMap data)

export interface Place extends LatLng {
  name: string;
}

/** Search-as-you-type for an area or address in India (Photon allows typing searches; Nominatim's free server does not). */
export function placeSearchUrl(query: string): string {
  return `https://photon.komoot.io/api/?q=${encodeURIComponent(query.trim())}&limit=6&lang=en&bbox=68,6,98,38`;
}

/** The matches from a Photon answer (GeoJSON), in India only, skipping anything malformed or repeated. */
export function parsePlaces(body: unknown): Place[] {
  const features = (body as { features?: unknown } | null)?.features;
  if (!Array.isArray(features)) return [];
  const out: Place[] = [];
  for (const f of features as Array<{ properties?: Record<string, unknown>; geometry?: { coordinates?: unknown } } | null>) {
    const pr = f?.properties ?? {};
    const c = f?.geometry?.coordinates;
    if (!Array.isArray(c) || pr.countrycode !== 'IN') continue;
    const lng = Number(c[0]);
    const lat = Number(c[1]);
    const parts = [pr.name, pr.street, pr.district, pr.city, pr.county, pr.state].filter((x): x is string => typeof x === 'string' && x.length > 0);
    const name = [...new Set(parts)].join(', ');
    if (!name || !Number.isFinite(lat) || !Number.isFinite(lng) || out.some((p) => p.name === name)) continue;
    out.push({ name, lat: Math.round(lat * 1e6) / 1e6, lng: Math.round(lng * 1e6) / 1e6 });
  }
  return out;
}
