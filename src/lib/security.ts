const DEFAULT_PIN = '1234';

export async function hashPin(pin: string): Promise<string> {
  const cleanPin = pin.trim();
  if (!/^\d{4}$/.test(cleanPin)) {
    throw new Error('PIN must be 4 digits.');
  }

  if (typeof crypto !== 'undefined' && crypto.subtle) {
    const bytes = new TextEncoder().encode(`tindahan-ni-lola:${cleanPin}`);
    const digest = await crypto.subtle.digest('SHA-256', bytes);
    return Array.from(new Uint8Array(digest))
      .map((byte) => byte.toString(16).padStart(2, '0'))
      .join('');
  }

  return `fallback:${btoa(`tindahan-ni-lola:${cleanPin}`)}`;
}

export async function verifyPin(pin: string, hash: string): Promise<boolean> {
  try {
    return (await hashPin(pin)) === hash;
  } catch {
    return false;
  }
}

export async function defaultPinHash(): Promise<string> {
  return hashPin(DEFAULT_PIN);
}

export function isValidPin(pin: string): boolean {
  return /^\d{4}$/.test(pin.trim());
}

export { DEFAULT_PIN };
