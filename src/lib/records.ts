import type { ActivityLog } from '../types';

export interface CalendarDay {
  key: string;
  dayNumber: number;
  isCurrentMonth: boolean;
  hasRecords: boolean;
  isSelected: boolean;
  isToday: boolean;
}

export function localDateKey(value: string | Date): string {
  const date = typeof value === 'string' ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return '';
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function todayKey(now = new Date()): string {
  return localDateKey(now);
}

export function yesterdayKey(now = new Date()): string {
  const date = new Date(now);
  date.setDate(date.getDate() - 1);
  return localDateKey(date);
}

export function monthKeyFromDateKey(dateKey: string): string {
  return dateKey.slice(0, 7);
}

export function shiftMonth(monthKey: string, amount: number): string {
  const [year, month] = monthKey.split('-').map(Number);
  const date = new Date(year, month - 1 + amount, 1);
  return monthKeyFromDateKey(localDateKey(date));
}

export function formatMonthLabel(monthKey: string): string {
  const [year, month] = monthKey.split('-').map(Number);
  return new Date(year, month - 1, 1).toLocaleDateString('en-PH', {
    month: 'long',
    year: 'numeric',
  });
}

export function getRecordDateKeys(logs: ActivityLog[]): Set<string> {
  return new Set(logs.map((log) => localDateKey(log.createdAt)).filter(Boolean));
}

export function filterLogsByDate(logs: ActivityLog[], dateKey: string): ActivityLog[] {
  return logs.filter((log) => localDateKey(log.createdAt) === dateKey);
}

export function buildCalendarDays(
  monthKey: string,
  selectedDateKey: string,
  recordDateKeys: Set<string>,
  now = new Date(),
): CalendarDay[] {
  const [year, month] = monthKey.split('-').map(Number);
  const firstDay = new Date(year, month - 1, 1);
  const start = new Date(firstDay);
  start.setDate(firstDay.getDate() - firstDay.getDay());

  return Array.from({ length: 42 }, (_, index) => {
    const date = new Date(start);
    date.setDate(start.getDate() + index);
    const key = localDateKey(date);
    return {
      key,
      dayNumber: date.getDate(),
      isCurrentMonth: date.getMonth() === month - 1,
      hasRecords: recordDateKeys.has(key),
      isSelected: key === selectedDateKey,
      isToday: key === todayKey(now),
    };
  });
}
