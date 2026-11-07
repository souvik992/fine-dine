import { Minus, Plus } from 'lucide-react';
import { useEffect, useRef, useState, type PointerEvent, type WheelEvent } from 'react';
import { pointAt, project, pxPerKm, unproject, viewAt, type LatLng } from '../online/map-view.js';

const H = 360;
const INDIA: LatLng = { lat: 22.35, lng: 78.67 };

/**
 * Settings › Online orders › Delivery: the store on a map with a ring for each delivery band. Click to put the store
 * there; drag to move around; + / − or the mouse wheel to zoom. Rings are the straight-line reach of each band
 * (its km ÷ the road factor), since bands count road distance.
 */
export function StoreLocationMap({ location, bandsKm, roadFactor, onPick }: { location: LatLng | null; bandsKm: number[]; roadFactor: number; onPick: (p: LatLng) => void }) {
  const box = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(800);
  const [zoom, setZoom] = useState(location ? 13 : 5);
  const [centre, setCentre] = useState<LatLng>(location ?? INDIA);
  const [failed, setFailed] = useState(false);
  const drag = useRef<{ x: number; y: number; c: { x: number; y: number }; moved: boolean } | null>(null);

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setWidth(Math.max(200, Math.round(el.clientWidth))));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // typed coordinates: bring the store into view when it is off the map
  useEffect(() => {
    if (!location || !Number.isFinite(location.lat) || !Number.isFinite(location.lng)) return;
    const p = viewAt(centre, zoom, width, H, [location]).pins[0]!;
    if (p.x < 0 || p.y < 0 || p.x > width || p.y > H) setCentre(location);
  }, [location?.lat, location?.lng]);

  const valid = location && Number.isFinite(location.lat) && Number.isFinite(location.lng) && location.lat !== 0 ? location : null;
  const view = viewAt(centre, zoom, width, H, valid ? [valid] : []);
  const pin = view.pins[0];
  const ppk = pxPerKm(valid?.lat ?? centre.lat, zoom);
  const zoomBy = (d: number) => setZoom((z) => Math.min(18, Math.max(4, z + d)));

  const down = (e: PointerEvent<HTMLDivElement>) => {
    if ((e.target as HTMLElement).closest('button')) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { x: e.clientX, y: e.clientY, c: project(centre, zoom), moved: false };
  };
  const move = (e: PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d) return;
    const dx = e.clientX - d.x;
    const dy = e.clientY - d.y;
    if (Math.abs(dx) + Math.abs(dy) > 4) d.moved = true;
    if (d.moved) setCentre(unproject(d.c.x - dx, d.c.y - dy, zoom));
  };
  const up = (e: PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    drag.current = null;
    if (!d || d.moved) return;
    const r = e.currentTarget.getBoundingClientRect();
    onPick(pointAt(centre, zoom, width, H, e.clientX - r.left, e.clientY - r.top));
  };
  const wheel = (e: WheelEvent<HTMLDivElement>) => zoomBy(e.deltaY < 0 ? 1 : -1);

  return (
    <div className="mt-3">
      <div
        ref={box}
        className="relative w-full cursor-crosshair touch-none select-none overflow-hidden rounded-lg border border-border bg-secondary"
        style={{ height: H }}
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={up}
        onWheel={wheel}
        data-testid="store-map"
        aria-label="Store location map: click to set the store location"
      >
        {view.tiles.map((t) => (
          <img key={t.key} src={t.src} alt="" draggable={false} className="pointer-events-none absolute" style={{ left: t.left, top: t.top, width: 256, height: 256 }} onError={() => setFailed(true)} />
        ))}
        {pin ? (
          <>
            <svg className="pointer-events-none absolute inset-0" width={width} height={H} aria-hidden>
              {bandsKm.map((km, i) => {
                const r = (km / roadFactor) * ppk;
                return (
                  <g key={i}>
                    <circle cx={pin.x} cy={pin.y} r={r} fill="#1f6feb" fillOpacity={i === 0 ? 0.12 : 0.05} stroke="#1f6feb" strokeWidth={2} strokeDasharray={i === 0 ? undefined : '6 4'} />
                    <text x={pin.x} y={pin.y - r + 14} textAnchor="middle" fontSize="12" fontWeight="700" fill="#0b3d91" stroke="#fff" strokeWidth={3} paintOrder="stroke">
                      {km} km
                    </text>
                  </g>
                );
              })}
            </svg>
            <div className="pointer-events-none absolute" style={{ left: pin.x, top: pin.y, transform: 'translate(-50%, -100%)' }}>
              <svg width="26" height="34" viewBox="0 0 24 32" aria-hidden>
                <path d="M12 0C5.4 0 0 5.4 0 12c0 9 12 20 12 20s12-11 12-20C24 5.4 18.6 0 12 0z" fill="#d1242f" stroke="#fff" strokeWidth="2" />
                <circle cx="12" cy="12" r="4.5" fill="#fff" />
              </svg>
            </div>
          </>
        ) : null}
        <div className="absolute right-2 top-2 flex flex-col overflow-hidden rounded border border-border bg-card shadow">
          <button type="button" className="flex h-8 w-8 items-center justify-center hover:bg-secondary" onClick={() => zoomBy(1)} aria-label="Zoom in">
            <Plus className="h-4 w-4" />
          </button>
          <button type="button" className="flex h-8 w-8 items-center justify-center border-t border-border hover:bg-secondary" onClick={() => zoomBy(-1)} aria-label="Zoom out">
            <Minus className="h-4 w-4" />
          </button>
        </div>
        <span className="absolute bottom-0 right-0 bg-white/80 px-1 text-[10px] text-black">© OpenStreetMap contributors</span>
        {failed ? <p className="absolute inset-x-0 top-0 bg-warn px-2 py-1 text-sm font-semibold text-black">Map tiles did not load (no internet?). You can still type the latitude and longitude.</p> : null}
      </div>
      <p className="mt-1 text-xs text-muted-foreground">
        {valid ? 'Click the map to move the store. ' : 'Find the store (drag, zoom) and click it to set the location. '}
        Rings show roughly how far each band reaches in a straight line (km ÷ road factor {roadFactor}).
      </p>
    </div>
  );
}
