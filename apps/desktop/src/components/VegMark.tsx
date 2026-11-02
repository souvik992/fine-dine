/** Indian veg / non-veg symbol: square outline with a dot. Has a text label for screen readers. */
export function VegMark({ veg }: { veg: boolean }) {
  return (
    <span
      role="img"
      aria-label={veg ? 'Veg' : 'Non-veg'}
      className="inline-flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-[3px] border-2"
      style={{ borderColor: veg ? 'var(--veg)' : 'var(--nonveg)' }}
    >
      <span className="h-1.5 w-1.5 rounded-full" style={{ background: veg ? 'var(--veg)' : 'var(--nonveg)' }} />
    </span>
  );
}
