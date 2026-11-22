import { Minus, Plus, Search } from 'lucide-react';
import { useEffect, useRef, useState, type PointerEvent, type WheelEvent } from 'react';
import { parsePlaces, pastedPoint, placeReverseUrl, placeSearchUrl, pointAt, project, pxPerKm, unproject, viewAt, type LatLng, type Place } from '../online/map-view.js';
import { ApiError } from '../api/client.js';
import { useApp } from '../app-context.js';
import { MapTileImg } from '../online/MapTileImg.js';

const H = 360;
const INDIA: LatLng = { lat: 22.35, lng: 78.67 };

/**
 * Settings › Online orders › Delivery: the store on a map with a ring for each delivery band. Click to put the store
 * there; drag to move around; + / − or the mouse wheel to zoom. Rings are the straight-line reach of each band
 * (its km ÷ the road factor), since bands count road distance. Type an area name to search as you type and jump there.
 * `onPick` gets the point and its address: the chosen place's name, or for a click on the map the address found for
 * that point (first '' while it is looked up, then the address; '' when none is found).
 */
export function StoreLocationMap({ location, bandsKm, roadFactor, onPick }: { location: LatLng | null; bandsKm: number[]; roadFactor: number; onPick: (p: LatLng, address: string) => void }) {
  const { api } = useApp();
  const box = useRef<HTMLDivElement>(null);
  // the latest onPick: an address found after a click must not undo edits made while it was looked up
  const pickRef = useRef(onPick);
  pickRef.current = onPick;
  const lookup = useRef<AbortController | null>(null);
  const pickPoint = (p: LatLng) => {
    lookup.current?.abort();
    const ctl = new AbortController();
    lookup.current = ctl;
    pickRef.current(p, '');
    void (async () => {
      try {
        const res = await fetch(placeReverseUrl(p), { headers: { accept: 'application/json' }, signal: ctl.signal });
        if (!res.ok) return;
        const name = parsePlaces(await res.json())[0]?.name;
        if (name && !ctl.signal.aborted) pickRef.current(p, name.slice(0, 200));
      } catch {
        // offline or no answer: the point is set, the address stays empty (search the area name to fill it)
      }
    })();
  };
  const [width, setWidth] = useState(800);
  const [zoom, setZoom] = useState(location ? 13 : 5);
  const [centre, setCentre] = useState<LatLng>(location ?? INDIA);
  const [failed, setFailed] = useState(false);
  const [query, setQuery] = useState('');
  const [places, setPlaces] = useState<Place[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const drag = useRef<{ x: number; y: number; c: { x: number; y: number }; moved: boolean; pin: boolean } | null>(null);
  /** Where the pin is while it is being dragged (map pixels). */
  const [dragPin, setDragPin] = useState<{ x: number; y: number } | null>(null);
  const point = pastedPoint(query);

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
  const pin = dragPin ?? view.pins[0];
  const ppk = pxPerKm(valid?.lat ?? centre.lat, zoom);
  const zoomBy = (d: number) => setZoom((z) => Math.min(18, Math.max(4, z + d)));

  const down = (e: PointerEvent<HTMLDivElement>) => {
    if ((e.target as HTMLElement).closest('button')) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    // on the pin (its head is above the point): drag the pin to the exact door; elsewhere: move the map
    const r = e.currentTarget.getBoundingClientRect();
    const at = { x: e.clientX - r.left, y: e.clientY - r.top };
    const onPin = !!pin && Math.abs(at.x - pin.x) <= 16 && at.y <= pin.y + 4 && at.y >= pin.y - 38;
    drag.current = { x: e.clientX, y: e.clientY, c: project(centre, zoom), moved: false, pin: onPin };
  };
  const move = (e: PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d) return;
    const dx = e.clientX - d.x;
    const dy = e.clientY - d.y;
    if (Math.abs(dx) + Math.abs(dy) > 4) d.moved = true;
    if (!d.moved) return;
    if (d.pin) {
      const r = e.currentTarget.getBoundingClientRect();
      setDragPin({ x: e.clientX - r.left, y: e.clientY - r.top });
    } else setCentre(unproject(d.c.x - dx, d.c.y - dy, zoom));
  };
  const up = (e: PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    drag.current = null;
    setDragPin(null);
    if (!d || (d.moved && !d.pin)) return;
    const r = e.currentTarget.getBoundingClientRect();
    pickPoint(pointAt(centre, zoom, width, H, e.clientX - r.left, e.clientY - r.top)); // a click, or where the pin was dropped
  };
  // search as you type: 400 ms after the last key, the newest search wins
  const skip = useRef(false);
  useEffect(() => {
    if (skip.current) {
      skip.current = false;
      return;
    }
    const q = query.trim();
    setSearchError(null);
    if (q.length < 3 || pastedPoint(q)) {
      setPlaces(null);
      setSearching(false);
      return;
    }
    const ctl = new AbortController();
    setSearching(true);
    const t = setTimeout(() => {
      void (async () => {
        try {
          const res = await fetch(placeSearchUrl(q), { headers: { accept: 'application/json' }, signal: ctl.signal });
          if (!res.ok) throw new Error(String(res.status));
          const found = parsePlaces(await res.json());
          setPlaces(found);
          if (!found.length) setSearchError('No place found with that name yet. Keep typing, or add the city, like "Marathahalli, Bengaluru".');
        } catch {
          if (ctl.signal.aborted) return;
          setPlaces(null);
          setSearchError('Could not search (no internet?). Drag and zoom the map, or type the latitude and longitude.');
        } finally {
          if (!ctl.signal.aborted) setSearching(false);
        }
      })();
    }, 400);
    return () => {
      clearTimeout(t);
      ctl.abort();
    };
  }, [query]);
  const usePoint = (p: LatLng) => {
    setCentre(p);
    setZoom(17);
    setPlaces(null);
    pickPoint(p); // its address is looked up
  };
  // Enter when typing found nothing: the wider search (the outlet server asks Nominatim, near the store)
  const wider = async () => {
    const q = query.trim();
    if (q.length < 3) return;
    setSearching(true);
    setSearchError(null);
    try {
      const near = valid ? `&near=${valid.lat},${valid.lng}` : '';
      const r = await api.get<{ places: Place[] }>(`/v1/maps/places?q=${encodeURIComponent(q)}${near}`);
      setPlaces(r.places);
      if (!r.places.length) setSearchError('No match. Try the area or road name, or paste the coordinates from a map (right-click your shop in any online map and copy the numbers).');
    } catch (e) {
      setSearchError(e instanceof ApiError ? e.message : 'Could not search.');
    } finally {
      setSearching(false);
    }
  };
  const choose = (p: Place) => {
    skip.current = true; // showing the chosen name in the box is not a new search
    setQuery(p.name);
    setCentre(p);
    setZoom(16);
    setPlaces(null);
    lookup.current?.abort(); // a click's address still on its way is not wanted any more
    onPick({ lat: p.lat, lng: p.lng }, p.name.slice(0, 200));
  };

  const wheel = (e: WheelEvent<HTMLDivElement>) => zoomBy(e.deltaY < 0 ? 1 : -1);

  return (
    <div className="mt-3">
      <div className="relative mb-2">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <input
          className="input w-full pl-9"
          maxLength={120}
          placeholder="Shop name, area or road (like Marathahalli, Bengaluru), or paste map coordinates"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault(); // Enter takes the pasted point, else the first match, else searches wider
              if (point) usePoint(point);
              else if (places?.[0]) choose(places[0]);
              else void wider();
            } else if (e.key === 'Escape' && places?.length) {
              e.stopPropagation();
              setPlaces(null);
            }
          }}
          aria-label="Search area name"
          autoComplete="off"
        />
        {searching ? <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">Searching…</span> : null}
      </div>
      {point ? (
        <button type="button" className="mb-2 w-full rounded-lg border border-border bg-card px-3 py-2 text-left text-sm hover:bg-secondary" onClick={() => usePoint(point)}>
          <b>Use this point</b> <span className="text-muted-foreground">{point.lat}, {point.lng}</span>
        </button>
      ) : null}
      {searchError ? <p className="mb-2 text-sm text-danger">{searchError}</p> : null}
      {places?.length ? (
        <ul className="mb-2 overflow-hidden rounded-lg border border-border bg-card text-sm" aria-label="Places found">
          {places.map((p, i) => (
            <li key={i} className={i ? 'border-t border-border' : ''}>
              <button type="button" className="w-full px-3 py-2 text-left hover:bg-secondary" onClick={() => choose(p)}>
                {p.name}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
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
          <MapTileImg key={t.key} path={t.src} className="pointer-events-none absolute" style={{ left: t.left, top: t.top }} onError={() => setFailed(true)} />
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
        {failed ? <p className="absolute inset-x-0 top-0 bg-warn px-2 py-1 text-sm font-semibold text-black">Part of the map is not saved yet (no internet?). You can still paste or type the latitude and longitude.</p> : null}
      </div>
      <p className="mt-1 text-xs text-muted-foreground">
        {valid ? 'Drag the pin to the exact door, or click the map (a searched area puts it at the area’s centre). ' : 'Search the area or drag and zoom, then click the store to set the location. '}
        Rings show roughly how far each band reaches in a straight line (km ÷ road factor {roadFactor}).
      </p>
    </div>
  );
}
