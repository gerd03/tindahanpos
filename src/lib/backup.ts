import type { AppData, BackupFile } from '../types';
import { normalizeAppData } from './settings';

export function createBackup(data: AppData): BackupFile {
  return {
    app: 'Tindahan ni Lola',
    version: 1,
    exportedAt: new Date().toISOString(),
    data,
  };
}

export function serializeBackup(data: AppData): string {
  return JSON.stringify(createBackup(data), null, 2);
}

export async function parseBackup(json: string): Promise<AppData> {
  const parsed = JSON.parse(json) as Partial<BackupFile>;
  if (parsed.app !== 'Tindahan ni Lola' || parsed.version !== 1 || !parsed.data) {
    throw new Error('Invalid backup file.');
  }

  const data = parsed.data as AppData;
  if (
    !Array.isArray(data.products) ||
    !Array.isArray(data.customers) ||
    !Array.isArray(data.ledgerEntries) ||
    !Array.isArray(data.payments)
  ) {
    throw new Error('Backup is missing records.');
  }

  return normalizeAppData(data);
}
