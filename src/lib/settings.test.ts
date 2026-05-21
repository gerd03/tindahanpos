import { describe, expect, it } from 'vitest';
import { DEFAULT_STORE_NAME } from './appInfo';
import { normalizeAppData, normalizeSettings } from './settings';

describe('settings compatibility', () => {
  it('adds a default store name to old settings', async () => {
    const settings = await normalizeSettings({
      language: 'ceb',
      pinHash: 'hash',
      uiSize: 'large',
    });

    expect(settings.storeName).toBe(DEFAULT_STORE_NAME);
    expect(settings.ownerName).toBe('');
    expect(settings.pinHash).toBe('hash');
    expect(settings.pinUpdatedAt).toBeNull();
    expect(settings.pinTimeout).toEqual({
      every: 10,
      unit: 'minutes',
    });
    expect(settings.autoBackup).toEqual({
      enabled: true,
      every: 8,
      unit: 'hours',
      lastRunAt: null,
      lastAttemptAt: null,
      lastFileName: null,
      lastUri: null,
      lastLocation: null,
      lastError: null,
    });
  });

  it('normalizes old backup data without storeName', async () => {
    const data = await normalizeAppData({
      products: [],
      customers: [],
      ledgerEntries: [],
      payments: [],
      settings: {
        language: 'en',
        pinHash: 'hash',
        uiSize: 'normal',
      },
    });

    expect(data.settings.storeName).toBe(DEFAULT_STORE_NAME);
    expect(data.settings.ownerName).toBe('');
    expect(data.settings.pinUpdatedAt).toBeNull();
  });

  it('preserves a pin update timestamp', async () => {
    const settings = await normalizeSettings({
      language: 'ceb',
      pinHash: 'hash',
      uiSize: 'large',
      storeName: 'Store',
      pinUpdatedAt: '2026-05-21T01:00:00.000Z',
    });

    expect(settings.pinUpdatedAt).toBe('2026-05-21T01:00:00.000Z');
  });

  it('normalizes protected PIN timeout settings', async () => {
    const settings = await normalizeSettings({
      pinTimeout: {
        every: 1,
        unit: 'days',
      },
    });

    expect(settings.pinTimeout).toEqual({
      every: 1,
      unit: 'days',
    });
  });

  it('adds empty allocations to old payment records', async () => {
    const data = await normalizeAppData({
      products: [],
      customers: [],
      ledgerEntries: [],
      payments: [
        {
          id: 'pay1',
          customerId: 'c1',
          amount: 20,
          note: '',
          createdAt: '2026-05-21T01:00:00.000Z',
        },
      ],
      settings: null,
    });

    expect(data.payments[0].allocations).toEqual([]);
  });
});
