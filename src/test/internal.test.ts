import { describe, it, expect } from '@jest/globals';
import {
  BoundedSet,
  detectDeviceInfo,
  getRefreshReason,
  parseFingerprint,
  REFRESH_INTERVAL_MS,
  RegistrationFingerprint,
} from '../internal';
import { SDK_VERSION } from '../version';

describe('getRefreshReason', () => {
  const now = 1_800_000_000_000;
  const previous: RegistrationFingerprint = {
    registeredAt: now - 60_000,
    endpoint: 'https://push.example/a',
    appVersion: '1.0.0',
    sdkVersion: '0.1.5',
    userId: 'u1',
  };
  const current = {
    endpoint: previous.endpoint,
    appVersion: previous.appVersion,
    sdkVersion: previous.sdkVersion,
    userId: previous.userId,
  };

  it('skips when nothing changed and the interval has not passed', () => {
    expect(getRefreshReason(previous, current, now)).toBeNull();
  });

  it('refreshes when there is no stored fingerprint (upgrade from <=0.1.4)', () => {
    expect(getRefreshReason(null, current, now)).toBe('no_fingerprint');
  });

  it('refreshes after 24h', () => {
    expect(getRefreshReason(previous, current, previous.registeredAt + REFRESH_INTERVAL_MS)).toBe('interval');
    expect(getRefreshReason(previous, current, previous.registeredAt + REFRESH_INTERVAL_MS - 1)).toBeNull();
  });

  it('refreshes when the clock went backwards', () => {
    expect(getRefreshReason(previous, current, previous.registeredAt - 1)).toBe('interval');
  });

  it('refreshes on endpoint change, including a lost subscription', () => {
    expect(getRefreshReason(previous, { ...current, endpoint: 'https://push.example/b' }, now)).toBe('endpoint_changed');
    expect(getRefreshReason(previous, { ...current, endpoint: null }, now)).toBe('endpoint_changed');
  });

  it('refreshes on app version, SDK version and user changes', () => {
    expect(getRefreshReason(previous, { ...current, appVersion: '1.1.0' }, now)).toBe('app_version_changed');
    expect(getRefreshReason(previous, { ...current, sdkVersion: '0.1.6' }, now)).toBe('sdk_version_changed');
    expect(getRefreshReason(previous, { ...current, userId: null }, now)).toBe('user_changed');
  });
});

describe('parseFingerprint', () => {
  it('rejects missing or malformed values', () => {
    expect(parseFingerprint(null)).toBeNull();
    expect(parseFingerprint('not json')).toBeNull();
    expect(parseFingerprint('{"endpoint":"x"}')).toBeNull();
  });

  it('parses a stored fingerprint', () => {
    const fp = { registeredAt: 1, endpoint: null, appVersion: null, sdkVersion: '0.1.5', userId: null };
    expect(parseFingerprint(JSON.stringify(fp))).toEqual(fp);
  });
});

describe('BoundedSet', () => {
  it('dedupes and evicts the oldest entries', () => {
    const set = new BoundedSet(2);
    expect(set.add('a')).toBe(true);
    expect(set.add('a')).toBe(false);
    set.add('b');
    set.add('c');
    expect(set.size).toBe(2);
    expect(set.has('a')).toBe(false);
    expect(set.has('c')).toBe(true);
  });
});

describe('detectDeviceInfo', () => {
  it('parses Chrome on Android from the UA string', () => {
    expect(
      detectDeviceInfo({
        userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Mobile Safari/537.36',
      }),
    ).toEqual({ osVersion: 'Android 14', deviceModel: 'Chrome 128' });
  });

  it('parses Safari on iOS', () => {
    expect(
      detectDeviceInfo({
        userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
      }),
    ).toEqual({ osVersion: 'iOS 17.5', deviceModel: 'Safari 17.5' });
  });

  it('prefers client hints and does not report the frozen macOS version', () => {
    expect(
      detectDeviceInfo({
        userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
        userAgentData: {
          platform: 'macOS',
          brands: [
            { brand: 'Chromium', version: '128' },
            { brand: 'Not;A=Brand', version: '24' },
            { brand: 'Google Chrome', version: '128' },
          ],
        },
      }),
    ).toEqual({ osVersion: 'macOS', deviceModel: 'Chrome 128' });
  });

  it('returns empty fields when nothing is known', () => {
    expect(detectDeviceInfo({ userAgent: '' })).toEqual({ osVersion: undefined, deviceModel: undefined });
    expect(detectDeviceInfo(undefined)).toEqual({});
  });
});

describe('SDK_VERSION', () => {
  it('matches package.json', async () => {
    const { readFileSync } = await import('node:fs');
    const pkg = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8'));
    expect(SDK_VERSION).toBe(pkg.version);
  });
});
