export type LanguageCode = 'ceb' | 'taglish' | 'bisayaEnglish' | 'en';

export type UiSize = 'normal' | 'large';

export interface Product {
  id: string;
  name: string;
  price: number;
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface Customer {
  id: string;
  name: string;
  note: string;
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface LedgerEntry {
  id: string;
  customerId: string;
  productId: string | null;
  itemName: string;
  quantity: number;
  unitPrice: number;
  total: number;
  createdAt: string;
}

export interface Payment {
  id: string;
  customerId: string;
  amount: number;
  note: string;
  createdAt: string;
  allocations: PaymentAllocation[];
}

export interface PaymentAllocation {
  ledgerEntryId: string;
  amount: number;
}

export interface Settings {
  language: LanguageCode;
  pinHash: string;
  uiSize: UiSize;
  storeName: string;
  ownerName: string;
  pinUpdatedAt: string | null;
  pinTimeout: PinTimeoutSettings;
  autoBackup: AutoBackupSettings;
}

export type AutoBackupUnit = 'minutes' | 'hours' | 'days';
export type AutoBackupLocation = 'downloads' | 'documents' | 'data' | 'browser';

export interface PinTimeoutSettings {
  every: number;
  unit: AutoBackupUnit;
}

export interface AutoBackupSettings {
  enabled: boolean;
  every: number;
  unit: AutoBackupUnit;
  lastRunAt: string | null;
  lastAttemptAt: string | null;
  lastFileName: string | null;
  lastUri: string | null;
  lastLocation: AutoBackupLocation | null;
  lastError: string | null;
}

export interface AppData {
  products: Product[];
  customers: Customer[];
  ledgerEntries: LedgerEntry[];
  payments: Payment[];
  settings: Settings;
}

export interface CustomerSummary {
  customer: Customer;
  balance: number;
  totalDebt: number;
  totalPaid: number;
  lastActivityAt: string | null;
}

export interface ActivityLog {
  id: string;
  customerId: string;
  customerName: string;
  kind: 'debt' | 'payment';
  label: string;
  amount: number;
  createdAt: string;
}

export interface BackupFile {
  app: 'Tindahan ni Lola';
  version: 1;
  exportedAt: string;
  data: AppData;
}
