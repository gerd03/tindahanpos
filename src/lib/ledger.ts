import type {
  ActivityLog,
  AppData,
  Customer,
  CustomerSummary,
  LedgerEntry,
  Payment,
  Product,
} from '../types';
import { makeId, normalizeName, nowIso, roundMoney } from './format';

export interface UnpaidLedgerItem {
  entry: LedgerEntry;
  remaining: number;
}

export function calculateBalance(
  customerId: string,
  ledgerEntries: LedgerEntry[],
  payments: Payment[],
): number {
  const debt = ledgerEntries
    .filter((entry) => entry.customerId === customerId)
    .reduce((sum, entry) => sum + entry.total, 0);
  const paid = payments
    .filter((payment) => payment.customerId === customerId)
    .reduce((sum, payment) => sum + payment.amount, 0);
  return roundMoney(Math.max(0, debt - paid));
}

export function validatePayment(
  amount: number,
  currentBalance: number,
): { ok: true } | { ok: false; message: string } {
  if (!Number.isFinite(amount) || amount <= 0) {
    return { ok: false, message: 'Payment must be greater than zero.' };
  }
  if (roundMoney(amount) > roundMoney(currentBalance)) {
    return { ok: false, message: 'Payment cannot be bigger than balance.' };
  }
  return { ok: true };
}

export function buildCustomerSummaries(data: AppData): CustomerSummary[] {
  return data.customers
    .map((customer) => {
      const customerEntries = data.ledgerEntries.filter(
        (entry) => entry.customerId === customer.id,
      );
      const customerPayments = data.payments.filter(
        (payment) => payment.customerId === customer.id,
      );
      const totalDebt = roundMoney(
        customerEntries.reduce((sum, entry) => sum + entry.total, 0),
      );
      const totalPaid = roundMoney(
        customerPayments.reduce((sum, payment) => sum + payment.amount, 0),
      );
      const lastActivityAt = [...customerEntries, ...customerPayments]
        .map((item) => item.createdAt)
        .sort()
        .at(-1) ?? null;

      return {
        customer,
        balance: roundMoney(Math.max(0, totalDebt - totalPaid)),
        totalDebt,
        totalPaid,
        lastActivityAt,
      };
    })
    .sort((left, right) => {
      if (left.balance !== right.balance) return right.balance - left.balance;
      return (right.lastActivityAt ?? '').localeCompare(left.lastActivityAt ?? '');
    });
}

export function buildUnpaidLedgerItems(
  data: AppData,
  customerId: string,
): UnpaidLedgerItem[] {
  const allocatedByEntry = new Map<string, number>();
  let remainingLegacyPaid = 0;

  for (const payment of data.payments.filter((item) => item.customerId === customerId)) {
    if (!payment.allocations.length) {
      remainingLegacyPaid = roundMoney(remainingLegacyPaid + payment.amount);
      continue;
    }
    for (const allocation of payment.allocations) {
      allocatedByEntry.set(
        allocation.ledgerEntryId,
        roundMoney((allocatedByEntry.get(allocation.ledgerEntryId) ?? 0) + allocation.amount),
      );
    }
  }

  return data.ledgerEntries
    .filter((entry) => entry.customerId === customerId)
    .sort((left, right) => left.createdAt.localeCompare(right.createdAt))
    .map((entry) => {
      const allocatedPaid = Math.min(entry.total, allocatedByEntry.get(entry.id) ?? 0);
      const afterAllocated = roundMoney(Math.max(0, entry.total - allocatedPaid));
      const legacyPaidForEntry = Math.min(afterAllocated, remainingLegacyPaid);
      remainingLegacyPaid = roundMoney(Math.max(0, remainingLegacyPaid - legacyPaidForEntry));
      return {
        entry,
        remaining: roundMoney(afterAllocated - legacyPaidForEntry),
      };
    })
    .filter((item) => item.remaining > 0);
}

export function findCustomerByName(
  customers: Customer[],
  name: string,
): Customer | undefined {
  const normalized = normalizeName(name);
  return customers.find((customer) => normalizeName(customer.name) === normalized);
}

export function findProductByName(
  products: Product[],
  name: string,
): Product | undefined {
  const normalized = normalizeName(name);
  return products.find(
    (product) => product.active && normalizeName(product.name) === normalized,
  );
}

export function createCustomer(name: string, note = ''): Customer {
  const timestamp = nowIso();
  return {
    id: makeId('customer'),
    name: name.trim().replace(/\s+/g, ' '),
    note: note.trim(),
    active: true,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

export function createProduct(name: string, price: number): Product {
  const timestamp = nowIso();
  return {
    id: makeId('product'),
    name: name.trim().replace(/\s+/g, ' '),
    price: roundMoney(price),
    active: true,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

export function createLedgerEntryDraft(
  customerId: string,
  product: Pick<Product, 'id' | 'name' | 'price'>,
  quantity: number,
  createdAt = nowIso(),
): LedgerEntry {
  const safeQuantity = roundMoney(quantity);
  const unitPrice = roundMoney(product.price);
  return {
    id: makeId('ledger'),
    customerId,
    productId: product.id,
    itemName: product.name,
    quantity: safeQuantity,
    unitPrice,
    total: roundMoney(safeQuantity * unitPrice),
    createdAt,
  };
}

export function createPaymentDraft(
  customerId: string,
  amount: number,
  note = '',
  allocations: Payment['allocations'] = [],
): Payment {
  return {
    id: makeId('payment'),
    customerId,
    amount: roundMoney(amount),
    note: note.trim(),
    createdAt: nowIso(),
    allocations,
  };
}

export function buildActivityLogs(data: AppData): ActivityLog[] {
  const customerNames = new Map(
    data.customers.map((customer) => [customer.id, customer.name]),
  );

  const debts: ActivityLog[] = data.ledgerEntries.map((entry) => ({
    id: entry.id,
    customerId: entry.customerId,
    customerName: customerNames.get(entry.customerId) ?? 'Unknown',
    kind: 'debt',
    label: `${entry.itemName} x ${entry.quantity}`,
    amount: entry.total,
    createdAt: entry.createdAt,
  }));

  const payments: ActivityLog[] = data.payments.map((payment) => ({
    id: payment.id,
    customerId: payment.customerId,
    customerName: customerNames.get(payment.customerId) ?? 'Unknown',
    kind: 'payment',
    label: payment.note || 'Payment',
    amount: payment.amount,
    createdAt: payment.createdAt,
  }));

  return [...debts, ...payments].sort((left, right) =>
    right.createdAt.localeCompare(left.createdAt),
  );
}
