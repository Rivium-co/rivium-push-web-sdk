/**
 * The SDK mirrors the worker's config into IndexedDB on every load, so a
 * worker registered without the SDK's query string can still confirm
 * delivery. See service-worker-config.test.ts for the worker's half.
 */
import { jest } from '@jest/globals';
import { RiviumPush } from '../index';

function fakeIndexedDB() {
  const saved: Record<string, any> = {};
  const later = (fn: () => void) => setTimeout(fn, 0);
  return {
    saved,
    open: jest.fn(() => {
      const req: any = { result: null, onsuccess: null, onerror: null, onupgradeneeded: null };
      later(() => {
        req.result = {
          objectStoreNames: { contains: () => true },
          createObjectStore: () => ({}),
          close: () => undefined,
          transaction: () => {
            const tx: any = {
              objectStore: () => ({ put: (value: any, key: string) => (saved[key] = value) }),
              oncomplete: null,
              onerror: null,
            };
            later(() => tx.oncomplete && tx.oncomplete());
            return tx;
          },
        };
        req.onsuccess && req.onsuccess();
      });
      return req;
    }),
  };
}

describe('the SDK stores the worker config', () => {
  const client = () => new RiviumPush({ apiKey: 'rv_live_test123' }) as any;

  it('writes the key, server URL and device id under rivium-push/config', async () => {
    const db = fakeIndexedDB();
    (globalThis as any).indexedDB = db;

    await client().storeServiceWorkerConfig();

    expect(db.open).toHaveBeenCalledWith('rivium-push', 1);
    expect(db.saved.config).toEqual(
      expect.objectContaining({ apiKey: 'rv_live_test123', serverUrl: expect.stringContaining('http'), deviceId: expect.any(String) }),
    );
  });

  it('is harmless where IndexedDB is unavailable (private windows, blocked site data)', async () => {
    (globalThis as any).indexedDB = undefined;
    await expect(client().storeServiceWorkerConfig()).resolves.toBeUndefined();

    (globalThis as any).indexedDB = { open: () => { throw new Error('blocked'); } };
    await expect(client().storeServiceWorkerConfig()).resolves.toBeUndefined();
  });

  it('rewrites it, so a changed device id does not leave a stale record', async () => {
    const db = fakeIndexedDB();
    (globalThis as any).indexedDB = db;
    db.saved.config = { apiKey: 'old', deviceId: 'web_old' };

    await client().storeServiceWorkerConfig();

    expect(db.saved.config.apiKey).toBe('rv_live_test123');
    expect(db.saved.config.deviceId).not.toBe('web_old');
  });
});
