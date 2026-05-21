import type {
  AppData,
  AutoBackupSettings,
  AutoBackupLocation,
  AutoBackupUnit,
  LanguageCode,
  Payment,
  PinTimeoutSettings,
  Settings,
  UiSize,
} from '../types';
import { DEFAULT_STORE_NAME } from './appInfo';
import { defaultPinHash } from './security';

const languages: LanguageCode[] = ['ceb', 'taglish', 'bisayaEnglish', 'en'];
const uiSizes: UiSize[] = ['normal', 'large'];
const autoBackupUnits: AutoBackupUnit[] = ['minutes', 'hours', 'days'];
const autoBackupLocations: AutoBackupLocation[] = [
  'downloads',
  'documents',
  'data',
  'browser',
];

export async function createDefaultSettings(): Promise<Settings> {
  return {
    language: 'ceb',
    pinHash: await defaultPinHash(),
    uiSize: 'large',
    storeName: DEFAULT_STORE_NAME,
    ownerName: '',
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
  };
}

export async function normalizeSettings(
  settings?: Partial<Settings> | null,
): Promise<Settings> {
  const defaults = await createDefaultSettings();
  return {
    language: isLanguage(settings?.language) ? settings.language : defaults.language,
    pinHash: settings?.pinHash || defaults.pinHash,
    uiSize: isUiSize(settings?.uiSize) ? settings.uiSize : defaults.uiSize,
    storeName: settings?.storeName?.trim() || defaults.storeName,
    ownerName: settings?.ownerName?.trim() || '',
    pinUpdatedAt:
      typeof settings?.pinUpdatedAt === 'string' && settings.pinUpdatedAt.trim()
        ? settings.pinUpdatedAt
        : null,
    pinTimeout: normalizePinTimeout(settings?.pinTimeout, defaults.pinTimeout),
    autoBackup: normalizeAutoBackup(settings?.autoBackup, defaults.autoBackup),
  };
}

export async function normalizeAppData(
  data: Partial<Omit<AppData, 'settings' | 'payments'>> & {
    payments?: Partial<Payment>[] | null;
    settings?: Partial<Settings> | null;
  },
): Promise<AppData> {
  return {
    products: Array.isArray(data.products) ? data.products : [],
    customers: Array.isArray(data.customers) ? data.customers : [],
    ledgerEntries: Array.isArray(data.ledgerEntries) ? data.ledgerEntries : [],
    payments: Array.isArray(data.payments) ? data.payments.map(normalizePayment) : [],
    settings: await normalizeSettings(data.settings),
  };
}

function normalizePayment(payment: Partial<Payment>): Payment {
  return {
    id: String(payment.id ?? ''),
    customerId: String(payment.customerId ?? ''),
    amount: Number(payment.amount ?? 0),
    note: String(payment.note ?? ''),
    createdAt: String(payment.createdAt ?? ''),
    allocations: Array.isArray(payment.allocations)
      ? payment.allocations
          .map((allocation) => ({
            ledgerEntryId: String(allocation.ledgerEntryId ?? ''),
            amount: Number(allocation.amount ?? 0),
          }))
          .filter(
            (allocation) =>
              allocation.ledgerEntryId.trim() && Number.isFinite(allocation.amount),
          )
      : [],
  };
}

function normalizeAutoBackup(
  settings: Partial<AutoBackupSettings> | undefined,
  defaults: AutoBackupSettings,
): AutoBackupSettings {
  const every = Number(settings?.every ?? defaults.every);
  return {
    enabled:
      typeof settings?.enabled === 'boolean' ? settings.enabled : defaults.enabled,
    every: Number.isFinite(every) && every > 0 ? Math.max(1, Math.floor(every)) : defaults.every,
    unit: isAutoBackupUnit(settings?.unit) ? settings.unit : defaults.unit,
    lastRunAt:
      typeof settings?.lastRunAt === 'string' && settings.lastRunAt.trim()
        ? settings.lastRunAt
        : null,
    lastAttemptAt:
      typeof settings?.lastAttemptAt === 'string' && settings.lastAttemptAt.trim()
        ? settings.lastAttemptAt
        : null,
    lastFileName:
      typeof settings?.lastFileName === 'string' && settings.lastFileName.trim()
        ? settings.lastFileName
        : null,
    lastUri:
      typeof settings?.lastUri === 'string' && settings.lastUri.trim()
        ? settings.lastUri
        : null,
    lastLocation: isAutoBackupLocation(settings?.lastLocation)
      ? settings.lastLocation
      : null,
    lastError:
      typeof settings?.lastError === 'string' && settings.lastError.trim()
        ? settings.lastError
        : null,
  };
}

function normalizePinTimeout(
  settings: Partial<PinTimeoutSettings> | undefined,
  defaults: PinTimeoutSettings,
): PinTimeoutSettings {
  const every = Number(settings?.every ?? defaults.every);
  return {
    every: Number.isFinite(every) && every > 0 ? Math.max(1, Math.floor(every)) : defaults.every,
    unit: isAutoBackupUnit(settings?.unit) ? settings.unit : defaults.unit,
  };
}

function isLanguage(value: unknown): value is LanguageCode {
  return typeof value === 'string' && languages.includes(value as LanguageCode);
}

function isUiSize(value: unknown): value is UiSize {
  return typeof value === 'string' && uiSizes.includes(value as UiSize);
}

function isAutoBackupUnit(value: unknown): value is AutoBackupUnit {
  return typeof value === 'string' && autoBackupUnits.includes(value as AutoBackupUnit);
}

function isAutoBackupLocation(value: unknown): value is AutoBackupLocation {
  return (
    typeof value === 'string' &&
    autoBackupLocations.includes(value as AutoBackupLocation)
  );
}
