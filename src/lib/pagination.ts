import { PAGE_SIZE } from './appInfo';

export type PageItem = number | 'ellipsis-start' | 'ellipsis-end';

export function pageCount(totalItems: number, pageSize = PAGE_SIZE): number {
  return Math.max(1, Math.ceil(totalItems / pageSize));
}

export function clampPage(
  page: number,
  totalItems: number,
  pageSize = PAGE_SIZE,
): number {
  const maxPage = pageCount(totalItems, pageSize);
  if (!Number.isFinite(page) || page < 1) return 1;
  return Math.min(Math.floor(page), maxPage);
}

export function paginate<T>(
  items: T[],
  page: number,
  pageSize = PAGE_SIZE,
): T[] {
  const safePage = clampPage(page, items.length, pageSize);
  const start = (safePage - 1) * pageSize;
  return items.slice(start, start + pageSize);
}

export function buildPageItems(
  currentPage: number,
  totalPages: number,
  maxNumbers = 3,
): PageItem[] {
  const safeTotal = Math.max(1, Math.floor(totalPages));
  const safeMax = Math.max(1, Math.floor(maxNumbers));
  const safeCurrent = Math.min(Math.max(1, Math.floor(currentPage)), safeTotal);

  if (safeTotal <= safeMax) {
    return Array.from({ length: safeTotal }, (_, index) => index + 1);
  }

  let start = safeCurrent - Math.floor(safeMax / 2);
  start = Math.max(1, Math.min(start, safeTotal - safeMax + 1));
  const end = start + safeMax - 1;
  const items: PageItem[] = [];

  if (start > 1) items.push('ellipsis-start');
  for (let page = start; page <= end; page += 1) items.push(page);
  if (end < safeTotal) items.push('ellipsis-end');

  return items;
}
