/**
 * Internal helpers kept free of SDK state so they can be unit-tested.
 * Not part of the public API.
 */
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
export declare function detectDeviceInfo(nav?: any): DeviceInfo;
/** Re-register at least this often, even if nothing changed. */
export declare const REFRESH_INTERVAL_MS: number;
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
export type RefreshReason = 'no_fingerprint' | 'interval' | 'endpoint_changed' | 'app_version_changed' | 'sdk_version_changed' | 'user_changed';
/**
 * Decide whether a previously registered browser should silently re-register.
 * Returns the reason, or null when the server is already up to date.
 */
export declare function getRefreshReason(previous: RegistrationFingerprint | null, current: Omit<RegistrationFingerprint, 'registeredAt'>, now: number, intervalMs?: number): RefreshReason | null;
export declare function parseFingerprint(raw: string | null): RegistrationFingerprint | null;
/** Insertion-ordered set that forgets its oldest entries past `limit`. */
export declare class BoundedSet {
    private readonly limit;
    private readonly items;
    constructor(limit: number);
    has(value: string): boolean;
    /** Adds the value. Returns false if it was already present. */
    add(value: string): boolean;
    delete(value: string): void;
    get size(): number;
}
