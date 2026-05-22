import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type PointerEvent,
  type ReactNode,
} from 'react';
import {
  BookOpen,
  CalendarDays,
  Check,
  CircleDollarSign,
  Download,
  FileClock,
  ChevronLeft,
  ChevronRight,
  Lock,
  Package,
  Plus,
  Printer,
  Search,
  Settings,
  Trash2,
  TrendingUp,
  Upload,
  Users,
  X,
} from 'lucide-react';
import { Capacitor, registerPlugin } from '@capacitor/core';
import { Directory, Encoding, Filesystem } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';
import { NativeBiometric } from '@capgo/capacitor-native-biometric';
import './index.css';
import type {
  AppData,
  AutoBackupLocation,
  AutoBackupSettings,
  Customer,
  CustomerSummary,
  LedgerEntry,
  LanguageCode,
  Product,
  Settings as AppSettings,
} from './types';
import { parseBackup, serializeBackup } from './lib/backup';
import {
  formatCurrency,
  formatTinyDateTime,
  makeId,
  nowIso,
  roundMoney,
} from './lib/format';
import {
  buildActivityLogs,
  buildCustomerSummaries,
  buildUnpaidLedgerItems,
  createCustomer,
  createLedgerEntryDraft,
  createPaymentDraft,
  createProduct,
  findCustomerByName,
  findProductByName,
  validatePayment,
  type UnpaidLedgerItem,
} from './lib/ledger';
import { createRepository, type AppRepository } from './lib/storage';
import { hashPin, isValidPin, verifyPin } from './lib/security';
import { getTranslator, languages } from './lib/i18n';
import { DEVELOPER_NAME, DEFAULT_STORE_NAME, PAGE_SIZE } from './lib/appInfo';
import { buildPageItems, clampPage, paginate, pageCount } from './lib/pagination';
import { createCustomerReceiptPdf, makeReceiptFilename } from './lib/receipt';
import {
  CURRENT_APP_VERSION,
  CURRENT_APP_VERSION_CODE,
  fetchAvailableUpdate,
  type UpdateManifest,
} from './lib/update';
import {
  type CalendarDay,
  buildCalendarDays,
  filterLogsByDate,
  formatMonthLabel,
  getRecordDateKeys,
  monthKeyFromDateKey,
  shiftMonth,
  todayKey,
  yesterdayKey,
} from './lib/records';

type Tab = 'utang' | 'people' | 'products' | 'trends' | 'history' | 'settings';
type PageKey = 'active' | 'people' | 'products' | 'paid' | 'logs';
type EmptyKind = 'utang' | 'people' | 'products' | 'paid' | 'history';
type TrendRange = 'week' | 'month';

interface DebtCartItem {
  id: string;
  productId: string | null;
  itemName: string;
  quantity: number;
  unitPrice: number;
  total: number;
}

interface ProductTrendPoint {
  dateKey: string;
  label: string;
  detailLabel: string;
  quantity: number;
  total: number;
  items: ProductTrendItem[];
}

interface ProductTrendItem {
  key: string;
  name: string;
  quantity: number;
  total: number;
}

interface ProductTrendData {
  year: number;
  monthIndex: number;
  points: ProductTrendPoint[];
  topItems: ProductTrendItem[];
  totalQuantity: number;
  totalValue: number;
  bestItem: ProductTrendItem | null;
}

const initialDebtForm = {
  customerName: '',
  itemName: '',
  quantity: '1',
  quickPrice: '',
};

const initialPaymentForm = {
  amount: '',
  note: '',
};

const initialPages: Record<PageKey, number> = {
  active: 1,
  people: 1,
  products: 1,
  paid: 1,
  logs: 1,
};

const BACKUP_FOLDER = 'SUKI TRACK Backups';

interface BackupWriteResult {
  filename: string;
  path: string;
  location: AutoBackupLocation;
  uri?: string;
}

interface DownloadsBackupPlugin {
  writeBackup(options: {
    filename: string;
    folder: string;
    data: string;
  }): Promise<{
    filename: string;
    path: string;
    uri: string;
  }>;
}

const DownloadsBackup = registerPlugin<DownloadsBackupPlugin>('DownloadsBackup');
let lastBiometricPromptAt = 0;

interface ConfirmDialogState {
  title: string;
  message: string;
  confirmLabel: string;
  requiresPin?: boolean;
  pinHash?: string;
  preferBiometric?: boolean;
  onConfirm: () => Promise<void> | void;
}

interface SecureActionOptions {
  title: string;
  message: string;
  confirmLabel: string;
  onConfirm: () => Promise<void> | void;
}

function buildPinHint(settings: AppSettings, t: ReturnType<typeof getTranslator>) {
  if (!settings.pinUpdatedAt) return t('defaultPinHint');
  return t('customPinHint').replace('{date}', formatTinyDateTime(settings.pinUpdatedAt));
}

function formatDateKeyLabel(dateKey: string) {
  const date = new Date(`${dateKey}T00:00:00`);
  if (Number.isNaN(date.getTime())) return dateKey;
  return date.toLocaleDateString('en-PH', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

function toLocalDateKey(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function formatTrendDayLabel(dateKey: string) {
  const date = new Date(`${dateKey}T00:00:00`);
  if (Number.isNaN(date.getTime())) return dateKey;
  return date.toLocaleDateString('en-PH', {
    month: 'short',
    day: 'numeric',
  });
}

function getMonthName(monthIndex: number, format: 'short' | 'long' = 'short') {
  return new Date(2026, monthIndex, 1).toLocaleDateString('en-PH', {
    month: format,
  });
}

function addTrendItem(
  totalsByProduct: Map<string, ProductTrendItem>,
  entry: LedgerEntry,
) {
  const productKey = entry.productId ?? entry.itemName.trim().toLowerCase();
  const existing = totalsByProduct.get(productKey);
  if (existing) {
    existing.quantity = roundMoney(existing.quantity + entry.quantity);
    existing.total = roundMoney(existing.total + entry.total);
    return;
  }
  totalsByProduct.set(productKey, {
    key: productKey,
    name: entry.itemName,
    quantity: roundMoney(entry.quantity),
    total: roundMoney(entry.total),
  });
}

function sortTrendItems(items: ProductTrendItem[]) {
  return items.sort((left, right) => {
    if (right.quantity !== left.quantity) return right.quantity - left.quantity;
    return right.total - left.total;
  });
}

function buildProductTrends(
  data: AppData,
  range: TrendRange = 'week',
  selectedMonthIndex?: number,
): ProductTrendData {
  const validEntries = data.ledgerEntries.filter((entry) => {
    const date = new Date(entry.createdAt);
    return Number.isFinite(entry.quantity) && !Number.isNaN(date.getTime());
  });
  const latestEntryTime = validEntries
    .map((entry) => new Date(entry.createdAt).getTime())
    .sort((left, right) => right - left)[0];
  const endDate = new Date(latestEntryTime ?? Date.now());
  endDate.setHours(0, 0, 0, 0);
  const trendYear = endDate.getFullYear();
  const trendMonthIndex = selectedMonthIndex ?? endDate.getMonth();

  const pointKeys =
    range === 'month'
      ? Array.from(
          { length: new Date(trendYear, trendMonthIndex + 1, 0).getDate() },
          (_, index) => {
            const date = new Date(trendYear, trendMonthIndex, index + 1);
            return toLocalDateKey(date);
          },
        )
      : Array.from({ length: 7 }, (_, index) => {
          const date = new Date(endDate);
          date.setDate(endDate.getDate() - (6 - index));
          return toLocalDateKey(date);
        });

  const allowedPointKeys = new Set(pointKeys);
  const totalsByPoint = new Map(
    pointKeys.map((dateKey) => [
      dateKey,
      {
        quantity: 0,
        total: 0,
        items: new Map<string, ProductTrendItem>(),
      },
    ]),
  );
  const totalsByProduct = new Map<string, ProductTrendItem>();

  for (const entry of validEntries) {
    const entryDate = new Date(entry.createdAt);
    const pointKey = toLocalDateKey(entryDate);
    if (!allowedPointKeys.has(pointKey)) continue;

    const pointTotal = totalsByPoint.get(pointKey);
    if (!pointTotal) continue;
    pointTotal.quantity = roundMoney(pointTotal.quantity + entry.quantity);
    pointTotal.total = roundMoney(pointTotal.total + entry.total);
    addTrendItem(pointTotal.items, entry);
    addTrendItem(totalsByProduct, entry);
  }

  const points = pointKeys.map((dateKey) => {
    const total = totalsByPoint.get(dateKey);
    return {
      dateKey,
      label: formatTrendDayLabel(dateKey),
      detailLabel: formatDateKeyLabel(dateKey),
      quantity: roundMoney(total?.quantity ?? 0),
      total: roundMoney(total?.total ?? 0),
      items: sortTrendItems([...(total?.items.values() ?? [])]),
    };
  });
  const topItems = sortTrendItems([...totalsByProduct.values()]).slice(0, 5);

  return {
    year: trendYear,
    monthIndex: trendMonthIndex,
    points,
    topItems,
    totalQuantity: roundMoney(points.reduce((sum, point) => sum + point.quantity, 0)),
    totalValue: roundMoney(points.reduce((sum, point) => sum + point.total, 0)),
    bestItem: topItems[0] ?? null,
  };
}

function makeDetailedBackupFilename(data: AppData): string {
  const safeStore = toPascalFilePart(data.settings.storeName) || 'Store';
  const stamp = new Date()
    .toISOString()
    .replace(/[:.]/g, '-')
    .replace('T', '_')
    .slice(0, 19);
  return `SukiTrack_Backup_${safeStore}_${stamp}.json`;
}

function toPascalFilePart(value: string): string {
  return value
    .trim()
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join('');
}

function makeBackupPath(filename: string): string {
  return `${BACKUP_FOLDER}/${filename}`;
}

function compactError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function getBackupLocationLabel(
  location: AutoBackupLocation | null,
  t: ReturnType<typeof getTranslator>,
) {
  if (location === 'downloads') return t('downloadsFolder');
  if (location === 'documents') return t('documentsFolder');
  if (location === 'data') return t('appStorage');
  if (location === 'browser') return t('browserStorage');
  return '-';
}

async function verifyWithDeviceBiometric(t: ReturnType<typeof getTranslator>) {
  if (!Capacitor.isNativePlatform()) return false;
  const now = Date.now();
  if (now - lastBiometricPromptAt < 1500) return false;
  lastBiometricPromptAt = now;

  try {
    const availability = await NativeBiometric.isAvailable({ useFallback: true });
    if (!availability.isAvailable) return false;
    await NativeBiometric.verifyIdentity({
      title: t('biometricTitle'),
      subtitle: t('biometricSubtitle'),
      description: t('biometricDescription'),
      reason: t('biometricReason'),
      negativeButtonText: t('usePinInstead'),
      fallbackTitle: t('usePinInstead'),
      useFallback: true,
      maxAttempts: 2,
    });
    return true;
  } catch {
    return false;
  }
}

async function requestDocumentPermissionIfNeeded() {
  if (!Capacitor.isNativePlatform()) return;
  try {
    const status = await Filesystem.checkPermissions();
    if (status.publicStorage !== 'granted') {
      await Filesystem.requestPermissions();
    }
  } catch {
    // Newer Android versions may not need or grant this permission for app-created files.
  }
}

async function writeNativeBackup(
  json: string,
  filename: string,
): Promise<BackupWriteResult> {
  try {
    await requestDocumentPermissionIfNeeded();
    const result = await DownloadsBackup.writeBackup({
      filename,
      folder: BACKUP_FOLDER,
      data: json,
    });
    return {
      filename: result.filename,
      path: result.path,
      location: 'downloads',
      uri: result.uri,
    };
  } catch {
    // Fall through to Capacitor Filesystem directories for devices that block public Downloads.
  }

  const path = makeBackupPath(filename);
  try {
    await requestDocumentPermissionIfNeeded();
    const result = await Filesystem.writeFile({
      path,
      data: json,
      directory: Directory.Documents,
      encoding: Encoding.UTF8,
      recursive: true,
    });
    const uri =
      result.uri ||
      (
        await Filesystem.getUri({
          path,
          directory: Directory.Documents,
        })
      ).uri;
    return { filename, path, location: 'documents', uri };
  } catch {
    const result = await Filesystem.writeFile({
      path,
      data: json,
      directory: Directory.Data,
      encoding: Encoding.UTF8,
      recursive: true,
    });
    const uri =
      result.uri ||
      (
        await Filesystem.getUri({
          path,
          directory: Directory.Data,
        })
      ).uri;
    return { filename, path, location: 'data', uri };
  }
}

async function writeNativeReceipt(base64: string, filename: string): Promise<string> {
  const path = `receipts/${filename}`;
  const writeTargets = [
    { path, directory: Directory.Cache },
    { path: filename, directory: Directory.Documents },
    { path, directory: Directory.Data },
  ];

  let lastError: unknown;
  for (const target of writeTargets) {
    try {
      const result = await Filesystem.writeFile({
        ...target,
        data: base64,
        recursive: true,
      });
      return (
        result.uri ||
        (
          await Filesystem.getUri({
            path: target.path,
            directory: target.directory,
          })
        ).uri
      );
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

function getAutoBackupIntervalMs(settings: AutoBackupSettings): number {
  const count = Math.max(1, Number(settings.every) || 1);
  if (settings.unit === 'minutes') return count * 60_000;
  if (settings.unit === 'days') return count * 86_400_000;
  return count * 3_600_000;
}

function getPinTimeoutMs(settings: AppSettings['pinTimeout']): number {
  const count = Math.max(1, Number(settings.every) || 1);
  if (settings.unit === 'minutes') return count * 60_000;
  if (settings.unit === 'days') return count * 86_400_000;
  return count * 3_600_000;
}

function downloadBrowserBackup(json: string, filename: string) {
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.style.display = 'none';
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function App() {
  const repositoryRef = useRef<AppRepository | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const autoBackupRunningRef = useRef(false);
  const [repository] = useState<AppRepository>(() => createRepository());
  const [data, setData] = useState<AppData | null>(null);
  const [tab, setTab] = useState<Tab>('utang');
  const [debtForm, setDebtForm] = useState(initialDebtForm);
  const [debtCart, setDebtCart] = useState<DebtCartItem[]>([]);
  const [showDebtModal, setShowDebtModal] = useState(false);
  const [paymentForm, setPaymentForm] = useState(initialPaymentForm);
  const [payingCustomerId, setPayingCustomerId] = useState<string | null>(null);
  const [selectedPaymentEntries, setSelectedPaymentEntries] = useState<string[]>([]);
  const [paymentItemsPage, setPaymentItemsPage] = useState(1);
  const [quickDebtCustomerId, setQuickDebtCustomerId] = useState<string | null>(null);
  const [quickDebtForm, setQuickDebtForm] = useState({
    itemName: '',
    quantity: '1',
    quickPrice: '',
  });
  const [quickDebtCart, setQuickDebtCart] = useState<DebtCartItem[]>([]);
  const [selectedCustomerId, setSelectedCustomerId] = useState<string | null>(null);
  const [productForm, setProductForm] = useState({ name: '', price: '', id: '' });
  const [showProductModal, setShowProductModal] = useState(false);
  const [showBulkProductModal, setShowBulkProductModal] = useState(false);
  const [bulkProductRows, setBulkProductRows] = useState([{ name: '', price: '' }]);
  const [customerForm, setCustomerForm] = useState({ id: '', name: '', note: '' });
  const [showCustomerModal, setShowCustomerModal] = useState(false);
  const [ledgerForm, setLedgerForm] = useState({ id: '', itemName: '', quantity: '', unitPrice: '' });
  const [showLedgerModal, setShowLedgerModal] = useState(false);
  const [unlocked, setUnlocked] = useState(false);
  const [unlockedUntil, setUnlockedUntil] = useState(0);
  const [pinInput, setPinInput] = useState('');
  const [pinForm, setPinForm] = useState({ next: '', confirm: '' });
  const [storeNameInput, setStoreNameInput] = useState<string | null>(null);
  const [ownerNameInput, setOwnerNameInput] = useState<string | null>(null);
  const [notice, setNotice] = useState('');
  const [search, setSearch] = useState('');
  const [peopleSearch, setPeopleSearch] = useState('');
  const [selectedRecordDate, setSelectedRecordDate] = useState(() => todayKey());
  const [calendarMonth, setCalendarMonth] = useState(() =>
    monthKeyFromDateKey(todayKey()),
  );
  const [showCalendar, setShowCalendar] = useState(false);
  const [availableUpdate, setAvailableUpdate] = useState<UpdateManifest | null>(null);
  const updateCheckStartedRef = useRef(false);
  const [pages, setPages] = useState<Record<PageKey, number>>(initialPages);
  const [confirmDialog, setConfirmDialog] = useState<ConfirmDialogState | null>(null);

  const language = data?.settings.language ?? 'ceb';
  const t = useMemo(() => getTranslator(language), [language]);

  useEffect(() => {
    repositoryRef.current = repository;
    repository
      .init()
      .then(setData)
      .catch((error) => setNotice(error instanceof Error ? error.message : String(error)));
  }, [repository]);

  useEffect(() => {
    if (!notice) return undefined;
    const timer = window.setTimeout(() => setNotice(''), 3000);
    return () => window.clearTimeout(timer);
  }, [notice]);

  useEffect(() => {
    if (!unlocked || !unlockedUntil) return undefined;
    const delay = Math.max(0, unlockedUntil - Date.now());
    const timer = window.setTimeout(() => setUnlocked(false), delay);
    return () => window.clearTimeout(timer);
  }, [unlocked, unlockedUntil]);

  useEffect(() => {
    if (updateCheckStartedRef.current) return;
    updateCheckStartedRef.current = true;
    fetchAvailableUpdate()
      .then((update) => {
        if (!update) return;
        const skippedCode = Number(localStorage.getItem('suki-track:skip-update-code') || 0);
        if (!update.required && skippedCode >= update.versionCode) return;
        setAvailableUpdate(update);
      })
      .catch(() => {
        // Offline or update host unavailable: keep the app usable.
      });
  }, []);

  const summaries = useMemo(
    () => (data ? buildCustomerSummaries(data) : []),
    [data],
  );
  const activeSummaries = summaries.filter((summary) => summary.balance > 0);
  const paidSummaries = summaries.filter(
    (summary) => summary.balance === 0 && summary.totalDebt > 0,
  );
  const activityLogs = useMemo(
    () => (data ? buildActivityLogs(data) : []),
    [data],
  );
  const recordDateKeys = useMemo(() => getRecordDateKeys(activityLogs), [activityLogs]);
  const selectedActivityLogs = useMemo(
    () => filterLogsByDate(activityLogs, selectedRecordDate),
    [activityLogs, selectedRecordDate],
  );
  const calendarDays = useMemo(
    () => buildCalendarDays(calendarMonth, selectedRecordDate, recordDateKeys),
    [calendarMonth, selectedRecordDate, recordDateKeys],
  );
  const activeProducts = data?.products.filter((product) => product.active) ?? [];
  const selectedCustomer = summaries.find(
    (summary) => summary.customer.id === selectedCustomerId,
  );
  const payingCustomer = summaries.find(
    (summary) => summary.customer.id === payingCustomerId,
  );
  const quickDebtCustomer = summaries.find(
    (summary) => summary.customer.id === quickDebtCustomerId,
  );
  const payableItems = useMemo(
    () =>
      data && payingCustomer
        ? buildUnpaidLedgerItems(data, payingCustomer.customer.id)
        : [],
    [data, payingCustomer],
  );
  const selectedPaymentTotal = roundMoney(
    payableItems
      .filter((item) => selectedPaymentEntries.includes(item.entry.id))
      .reduce((sum, item) => sum + item.remaining, 0),
  );
  const paymentPage = clampPage(paymentItemsPage, payableItems.length, PAGE_SIZE);
  const visiblePayableItems = paginate(payableItems, paymentPage, PAGE_SIZE);
  const chosenProduct = data
    ? findProductByName(data.products, debtForm.itemName)
    : undefined;
  const quickChosenProduct = data
    ? findProductByName(data.products, quickDebtForm.itemName)
    : undefined;
  const quantity = Number(debtForm.quantity);
  const quickPrice = Number(debtForm.quickPrice);
  const unitPrice = chosenProduct?.price ?? quickPrice;
  const debtTotal =
    Number.isFinite(quantity) && Number.isFinite(unitPrice)
      ? roundMoney(quantity * unitPrice)
      : 0;
  const debtCartTotal = debtCart.reduce((sum, item) => roundMoney(sum + item.total), 0);
  const quickQuantity = Number(quickDebtForm.quantity);
  const quickPriceValue = Number(quickDebtForm.quickPrice);
  const quickUnitPrice = quickChosenProduct?.price ?? quickPriceValue;
  const quickDebtTotal =
    Number.isFinite(quickQuantity) && Number.isFinite(quickUnitPrice)
      ? roundMoney(quickQuantity * quickUnitPrice)
      : 0;
  const quickDebtCartTotal = quickDebtCart.reduce(
    (sum, item) => roundMoney(sum + item.total),
    0,
  );
  const totalActiveDebt = activeSummaries.reduce(
    (sum, summary) => roundMoney(sum + summary.balance),
    0,
  );
  const filteredProducts = activeProducts.filter((product) =>
    product.name.toLowerCase().includes(search.toLowerCase()),
  );
  const filteredPeopleSummaries = summaries.filter((summary) =>
    summary.customer.name.toLowerCase().includes(peopleSearch.trim().toLowerCase()),
  );
  const activePage = clampPage(pages.active, activeSummaries.length, PAGE_SIZE);
  const peoplePage = clampPage(pages.people, filteredPeopleSummaries.length, PAGE_SIZE);
  const productsPage = clampPage(pages.products, filteredProducts.length, PAGE_SIZE);
  const paidPage = clampPage(pages.paid, paidSummaries.length, PAGE_SIZE);
  const logsPage = clampPage(pages.logs, selectedActivityLogs.length, PAGE_SIZE);
  const pinHint = data ? buildPinHint(data.settings, t) : '';

  function setPage(key: PageKey, page: number, totalItems: number) {
    setPages((current) => ({
      ...current,
      [key]: clampPage(page, totalItems, PAGE_SIZE),
    }));
  }

  function updateSearch(value: string) {
    setSearch(value);
    setPages((current) => ({ ...current, products: 1 }));
  }

  function updatePeopleSearch(value: string) {
    setPeopleSearch(value);
    setPages((current) => ({ ...current, people: 1 }));
  }

  function selectRecordDate(dateKey: string) {
    setSelectedRecordDate(dateKey);
    setCalendarMonth(monthKeyFromDateKey(dateKey));
    setPages((current) => ({ ...current, logs: 1 }));
  }

  async function refresh() {
    const repository = repositoryRef.current;
    if (!repository) return;
    setData(await repository.load());
  }

  function runSecureAction(options: SecureActionOptions) {
    if (!data) return;
    setConfirmDialog({
      ...options,
      requiresPin: true,
      pinHash: data.settings.pinHash,
      preferBiometric: data.settings.biometricEnabled,
    });
  }

  function makeCartItem({
    itemName,
    quantity,
    quickPrice,
    product,
  }: {
    itemName: string;
    quantity: number;
    quickPrice: number;
    product: Product | undefined;
  }): DebtCartItem | null {
    const cleanName = itemName.trim();
    if (!cleanName) {
      setNotice(t('required'));
      return null;
    }
    if (!Number.isFinite(quantity) || quantity <= 0) {
      setNotice(t('invalidQuantity'));
      return null;
    }
    const unitPrice = product?.price ?? quickPrice;
    if (!Number.isFinite(unitPrice) || unitPrice <= 0) {
      setNotice(t('invalidPrice'));
      return null;
    }

    const safeQuantity = roundMoney(quantity);
    const safeUnitPrice = roundMoney(unitPrice);
    return {
      id: makeId('cart'),
      productId: product?.id ?? null,
      itemName: product?.name ?? cleanName.replace(/\s+/g, ' '),
      quantity: safeQuantity,
      unitPrice: safeUnitPrice,
      total: roundMoney(safeQuantity * safeUnitPrice),
    };
  }

  function addDebtCartItem(event: React.FormEvent) {
    event.preventDefault();
    const item = makeCartItem({
      itemName: debtForm.itemName,
      quantity,
      quickPrice,
      product: chosenProduct,
    });
    if (!item) return;
    setDebtCart((current) => [...current, item]);
    setDebtForm({ ...initialDebtForm, customerName: debtForm.customerName });
  }

  function addQuickDebtCartItem(event: React.FormEvent) {
    event.preventDefault();
    const item = makeCartItem({
      itemName: quickDebtForm.itemName,
      quantity: quickQuantity,
      quickPrice: quickPriceValue,
      product: quickChosenProduct,
    });
    if (!item) return;
    setQuickDebtCart((current) => [...current, item]);
    setQuickDebtForm({ itemName: '', quantity: '1', quickPrice: '' });
  }

  async function saveDebtForCustomer({
    customerName,
    items,
  }: {
    customerName: string;
    items: DebtCartItem[];
  }): Promise<boolean> {
    if (!data || !repositoryRef.current) return false;
    if (!customerName) {
      setNotice(t('required'));
      return false;
    }
    if (!items.length) {
      setNotice(t('noCartItems'));
      return false;
    }

    let customer = findCustomerByName(data.customers, customerName);
    if (!customer) {
      customer = createCustomer(customerName);
      await repositoryRef.current.upsertCustomer(customer);
    }

    const timestamp = nowIso();
    const productsById = new Map(data.products.map((product) => [product.id, product]));
    const productsByName = new Map(
      data.products
        .filter((product) => product.active)
        .map((product) => [product.name.trim().toLowerCase(), product]),
    );
    const entries: LedgerEntry[] = [];

    for (const item of items) {
      let product = item.productId ? productsById.get(item.productId) : undefined;
      if (!product) {
        product = productsByName.get(item.itemName.trim().toLowerCase());
      }
      if (!product) {
        product = createProduct(item.itemName, item.unitPrice);
        productsById.set(product.id, product);
        productsByName.set(product.name.trim().toLowerCase(), product);
        await repositoryRef.current.upsertProduct(product);
      }

      entries.push(
        createLedgerEntryDraft(
          customer.id,
          { id: product.id, name: item.itemName, price: item.unitPrice },
          item.quantity,
          timestamp,
        ),
      );
    }

    await repositoryRef.current.upsertCustomer({
      ...customer,
      active: true,
      updatedAt: timestamp,
    });
    await repositoryRef.current.addLedgerEntries(entries);
    setNotice(t('saved'));
    await refresh();
    return true;
  }

  async function saveDebt(event?: React.FormEvent) {
    event?.preventDefault();
    const customerName = debtForm.customerName.trim();
    if (!customerName) return setNotice(t('required'));
    if (!debtCart.length) return setNotice(t('noCartItems'));

    runSecureAction({
      title: t('confirmDebtTitle'),
      message: t('confirmDebtMessage')
        .replace('{name}', customerName)
        .replace('{count}', String(debtCart.length))
        .replace('{amount}', formatCurrency(debtCartTotal)),
      confirmLabel: t('saveAllDebt'),
      onConfirm: async () => {
        const saved = await saveDebtForCustomer({
          customerName,
          items: debtCart,
        });
        if (saved) {
          setDebtForm(initialDebtForm);
          setDebtCart([]);
          setShowDebtModal(false);
        }
      },
    });
  }

  async function saveQuickDebt(event?: React.FormEvent) {
    event?.preventDefault();
    if (!quickDebtCustomer) return;
    if (!quickDebtCart.length) return setNotice(t('noCartItems'));

    runSecureAction({
      title: t('confirmDebtTitle'),
      message: t('confirmDebtMessage')
        .replace('{name}', quickDebtCustomer.customer.name)
        .replace('{count}', String(quickDebtCart.length))
        .replace('{amount}', formatCurrency(quickDebtCartTotal)),
      confirmLabel: t('saveAllDebt'),
      onConfirm: async () => {
        const saved = await saveDebtForCustomer({
          customerName: quickDebtCustomer.customer.name,
          items: quickDebtCart,
        });
        if (saved) closeQuickDebt();
      },
    });
  }

  function openQuickDebt(customerId: string) {
    setQuickDebtCustomerId(customerId);
    setQuickDebtForm({ itemName: '', quantity: '1', quickPrice: '' });
    setQuickDebtCart([]);
  }

  function closeQuickDebt() {
    setQuickDebtCustomerId(null);
    setQuickDebtForm({ itemName: '', quantity: '1', quickPrice: '' });
    setQuickDebtCart([]);
  }

  function closeDebtModal() {
    setShowDebtModal(false);
    setDebtForm(initialDebtForm);
    setDebtCart([]);
  }

  function togglePaymentItem(entryId: string) {
    setSelectedPaymentEntries((current) =>
      current.includes(entryId)
        ? current.filter((id) => id !== entryId)
        : [...current, entryId],
    );
  }

  function openPayment(customerId: string) {
    setPaymentItemsPage(1);
    setSelectedPaymentEntries([]);
    setPaymentForm(initialPaymentForm);
    setPayingCustomerId(customerId);
  }

  function closePaymentModal() {
    setPayingCustomerId(null);
    setPaymentForm(initialPaymentForm);
    setSelectedPaymentEntries([]);
  }

  async function savePaymentAfterPin({
    amount,
    selectedItems,
  }: {
    amount: number;
    selectedItems: UnpaidLedgerItem[];
  }) {
    if (!data || !repositoryRef.current || !payingCustomer) return;
    const allocations = selectedItems.map((item) => ({
      ledgerEntryId: item.entry.id,
      amount: item.remaining,
    }));
    const note =
      paymentForm.note ||
      (selectedItems.length
        ? `Bayad: ${selectedItems.map((item) => item.entry.itemName).join(', ')}`
        : '');
    const payment = createPaymentDraft(
      payingCustomer.customer.id,
      amount,
      note,
      allocations,
    );
    await repositoryRef.current.addPayment(payment);
    const nextBalance = roundMoney(payingCustomer.balance - amount);
    await repositoryRef.current.upsertCustomer({
      ...payingCustomer.customer,
      active: nextBalance > 0,
      updatedAt: payment.createdAt,
    });
    setPaymentForm(initialPaymentForm);
    setSelectedPaymentEntries([]);
    setPayingCustomerId(null);
    setNotice(nextBalance === 0 ? t('fullyPaid') : t('partialPaid'));
    await refresh();
  }

  async function savePayment(event: React.FormEvent) {
    event.preventDefault();
    if (!data || !repositoryRef.current || !payingCustomer) return;
    const amount = selectedPaymentTotal > 0 ? selectedPaymentTotal : Number(paymentForm.amount);
    const validation = validatePayment(amount, payingCustomer.balance);
    if (!validation.ok) {
      return setNotice(
        validation.message.includes('bigger') ? t('overpayment') : t('invalidPayment'),
      );
    }

    const selectedItems = payableItems.filter((item) =>
      selectedPaymentEntries.includes(item.entry.id),
    );
    runSecureAction({
      title: t('confirmPaymentTitle'),
      message: t('confirmPaymentMessage')
        .replace('{name}', payingCustomer.customer.name)
        .replace('{amount}', formatCurrency(amount)),
      confirmLabel: t('savePayment'),
      onConfirm: async () => {
        await savePaymentAfterPin({ amount, selectedItems });
      },
    });
  }

  async function saveProduct(event: React.FormEvent) {
    event.preventDefault();
    if (!data || !repositoryRef.current) return;
    const name = productForm.name.trim();
    const price = Number(productForm.price);
    if (!name) return setNotice(t('required'));
    if (!Number.isFinite(price) || price <= 0) return setNotice(t('invalidPrice'));
    runSecureAction({
      title: productForm.id ? t('editProduct') : t('addProduct'),
      message: productForm.id
        ? t('confirmEditProduct').replace('{name}', name)
        : t('confirmAddProduct').replace('{name}', name),
      confirmLabel: t('save'),
      onConfirm: async () => {
        const existing = productForm.id
          ? data.products.find((product) => product.id === productForm.id)
          : undefined;
        const product = existing
          ? { ...existing, name, price: roundMoney(price), active: true, updatedAt: nowIso() }
          : createProduct(name, price);
        await repositoryRef.current!.upsertProduct(product);
        setProductForm({ name: '', price: '', id: '' });
        setShowProductModal(false);
        setNotice(t('saved'));
        await refresh();
      },
    });
  }

  function openProductModal(product?: Product) {
    setProductForm(
      product
        ? { id: product.id, name: product.name, price: String(product.price) }
        : { name: '', price: '', id: '' },
    );
    setShowProductModal(true);
  }

  function closeProductModal() {
    setProductForm({ name: '', price: '', id: '' });
    setShowProductModal(false);
  }

  async function saveBulkProducts(event: React.FormEvent) {
    event.preventDefault();
    if (!data || !repositoryRef.current) return;
    const items = bulkProductRows
      .map((row) => ({ name: row.name.trim(), price: Number(row.price) }))
      .filter((item) => item.name && Number.isFinite(item.price) && item.price > 0);
    if (!items.length) return setNotice(t('invalidBulkProducts'));

    runSecureAction({
      title: t('bulkAddProducts'),
      message: t('confirmBulkAddProducts').replace('{count}', String(items.length)),
      confirmLabel: t('saveAllDebt'),
      onConfirm: async () => {
        for (const item of items) {
          await repositoryRef.current!.upsertProduct(createProduct(item.name, item.price));
        }
        setBulkProductRows([{ name: '', price: '' }]);
        setShowBulkProductModal(false);
        setNotice(t('saved'));
        await refresh();
      },
    });
  }

  function openBulkProductAdd() {
    setBulkProductRows([{ name: '', price: '' }]);
    setShowBulkProductModal(true);
  }

  function updateBulkProductRow(index: number, next: Partial<{ name: string; price: string }>) {
    setBulkProductRows((current) =>
      current.map((row, rowIndex) => (rowIndex === index ? { ...row, ...next } : row)),
    );
  }

  function addBulkProductRow() {
    setBulkProductRows((current) => [...current, { name: '', price: '' }]);
  }

  function removeBulkProductRow(index: number) {
    setBulkProductRows((current) =>
      current.length === 1 ? current : current.filter((_, rowIndex) => rowIndex !== index),
    );
  }

  function openCustomerModal(customer: Customer) {
    setCustomerForm({ id: customer.id, name: customer.name, note: customer.note });
    setShowCustomerModal(true);
  }

  async function saveCustomer(event: React.FormEvent) {
    event.preventDefault();
    if (!data || !repositoryRef.current) return;
    const name = customerForm.name.trim();
    if (!name) return setNotice(t('required'));
    const customer = data.customers.find((item) => item.id === customerForm.id);
    if (!customer) return;
    runSecureAction({
      title: t('editPerson'),
      message: t('confirmEditPerson').replace('{name}', name),
      confirmLabel: t('save'),
      onConfirm: async () => {
        await repositoryRef.current!.upsertCustomer({
          ...customer,
          name,
          note: customerForm.note.trim(),
          updatedAt: nowIso(),
        });
        setShowCustomerModal(false);
        setCustomerForm({ id: '', name: '', note: '' });
        setNotice(t('saved'));
        await refresh();
      },
    });
  }

  function openLedgerModal(entryId: string) {
    if (!data) return;
    const entry = data.ledgerEntries.find((item) => item.id === entryId);
    if (!entry) return;
    setLedgerForm({
      id: entry.id,
      itemName: entry.itemName,
      quantity: String(entry.quantity),
      unitPrice: String(entry.unitPrice),
    });
    setShowLedgerModal(true);
  }

  async function saveLedgerEntry(event: React.FormEvent) {
    event.preventDefault();
    if (!data || !repositoryRef.current) return;
    const entry = data.ledgerEntries.find((item) => item.id === ledgerForm.id);
    if (!entry) return;
    const itemName = ledgerForm.itemName.trim();
    const quantity = Number(ledgerForm.quantity);
    const unitPrice = Number(ledgerForm.unitPrice);
    if (!itemName) return setNotice(t('required'));
    if (!Number.isFinite(quantity) || quantity <= 0) return setNotice(t('invalidQuantity'));
    if (!Number.isFinite(unitPrice) || unitPrice <= 0) return setNotice(t('invalidPrice'));

    runSecureAction({
      title: t('editDebtItem'),
      message: t('confirmEditDebtItem').replace('{name}', itemName),
      confirmLabel: t('save'),
      onConfirm: async () => {
        await repositoryRef.current!.updateLedgerEntry({
          ...entry,
          itemName,
          quantity: roundMoney(quantity),
          unitPrice: roundMoney(unitPrice),
          total: roundMoney(quantity * unitPrice),
        });
        setShowLedgerModal(false);
        setLedgerForm({ id: '', itemName: '', quantity: '', unitPrice: '' });
        setNotice(t('saved'));
        await refresh();
      },
    });
  }

  async function deleteLedgerEntry(entryId: string) {
    if (!data || !repositoryRef.current) return;
    const entry = data.ledgerEntries.find((item) => item.id === entryId);
    if (!entry) return;
    runSecureAction({
      title: t('deleteDebtItem'),
      message: t('confirmDeleteDebtItem').replace('{name}', entry.itemName),
      confirmLabel: t('delete'),
      onConfirm: async () => {
        await repositoryRef.current!.deleteLedgerEntry(entry.id);
        setNotice(t('saved'));
        await refresh();
      },
    });
  }

  async function deleteProduct(product: Product) {
    if (!data || !repositoryRef.current) return;
    runSecureAction({
      title: t('delete'),
      message: t('confirmDelete'),
      confirmLabel: t('delete'),
      onConfirm: async () => {
        await repositoryRef.current!.softDeleteProduct(product.id, nowIso());
        setNotice(t('productDeleted'));
        await refresh();
      },
    });
  }

  async function deleteCustomer(customerId: string) {
    if (!data || !repositoryRef.current) return;
    const summary = summaries.find((item) => item.customer.id === customerId);
    if (!summary) return;
    runSecureAction({
      title: t('deleteCustomer'),
      message: t('confirmDeleteCustomer').replace('{name}', summary.customer.name),
      confirmLabel: t('delete'),
      onConfirm: async () => {
        await repositoryRef.current!.deleteCustomer(summary.customer.id);
        if (selectedCustomerId === summary.customer.id) setSelectedCustomerId(null);
        if (payingCustomerId === summary.customer.id) closePaymentModal();
        if (quickDebtCustomerId === summary.customer.id) closeQuickDebt();
        setNotice(t('customerDeleted'));
        await refresh();
      },
    });
  }

  async function unlockWithPin(event: React.FormEvent) {
    event.preventDefault();
    if (!data) return;
    const ok = await verifyPin(pinInput, data.settings.pinHash);
    if (!ok) return setNotice(t('wrongPin'));
    setUnlockedUntil(Date.now() + getPinTimeoutMs(data.settings.pinTimeout));
    setUnlocked(true);
    setPinInput('');
  }

  async function updateSettings(nextSettings: AppSettings) {
    if (!repositoryRef.current) return;
    await repositoryRef.current.saveSettings(nextSettings);
    await refresh();
  }

  async function changeLanguage(languageCode: LanguageCode) {
    if (!data) return;
    await updateSettings({ ...data.settings, language: languageCode });
  }

  async function changeUiSize(uiSize: AppSettings['uiSize']) {
    if (!data) return;
    await updateSettings({ ...data.settings, uiSize });
  }

  async function changeBiometricEnabled(biometricEnabled: boolean) {
    if (!data) return;
    await updateSettings({ ...data.settings, biometricEnabled });
  }

  async function changePinTimeout(next: Partial<AppSettings['pinTimeout']>) {
    if (!data) return;
    const nextPinTimeout = {
      ...data.settings.pinTimeout,
      ...next,
      every: Math.max(1, Math.floor(Number(next.every ?? data.settings.pinTimeout.every) || 1)),
    };
    await updateSettings({
      ...data.settings,
      pinTimeout: nextPinTimeout,
    });
    if (unlocked) {
      setUnlockedUntil(Date.now() + getPinTimeoutMs(nextPinTimeout));
    }
  }

  async function changePin(event: React.FormEvent) {
    event.preventDefault();
    if (!data) return;
    if (!isValidPin(pinForm.next) || pinForm.next !== pinForm.confirm) {
      return setNotice(t('wrongPin'));
    }
    await updateSettings({
      ...data.settings,
      pinHash: await hashPin(pinForm.next),
      pinUpdatedAt: nowIso(),
    });
    setPinForm({ next: '', confirm: '' });
    setNotice(t('saved'));
  }

  async function saveStoreName(event: React.FormEvent) {
    event.preventDefault();
    if (!data) return;
    await updateSettings({
      ...data.settings,
      storeName: (storeNameInput ?? data.settings.storeName).trim() || DEFAULT_STORE_NAME,
      ownerName: (ownerNameInput ?? data.settings.ownerName).trim(),
    });
    setStoreNameInput(null);
    setOwnerNameInput(null);
    setNotice(t('saved'));
  }

  async function changeAutoBackup(next: Partial<AutoBackupSettings>) {
    if (!data) return;
    await updateSettings({
      ...data.settings,
      autoBackup: {
        ...data.settings.autoBackup,
        ...next,
        lastAttemptAt:
          next.every !== undefined || next.unit !== undefined || next.enabled !== undefined
            ? null
            : data.settings.autoBackup.lastAttemptAt,
      },
    });
  }

  const runAutoBackupNow = useCallback(async (currentData: AppData, showMessage: boolean) => {
    if (!repositoryRef.current || autoBackupRunningRef.current) return false;
    autoBackupRunningRef.current = true;
    const settings = currentData.settings.autoBackup;
    const timestamp = nowIso();
    try {
      const json = serializeBackup(currentData);
      const filename = makeDetailedBackupFilename(currentData);
      let result: BackupWriteResult;
      if (Capacitor.isNativePlatform()) {
        result = await writeNativeBackup(json, filename);
      } else {
        localStorage.setItem('suki-track:auto-backup', json);
        localStorage.setItem('suki-track:auto-backup-filename', filename);
        downloadBrowserBackup(json, filename);
        result = {
          filename,
          path: filename,
          location: 'browser',
        };
      }
      await repositoryRef.current.saveSettings({
        ...currentData.settings,
        autoBackup: {
          ...settings,
          lastRunAt: timestamp,
          lastAttemptAt: timestamp,
          lastFileName: result.filename,
          lastUri: result.uri ?? null,
          lastLocation: result.location,
          lastError: null,
        },
      });
      setData(await repositoryRef.current.load());
      if (showMessage) setNotice(t('autoBackupOk'));
      return true;
    } catch (error) {
      await repositoryRef.current.saveSettings({
        ...currentData.settings,
        autoBackup: {
          ...settings,
          lastAttemptAt: timestamp,
          lastUri: null,
          lastError: compactError(error),
        },
      });
      setData(await repositoryRef.current.load());
      setNotice(compactError(error));
      return false;
    } finally {
      autoBackupRunningRef.current = false;
    }
  }, [t]);

  async function writeBackupFile(currentData: AppData, shareAfterWrite: boolean) {
    const json = serializeBackup(currentData);
    const filename = makeDetailedBackupFilename(currentData);
    if (Capacitor.isNativePlatform()) {
      const result = await writeNativeBackup(json, filename);
      if (shareAfterWrite) {
        await Share.share({
          title: t('exportBackup'),
          text: t('backup'),
          url: result.uri,
        });
      }
      return;
    }

    if (shareAfterWrite) {
      downloadBrowserBackup(json, filename);
    } else {
      localStorage.setItem('suki-track:auto-backup', json);
      localStorage.setItem('suki-track:auto-backup-filename', filename);
    }
  }

  useEffect(() => {
    if (!data?.settings.autoBackup.enabled) return undefined;

    const runIfDue = async () => {
      if (!repositoryRef.current || autoBackupRunningRef.current) return;
      const settings = data.settings.autoBackup;
      const lastBackupTime = settings.lastRunAt ?? settings.lastAttemptAt;
      const lastRunTime = lastBackupTime ? new Date(lastBackupTime).getTime() : 0;
      const currentTime = new Date().getTime();
      const due =
        !settings.lastFileName ||
        Boolean(settings.lastError) ||
        !lastRunTime || currentTime - lastRunTime >= getAutoBackupIntervalMs(settings);
      if (!due) return;

      await runAutoBackupNow(data, false);
    };
    void runIfDue();
    const timer = window.setInterval(
      runIfDue,
      Math.min(60_000, getAutoBackupIntervalMs(data.settings.autoBackup)),
    );
    return () => window.clearInterval(timer);
  }, [data, runAutoBackupNow]);

  async function exportBackup() {
    if (!data) return;
    await writeBackupFile(data, true);
  }

  async function importBackup(file: File | undefined) {
    if (!file || !repositoryRef.current) return;
    setConfirmDialog({
      title: t('importBackup'),
      message: `${t('importWarning')} ${t('confirmImport')}`,
      confirmLabel: t('importBackup'),
      onConfirm: async () => {
        const imported = await parseBackup(await file.text());
        await repositoryRef.current!.replaceAll(imported);
        setNotice(t('imported'));
        setUnlocked(false);
        await refresh();
        if (fileInputRef.current) fileInputRef.current.value = '';
      },
    });
  }

  async function printReceipt(customerId: string) {
    if (!data) return;
    const summary = summaries.find((item) => item.customer.id === customerId);
    if (!summary) return;

    try {
      setNotice(t('generatingPdf'));
      const doc = createCustomerReceiptPdf(data, customerId);
      const filename = makeReceiptFilename(summary.customer.name, data.settings.storeName);
      if (Capacitor.isNativePlatform()) {
        const base64 = doc.output('datauristring').split(',')[1];
        const uri = await writeNativeReceipt(base64, filename);
        await Share.share({
          title: t('receipt'),
          text: summary.customer.name,
          url: uri,
        });
      } else {
        doc.save(filename);
      }
      setNotice(t('pdfReady'));
    } catch (error) {
      setNotice(error instanceof Error ? error.message : String(error));
    }
  }

  function switchTab(nextTab: Tab) {
    setTab(nextTab);
  }

  function openProtectedTab(nextTab: Tab) {
    switchTab(nextTab);
    if (nextTab !== 'products' && nextTab !== 'trends' && nextTab !== 'settings') return;
    if (unlockedUntil > Date.now()) {
      setUnlocked(true);
      return;
    }
    setUnlocked(false);
  }

  function openUpdate(update: UpdateManifest) {
    window.open(update.apkUrl, '_blank', 'noopener,noreferrer');
  }

  function skipUpdate(update: UpdateManifest) {
    localStorage.setItem('suki-track:skip-update-code', String(update.versionCode));
    setAvailableUpdate(null);
  }

  if (!data) {
    return (
      <main className="loading">
        <AnimatedShopIcon />
        <span>{t('loading')}</span>
      </main>
    );
  }

  const appClass = `app ${data.settings.uiSize === 'large' ? 'large-text' : ''}`;

  return (
    <div className={appClass}>
      <header className="app-header">
        <AnimatedShopIcon />
        <div className="brand-copy">
          <h1>{data.settings.storeName}</h1>
        </div>
        <button
          type="button"
          className={tab === 'settings' ? 'header-settings-button active' : 'header-settings-button'}
          onClick={() => openProtectedTab('settings')}
          aria-label={t('navSettings')}
        >
          <Settings size={21} />
        </button>
      </header>

      {notice && (
        <div className="feedback-backdrop" role="status" aria-live="polite">
          <div className="notice">
            <span className="notice-icon" aria-hidden="true">
              <Check size={18} />
            </span>
            <span>{notice}</span>
            <button type="button" className="icon-button close-button" onClick={() => setNotice('')}>
              <X size={20} />
            </button>
          </div>
        </div>
      )}

      <main className="content" key={tab}>
        {tab === 'utang' && (
          <section className="screen-grid">
            <div className="panel summary-panel">
              <div className="summary-copy">
                <p className="label">{t('totalActiveDebt')}</p>
                <strong className="big-total">{formatCurrency(totalActiveDebt)}</strong>
                <p className="muted">
                  {activeSummaries.length} {t('activeCustomers').toLowerCase()}
                </p>
              </div>
              <div className="summary-visual">
                <AnimatedPeopleDebtIcon />
              </div>
              <button
                type="button"
                className="primary-button dashboard-add-button"
                onClick={() => setShowDebtModal(true)}
              >
                <Plus size={22} />
                {t('addDebt')}
              </button>
            </div>

            <section className="panel wide-panel list-panel">
              <h2>{t('activeCustomers')}</h2>
              <CustomerList
                summaries={paginate(activeSummaries, activePage, PAGE_SIZE)}
                emptyText={t('noUtangEmpty')}
                emptyKind="utang"
                onPay={openPayment}
                onView={(id) => setSelectedCustomerId(id)}
                onAddDebt={openQuickDebt}
                onPrint={printReceipt}
                t={t}
              />
              <Pagination
                totalItems={activeSummaries.length}
                currentPage={activePage}
                onPageChange={(page) => setPage('active', page, activeSummaries.length)}
                t={t}
              />
            </section>
          </section>
        )}

        {tab === 'people' && (
          <section className="panel list-panel">
            <h2>{t('allCustomers')}</h2>
            <div className="search-row people-search">
              <Search size={22} />
              <input
                value={peopleSearch}
                placeholder={t('searchPeople')}
                onChange={(event) => updatePeopleSearch(event.target.value)}
              />
            </div>
              <CustomerList
                summaries={paginate(filteredPeopleSummaries, peoplePage, PAGE_SIZE)}
                emptyText={t('noPeopleEmpty')}
                emptyKind="people"
                onPay={openPayment}
                onView={(id) => setSelectedCustomerId(id)}
                onAddDebt={openQuickDebt}
                onPrint={printReceipt}
                onEdit={openCustomerModal}
                onDelete={deleteCustomer}
                t={t}
              />
            <Pagination
              totalItems={filteredPeopleSummaries.length}
              currentPage={peoplePage}
              onPageChange={(page) =>
                setPage('people', page, filteredPeopleSummaries.length)
              }
              t={t}
            />
          </section>
        )}

        {tab === 'products' && (
          <ProtectedArea
            unlocked={unlocked}
            pinInput={pinInput}
            setPinInput={setPinInput}
            onUnlock={unlockWithPin}
            pinHint={pinHint}
            t={t}
          >
            <section className="screen-grid">
              <section className="panel form-panel product-panel">
                <div className="product-hero">
                  <button
                    type="button"
                    className="primary-button product-add-mini"
                    onClick={() => openProductModal()}
                  >
                    <Plus size={20} />
                    {t('addProduct')}
                  </button>
                  <button
                    type="button"
                    className="secondary-button product-add-mini"
                    onClick={openBulkProductAdd}
                  >
                    <Plus size={20} />
                    {t('bulkAddProducts')}
                  </button>
                </div>
              </section>

              <section className="panel wide-panel product-panel">
                <h2>{t('products')}</h2>
                <div className="search-row">
                  <Search size={24} />
                  <input
                    value={search}
                    placeholder={t('search')}
                    onChange={(event) => updateSearch(event.target.value)}
                  />
                </div>
                <ProductList
                  products={paginate(filteredProducts, productsPage, PAGE_SIZE)}
                  emptyText={t('noProductsEmpty')}
                  emptyKind="products"
                  onEdit={openProductModal}
                  onDelete={deleteProduct}
                  t={t}
                />
                <Pagination
                  totalItems={filteredProducts.length}
                  currentPage={productsPage}
                  onPageChange={(page) => setPage('products', page, filteredProducts.length)}
                  t={t}
                />
              </section>
            </section>
          </ProtectedArea>
        )}

        {tab === 'trends' && (
          <ProtectedArea
            unlocked={unlocked}
            pinInput={pinInput}
            setPinInput={setPinInput}
            onUnlock={unlockWithPin}
            pinHint={pinHint}
            t={t}
          >
            <section className="analytics-screen">
              <ProductTrendPanel data={data} t={t} />
            </section>
          </ProtectedArea>
        )}

        {tab === 'history' && (
          <section className="screen-grid">
            <section className="panel wide-panel history-panel">
              <div className="record-toolbar">
                <div>
                  <h2>{t('itemLogs')}</h2>
                  <p className="muted">
                    {t('selectedRecords')}: {formatDateKeyLabel(selectedRecordDate)}
                  </p>
                </div>
                <div className="date-buttons">
                  <button
                    type="button"
                    className={
                      selectedRecordDate === todayKey()
                        ? 'secondary-button selected'
                        : 'secondary-button'
                    }
                    onClick={() => {
                      setShowCalendar(false);
                      selectRecordDate(todayKey());
                    }}
                  >
                    {t('today')}
                  </button>
                  <button
                    type="button"
                    className={
                      selectedRecordDate === yesterdayKey()
                        ? 'secondary-button selected'
                        : 'secondary-button'
                    }
                    onClick={() => {
                      setShowCalendar(false);
                      selectRecordDate(yesterdayKey());
                    }}
                  >
                    {t('yesterday')}
                  </button>
                  <button
                    type="button"
                    className={showCalendar ? 'secondary-button selected' : 'secondary-button'}
                    onClick={() => setShowCalendar((value) => !value)}
                  >
                    <CalendarDays size={20} />
                    {t('calendar')}
                  </button>
                </div>
              </div>
              {showCalendar && (
                <RecordCalendar
                  days={calendarDays}
                  monthLabel={formatMonthLabel(calendarMonth)}
                  onPreviousMonth={() => setCalendarMonth((month) => shiftMonth(month, -1))}
                  onNextMonth={() => setCalendarMonth((month) => shiftMonth(month, 1))}
                  onSelectDate={selectRecordDate}
                />
              )}
              <ActivityList
                logs={paginate(selectedActivityLogs, logsPage, PAGE_SIZE)}
                emptyText={t('noHistoryEmpty')}
              />
              <Pagination
                totalItems={selectedActivityLogs.length}
                currentPage={logsPage}
                onPageChange={(page) => setPage('logs', page, selectedActivityLogs.length)}
                t={t}
              />
            </section>
            <section className="panel paid-panel">
              <h2>{t('paidCustomers')}</h2>
              <CustomerList
                summaries={paginate(paidSummaries, paidPage, PAGE_SIZE)}
                emptyText={t('noPaidEmpty')}
                emptyKind="paid"
                onPay={openPayment}
                onView={(id) => setSelectedCustomerId(id)}
                onAddDebt={openQuickDebt}
                onPrint={printReceipt}
                t={t}
              />
              <Pagination
                totalItems={paidSummaries.length}
                currentPage={paidPage}
                onPageChange={(page) => setPage('paid', page, paidSummaries.length)}
                t={t}
              />
            </section>
          </section>
        )}

        {tab === 'settings' && (
          <ProtectedArea
            unlocked={unlocked}
            pinInput={pinInput}
            setPinInput={setPinInput}
            onUnlock={unlockWithPin}
            pinHint={pinHint}
            t={t}
          >
            <section className="screen-grid">
              <form className="panel form-panel settings-panel" onSubmit={saveStoreName}>
                <h2>{t('storeName')}</h2>
                <label>
                  {t('storeName')}
                  <input
                    value={storeNameInput ?? data.settings.storeName}
                    onChange={(event) => setStoreNameInput(event.target.value)}
                    placeholder={DEFAULT_STORE_NAME}
                  />
                </label>
                <label>
                  {t('ownerName')}
                  <input
                    value={ownerNameInput ?? data.settings.ownerName}
                    onChange={(event) => setOwnerNameInput(event.target.value)}
                    placeholder={t('ownerNamePlaceholder')}
                  />
                </label>
                <button className="primary-button" type="submit">
                  <Check size={24} />
                  {t('saveStoreName')}
                </button>
              </form>

              <div className="panel form-panel settings-panel">
                <h2>{t('language')}</h2>
                <div className="choice-grid">
                  {languages.map((languageOption) => (
                    <button
                      type="button"
                      key={languageOption.code}
                      className={
                        languageOption.code === language
                          ? 'choice-button selected'
                          : 'choice-button'
                      }
                      onClick={() => changeLanguage(languageOption.code)}
                    >
                      {languageOption.label}
                    </button>
                  ))}
                </div>
                <h2>{t('uiSize')}</h2>
                <div className="button-row">
                  <button
                    type="button"
                    className={
                      data.settings.uiSize === 'normal'
                        ? 'secondary-button selected'
                        : 'secondary-button'
                    }
                    onClick={() => changeUiSize('normal')}
                  >
                    {t('normal')}
                  </button>
                  <button
                    type="button"
                    className={
                      data.settings.uiSize === 'large'
                        ? 'secondary-button selected'
                        : 'secondary-button'
                    }
                    onClick={() => changeUiSize('large')}
                  >
                    {t('large')}
                  </button>
                </div>
                <h2>{t('security')}</h2>
                <label className="toggle-row">
                  <input
                    type="checkbox"
                    checked={data.settings.biometricEnabled}
                    onChange={(event) => void changeBiometricEnabled(event.target.checked)}
                  />
                  {t('biometricSetting')}
                </label>
                <h2>{t('pinTimeout')}</h2>
                <div className="two-columns">
                  <label>
                    {t('every')}
                    <input
                      type="number"
                      min="1"
                      step="1"
                      value={data.settings.pinTimeout.every}
                      placeholder="10"
                      onChange={(event) =>
                        void changePinTimeout({ every: Number(event.target.value) || 1 })
                      }
                    />
                  </label>
                  <label>
                    {t('unit')}
                    <select
                      value={data.settings.pinTimeout.unit}
                      onChange={(event) =>
                        void changePinTimeout({
                          unit: event.target.value as AutoBackupSettings['unit'],
                        })
                      }
                    >
                      <option value="minutes">{t('minutes')}</option>
                      <option value="hours">{t('hours')}</option>
                      <option value="days">{t('days')}</option>
                    </select>
                  </label>
                </div>
              </div>

              <form className="panel form-panel settings-panel" onSubmit={changePin}>
                <h2>{t('changePin')}</h2>
                <p className="pin-note">{pinHint}</p>
                <label>
                  {t('newPin')}
                  <input
                    type="password"
                    inputMode="numeric"
                    maxLength={4}
                    placeholder={t('pinPlaceholder')}
                    value={pinForm.next}
                    onChange={(event) =>
                      setPinForm({ ...pinForm, next: event.target.value })
                    }
                  />
                </label>
                <label>
                  {t('confirmPin')}
                  <input
                    type="password"
                    inputMode="numeric"
                    maxLength={4}
                    placeholder={t('confirmPinPlaceholder')}
                    value={pinForm.confirm}
                    onChange={(event) =>
                      setPinForm({ ...pinForm, confirm: event.target.value })
                    }
                  />
                </label>
                <button className="primary-button" type="submit">
                  <Lock size={24} />
                  {t('save')}
                </button>
              </form>

              <div className="panel form-panel settings-panel">
                <h2>{t('backup')}</h2>
                <p className="muted">{t('importWarning')}</p>
                <button type="button" className="primary-button" onClick={exportBackup}>
                  <Download size={24} />
                  {t('exportBackup')}
                </button>
                <button
                  type="button"
                  className="secondary-button"
                  onClick={() => fileInputRef.current?.click()}
                >
                  <Upload size={24} />
                  {t('importBackup')}
                </button>
                <input
                  ref={fileInputRef}
                  className="hidden-input"
                  type="file"
                  accept="application/json,.json"
                  onChange={(event) => importBackup(event.target.files?.[0])}
                />
              </div>

              <div className="panel form-panel settings-panel">
                <h2>{t('autoBackup')}</h2>
                <label className="toggle-row">
                  <input
                    type="checkbox"
                    checked={data.settings.autoBackup.enabled}
                    onChange={(event) =>
                      void changeAutoBackup({ enabled: event.target.checked })
                    }
                  />
                  {t('autoBackupOn')}
                </label>
                <div className="two-columns">
                  <label>
                    {t('every')}
                    <input
                      type="number"
                      min="1"
                      step="1"
                      value={data.settings.autoBackup.every}
                      placeholder="8"
                      onChange={(event) =>
                        void changeAutoBackup({ every: Number(event.target.value) || 1 })
                      }
                    />
                  </label>
                  <label>
                    {t('unit')}
                    <select
                      value={data.settings.autoBackup.unit}
                      onChange={(event) =>
                        void changeAutoBackup({
                          unit: event.target.value as AutoBackupSettings['unit'],
                        })
                      }
                    >
                      <option value="minutes">{t('minutes')}</option>
                      <option value="hours">{t('hours')}</option>
                      <option value="days">{t('days')}</option>
                    </select>
                  </label>
                </div>
                <div className="backup-status-grid">
                  <span>{t('lastBackup')}</span>
                  <strong>{formatTinyDateTime(data.settings.autoBackup.lastRunAt)}</strong>
                  <span>{t('fileName')}</span>
                  <strong>{data.settings.autoBackup.lastFileName ?? '-'}</strong>
                  <span>{t('backupLocation')}</span>
                  <strong>{getBackupLocationLabel(data.settings.autoBackup.lastLocation, t)}</strong>
                  <span>{t('backupStatus')}</span>
                  <strong>
                    {data.settings.autoBackup.lastError
                      ? `${t('autoBackupFailed')}: ${data.settings.autoBackup.lastError}`
                      : data.settings.autoBackup.lastFileName
                        ? t('autoBackupOk')
                        : '-'}
                  </strong>
                </div>
                <button
                  type="button"
                  className="primary-button"
                  onClick={() => void runAutoBackupNow(data, true)}
                >
                  <Download size={22} />
                  {t('runBackupNow')}
                </button>
              </div>

              <div className="panel form-panel settings-panel">
                <h2>{t('about')}</h2>
                <p className="credit-line">
                  <span>{t('developer')}</span>
                  <strong>{DEVELOPER_NAME}</strong>
                </p>
              </div>
            </section>
          </ProtectedArea>
        )}
      </main>

      {selectedCustomer && (
        <CustomerDetail
          summary={selectedCustomer}
          data={data}
          onClose={() => setSelectedCustomerId(null)}
          onPay={openPayment}
          onPrint={printReceipt}
          onEditDebt={openLedgerModal}
          onDeleteDebt={deleteLedgerEntry}
          t={t}
        />
      )}

      {payingCustomer && (
        <Modal title={t('addPayment')} onClose={closePaymentModal}>
          <form className="modal-form" onSubmit={savePayment}>
            <p className="modal-balance">
              {payingCustomer.customer.name}: {formatCurrency(payingCustomer.balance)}
            </p>
            <div className="payable-list">
              <p className="label">{t('chooseItemsToPay')}</p>
              {payableItems.length ? (
                <>
                  {visiblePayableItems.map((item) => (
                    <label className="payable-item" key={item.entry.id}>
                      <input
                        type="checkbox"
                        checked={selectedPaymentEntries.includes(item.entry.id)}
                        onChange={() => togglePaymentItem(item.entry.id)}
                      />
                      <span>
                        <strong>{item.entry.itemName}</strong>
                        <small>
                          {item.entry.quantity} x {formatCurrency(item.entry.unitPrice)}
                        </small>
                      </span>
                      <b>{formatCurrency(item.remaining)}</b>
                    </label>
                  ))}
                  <Pagination
                    totalItems={payableItems.length}
                    currentPage={paymentPage}
                    onPageChange={setPaymentItemsPage}
                    t={t}
                  />
                </>
              ) : (
                <p className="muted">{t('noItemsToPay')}</p>
              )}
            </div>
            {selectedPaymentTotal > 0 && (
              <div className="total-row">
                <span>{t('selectedTotal')}</span>
                <strong>{formatCurrency(selectedPaymentTotal)}</strong>
              </div>
            )}
            <label>
              {t('amountPaid')}
              <input
                type="number"
                min="0"
                step="0.01"
                value={paymentForm.amount}
                disabled={selectedPaymentTotal > 0}
                placeholder={
                  selectedPaymentTotal > 0
                    ? formatCurrency(selectedPaymentTotal)
                    : t('amountPlaceholder')
                }
                onChange={(event) =>
                  setPaymentForm({ ...paymentForm, amount: event.target.value })
                }
              />
            </label>
            <label className="payment-note-field">
              {t('paymentNote')}
              <input
                value={paymentForm.note}
                placeholder={t('paymentNotePlaceholder')}
                onChange={(event) =>
                  setPaymentForm({ ...paymentForm, note: event.target.value })
                }
              />
            </label>
            <button className="primary-button" type="submit">
              <CircleDollarSign size={24} />
              {t('savePayment')}
            </button>
          </form>
        </Modal>
      )}

      {showDebtModal && (
        <Modal title={t('addDebt')} onClose={closeDebtModal}>
          <div className="modal-form">
            <CustomerNameField
              label={t('customerName')}
              placeholder={t('customerPlaceholder')}
              customers={data.customers}
              value={debtForm.customerName}
              onChange={(customerName) => setDebtForm({ ...debtForm, customerName })}
            />

            <form className="cart-entry-form" onSubmit={addDebtCartItem}>
              <ProductNameField
                label={t('itemName')}
                placeholder={t('itemPlaceholder')}
                products={activeProducts}
                value={debtForm.itemName}
                isReady={Boolean(debtForm.itemName.trim()) && debtTotal > 0}
                onChange={(itemName) => setDebtForm({ ...debtForm, itemName })}
              />

              <div className="two-columns">
                <label>
                  {t('quantity')}
                  <input
                    type="number"
                    min="1"
                    step="1"
                    value={debtForm.quantity}
                    onChange={(event) =>
                      setDebtForm({ ...debtForm, quantity: event.target.value })
                    }
                  />
                </label>
                <label>
                  {t('price')}
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={chosenProduct ? chosenProduct.price : debtForm.quickPrice}
                    disabled={Boolean(chosenProduct)}
                    onChange={(event) =>
                      setDebtForm({ ...debtForm, quickPrice: event.target.value })
                    }
                  />
                </label>
              </div>

              {!chosenProduct && debtForm.itemName.trim() && (
                <p className="helper">{t('quickAddProduct')}</p>
              )}

              <div className="total-row">
                <span>{t('total')}</span>
                <strong>{formatCurrency(debtTotal || 0)}</strong>
              </div>
              <button
                className={
                  debtForm.itemName.trim() && debtTotal > 0
                    ? 'secondary-button add-item-button ready'
                    : 'secondary-button add-item-button'
                }
                type="submit"
              >
                <Plus size={20} />
                {t('addItem')}
              </button>
            </form>

            <CartList
              items={debtCart}
              emptyText={t('noCartItems')}
              onRemove={(id) =>
                setDebtCart((current) => current.filter((item) => item.id !== id))
              }
            />
            <div className="total-row">
              <span>{t('selectedTotal')}</span>
              <strong>{formatCurrency(debtCartTotal)}</strong>
            </div>
            <button
              className={
                debtCart.length
                  ? 'primary-button save-all-button ready'
                  : 'primary-button save-all-button'
              }
              type="button"
              disabled={!debtCart.length}
              onClick={() => void saveDebt()}
            >
              <Check size={22} />
              {t('saveAllDebt')}
            </button>
          </div>
        </Modal>
      )}

      {quickDebtCustomer && (
        <Modal title={`${t('addDebtForCustomer')}: ${quickDebtCustomer.customer.name}`} onClose={closeQuickDebt}>
          <div className="modal-form">
            <p className="modal-balance">
              {t('balance')}: {formatCurrency(quickDebtCustomer.balance)}
            </p>
            <form className="cart-entry-form" onSubmit={addQuickDebtCartItem}>
              <ProductNameField
                label={t('itemName')}
                placeholder={t('itemPlaceholder')}
                products={activeProducts}
                value={quickDebtForm.itemName}
                isReady={Boolean(quickDebtForm.itemName.trim()) && quickDebtTotal > 0}
                onChange={(itemName) =>
                  setQuickDebtForm({ ...quickDebtForm, itemName })
                }
              />
              <div className="two-columns">
                <label>
                  {t('quantity')}
                  <input
                    type="number"
                    min="1"
                    step="1"
                    value={quickDebtForm.quantity}
                    onChange={(event) =>
                      setQuickDebtForm({ ...quickDebtForm, quantity: event.target.value })
                    }
                  />
                </label>
                <label>
                  {t('price')}
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={
                      quickChosenProduct ? quickChosenProduct.price : quickDebtForm.quickPrice
                    }
                    disabled={Boolean(quickChosenProduct)}
                    onChange={(event) =>
                      setQuickDebtForm({ ...quickDebtForm, quickPrice: event.target.value })
                    }
                  />
                </label>
              </div>
              {!quickChosenProduct && quickDebtForm.itemName.trim() && (
                <p className="helper">{t('quickAddProduct')}</p>
              )}
              <div className="total-row">
                <span>{t('total')}</span>
                <strong>{formatCurrency(quickDebtTotal || 0)}</strong>
              </div>
              <button
                className={
                  quickDebtForm.itemName.trim() && quickDebtTotal > 0
                    ? 'secondary-button add-item-button ready'
                    : 'secondary-button add-item-button'
                }
                type="submit"
              >
                <Plus size={20} />
                {t('addItem')}
              </button>
            </form>
            <CartList
              items={quickDebtCart}
              emptyText={t('noCartItems')}
              onRemove={(id) =>
                setQuickDebtCart((current) => current.filter((item) => item.id !== id))
              }
            />
            <div className="total-row">
              <span>{t('selectedTotal')}</span>
              <strong>{formatCurrency(quickDebtCartTotal)}</strong>
            </div>
            <button
              className={
                quickDebtCart.length
                  ? 'primary-button save-all-button ready'
                  : 'primary-button save-all-button'
              }
              type="button"
              disabled={!quickDebtCart.length}
              onClick={() => void saveQuickDebt()}
            >
              <Check size={22} />
              {t('saveAllDebt')}
            </button>
          </div>
        </Modal>
      )}

      {showProductModal && (
        <Modal title={productForm.id ? t('edit') : t('addProduct')} onClose={closeProductModal}>
          <form className="modal-form" onSubmit={saveProduct}>
            <label>
              {t('itemName')}
              <input
                value={productForm.name}
                placeholder={t('itemPlaceholder')}
                onChange={(event) =>
                  setProductForm({ ...productForm, name: event.target.value })
                }
              />
            </label>
            <label>
              {t('price')}
              <input
                type="number"
                min="0"
                step="0.01"
                value={productForm.price}
                placeholder="Pananglitan: 12.00"
                onChange={(event) =>
                  setProductForm({ ...productForm, price: event.target.value })
                }
              />
            </label>
            <div className="button-row">
              <button className="primary-button" type="submit">
                <Check size={22} />
                {t('save')}
              </button>
              <button type="button" className="secondary-button" onClick={closeProductModal}>
                {t('cancel')}
              </button>
            </div>
          </form>
        </Modal>
      )}

      {showBulkProductModal && (
        <Modal
          title={t('bulkAddProducts')}
          onClose={() => setShowBulkProductModal(false)}
        >
          <form className="modal-form" onSubmit={saveBulkProducts}>
            <div className="bulk-product-rows">
              <span className="label">{t('bulkProductsLabel')}</span>
              {bulkProductRows.map((row, index) => (
                <div className="bulk-product-row" key={index}>
                  <input
                    value={row.name}
                    placeholder={t('itemName')}
                    onChange={(event) =>
                      updateBulkProductRow(index, { name: event.target.value })
                    }
                  />
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={row.price}
                    placeholder={t('price')}
                    onChange={(event) =>
                      updateBulkProductRow(index, { price: event.target.value })
                    }
                  />
                  <button
                    type="button"
                    className="icon-button close-button"
                    onClick={() => removeBulkProductRow(index)}
                    aria-label={t('delete')}
                  >
                    <X size={18} />
                  </button>
                </div>
              ))}
              <button type="button" className="secondary-button" onClick={addBulkProductRow}>
                <Plus size={20} />
                {t('addItem')}
              </button>
            </div>
            <div className="button-row">
              <button className="primary-button" type="submit">
                <Check size={22} />
                {t('saveAllDebt')}
              </button>
              <button
                type="button"
                className="secondary-button"
                onClick={() => setShowBulkProductModal(false)}
              >
                {t('cancel')}
              </button>
            </div>
          </form>
        </Modal>
      )}

      {showCustomerModal && (
        <Modal title={t('editPerson')} onClose={() => setShowCustomerModal(false)}>
          <form className="modal-form" onSubmit={saveCustomer}>
            <label>
              {t('customerName')}
              <input
                value={customerForm.name}
                placeholder={t('customerPlaceholder')}
                onChange={(event) =>
                  setCustomerForm({ ...customerForm, name: event.target.value })
                }
              />
            </label>
            <label>
              {t('paymentNote')}
              <input
                value={customerForm.note}
                placeholder={t('paymentNotePlaceholder')}
                onChange={(event) =>
                  setCustomerForm({ ...customerForm, note: event.target.value })
                }
              />
            </label>
            <div className="button-row">
              <button className="primary-button" type="submit">
                <Check size={22} />
                {t('save')}
              </button>
              <button
                type="button"
                className="secondary-button"
                onClick={() => setShowCustomerModal(false)}
              >
                {t('cancel')}
              </button>
            </div>
          </form>
        </Modal>
      )}

      {showLedgerModal && (
        <Modal title={t('editDebtItem')} onClose={() => setShowLedgerModal(false)}>
          <form className="modal-form" onSubmit={saveLedgerEntry}>
            <label>
              {t('itemName')}
              <input
                value={ledgerForm.itemName}
                onChange={(event) =>
                  setLedgerForm({ ...ledgerForm, itemName: event.target.value })
                }
              />
            </label>
            <div className="two-columns">
              <label>
                {t('quantity')}
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={ledgerForm.quantity}
                  onChange={(event) =>
                    setLedgerForm({ ...ledgerForm, quantity: event.target.value })
                  }
                />
              </label>
              <label>
                {t('price')}
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={ledgerForm.unitPrice}
                  onChange={(event) =>
                    setLedgerForm({ ...ledgerForm, unitPrice: event.target.value })
                  }
                />
              </label>
            </div>
            <div className="button-row">
              <button className="primary-button" type="submit">
                <Check size={22} />
                {t('save')}
              </button>
              <button
                type="button"
                className="secondary-button"
                onClick={() => setShowLedgerModal(false)}
              >
                {t('cancel')}
              </button>
            </div>
          </form>
        </Modal>
      )}

      {confirmDialog && (
        <ConfirmDialog
          dialog={confirmDialog}
          cancelLabel={t('cancel')}
          pinLabel={t('pin')}
          wrongPinLabel={t('wrongPin')}
          t={t}
          onCancel={() => {
            if (fileInputRef.current) fileInputRef.current.value = '';
            setConfirmDialog(null);
          }}
          onConfirm={async () => {
            try {
              await confirmDialog.onConfirm();
            } catch (error) {
              setNotice(error instanceof Error ? error.message : String(error));
            } finally {
              if (fileInputRef.current) fileInputRef.current.value = '';
              setConfirmDialog(null);
            }
          }}
        />
      )}

      {availableUpdate && (
        <Modal
          title="Update available"
          onClose={() => {
            if (!availableUpdate.required) skipUpdate(availableUpdate);
          }}
        >
          <div className="update-content">
            <p>
              A new SUKI TRACK version is ready: <strong>v{availableUpdate.version}</strong>
            </p>
            {availableUpdate.notes && <p className="muted">{availableUpdate.notes}</p>}
            <p className="muted">
              Current version: v{CURRENT_APP_VERSION} ({CURRENT_APP_VERSION_CODE})
            </p>
            <div className="button-row">
              {!availableUpdate.required && (
                <button
                  type="button"
                  className="secondary-button"
                  onClick={() => skipUpdate(availableUpdate)}
                >
                  Later
                </button>
              )}
              <button
                type="button"
                className="primary-button"
                onClick={() => openUpdate(availableUpdate)}
              >
                <Download size={20} />
                Update Now
              </button>
            </div>
          </div>
        </Modal>
      )}

      <nav className="bottom-nav" aria-label="Main navigation">
        <NavButton
          icon={<BookOpen />}
          label={t('navUtang')}
          active={tab === 'utang'}
          onClick={() => openProtectedTab('utang')}
        />
        <NavButton
          icon={<Users />}
          label={t('navPeople')}
          active={tab === 'people'}
          onClick={() => openProtectedTab('people')}
        />
        <NavButton
          icon={<Package />}
          label={t('navProducts')}
          active={tab === 'products'}
          onClick={() => openProtectedTab('products')}
        />
        <NavButton
          icon={<TrendingUp />}
          label={t('navTrends')}
          active={tab === 'trends'}
          onClick={() => openProtectedTab('trends')}
        />
        <NavButton
          icon={<FileClock />}
          label={t('navHistory')}
          active={tab === 'history'}
          onClick={() => openProtectedTab('history')}
        />
      </nav>
    </div>
  );
}

function CustomerList({
  summaries,
  emptyText,
  emptyKind,
  onPay,
  onView,
  onAddDebt,
  onPrint,
  onEdit,
  onDelete,
  t,
}: {
  summaries: CustomerSummary[];
  emptyText: string;
  emptyKind: EmptyKind;
  onPay: (id: string) => void;
  onView: (id: string) => void;
  onAddDebt: (customerId: string) => void;
  onPrint: (id: string) => void;
  onEdit?: (customer: Customer) => void;
  onDelete?: (id: string) => void;
  t: ReturnType<typeof getTranslator>;
}) {
  if (!summaries.length) return <EmptyState kind={emptyKind} message={emptyText} />;
  return (
    <div className="list">
      {summaries.map((summary) => {
        const card = (
          <article className="list-card customer-card">
            <div>
              <h3>{summary.customer.name}</h3>
              <p className="muted date-line">{formatTinyDateTime(summary.lastActivityAt)}</p>
            </div>
            <div className="amount-block">
              <span>{t('balance')}</span>
              <strong>{formatCurrency(summary.balance)}</strong>
            </div>
            <div
              className={
                summary.balance > 0
                  ? 'card-actions customer-actions'
                  : 'card-actions customer-actions no-payment'
              }
            >
            <button
              type="button"
              className="secondary-button tone-view"
              onClick={() => onView(summary.customer.id)}
            >
              {t('view')}
            </button>
            <button
              type="button"
              className="secondary-button tone-add"
              onClick={() => onAddDebt(summary.customer.id)}
            >
              <Plus size={20} />
              {t('addDebtForCustomer')}
            </button>
            {summary.balance > 0 && (
              <button
                type="button"
                className="primary-button compact tone-pay"
                onClick={() => onPay(summary.customer.id)}
              >
                {t('payment')}
              </button>
            )}
            <button
              type="button"
              className="secondary-button tone-receipt"
              onClick={() => onPrint(summary.customer.id)}
            >
              <Printer size={20} />
              {t('receiptShort')}
            </button>
            </div>
          </article>
        );
        if (!onEdit && !onDelete) return <div key={summary.customer.id}>{card}</div>;
        return (
          <SwipeActions
            key={summary.customer.id}
            actions={
              <>
                {onEdit && (
                  <button type="button" className="swipe-action edit" onClick={() => onEdit(summary.customer)}>
                    {t('edit')}
                  </button>
                )}
                {onDelete && (
                  <button type="button" className="swipe-action delete" onClick={() => onDelete(summary.customer.id)}>
                    <Trash2 size={18} />
                  </button>
                )}
              </>
            }
          >
            {card}
          </SwipeActions>
        );
      })}
    </div>
  );
}

function SwipeActions({
  children,
  actions,
}: {
  children: ReactNode;
  actions: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const startRef = useRef<{ x: number; y: number } | null>(null);

  function handlePointerDown(event: PointerEvent<HTMLDivElement>) {
    startRef.current = { x: event.clientX, y: event.clientY };
  }

  function handlePointerMove(event: PointerEvent<HTMLDivElement>) {
    const start = startRef.current;
    if (!start) return;
    const deltaX = event.clientX - start.x;
    const deltaY = event.clientY - start.y;
    if (Math.abs(deltaX) < 18 || Math.abs(deltaX) < Math.abs(deltaY)) return;
    setOpen(deltaX < 0);
  }

  function handlePointerUp(event: PointerEvent<HTMLDivElement>) {
    const start = startRef.current;
    if (!start) return;
    const deltaX = event.clientX - start.x;
    if (deltaX < -28) setOpen(true);
    if (deltaX > 28) setOpen(false);
    startRef.current = null;
  }

  return (
    <div
      className={open ? 'swipe-row is-open' : 'swipe-row'}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={() => {
        startRef.current = null;
      }}
    >
      <div className="swipe-content" onClick={() => open && setOpen(false)}>
        {children}
      </div>
      <div className="swipe-actions">{actions}</div>
    </div>
  );
}

function EmptyState({ kind, message }: { kind: EmptyKind; message: string }) {
  return (
    <div className={`empty-state empty-state-${kind}`}>
      <EmptyStateIcon kind={kind} />
      <p>{message}</p>
    </div>
  );
}

function CustomerNameField({
  label,
  placeholder,
  customers,
  value,
  onChange,
}: {
  label: string;
  placeholder: string;
  customers: Customer[];
  value: string;
  onChange: (value: string) => void;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const inputId = useId();
  const query = value.trim().toLowerCase();
  const suggestions = customers
    .filter((customer) => {
      if (!query) return false;
      return customer.name.toLowerCase().includes(query);
    })
    .sort((first, second) => {
      const firstName = first.name.toLowerCase();
      const secondName = second.name.toLowerCase();
      const firstStarts = firstName.startsWith(query);
      const secondStarts = secondName.startsWith(query);
      if (firstStarts !== secondStarts) return firstStarts ? -1 : 1;
      return first.name.localeCompare(second.name);
    })
    .slice(0, 3);
  const hasExactCustomer = customers.some(
    (customer) => customer.name.trim().toLowerCase() === query,
  );
  const showSuggestions =
    isOpen && query.length > 0 && !hasExactCustomer && suggestions.length > 0;

  return (
    <div className="product-name-field">
      <label htmlFor={inputId}>{label}</label>
      <span className={showSuggestions ? 'product-picker open' : 'product-picker'}>
        <input
          id={inputId}
          value={value}
          placeholder={placeholder}
          autoComplete="off"
          onFocus={() => setIsOpen(true)}
          onBlur={() => setIsOpen(false)}
          onChange={(event) => {
            onChange(event.target.value);
            setIsOpen(true);
          }}
        />
        <span
          className={
            value.trim() ? 'product-picker-status ready' : 'product-picker-status'
          }
        >
          {value.trim() ? <Check size={18} /> : <Search size={18} />}
        </span>
        {showSuggestions && (
          <span className="product-suggestions customer-suggestions">
            {suggestions.map((customer) => (
              <button
                type="button"
                key={customer.id}
                className="product-suggestion"
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => {
                  onChange(customer.name);
                  setIsOpen(false);
                }}
              >
                <span>{customer.name}</span>
                <strong>{formatTinyDateTime(customer.updatedAt)}</strong>
              </button>
            ))}
          </span>
        )}
      </span>
    </div>
  );
}

function ProductNameField({
  label,
  placeholder,
  products,
  value,
  isReady,
  onChange,
}: {
  label: string;
  placeholder: string;
  products: Product[];
  value: string;
  isReady: boolean;
  onChange: (value: string) => void;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const inputId = useId();
  const query = value.trim().toLowerCase();
  const hasExactProduct = products.some(
    (product) => product.name.trim().toLowerCase() === query,
  );
  const suggestions = products
    .filter((product) => {
      if (!query) return false;
      return product.name.toLowerCase().includes(query);
    })
    .sort((first, second) => {
      const firstName = first.name.toLowerCase();
      const secondName = second.name.toLowerCase();
      const firstStarts = query && firstName.startsWith(query);
      const secondStarts = query && secondName.startsWith(query);
      if (firstStarts !== secondStarts) return firstStarts ? -1 : 1;
      return first.name.localeCompare(second.name);
    })
    .slice(0, 3);
  const showSuggestions = isOpen && query.length > 0 && !hasExactProduct && suggestions.length > 0;

  return (
    <div className="product-name-field">
      <label htmlFor={inputId}>{label}</label>
      <span className={showSuggestions ? 'product-picker open' : 'product-picker'}>
        <input
          id={inputId}
          value={value}
          placeholder={placeholder}
          autoComplete="off"
          onFocus={() => setIsOpen(true)}
          onBlur={() => setIsOpen(false)}
          onChange={(event) => {
            onChange(event.target.value);
            setIsOpen(true);
          }}
        />
        <span className={isReady ? 'product-picker-status ready' : 'product-picker-status'}>
          {isReady ? <Check size={18} /> : <Search size={18} />}
        </span>
        {showSuggestions && (
          <span className="product-suggestions">
            {suggestions.map((product) => (
              <button
                type="button"
                key={product.id}
                className="product-suggestion"
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => {
                  onChange(product.name);
                  setIsOpen(false);
                }}
              >
                <span>{product.name}</span>
                <strong>{formatCurrency(product.price)}</strong>
              </button>
            ))}
          </span>
        )}
      </span>
    </div>
  );
}

function CartList({
  items,
  emptyText,
  onRemove,
}: {
  items: DebtCartItem[];
  emptyText: string;
  onRemove: (id: string) => void;
}) {
  if (!items.length) return <p className="cart-empty">{emptyText}</p>;
  return (
    <div className="cart-list">
      {items.map((item) => (
        <div className="cart-row" key={item.id}>
          <div>
            <strong>{item.itemName}</strong>
            <span>
              {item.quantity} x {formatCurrency(item.unitPrice)}
            </span>
          </div>
          <b>{formatCurrency(item.total)}</b>
          <button
            type="button"
            className="icon-button close-button"
            onClick={() => onRemove(item.id)}
            aria-label="Remove item"
          >
            <X size={18} />
          </button>
        </div>
      ))}
    </div>
  );
}

function EmptyStateIcon({ kind }: { kind: EmptyKind }) {
  const symbol =
    kind === 'products'
      ? 'box'
      : kind === 'people'
        ? 'people'
        : kind === 'paid'
          ? 'check'
          : kind === 'utang'
            ? 'peso'
            : 'clock';

  return (
    <svg className="empty-icon" viewBox="0 0 120 120" aria-hidden="true">
      <circle className="empty-orbit" cx="60" cy="60" r="42" />
      <circle className="empty-dot dot-one" cx="28" cy="36" r="4" />
      <circle className="empty-dot dot-two" cx="94" cy="42" r="3" />
      <rect className="empty-card-shape" x="33" y="37" width="54" height="46" rx="10" />
      {symbol === 'box' && (
        <>
          <path className="empty-line" d="M45 52h30M45 63h30M53 74h14" />
          <path className="empty-accent" d="m43 39 17-10 17 10M60 29v22" />
        </>
      )}
      {symbol === 'people' && (
        <>
          <circle className="empty-accent-fill" cx="52" cy="54" r="8" />
          <circle className="empty-accent-fill soft" cx="72" cy="57" r="7" />
          <path className="empty-line" d="M40 75c3-10 21-10 25 0M62 76c3-8 18-8 21 0" />
        </>
      )}
      {symbol === 'check' && (
        <>
          <path className="empty-accent" d="m44 62 11 11 24-28" />
          <path className="empty-line" d="M44 82h34" />
        </>
      )}
      {symbol === 'peso' && (
        <>
          <path className="empty-accent" d="M53 78V42h14c8 0 13 5 13 12s-5 12-13 12H47M47 55h33M47 65h33" />
          <path className="empty-line" d="M42 84h36" />
        </>
      )}
      {symbol === 'clock' && (
        <>
          <circle className="empty-accent" cx="60" cy="60" r="20" />
          <path className="empty-line" d="M60 48v14l10 7" />
        </>
      )}
    </svg>
  );
}

function AnimatedPeopleDebtIcon() {
  return (
    <svg className="summary-people-icon" viewBox="0 0 160 96" aria-hidden="true">
      <circle className="people-orbit" cx="80" cy="48" r="42" />
      <g className="person side left-person">
        <circle cx="42" cy="31" r="14" />
        <path d="M20 76c0-21 10-32 27-32h10v38H30c-6 0-10-4-10-6z" />
      </g>
      <g className="person main-person">
        <circle cx="80" cy="24" r="18" />
        <path d="M55 82V62c0-18 10-30 25-30s25 12 25 30v20z" />
      </g>
      <g className="person side right-person">
        <circle cx="118" cy="31" r="14" />
        <path d="M103 44h10c17 0 27 11 27 32 0 2-4 6-10 6h-27z" />
      </g>
      <path className="peso-pulse" d="M75 66V46h9c5 0 8 3 8 7s-3 7-8 7H71M71 53h21M71 60h21" />
    </svg>
  );
}

function ProductTrendPanel({
  data,
  t,
}: {
  data: AppData;
  t: ReturnType<typeof getTranslator>;
}) {
  const [range, setRange] = useState<TrendRange>('week');
  const [selectedMonthIndex, setSelectedMonthIndex] = useState<number | null>(null);
  const [selectedPointKey, setSelectedPointKey] = useState<string | null>(null);
  const trends = useMemo(
    () => buildProductTrends(data, range, selectedMonthIndex ?? undefined),
    [data, range, selectedMonthIndex],
  );
  const selectedPoint =
    trends.points.find((point) => point.dateKey === selectedPointKey) ??
    trends.points.find((point) => point.quantity > 0) ??
    trends.points.at(-1) ??
    null;
  const maxQuantity = Math.max(1, ...trends.points.map((point) => point.quantity));
  const chartWidth = 320;
  const chartHeight = 112;
  const chartPadding = 10;
  const usableWidth = chartWidth - chartPadding * 2;
  const usableHeight = chartHeight - chartPadding * 2;
  const chartPoints = trends.points.map((point, index) => {
    const x =
      chartPadding +
      (trends.points.length === 1 ? usableWidth / 2 : (index / (trends.points.length - 1)) * usableWidth);
    const y = chartPadding + usableHeight - (point.quantity / maxQuantity) * usableHeight;
    return { ...point, x, y };
  });
  const polylinePoints = chartPoints.map((point) => `${point.x},${point.y}`).join(' ');

  return (
    <section className="panel product-panel trend-panel">
      <div className="trend-header">
        <div>
          <h2>{t('productTrends')}</h2>
          <p className="muted">
            {range === 'week'
              ? t('lastSevenDays')
              : t('monthView').replace('{month}', getMonthName(trends.monthIndex, 'long'))}
          </p>
        </div>
        <span className="trend-year-badge">{trends.year}</span>
      </div>

      <div className="trend-range-tabs" role="group" aria-label={t('trendRange')}>
        {(['week', 'month'] as const).map((option) => (
          <button
            type="button"
            key={option}
            className={range === option ? 'choice-button selected' : 'choice-button'}
            onClick={() => {
              setRange(option);
              setSelectedPointKey(null);
            }}
          >
            {option === 'week' ? t('sevenDays') : t('month')}
          </button>
        ))}
      </div>

      {range === 'month' && (
        <div className="trend-month-picker" aria-label={t('selectMonth')}>
          {Array.from({ length: 12 }, (_, index) => (
            <button
              type="button"
              key={index}
              className={trends.monthIndex === index ? 'selected' : ''}
              onClick={() => {
                setSelectedMonthIndex(index);
                setSelectedPointKey(null);
              }}
            >
              {getMonthName(index)}
            </button>
          ))}
        </div>
      )}

      <div className="trend-metrics">
        <div>
          <span>{t('itemsMoved')}</span>
          <strong>{trends.totalQuantity.toLocaleString('en-PH')}</strong>
        </div>
        <div>
          <span>{t('trendValue')}</span>
          <strong>{formatCurrency(trends.totalValue)}</strong>
        </div>
        <div>
          <span>{t('topProduct')}</span>
          <strong>{trends.bestItem?.name ?? '-'}</strong>
        </div>
      </div>

      <div className="trend-chart" aria-label={t('productTrends')}>
        <svg viewBox={`0 0 ${chartWidth} ${chartHeight}`} role="img">
          <line
            x1={chartPadding}
            y1={chartHeight - chartPadding}
            x2={chartWidth - chartPadding}
            y2={chartHeight - chartPadding}
            className="trend-axis"
          />
          {chartPoints.map((point) => (
            <line
              key={`grid-${point.dateKey}`}
              x1={point.x}
              y1={chartPadding}
              x2={point.x}
              y2={chartHeight - chartPadding}
              className="trend-grid"
            />
          ))}
          <polyline points={polylinePoints} className="trend-line" />
          {chartPoints.map((point) => (
            <g
              key={point.dateKey}
              role="button"
              tabIndex={0}
              className="trend-dot-button"
              aria-label={`${point.detailLabel}: ${point.quantity.toLocaleString('en-PH')}`}
              onClick={() => setSelectedPointKey(point.dateKey)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  setSelectedPointKey(point.dateKey);
                }
              }}
            >
              <circle
                cx={point.x}
                cy={point.y}
                r={selectedPoint?.dateKey === point.dateKey ? 5 : 4}
                className={point.quantity > 0 ? 'trend-dot active' : 'trend-dot'}
              />
            </g>
          ))}
        </svg>
        <div className="trend-days">
          {chartPoints.map((point) => (
            <span key={point.dateKey}>{point.label}</span>
          ))}
        </div>
      </div>

      {selectedPoint && (
        <div className="trend-list">
          <div className="trend-list-head">
            <span>{selectedPoint.detailLabel}</span>
            <span>{t('quantity')}</span>
          </div>
          {selectedPoint.items.length ? (
            selectedPoint.items.map((item) => (
              <div className="trend-row" key={item.key}>
                <strong>{item.name}</strong>
                <span>
                  {item.quantity.toLocaleString('en-PH')} - {formatCurrency(item.total)}
                </span>
              </div>
            ))
          ) : (
            <p className="muted trend-empty">{t('noItemsInPoint')}</p>
          )}
        </div>
      )}

      <div className="trend-list">
        <div className="trend-list-head">
          <span>{t('topProducts')}</span>
          <span>{t('quantity')}</span>
        </div>
        {trends.topItems.length ? (
          trends.topItems.map((item) => (
            <div className="trend-row" key={item.key}>
              <strong>{item.name}</strong>
              <span>
                {item.quantity.toLocaleString('en-PH')} - {formatCurrency(item.total)}
              </span>
            </div>
          ))
        ) : (
          <p className="muted trend-empty">{t('noTrendData')}</p>
        )}
      </div>
    </section>
  );
}

function ProductList({
  products,
  emptyText,
  emptyKind,
  onEdit,
  onDelete,
  t,
}: {
  products: Product[];
  emptyText: string;
  emptyKind: EmptyKind;
  onEdit: (product: Product) => void;
  onDelete: (product: Product) => void;
  t: ReturnType<typeof getTranslator>;
}) {
  if (!products.length) return <EmptyState kind={emptyKind} message={emptyText} />;
  return (
    <div className="list">
      {products.map((product) => (
        <SwipeActions
          key={product.id}
          actions={
            <>
              <button type="button" className="swipe-action edit" onClick={() => onEdit(product)}>
                {t('edit')}
              </button>
              <button type="button" className="swipe-action delete" onClick={() => onDelete(product)}>
                <Trash2 size={18} />
              </button>
            </>
          }
        >
        <article className="list-card product-card">
          <div className="product-card-main">
            <span className="product-card-icon" aria-hidden="true">
              <Package size={18} />
            </span>
            <div>
              <h3>{product.name}</h3>
              <p className="muted">{formatCurrency(product.price)}</p>
            </div>
          </div>
        </article>
        </SwipeActions>
      ))}
    </div>
  );
}

function ActivityList({
  logs,
  emptyText = 'No records yet.',
  onEditDebt,
  onDeleteDebt,
  t,
}: {
  logs: ReturnType<typeof buildActivityLogs>;
  emptyText?: string;
  onEditDebt?: (id: string) => void;
  onDeleteDebt?: (id: string) => void;
  t?: ReturnType<typeof getTranslator>;
}) {
  if (!logs.length) return <EmptyState kind="history" message={emptyText} />;
  return (
    <div className="list">
      {logs.map((log) => {
        const card = (
          <article className="list-card activity-card">
          <div>
            <h3>{log.customerName}</h3>
            <p className="muted">{log.label}</p>
            <p className="muted date-line">{formatTinyDateTime(log.createdAt)}</p>
          </div>
          <strong className={log.kind === 'payment' ? 'paid-amount' : ''}>
            {log.kind === 'payment' ? '-' : '+'}
            {formatCurrency(log.amount)}
          </strong>
          </article>
        );
        if (log.kind !== 'debt' || !onEditDebt || !onDeleteDebt || !t) {
          return <div key={log.id}>{card}</div>;
        }
        return (
          <SwipeActions
            key={log.id}
            actions={
              <>
                <button type="button" className="swipe-action edit" onClick={() => onEditDebt(log.id)}>
                  {t('edit')}
                </button>
                <button type="button" className="swipe-action delete" onClick={() => onDeleteDebt(log.id)}>
                  <Trash2 size={18} />
                </button>
              </>
            }
          >
            {card}
          </SwipeActions>
        );
      })}
    </div>
  );
}

function CustomerDetail({
  summary,
  data,
  onClose,
  onPay,
  onPrint,
  onEditDebt,
  onDeleteDebt,
  t,
}: {
  summary: CustomerSummary;
  data: AppData;
  onClose: () => void;
  onPay: (id: string) => void;
  onPrint: (id: string) => void;
  onEditDebt: (id: string) => void;
  onDeleteDebt: (id: string) => void;
  t: ReturnType<typeof getTranslator>;
}) {
  const [logPage, setLogPage] = useState(1);
  const customerLogs = buildActivityLogs(data).filter(
    (log) => log.customerId === summary.customer.id,
  );
  const currentLogPage = clampPage(logPage, customerLogs.length, PAGE_SIZE);
  return (
    <Modal title={summary.customer.name} onClose={onClose}>
      <div className="detail-summary">
        <div>
          <span>{t('balance')}</span>
          <strong>{formatCurrency(summary.balance)}</strong>
        </div>
        <div>
          <span>{t('paid')}</span>
          <strong>{formatCurrency(summary.totalPaid)}</strong>
        </div>
      </div>
      <div className="detail-actions">
        {summary.balance > 0 && (
          <button
            type="button"
            className="primary-button"
            onClick={() => onPay(summary.customer.id)}
          >
            <CircleDollarSign size={20} />
            {t('addPayment')}
          </button>
        )}
        <button
          type="button"
          className="secondary-button detail-print"
          onClick={() => onPrint(summary.customer.id)}
        >
          <Printer size={20} />
          {t('printPdf')}
        </button>
      </div>
      <h3>{t('itemLogs')}</h3>
      <ActivityList
        logs={paginate(customerLogs, currentLogPage, PAGE_SIZE)}
        emptyText={t('noHistoryEmpty')}
        onEditDebt={onEditDebt}
        onDeleteDebt={onDeleteDebt}
        t={t}
      />
      <Pagination
        totalItems={customerLogs.length}
        currentPage={currentLogPage}
        onPageChange={setLogPage}
        t={t}
      />
    </Modal>
  );
}

function ProtectedArea({
  unlocked,
  pinInput,
  setPinInput,
  onUnlock,
  pinHint,
  t,
  children,
}: {
  unlocked: boolean;
  pinInput: string;
  setPinInput: (value: string) => void;
  onUnlock: (event: React.FormEvent) => void;
  pinHint: string;
  t: ReturnType<typeof getTranslator>;
  children: React.ReactNode;
}) {
  if (unlocked) return <>{children}</>;
  return (
    <section className="lock-panel">
      <Lock size={42} />
      <h2>{t('enterPin')}</h2>
      <p className="pin-note">{pinHint}</p>
      <form onSubmit={onUnlock}>
        <input
          type="password"
          inputMode="numeric"
          maxLength={4}
          placeholder={t('pinPlaceholder')}
          value={pinInput}
          onChange={(event) => setPinInput(event.target.value)}
        />
        <button type="submit" className="primary-button">
          {t('unlock')}
        </button>
      </form>
    </section>
  );
}

function Modal({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true">
      <section className="modal">
        <div className="modal-header">
          <h2>{title}</h2>
          <button type="button" className="icon-button close-button" onClick={onClose}>
            <X size={26} />
          </button>
        </div>
        <div className="modal-body">{children}</div>
      </section>
    </div>
  );
}

function ConfirmDialog({
  dialog,
  cancelLabel,
  pinLabel,
  wrongPinLabel,
  t,
  onCancel,
  onConfirm,
}: {
  dialog: ConfirmDialogState;
  cancelLabel: string;
  pinLabel: string;
  wrongPinLabel: string;
  t: ReturnType<typeof getTranslator>;
  onCancel: () => void;
  onConfirm: () => Promise<void> | void;
}) {
  const [pinValue, setPinValue] = useState('');
  const [pinError, setPinError] = useState('');
  const [checkingBiometric, setCheckingBiometric] = useState(false);

  async function handleBiometricConfirm() {
    if (!dialog.requiresPin) return;
    setCheckingBiometric(true);
    const ok = await verifyWithDeviceBiometric(t);
    setCheckingBiometric(false);
    if (ok) await onConfirm();
  }

  useEffect(() => {
    if (!dialog.requiresPin || !dialog.preferBiometric) return;
    void handleBiometricConfirm();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleConfirm() {
    if (dialog.requiresPin) {
      const ok = await verifyPin(pinValue, dialog.pinHash ?? '');
      if (!ok) {
        setPinError(wrongPinLabel);
        return;
      }
    }
    await onConfirm();
  }

  return (
    <Modal title={dialog.title} onClose={onCancel}>
      <div className="confirm-content">
        <p>{dialog.message}</p>
        {dialog.requiresPin && (
          <div className="confirm-security">
            {dialog.preferBiometric && (
              <button
                type="button"
                className="secondary-button biometric-button"
                disabled={checkingBiometric}
                onClick={() => void handleBiometricConfirm()}
              >
                <Lock size={18} />
                {checkingBiometric ? t('checkingBiometric') : t('useFingerprint')}
              </button>
            )}
            <label className="confirm-pin">
              {pinLabel}
              <input
                type="password"
                inputMode="numeric"
                maxLength={4}
                placeholder={pinLabel}
                value={pinValue}
                onChange={(event) => {
                  setPinValue(event.target.value);
                  setPinError('');
                }}
              />
              {pinError && <span>{pinError}</span>}
            </label>
          </div>
        )}
        <div className="button-row">
          <button type="button" className="secondary-button" onClick={onCancel}>
            {cancelLabel}
          </button>
          <button type="button" className="primary-button" onClick={() => void handleConfirm()}>
            {dialog.confirmLabel}
          </button>
        </div>
      </div>
    </Modal>
  );
}

function Pagination({
  totalItems,
  currentPage,
  onPageChange,
  t,
}: {
  totalItems: number;
  currentPage: number;
  onPageChange: (page: number) => void;
  t: ReturnType<typeof getTranslator>;
}) {
  const totalPages = pageCount(totalItems, PAGE_SIZE);
  if (totalPages <= 1) return null;
  const pages = buildPageItems(currentPage, totalPages, 3);

  return (
    <div className="pagination" aria-label="Pagination">
      <button
        type="button"
        className="page-button"
        aria-label={t('previous')}
        disabled={currentPage === 1}
        onClick={() => onPageChange(currentPage - 1)}
      >
        <ChevronLeft size={18} />
      </button>
      <div className="page-numbers">
        {pages.map((page) =>
          typeof page === 'number' ? (
            <button
              type="button"
              key={page}
              className={page === currentPage ? 'page-number active' : 'page-number'}
              onClick={() => onPageChange(page)}
              aria-label={`Page ${page}`}
            >
              {page}
            </button>
          ) : (
            <span className="page-ellipsis" key={page} aria-hidden="true">
              ...
            </span>
          ),
        )}
      </div>
      <button
        type="button"
        className="page-button"
        aria-label={t('next')}
        disabled={currentPage === totalPages}
        onClick={() => onPageChange(currentPage + 1)}
      >
        <ChevronRight size={18} />
      </button>
    </div>
  );
}

function RecordCalendar({
  days,
  monthLabel,
  onPreviousMonth,
  onNextMonth,
  onSelectDate,
}: {
  days: CalendarDay[];
  monthLabel: string;
  onPreviousMonth: () => void;
  onNextMonth: () => void;
  onSelectDate: (dateKey: string) => void;
}) {
  const weekDays = ['Dom', 'Lun', 'Mar', 'Miy', 'Huw', 'Biy', 'Sab'];

  return (
    <div className="record-calendar">
      <div className="calendar-header">
        <button
          type="button"
          className="icon-button"
          onClick={onPreviousMonth}
          aria-label="Previous month"
        >
          <ChevronLeft size={22} />
        </button>
        <strong>{monthLabel}</strong>
        <button
          type="button"
          className="icon-button"
          onClick={onNextMonth}
          aria-label="Next month"
        >
          <ChevronRight size={22} />
        </button>
      </div>
      <div className="calendar-grid" aria-label="Record calendar">
        {weekDays.map((day) => (
          <span className="calendar-weekday" key={day}>
            {day}
          </span>
        ))}
        {days.map((day) => {
          const className = [
            'calendar-day',
            day.isCurrentMonth ? '' : 'outside',
            day.hasRecords ? 'has-records' : '',
            day.isSelected ? 'selected' : '',
            day.isToday ? 'today' : '',
          ]
            .filter(Boolean)
            .join(' ');

          return (
            <button
              type="button"
              className={className}
              key={day.key}
              onClick={() => onSelectDate(day.key)}
              aria-label={day.key}
            >
              <span>{day.dayNumber}</span>
              {day.hasRecords && <i aria-hidden="true" />}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function AnimatedShopIcon({ compact = false }: { compact?: boolean }) {
  return (
    <svg
      className={compact ? 'shop-logo compact' : 'shop-logo'}
      viewBox="0 0 128 128"
      aria-hidden="true"
    >
      <rect className="shop-shadow" x="30" y="101" width="68" height="9" rx="4.5" />
      <path className="shop-bag" d="M35 47h58l-4 57H39z" />
      <path className="shop-handle" d="M49 48c1-16 8-24 15-24s14 8 15 24" />
      <path className="shop-roof" d="M31 47h66l-7-17H38z" />
      <g className="shop-awning">
        <path d="M33 47h62v10c0 6-5 11-11 11-5 0-9-3-11-7-2 4-6 7-11 7s-9-3-11-7c-2 4-6 7-11 7-6 0-11-5-11-11z" />
        <path className="awning-line" d="M48 47v16M64 47v17M80 47v16" />
      </g>
      <path className="shop-door" d="M55 104V78h18v26" />
      <path className="shop-window" d="M42 79h13v14H42zM75 79h13v14H75z" />
      <path className="shop-smile" d="M55 38c5 4 13 4 18 0" />
      <circle className="shop-spark spark-one" cx="26" cy="39" r="3" />
      <circle className="shop-spark spark-two" cx="99" cy="35" r="2.5" />
      <path className="shop-spark spark-three" d="M99 78h8M103 74v8" />
    </svg>
  );
}

function NavButton({
  icon,
  label,
  active,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className={active ? 'nav-button active' : 'nav-button'}
      onClick={onClick}
    >
      {icon}
      <span>{label}</span>
    </button>
  );
}

export default App;
