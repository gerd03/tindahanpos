import { describe, expect, it } from 'vitest';
import type { ActivityLog } from '../types';
import {
  buildCalendarDays,
  filterLogsByDate,
  getRecordDateKeys,
  localDateKey,
  shiftMonth,
  todayKey,
  yesterdayKey,
} from './records';

const logs: ActivityLog[] = [
  {
    id: '1',
    customerId: 'c1',
    customerName: 'Juan',
    kind: 'debt',
    label: 'Pancit',
    amount: 20,
    createdAt: '2026-05-21T03:00:00.000Z',
  },
  {
    id: '2',
    customerId: 'c1',
    customerName: 'Juan',
    kind: 'payment',
    label: 'Bayad',
    amount: 10,
    createdAt: '2026-05-20T03:00:00.000Z',
  },
];

describe('record dates', () => {
  it('formats today and yesterday keys using local date', () => {
    const now = new Date(2026, 4, 21, 12, 0, 0);

    expect(todayKey(now)).toBe('2026-05-21');
    expect(yesterdayKey(now)).toBe('2026-05-20');
    expect(localDateKey(now)).toBe('2026-05-21');
  });

  it('filters logs by local date', () => {
    expect(filterLogsByDate(logs, '2026-05-21')).toHaveLength(1);
    expect(filterLogsByDate(logs, '2026-05-20')).toHaveLength(1);
  });

  it('highlights calendar days with records', () => {
    const days = buildCalendarDays(
      '2026-05',
      '2026-05-21',
      getRecordDateKeys(logs),
      new Date(2026, 4, 21),
    );

    expect(days.find((day) => day.key === '2026-05-21')?.hasRecords).toBe(true);
    expect(days.find((day) => day.key === '2026-05-21')?.isSelected).toBe(true);
    expect(days.find((day) => day.key === '2026-05-19')?.hasRecords).toBe(false);
  });

  it('shifts month keys', () => {
    expect(shiftMonth('2026-05', -1)).toBe('2026-04');
    expect(shiftMonth('2026-12', 1)).toBe('2027-01');
  });
});
