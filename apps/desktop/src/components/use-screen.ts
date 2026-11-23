// The screen DinePOS is on (DinePOS for Android: a phone, a tablet or a POS machine; a PC): its size, kept up to date.
import { useEffect, useState } from 'react';

export interface Screen {
  width: number;
  height: number;
  /** A phone, upright or sideways (narrow, or short): one panel at a time. */
  compact: boolean;
}

const read = (): Screen => {
  const width = window.innerWidth;
  const height = window.innerHeight;
  return { width, height, compact: width < 768 || height < 500 };
};

export function useScreen(): Screen {
  const [s, set] = useState(read);
  useEffect(() => {
    const on = () => set(read());
    window.addEventListener('resize', on);
    return () => window.removeEventListener('resize', on);
  }, []);
  return s;
}
