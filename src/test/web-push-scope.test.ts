/**
 * Web Push next to another service worker (Flutter web has its own at '/'): the SDK's worker can have its own scope,
 * the permission prompt comes first (Safari shows it only close to the user's tap), a foreign worker is never
 * subscribed, and a tap with no window open starts the app with the message.
 */
import { jest } from '@jest/globals';
import { readFileSync } from 'fs';
import { createContext, runInContext } from 'vm';
import { join } from 'path';
import RiviumPush from '../index';

const sw = navigator.serviceWorker as any;

describe('service worker scope', () => {
  beforeEach(() => {
    (Notification as any).permission = 'default';
    sw.register.mockClear();
    (Notification.requestPermission as jest.Mock).mockClear();
  });

  it('registers the worker with the configured scope, after asking for permission', async () => {
    const push = new RiviumPush({ apiKey: 'rv_live_test123', serviceWorkerScope: '/rivium-push/' });
    await push.register().catch(() => undefined);
    expect(sw.register).toHaveBeenCalledTimes(1);
    expect(sw.register.mock.calls[0][1]).toEqual({ scope: '/rivium-push/' });
    expect(String(sw.register.mock.calls[0][0])).toMatch(/^\/rivium-push-sw\.js\?/);
    const asked = (Notification.requestPermission as jest.Mock).mock.invocationCallOrder[0];
    expect(asked).toBeLessThan(sw.register.mock.invocationCallOrder[0]);
  });

  it('the default scope stays /', async () => {
    const push = new RiviumPush({ apiKey: 'rv_live_test123' });
    await push.register().catch(() => undefined);
    expect(sw.register.mock.calls[0][1]).toEqual({ scope: '/' });
  });

  it('never takes another worker (Flutter’s own) as its registration', async () => {
    const push: any = new RiviumPush({ apiKey: 'rv_live_test123', autoRegisterServiceWorker: false });
    const original = sw.getRegistration;
    try {
      sw.getRegistration = jest.fn(async () => ({ active: { scriptURL: 'http://localhost/flutter_service_worker.js?v=1' } }));
      expect(await push.ownServiceWorkerRegistration()).toBeNull();
      const own = { active: { scriptURL: 'http://localhost/rivium-push-sw.js?riviumApiKey=k' } };
      sw.getRegistration = jest.fn(async () => own);
      expect(await push.ownServiceWorkerRegistration()).toBe(own);
    } finally {
      sw.getRegistration = original;
    }
  });
});

describe('service worker: a tap with no window open', () => {
  it('opens the app folder with the message in the URL', async () => {
    const listeners: Record<string, (event: any) => void> = {};
    const openWindow = jest.fn(async (_url: string) => null);
    const sandbox: any = {
      self: {
        location: { href: 'https://app.example/rivium-push-sw.js?riviumApiKey=rv_live_url&riviumDeviceId=web_url&riviumServerUrl=https://push-api.rivium.co', origin: 'https://app.example' },
        addEventListener: (type: string, fn: (event: any) => void) => {
          listeners[type] = fn;
        },
        registration: { scope: 'https://app.example/rivium-push/' },
        clients: { matchAll: async () => [], openWindow, claim: async () => undefined },
        skipWaiting: () => undefined,
      },
      indexedDB: { open: () => ({}) },
      fetch: jest.fn(async () => ({ ok: true, status: 200 })),
      console: { log: jest.fn(), warn: jest.fn(), error: jest.fn() },
      URL,
      setTimeout: (fn: () => void) => setTimeout(fn, 0),
      clearTimeout,
      Promise,
      JSON,
      Set,
    };
    sandbox.globalThis = sandbox;
    runInContext(readFileSync(join(process.cwd(), 'service-worker.js'), 'utf8'), createContext(sandbox));
    const pending: Promise<any>[] = [];
    listeners.notificationclick({
      action: '',
      notification: { title: 'T', body: 'B', close: jest.fn(), data: { messageId: 'm1', riviumPushPayload: { messageId: 'm1' } } },
      waitUntil: (p: Promise<any>) => pending.push(p),
    });
    await Promise.all(pending);
    expect(openWindow).toHaveBeenCalledTimes(1);
    const url = new URL(openWindow.mock.calls[0][0]);
    expect(url.origin + url.pathname).toBe('https://app.example/');
    expect(JSON.parse(url.searchParams.get('rivium_push_notification')!)).toMatchObject({ title: 'T', body: 'B', messageId: 'm1' });
  });
});
