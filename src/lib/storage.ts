import { Capacitor } from '@capacitor/core';
import {
  CapacitorSQLite,
  SQLiteConnection,
  type SQLiteDBConnection,
} from '@capacitor-community/sqlite';
import type {
  AppData,
  Customer,
  LedgerEntry,
  Payment,
  Product,
  Settings,
} from '../types';
import { createDefaultSettings, normalizeAppData, normalizeSettings } from './settings';

const DB_NAME = 'tindahan_lola';
const LOCAL_KEY = 'tindahan-ni-lola:data';

export interface AppRepository {
  readonly mode: 'sqlite' | 'browser';
  init(): Promise<AppData>;
  load(): Promise<AppData>;
  saveSettings(settings: Settings): Promise<void>;
  upsertProduct(product: Product): Promise<void>;
  softDeleteProduct(productId: string, updatedAt: string): Promise<void>;
  upsertCustomer(customer: Customer): Promise<void>;
  deleteCustomer(customerId: string): Promise<void>;
  addLedgerEntry(entry: LedgerEntry): Promise<void>;
  addLedgerEntries(entries: LedgerEntry[]): Promise<void>;
  addPayment(payment: Payment): Promise<void>;
  replaceAll(data: AppData): Promise<void>;
}

export async function createEmptyData(): Promise<AppData> {
  return {
    products: [],
    customers: [],
    ledgerEntries: [],
    payments: [],
    settings: await createDefaultSettings(),
  };
}

export function createRepository(): AppRepository {
  if (Capacitor.isNativePlatform()) {
    return new SqliteRepository();
  }
  return new BrowserRepository();
}

class BrowserRepository implements AppRepository {
  readonly mode = 'browser' as const;

  async init(): Promise<AppData> {
    const existing = localStorage.getItem(LOCAL_KEY);
    if (existing) return this.load();
    const data = await createEmptyData();
    this.write(data);
    return data;
  }

  async load(): Promise<AppData> {
    const raw = localStorage.getItem(LOCAL_KEY);
    if (!raw) return this.init();
    const data = await normalizeAppData(JSON.parse(raw) as Partial<AppData>);
    this.write(data);
    return data;
  }

  async saveSettings(settings: Settings): Promise<void> {
    const data = await this.load();
    this.write({ ...data, settings });
  }

  async upsertProduct(product: Product): Promise<void> {
    const data = await this.load();
    const products = upsertById(data.products, product);
    this.write({ ...data, products });
  }

  async softDeleteProduct(productId: string, updatedAt: string): Promise<void> {
    const data = await this.load();
    const products = data.products.map((product) =>
      product.id === productId ? { ...product, active: false, updatedAt } : product,
    );
    this.write({ ...data, products });
  }

  async upsertCustomer(customer: Customer): Promise<void> {
    const data = await this.load();
    const customers = upsertById(data.customers, customer);
    this.write({ ...data, customers });
  }

  async deleteCustomer(customerId: string): Promise<void> {
    const data = await this.load();
    this.write({
      ...data,
      customers: data.customers.filter((customer) => customer.id !== customerId),
      ledgerEntries: data.ledgerEntries.filter(
        (entry) => entry.customerId !== customerId,
      ),
      payments: data.payments.filter((payment) => payment.customerId !== customerId),
    });
  }

  async addLedgerEntry(entry: LedgerEntry): Promise<void> {
    const data = await this.load();
    this.write({ ...data, ledgerEntries: [...data.ledgerEntries, entry] });
  }

  async addLedgerEntries(entries: LedgerEntry[]): Promise<void> {
    if (!entries.length) return;
    const data = await this.load();
    this.write({ ...data, ledgerEntries: [...data.ledgerEntries, ...entries] });
  }

  async addPayment(payment: Payment): Promise<void> {
    const data = await this.load();
    this.write({ ...data, payments: [...data.payments, payment] });
  }

  async replaceAll(data: AppData): Promise<void> {
    this.write(data);
  }

  private write(data: AppData): void {
    localStorage.setItem(LOCAL_KEY, JSON.stringify(data));
  }
}

class SqliteRepository implements AppRepository {
  readonly mode = 'sqlite' as const;
  private sqlite = new SQLiteConnection(CapacitorSQLite);
  private db: SQLiteDBConnection | null = null;

  async init(): Promise<AppData> {
    await this.open();
    await this.db!.execute(
      `
      CREATE TABLE IF NOT EXISTS products (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        price REAL NOT NULL,
        active INTEGER NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS customers (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        note TEXT NOT NULL,
        active INTEGER NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS ledger_entries (
        id TEXT PRIMARY KEY,
        customer_id TEXT NOT NULL,
        product_id TEXT,
        item_name TEXT NOT NULL,
        quantity REAL NOT NULL,
        unit_price REAL NOT NULL,
        total REAL NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS payments (
        id TEXT PRIMARY KEY,
        customer_id TEXT NOT NULL,
        amount REAL NOT NULL,
        note TEXT NOT NULL,
        created_at TEXT NOT NULL,
        allocations_json TEXT NOT NULL DEFAULT '[]'
      );
      CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
      `,
      false,
    );
    await this.ensurePaymentAllocationsColumn();

    const settings = await this.querySettings();
    if (!settings) {
      const empty = await createEmptyData();
      await this.saveSettings(empty.settings);
    } else {
      await this.saveSettings(settings);
    }

    return this.load();
  }

  async load(): Promise<AppData> {
    await this.open();
    const [products, customers, ledgerEntries, payments] = await Promise.all([
      this.queryProducts(),
      this.queryCustomers(),
      this.queryLedgerEntries(),
      this.queryPayments(),
    ]);
    const settings = (await this.querySettings()) ?? (await createEmptyData()).settings;
    return { products, customers, ledgerEntries, payments, settings };
  }

  async saveSettings(settings: Settings): Promise<void> {
    await this.open();
    await this.db!.run(
      `INSERT OR REPLACE INTO settings (key, value) VALUES ('app', ?);`,
      [JSON.stringify(settings)],
    );
  }

  async upsertProduct(product: Product): Promise<void> {
    await this.open();
    await this.db!.run(
      `
      INSERT OR REPLACE INTO products
        (id, name, price, active, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?);
      `,
      [
        product.id,
        product.name,
        product.price,
        product.active ? 1 : 0,
        product.createdAt,
        product.updatedAt,
      ],
    );
  }

  async softDeleteProduct(productId: string, updatedAt: string): Promise<void> {
    await this.open();
    await this.db!.run(
      `UPDATE products SET active = 0, updated_at = ? WHERE id = ?;`,
      [updatedAt, productId],
    );
  }

  async upsertCustomer(customer: Customer): Promise<void> {
    await this.open();
    await this.db!.run(
      `
      INSERT OR REPLACE INTO customers
        (id, name, note, active, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?);
      `,
      [
        customer.id,
        customer.name,
        customer.note,
        customer.active ? 1 : 0,
        customer.createdAt,
        customer.updatedAt,
      ],
    );
  }

  async deleteCustomer(customerId: string): Promise<void> {
    await this.open();
    await this.db!.execute('BEGIN TRANSACTION;', false);
    try {
      await this.db!.run(`DELETE FROM payments WHERE customer_id = ?;`, [customerId]);
      await this.db!.run(`DELETE FROM ledger_entries WHERE customer_id = ?;`, [
        customerId,
      ]);
      await this.db!.run(`DELETE FROM customers WHERE id = ?;`, [customerId]);
      await this.db!.execute('COMMIT;', false);
    } catch (error) {
      await this.db!.execute('ROLLBACK;', false);
      throw error;
    }
  }

  async addLedgerEntry(entry: LedgerEntry): Promise<void> {
    await this.open();
    await this.db!.run(
      `
      INSERT INTO ledger_entries
        (id, customer_id, product_id, item_name, quantity, unit_price, total, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?);
      `,
      [
        entry.id,
        entry.customerId,
        entry.productId,
        entry.itemName,
        entry.quantity,
        entry.unitPrice,
        entry.total,
        entry.createdAt,
      ],
    );
  }

  async addLedgerEntries(entries: LedgerEntry[]): Promise<void> {
    if (!entries.length) return;
    await this.open();
    await this.db!.execute('BEGIN TRANSACTION;', false);
    try {
      for (const entry of entries) {
        await this.db!.run(
          `
          INSERT INTO ledger_entries
            (id, customer_id, product_id, item_name, quantity, unit_price, total, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?);
          `,
          [
            entry.id,
            entry.customerId,
            entry.productId,
            entry.itemName,
            entry.quantity,
            entry.unitPrice,
            entry.total,
            entry.createdAt,
          ],
        );
      }
      await this.db!.execute('COMMIT;', false);
    } catch (error) {
      await this.db!.execute('ROLLBACK;', false);
      throw error;
    }
  }

  async addPayment(payment: Payment): Promise<void> {
    await this.open();
    await this.db!.run(
      `
      INSERT INTO payments (id, customer_id, amount, note, created_at, allocations_json)
      VALUES (?, ?, ?, ?, ?, ?);
      `,
      [
        payment.id,
        payment.customerId,
        payment.amount,
        payment.note,
        payment.createdAt,
        JSON.stringify(payment.allocations),
      ],
    );
  }

  async replaceAll(data: AppData): Promise<void> {
    await this.open();
    await this.db!.execute(
      `
      DELETE FROM payments;
      DELETE FROM ledger_entries;
      DELETE FROM customers;
      DELETE FROM products;
      DELETE FROM settings;
      `,
      false,
    );

    for (const product of data.products) await this.upsertProduct(product);
    for (const customer of data.customers) await this.upsertCustomer(customer);
    for (const entry of data.ledgerEntries) await this.addLedgerEntry(entry);
    for (const payment of data.payments) await this.addPayment(payment);
    await this.saveSettings(data.settings);
  }

  private async open(): Promise<void> {
    if (this.db) return;
    const hasConnection = await this.sqlite.isConnection(DB_NAME, false);
    this.db = hasConnection.result
      ? await this.sqlite.retrieveConnection(DB_NAME, false)
      : await this.sqlite.createConnection(DB_NAME, false, 'no-encryption', 1, false);
    await this.db.open();
  }

  private async queryProducts(): Promise<Product[]> {
    const result = await this.db!.query(
      `SELECT id, name, price, active, created_at, updated_at FROM products ORDER BY name;`,
    );
    return (result.values ?? []).map((row) => ({
      id: String(row.id),
      name: String(row.name),
      price: Number(row.price),
      active: Boolean(Number(row.active)),
      createdAt: String(row.created_at),
      updatedAt: String(row.updated_at),
    }));
  }

  private async queryCustomers(): Promise<Customer[]> {
    const result = await this.db!.query(
      `SELECT id, name, note, active, created_at, updated_at FROM customers ORDER BY name;`,
    );
    return (result.values ?? []).map((row) => ({
      id: String(row.id),
      name: String(row.name),
      note: String(row.note ?? ''),
      active: Boolean(Number(row.active)),
      createdAt: String(row.created_at),
      updatedAt: String(row.updated_at),
    }));
  }

  private async queryLedgerEntries(): Promise<LedgerEntry[]> {
    const result = await this.db!.query(
      `
      SELECT id, customer_id, product_id, item_name, quantity, unit_price, total, created_at
      FROM ledger_entries
      ORDER BY created_at DESC;
      `,
    );
    return (result.values ?? []).map((row) => ({
      id: String(row.id),
      customerId: String(row.customer_id),
      productId: row.product_id ? String(row.product_id) : null,
      itemName: String(row.item_name),
      quantity: Number(row.quantity),
      unitPrice: Number(row.unit_price),
      total: Number(row.total),
      createdAt: String(row.created_at),
    }));
  }

  private async queryPayments(): Promise<Payment[]> {
    const result = await this.db!.query(
      `
      SELECT id, customer_id, amount, note, created_at, allocations_json
      FROM payments
      ORDER BY created_at DESC;
      `,
    );
    return (result.values ?? []).map((row) => ({
      id: String(row.id),
      customerId: String(row.customer_id),
      amount: Number(row.amount),
      note: String(row.note ?? ''),
      createdAt: String(row.created_at),
      allocations: parseAllocations(row.allocations_json),
    }));
  }

  private async querySettings(): Promise<Settings | null> {
    const result = await this.db!.query(`SELECT value FROM settings WHERE key = 'app';`);
    const raw = result.values?.[0]?.value;
    return raw ? normalizeSettings(JSON.parse(String(raw)) as Partial<Settings>) : null;
  }

  private async ensurePaymentAllocationsColumn(): Promise<void> {
    const result = await this.db!.query(`PRAGMA table_info(payments);`);
    const hasAllocations = (result.values ?? []).some(
      (row) => String(row.name) === 'allocations_json',
    );
    if (!hasAllocations) {
      await this.db!.execute(
        `ALTER TABLE payments ADD COLUMN allocations_json TEXT NOT NULL DEFAULT '[]';`,
        false,
      );
    }
  }
}

function upsertById<T extends { id: string }>(items: T[], item: T): T[] {
  const exists = items.some((existing) => existing.id === item.id);
  return exists
    ? items.map((existing) => (existing.id === item.id ? item : existing))
    : [...items, item];
}

function parseAllocations(value: unknown): Payment['allocations'] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(String(value)) as Payment['allocations'];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}
