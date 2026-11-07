import type { OnlineOrderView } from '@dinepos/shared';
import { ExternalLink, Navigation } from 'lucide-react';
import { useState } from 'react';
import { Modal } from '../components/Modal.js';
import { directionsUrl, mapView, openStreetMapUrl, type LatLng } from './map-view.js';

const W = 640;
const H = 400;

/**
 * Where a delivery goes: the customer's pin (and the store's, when Settings › Serviceability has it) on OpenStreetMap
 * tiles, with links that open directions in the PC's browser. Needs the internet, like online orders themselves.
 */
export function DeliveryMap({ order, store, onClose }: { order: OnlineOrderView; store: LatLng | null; onClose: () => void }) {
  const to = order.order.location!;
  const view = mapView(store ? [to, store] : [to], W, H);
  const [failed, setFailed] = useState(false);
  const a = order.order.address;
  return (
    <Modal title={`${order.number}: delivery map`} onClose={onClose} wide>
      {a ? <p className="mb-2 text-sm">{[a.line1, a.line2, a.landmark, `${a.city} ${a.pincode}`].filter(Boolean).join(', ')}{order.order.distanceKm !== null ? ` · about ${order.order.distanceKm} km by road` : ''}</p> : null}
      <div className="relative mx-auto overflow-hidden rounded-lg border border-border bg-secondary" style={{ width: W, height: H, maxWidth: '100%' }} data-testid="delivery-map">
        {view.tiles.map((t) => (
          <img key={t.key} src={t.src} alt="" draggable={false} className="absolute select-none" style={{ left: t.left, top: t.top, width: 256, height: 256 }} onError={() => setFailed(true)} />
        ))}
        {store ? <Pin x={view.pins[1]!.x} y={view.pins[1]!.y} label="Store" color="#1f6feb" /> : null}
        <Pin x={view.pins[0]!.x} y={view.pins[0]!.y} label="Customer" color="#d1242f" />
        <span className="absolute bottom-0 right-0 bg-white/80 px-1 text-[10px] text-black">© OpenStreetMap contributors</span>
        {failed ? <p className="absolute inset-x-0 top-0 bg-warn px-2 py-1 text-sm font-semibold text-black">Map tiles did not load (no internet?). The links below still work on a phone.</p> : null}
      </div>
      <p className="mt-2 text-xs text-muted-foreground tabular-nums">
        Customer pin {to.lat}, {to.lng}
        {store ? '' : ' · set the store location in Settings › Online orders › Serviceability to see the store and get directions from it'}
      </p>
      <div className="mt-4 flex justify-end gap-2">
        <button className="btn" onClick={() => window.open(openStreetMapUrl(to), '_blank', 'noopener')}>
          <ExternalLink className="h-4 w-4" /> Open in OpenStreetMap
        </button>
        <button className="btn btn-primary" onClick={() => window.open(directionsUrl(to, store), '_blank', 'noopener')}>
          <Navigation className="h-4 w-4" /> Directions
        </button>
      </div>
    </Modal>
  );
}

function Pin({ x, y, label, color }: { x: number; y: number; label: string; color: string }) {
  return (
    <div className="pointer-events-none absolute flex flex-col items-center" style={{ left: x, top: y, transform: 'translate(-50%, -100%)' }} aria-label={label}>
      <span className="mb-0.5 rounded bg-white px-1 text-xs font-bold text-black shadow">{label}</span>
      <svg width="24" height="32" viewBox="0 0 24 32" aria-hidden>
        <path d="M12 0C5.4 0 0 5.4 0 12c0 9 12 20 12 20s12-11 12-20C24 5.4 18.6 0 12 0z" fill={color} stroke="#fff" strokeWidth="2" />
        <circle cx="12" cy="12" r="4.5" fill="#fff" />
      </svg>
    </div>
  );
}
