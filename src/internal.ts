/**
 * Internal helpers kept free of SDK state so they can be unit-tested.
 * Not part of the public API.
 */

// ============================================================================
// Device info
// ============================================================================

export interface DeviceInfo {
  /** OS name + version, e.g. "Windows 10.0", "Android 14", "macOS 14.5" */
  osVersion?: string;
  /** Browser name + major version, e.g. "Chrome 128", "Safari 17" */
  deviceModel?: string;
}

/**
 * Best-effort, synchronous OS / browser detection. Prefers User-Agent Client
 * Hints (`navigator.userAgentData`) and falls back to minimal UA parsing.
 * Never throws; unknown values are left undefined.
 */
export function detectDeviceInfo(nav: any = typeof navigator !== 'undefined' ? navigator : undefined): DeviceInfo {
  if (!nav) return {};
  try {
    const ua: string = nav.userAgent || '';
    const uaData = nav.userAgentData;
    let browser: string | undefined;
    let os: string | undefined;

    if (uaData && Array.isArray(uaData.brands)) {
      const brand = uaData.brands.find(
        (b: { brand: string }) => !/not.?a.?brand|chromium/i.test(b.brand),
      ) || uaData.brands.find((b: { brand: string }) => /chromium/i.test(b.brand));
      if (brand) browser = `${brand.brand.replace(/^Google /, '')} ${brand.version}`;
      if (uaData.platform) os = uaData.platform;
    }

    if (!browser) browser = parseBrowser(ua);
    // Low-entropy client hints only give the platform name, so take the
    // version from the UA string. Exception: Chromium freezes the macOS
    // version at 10_15_7, which would be misleading, so report just "macOS".
    const uaOs = parseOs(ua);
    if (!(uaData && os === 'macOS')) os = uaOs || os;

    return { osVersion: truncate(os), deviceModel: truncate(browser) };
  } catch {
    return {};
  }
}

function parseBrowser(ua: string): string | undefined {
  const rules: Array<[RegExp, string]> = [
    [/Edg(?:e|A|iOS)?\/(\d+)/, 'Edge'],
    [/OPR\/(\d+)/, 'Opera'],
    [/SamsungBrowser\/(\d+)/, 'Samsung Internet'],
    [/Firefox\/(\d+)/, 'Firefox'],
    [/FxiOS\/(\d+)/, 'Firefox'],
    [/CriOS\/(\d+)/, 'Chrome'],
    [/Chrome\/(\d+)/, 'Chrome'],
    [/Version\/(\d+(?:\.\d+)?).*Safari/, 'Safari'],
  ];
  for (const [re, name] of rules) {
    const m = ua.match(re);
    if (m) return `${name} ${m[1]}`;
  }
  return undefined;
}

function parseOs(ua: string): string | undefined {
  let m: RegExpMatchArray | null;
  if ((m = ua.match(/Windows NT (\d+(?:\.\d+)?)/))) return `Windows ${m[1]}`;
  if ((m = ua.match(/Android (\d+(?:\.\d+)*)/))) return `Android ${m[1]}`;
  if ((m = ua.match(/(?:iPhone|iPad|iPod).*? OS (\d+(?:_\d+)*)/))) return `iOS ${m[1].replace(/_/g, '.')}`;
  if ((m = ua.match(/Mac OS X (\d+(?:[._]\d+)*)/))) return `macOS ${m[1].replace(/_/g, '.')}`;
  if (/CrOS/.test(ua)) return 'ChromeOS';
  if (/Linux/.test(ua)) return 'Linux';
  return undefined;
}

function truncate(value?: string): string | undefined {
  return value ? value.slice(0, 64) : undefined;
}

// ============================================================================
// Automatic registration refresh
// ============================================================================

/** Re-register at least this often, even if nothing changed. */
export const REFRESH_INTERVAL_MS = 24 * 60 * 60 * 1000;

/** What the server last saw from this browser. Persisted in localStorage. */
export interface RegistrationFingerprint {
  /** Time of the last successful registration (ms since epoch) */
  registeredAt: number;
  /** Web Push endpoint, or null when registered MQTT-only */
  endpoint: string | null;
  appVersion: string | null;
  sdkVersion: string;
  userId: string | null;
}

export type RefreshReason =
  | 'no_fingerprint'
  | 'interval'
  | 'endpoint_changed'
  | 'app_version_changed'
  | 'sdk_version_changed'
  | 'user_changed';

/**
 * Decide whether a previously registered browser should silently re-register.
 * Returns the reason, or null when the server is already up to date.
 */
export function getRefreshReason(
  previous: RegistrationFingerprint | null,
  current: Omit<RegistrationFingerprint, 'registeredAt'>,
  now: number,
  intervalMs: number = REFRESH_INTERVAL_MS,
): RefreshReason | null {
  if (!previous) return 'no_fingerprint';
  if (current.sdkVersion !== previous.sdkVersion) return 'sdk_version_changed';
  if ((current.appVersion ?? null) !== (previous.appVersion ?? null)) return 'app_version_changed';
  if ((current.userId ?? null) !== (previous.userId ?? null)) return 'user_changed';
  if ((current.endpoint ?? null) !== (previous.endpoint ?? null)) return 'endpoint_changed';
  if (!(previous.registeredAt > 0) || now - previous.registeredAt >= intervalMs || now < previous.registeredAt) {
    return 'interval';
  }
  return null;
}

export function parseFingerprint(raw: string | null): RegistrationFingerprint | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw);
    if (!value || typeof value !== 'object' || typeof value.registeredAt !== 'number') return null;
    return value as RegistrationFingerprint;
  } catch {
    return null;
  }
}

// ============================================================================
// Bounded dedupe
// ============================================================================

/** Insertion-ordered set that forgets its oldest entries past `limit`. */
export class BoundedSet {
  private readonly items = new Set<string>();

  constructor(private readonly limit: number) {}

  has(value: string): boolean {
    return this.items.has(value);
  }

  /** Adds the value. Returns false if it was already present. */
  add(value: string): boolean {
    if (this.items.has(value)) return false;
    this.items.add(value);
    while (this.items.size > this.limit) {
      const oldest = this.items.values().next().value as string;
      this.items.delete(oldest);
    }
    return true;
  }

  delete(value: string): void {
    this.items.delete(value);
  }

  get size(): number {
    return this.items.size;
  }
}
