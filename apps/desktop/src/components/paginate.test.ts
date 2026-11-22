import { describe, expect, it } from 'vitest';
import { paginate } from './paginate.js';

const list = Array.from({ length: 23 }, (_, i) => i + 1);

describe('paginate', () => {
  it('shows 10 rows a page, the last page holding the rest', () => {
    expect(paginate(list, 1, 10)).toMatchObject({ rows: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10], page: 1, pages: 3, from: 1, to: 10, total: 23 });
    expect(paginate(list, 3, 10)).toMatchObject({ rows: [21, 22, 23], page: 3, from: 21, to: 23 });
  });

  it('keeps the page within range when the list shrinks or the page is odd', () => {
    expect(paginate(list.slice(0, 12), 3, 10)).toMatchObject({ page: 2, rows: [11, 12] });
    expect(paginate(list, 0, 10).page).toBe(1);
    expect(paginate(list, Number.NaN, 10).page).toBe(1);
  });

  it('an empty list is one empty page', () => {
    expect(paginate([], 1, 10)).toEqual({ rows: [], page: 1, pages: 1, from: 0, to: 0, total: 0 });
  });
});
