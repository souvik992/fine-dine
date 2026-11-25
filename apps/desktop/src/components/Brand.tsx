// DinePOS's own mark (the fork and knife of the app icon, build/icon.png) and wordmark, drawn in the brand colour.

/** The app icon as a tile. `inverse`: a light tile with brand-coloured cutlery, for the coloured top bar. */
export function BrandMark({ size = 36, inverse = false, className = '' }: { size?: number; inverse?: boolean; className?: string }) {
  const tile = inverse ? 'var(--primary-foreground)' : 'var(--primary)';
  const ink = inverse ? 'var(--primary)' : 'var(--primary-foreground)';
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" className={`shrink-0 ${className}`} aria-hidden>
      <rect width="48" height="48" rx="12" fill={tile} />
      {/* fork: three tines on a rounded base, then the handle */}
      <path d="M14.5 11v7.5M18.5 11v7.5M22.5 11v7.5M14.5 18.5a4 4 0 0 0 8 0M18.5 22.5V37" fill="none" stroke={ink} strokeWidth="2.6" strokeLinecap="round" />
      {/* knife: a curved blade over a straight handle */}
      <path d="M30 10.5c3.6.4 5.9 5 5.9 11.2l-2.6 5.4V37a1.6 1.6 0 0 1-3.2 0V11.3c0-.5.4-.85.9-.8z" fill={ink} />
    </svg>
  );
}

/** Mark + "DinePOS". On the coloured top bar pass `inverse`. */
export function BrandLogo({ size = 32, inverse = false, className = '' }: { size?: number; inverse?: boolean; className?: string }) {
  return (
    <span className={`flex shrink-0 items-center gap-2 ${className}`} aria-label="DinePOS">
      <BrandMark size={size} inverse={inverse} />
      <span className={`font-display font-semibold leading-none tracking-tight ${inverse ? 'text-primary-foreground' : 'text-foreground'}`} style={{ fontSize: Math.round(size * 0.62) }} aria-hidden>
        Dine<span className={inverse ? '' : 'text-primary'}>POS</span>
      </span>
    </span>
  );
}
