import { Delete } from 'lucide-react';
import { useEffect } from 'react';

/**
 * Masked PIN entry with an on-screen pad (touch) and the keyboard (digits, Backspace, Enter). Listens on the window
 * so the cashier can just type; `active` turns that off while another dialog is open.
 */
export function PinPad({ value, onChange, onSubmit, active = true, maxLength = 6 }: { value: string; onChange: (v: string) => void; onSubmit: () => void; active?: boolean; maxLength?: number }) {
  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement | null)?.tagName === 'INPUT') return;
      if (/^\d$/.test(e.key) && value.length < maxLength) onChange(value + e.key);
      else if (e.key === 'Backspace') onChange(value.slice(0, -1));
      else if (e.key === 'Enter') onSubmit();
      else return;
      e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [value, onChange, onSubmit, active, maxLength]);

  const key = (label: string, onPress: () => void, aria?: string) => (
    <button type="button" className="btn h-14 text-xl" onClick={onPress} aria-label={aria ?? label}>
      {label}
    </button>
  );
  return (
    <div>
      <div className="mb-4 flex justify-center gap-3" aria-label={`${value.length} digits entered`} data-testid="pin-dots">
        {Array.from({ length: Math.max(4, value.length) }, (_, i) => (
          <span key={i} className={`h-4 w-4 rounded-full border-2 border-foreground ${i < value.length ? 'bg-foreground' : ''}`} />
        ))}
      </div>
      <div className="grid grid-cols-3 gap-2">
        {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((d) => key(d, () => value.length < maxLength && onChange(value + d)))}
        <button type="button" className="btn h-14" onClick={() => onChange(value.slice(0, -1))} aria-label="Delete last digit">
          <Delete className="h-5 w-5" />
        </button>
        {key('0', () => value.length < maxLength && onChange(`${value}0`))}
        <button type="button" className="btn btn-primary h-14 text-base" onClick={onSubmit} disabled={value.length < 4}>
          OK
        </button>
      </div>
    </div>
  );
}
