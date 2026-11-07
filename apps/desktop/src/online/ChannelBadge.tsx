import type { HubOrder } from '@dinepos/shared';
import { Globe, Smartphone } from 'lucide-react';

const TITLE: Record<HubOrder['channel'], string> = { swiggy: 'Swiggy', zomato: 'Zomato', website: 'The store’s website', app: 'The store’s app' };

/**
 * Where an online order came from, in that channel's colours (the same badges as the cloud admin page): Swiggy orange,
 * Zomato red, the store's own website and app with a globe and a phone. Our own lettering, not the platforms' logos.
 */
export function ChannelBadge({ channel }: { channel: HubOrder['channel'] }) {
  const base = 'inline-flex h-6 items-center gap-1 whitespace-nowrap rounded-md px-2 text-[13px] leading-none';
  if (channel === 'swiggy')
    return (
      <span className={`${base} bg-[#FC8019] font-extrabold tracking-tight text-white`} title={TITLE.swiggy} data-channel="swiggy">
        Swiggy
      </span>
    );
  if (channel === 'zomato')
    return (
      <span className={`${base} bg-[#E23744] font-extrabold italic tracking-tight text-white`} title={TITLE.zomato} data-channel="zomato">
        zomato
      </span>
    );
  const Icon = channel === 'app' ? Smartphone : Globe;
  return (
    <span className={`${base} bg-[#ffedd5] font-semibold text-[#9a3412]`} title={TITLE[channel]} data-channel={channel}>
      <Icon className="h-3.5 w-3.5" /> {channel === 'app' ? 'App' : 'Website'}
    </span>
  );
}
