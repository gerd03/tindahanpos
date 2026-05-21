import { describe, expect, it } from 'vitest';
import type { LedgerEntry, Payment, Product } from '../types';
import {
  calculateBalance,
  createLedgerEntryDraft,
  validatePayment,
} from './ledger';

const product: Product = {
  id: 'product-1',
  name: 'Pancit Canton',
  price: 18,
  active: true,
  createdAt: '2026-05-20T00:00:00.000Z',
  updatedAt: '2026-05-20T00:00:00.000Z',
};

describe('ledger math', () => {
  it('calculates multiple item debts and partial payments', () => {
    const entries: LedgerEntry[] = [
      { ...createLedgerEntryDraft('juan', product, 3), total: 54 },
      {
        ...createLedgerEntryDraft('juan', { ...product, id: 'product-2', price: 12 }, 2),
        total: 24,
      },
    ];
    const payments: Payment[] = [
      {
        id: 'payment-1',
        customerId: 'juan',
        amount: 50,
        note: '',
        createdAt: '2026-05-20T01:00:00.000Z',
        allocations: [],
      },
    ];

    expect(calculateBalance('juan', entries, payments)).toBe(28);
  });

  it('rejects overpayment and accepts full payment', () => {
    expect(validatePayment(101, 100).ok).toBe(false);
    expect(validatePayment(100, 100).ok).toBe(true);
    expect(validatePayment(50, 100).ok).toBe(true);
  });

  it('keeps price snapshots on old ledger entries', () => {
    const firstEntry = createLedgerEntryDraft('juan', product, 2);
    const updatedProduct = { ...product, price: 22 };
    const secondEntry = createLedgerEntryDraft('juan', updatedProduct, 2);

    expect(firstEntry.unitPrice).toBe(18);
    expect(firstEntry.total).toBe(36);
    expect(secondEntry.unitPrice).toBe(22);
    expect(secondEntry.total).toBe(44);
  });
});
