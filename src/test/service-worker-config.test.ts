/**
 * The worker must keep confirming delivery even when it was registered
 * WITHOUT the SDK's query string - a plain
 * `navigator.serviceWorker.register('/rivium-push-sw.js')`, another library,
 * or a hot reload in development. Before the IndexedDB fallback such a worker
 * still showed notifications while silently confirming none of them.
 */
import { jest } from '@jest/globals';
import { readFileSync } from 'fs';
import { createContext, runInContext } from 'vm';
import { join } from 'path';

const SW_PATH = join(process.cwd(), 'service-worker.js');

/** Just enough IndexedDB for open/createObjectStore/get/put. */
function fakeIndexedDB(initial: Record<string, any> | null) {
  const store: Record<string, any> = initial ? { config: initial } : {};
  const later = (fn: () => void) => setTimeout(fn, 0);
  return {
    store,
    open: () => {
      const req: any = { result: null, onsuccess: null, onerror: null, onupgradeneeded: null };
      later(() => {
        req.result = {
          objectStoreNames: { contains: () => true },
          createObjectStore: () => ({}),
          close: () => undefined,
          transaction: () => ({
            objectStore: () => ({
              get: (key: string) => {
                const g: any = { onsuccess: null, onerror: null, result: store[key] };
                later(() => g.onsuccess && g.onsuccess());
                return g;
              },
              put: (value: any, key: string) => {
                store[key] = value;
              },
            }),
          }),
        };
        req.onsuccess && req.onsuccess();
      });
      return req;
    },
  };
}

function loadWorker(href: string, stored: Record<string, any> | null) {
  const fetchMock = jest.fn(async () => ({ ok: true, status: 200 }));
  const sandbox: any = {
    self: { location: { href, origin: 'https://app.example' }, addEventListener: () => undefined, registration: {} },
    indexedDB: fakeIndexedDB(stored),
    fetch: fetchMock,
    console: { log: jest.fn(), warn: jest.fn(), error: jest.fn() },
    URL,
    setTimeout,
    clearTimeout,
    Promise,
    JSON,
  };
  sandbox.globalThis = sandbox;
  const context = createContext(sandbox);
  runInContext(readFileSync(SW_PATH, 'utf8'), context);
  return { context: context as any, fetchMock, warn: sandbox.console.warn };
}

const CONFIG = { apiKey: 'rv_live_stored', serverUrl: 'https://push-api.rivium.co', deviceId: 'web_stored', sdkVersion: '0.1.8' };

describe('service worker config', () => {
  it('uses the registration URL when the SDK registered it', async () => {
    const { context, fetchMock } = loadWorker(
      'https://app.example/rivium-push-sw.js?riviumApiKey=rv_live_url&riviumDeviceId=web_url&riviumServerUrl=https://push-api.rivium.co',
      CONFIG,
    );
    await context.riviumReportDelivered('msg-1');
    const [url, init] = fetchMock.mock.calls[0] as any[];
    expect(url).toBe('https://push-api.rivium.co/receipts/delivered');
    expect(init.headers['x-api-key']).toBe('rv_live_url');
    expect(JSON.parse(init.body).deviceId).toBe('web_url');
  });

  it('falls back to stored config when the worker URL has none', async () => {
    const { context, fetchMock } = loadWorker('https://app.example/rivium-push-sw.js', CONFIG);
    await context.riviumReportDelivered('msg-2');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const init = (fetchMock.mock.calls[0] as any[])[1];
    expect(init.headers['x-api-key']).toBe('rv_live_stored');
    expect(JSON.parse(init.body)).toEqual({ messageId: 'msg-2', deviceId: 'web_stored' });
  });

  it('says what is missing when neither place has config, and never throws', async () => {
    const { context, fetchMock, warn } = loadWorker('https://app.example/rivium-push-sw.js', null);
    await expect(context.riviumReportDelivered('msg-3')).resolves.toBeUndefined();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(String((warn as any).mock.calls[0][0])).toMatch(/apiKey and deviceId missing/);
  });

  it('still skips a push that carries no message id', async () => {
    const { context, fetchMock } = loadWorker('https://app.example/rivium-push-sw.js', CONFIG);
    await context.riviumReportDelivered(null);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('defaults the server URL when only the key and device are known', async () => {
    const { context, fetchMock } = loadWorker(
      'https://app.example/rivium-push-sw.js?riviumApiKey=rv_live_url&riviumDeviceId=web_url',
      null,
    );
    await context.riviumReportDelivered('msg-4');
    expect((fetchMock.mock.calls[0] as any[])[0]).toBe('https://push-api.rivium.co/receipts/delivered');
  });
});
