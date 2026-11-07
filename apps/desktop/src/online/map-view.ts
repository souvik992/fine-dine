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
  const cx = (Math.max(...px.map((p) => p.x)) + Math.min(...px.map((p) => p.x))) / 2;
  const cy = (Math.max(...px.map((p) => p.y)) + Math.min(...px.map((p) => p.y))) / 2;
  const ox = cx - width / 2;
  const oy = cy - height / 2;
  const n = 2 ** zoom;
  const tiles: MapTile[] = [];
  for (let ty = Math.floor(oy / TILE); ty * TILE < oy + height; ty++) {
    if (ty < 0 || ty >= n) continue;
    for (let tx = Math.floor(ox / TILE); tx * TILE < ox + width; tx++) {
      const wx = ((tx % n) + n) % n;
      tiles.push({ key: `${zoom}/${tx}/${ty}`, src: `${TILE_HOST}/${zoom}/${wx}/${ty}.png`, left: Math.round(tx * TILE - ox), top: Math.round(ty * TILE - oy) });
    }
  }
  return { zoom, tiles, pins: px.map((p) => ({ x: Math.round(p.x - ox), y: Math.round(p.y - oy) })) };
}

const ll = (p: LatLng) => `${p.lat},${p.lng}`;

/** Directions for the rider (opens in the PC's browser or on a phone): from the store when known. */
export function directionsUrl(to: LatLng, from: LatLng | null): string {
  return `https://www.google.com/maps/dir/?api=1${from ? `&origin=${ll(from)}` : ''}&destination=${ll(to)}&travelmode=driving`;
}

export function openStreetMapUrl(p: LatLng): string {
  return `https://www.openstreetmap.org/?mlat=${p.lat}&mlon=${p.lng}#map=17/${p.lat}/${p.lng}`;
}
