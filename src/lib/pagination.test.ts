import { describe, expect, it } from 'vitest';
import { buildPageItems, clampPage, pageCount, paginate } from './pagination';

describe('pagination', () => {
  it('limits lists to five records by default', () => {
    expect(paginate([1, 2, 3, 4, 5, 6], 1)).toEqual([1, 2, 3, 4, 5]);
    expect(paginate([1, 2, 3, 4, 5, 6], 2)).toEqual([6]);
  });

  it('clamps invalid pages', () => {
    expect(pageCount(11)).toBe(3);
    expect(clampPage(99, 11)).toBe(3);
    expect(clampPage(0, 11)).toBe(1);
  });

  it('keeps pagination buttons compact with ellipses', () => {
    expect(buildPageItems(1, 4)).toEqual([1, 2, 3, 'ellipsis-end']);
    expect(buildPageItems(5, 10)).toEqual([
      'ellipsis-start',
      4,
      5,
      6,
      'ellipsis-end',
    ]);
    expect(buildPageItems(10, 10)).toEqual(['ellipsis-start', 8, 9, 10]);
  });
});
