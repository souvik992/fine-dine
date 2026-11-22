// One page of a list shown a few rows at a time. Pure, no React.

export interface Page<T> {
  rows: T[];
  /** The page shown, 1-based; kept within 1..pages when the list shrinks. */
  page: number;
  pages: number;
  /** 1-based positions of the first and last row shown; 0 and 0 for an empty list. */
  from: number;
  to: number;
  total: number;
}

export function paginate<T>(list: readonly T[], page: number, size: number): Page<T> {
  const total = list.length;
  const pages = Math.max(1, Math.ceil(total / size));
  const p = Math.min(Math.max(1, Math.floor(page) || 1), pages);
  const start = (p - 1) * size;
  const rows = list.slice(start, start + size);
  return { rows, page: p, pages, from: rows.length ? start + 1 : 0, to: start + rows.length, total };
}
