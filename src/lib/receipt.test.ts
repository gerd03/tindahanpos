import { describe, expect, it } from 'vitest';
import type { AppData } from '../types';
import { buildReceiptData, makeReceiptFilename } from './receipt';

const data: AppData = {
  products: [],
  customers: [
    {
      id: 'c1',
      name: 'Robert Caton',
      note: '',
      active: true,
      createdAt: '2026-05-20T00:00:00.000Z',
      updatedAt: '2026-05-20T00:00:00.000Z',
    },
  ],
  ledgerEntries: [
    {
      id: 'l1',
      customerId: 'c1',
      productId: 'p1',
      itemName: 'Pancit Canton',
      quantity: 2,
      unitPrice: 12,
      total: 24,
      createdAt: '2026-05-20T01:00:00.000Z',
    },
    {
      id: 'l2',
      customerId: 'c1',
      productId: 'p2',
      itemName: 'Coke',
      quantity: 1,
      unitPrice: 60,
      total: 60,
      createdAt: '2026-05-20T02:00:00.000Z',
    },
  ],
  payments: [
    {
      id: 'pay1',
      customerId: 'c1',
      amount: 20,
      note: 'Partial',
      createdAt: '2026-05-20T03:00:00.000Z',
      allocations: [],
    },
  ],
  settings: {
    language: 'ceb',
    pinHash: 'hash',
    uiSize: 'large',
    storeName: 'Tindahan ni Lola Magding',
    ownerName: 'Lola Magding',
    pinUpdatedAt: null,
    pinTimeout: {
      every: 10,
      unit: 'minutes',
    },
    autoBackup: {
      enabled: true,
      every: 8,
      unit: 'hours',
      lastRunAt: null,
      lastAttemptAt: null,
      lastFileName: null,
      lastUri: null,
      lastLocation: null,
      lastError: null,
    },
  },
};

describe('receipt data', () => {
  it('builds receipt rows from unpaid debts only', () => {
    const receipt = buildReceiptData(data, 'c1');

    expect(receipt.storeName).toBe('Tindahan ni Lola Magding');
    expect(receipt.ownerName).toBe('Lola Magding');
    expect(receipt.rows.map((row) => row.itemName)).toEqual(['Pancit Canton', 'Coke']);
    expect(receipt.rows.map((row) => row.amount)).toEqual([4, 60]);
    expect(receipt.finalBalance).toBe(64);
  });

  it('uses pdf filenames for receipts', () => {
    expect(makeReceiptFilename('Robert Caton', 'Tindahan ni Lola')).toMatch(
      /^SukiTrack_TindahanNiLola_RobertCaton_\d{4}-\d{2}-\d{2}\.pdf$/,
    );
  });
});
