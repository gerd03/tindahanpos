export const CURRENT_APP_VERSION = '1.0.3';
export const CURRENT_APP_VERSION_CODE = 4;

// Deploy public/version.json to Vercel and replace this with your live URL.
export const UPDATE_MANIFEST_URL = 'https://tindahanpos.vercel.app/version.json';

export interface UpdateManifest {
  version: string;
  versionCode: number;
  apkUrl: string;
  notes?: string;
  required?: boolean;
}

export async function fetchAvailableUpdate(): Promise<UpdateManifest | null> {
  const response = await fetch(`${UPDATE_MANIFEST_URL}?t=${Date.now()}`, {
    cache: 'no-store',
  });
  if (!response.ok) return null;

  const manifest = (await response.json()) as Partial<UpdateManifest>;
  if (
    !manifest.version ||
    !manifest.apkUrl ||
    !Number.isFinite(manifest.versionCode)
  ) {
    return null;
  }

  if (Number(manifest.versionCode) <= CURRENT_APP_VERSION_CODE) return null;

  return {
    version: String(manifest.version),
    versionCode: Number(manifest.versionCode),
    apkUrl: String(manifest.apkUrl),
    notes: manifest.notes ? String(manifest.notes) : '',
    required: Boolean(manifest.required),
  };
}
