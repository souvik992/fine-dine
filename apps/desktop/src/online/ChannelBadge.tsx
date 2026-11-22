import type { HubOrder } from '@dinepos/shared';
import { Globe, Smartphone } from 'lucide-react';

type Channel = HubOrder['channel'];

const LOOK: Record<Channel, { label: string; title: string; tile: string; text: string; stripe: string }> = {
  swiggy: { label: 'Swiggy', title: 'Swiggy', tile: 'bg-[#FC8019] text-white', text: 'text-[#C2410C] font-extrabold tracking-tight', stripe: 'border-l-[#FC8019]' },
  zomato: { label: 'zomato', title: 'Zomato', tile: 'bg-[#E23744] text-white', text: 'text-[#CB202D] font-extrabold italic tracking-tight', stripe: 'border-l-[#E23744]' },
  website: { label: 'Website', title: 'The store’s website', tile: 'bg-[#2563EB] text-white', text: 'text-[#1D4ED8] font-semibold', stripe: 'border-l-[#2563EB]' },
  app: { label: 'App', title: 'The store’s app', tile: 'bg-[#7C3AED] text-white', text: 'text-[#6D28D9] font-semibold', stripe: 'border-l-[#7C3AED]' },
};

/** The channel's mark: a rounded tile in its colour, drawn here (no image files) so it works offline. Our own lettering. */
function ChannelLogo({ channel, px }: { channel: Channel; px: number }) {
  return (
    <span className={`inline-flex shrink-0 items-center justify-center rounded-md ${LOOK[channel].tile}`} style={{ width: px, height: px }} aria-hidden="true">
      {channel === 'swiggy' ? (
        <svg viewBox="0 0 24 24" width={px * 0.72} height={px * 0.72}>
          <path fill="currentColor" d="M12 2.2c-4.2 0-7.4 3.1-7.4 7.2 0 4.6 5.1 10.3 6.6 11.9.4.4 1.1.4 1.5 0 1.5-1.6 6.7-7.3 6.7-11.9 0-4.1-3.2-7.2-7.4-7.2z" />
          <text x="12" y="13.6" textAnchor="middle" fontSize="10" fontWeight="900" fontFamily="Arial, Helvetica, sans-serif" fill="#FC8019">S</text>
        </svg>
      ) : channel === 'zomato' ? (
        <svg viewBox="0 0 24 24" width={px * 0.8} height={px * 0.8}>
          <text x="12" y="17.5" textAnchor="middle" fontSize="19" fontWeight="900" fontStyle="italic" fontFamily="Arial, Helvetica, sans-serif" fill="currentColor">z</text>
        </svg>
      ) : channel === 'website' ? (
        <Globe style={{ width: px * 0.62, height: px * 0.62 }} strokeWidth={2.4} />
      ) : (
        <Smartphone style={{ width: px * 0.62, height: px * 0.62 }} strokeWidth={2.4} />
      )}
    </span>
  );
}

/** The coloured left edge of an order card, so Swiggy, Zomato, website and app orders tell apart at a glance. */
export const channelStripe = (channel: Channel) => LOOK[channel]?.stripe ?? '';

/** Where an online order came from: logo and name in the channel's colours. sm: lists and headers; md: the order card. */
export function ChannelBadge({ channel, size = 'sm' }: { channel: Channel; size?: 'sm' | 'md' }) {
  const look = LOOK[channel];
  return (
    <span className={`inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap ${size === 'md' ? 'text-base' : 'text-sm'}`} title={`Order from ${look.title}`} data-channel={channel}>
      <ChannelLogo channel={channel} px={size === 'md' ? 28 : 20} />
      <span className={look.text}>{look.label}</span>
    </span>
  );
}
