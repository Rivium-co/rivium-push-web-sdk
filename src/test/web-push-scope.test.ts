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

describe('subscription waits for an active worker', () => {
  it('subscribes only after the installing worker is activated (Safari refuses before)', async () => {
    const push: any = new RiviumPush({ apiKey: 'rv_live_test123' });
    const listeners: Array<() => void> = [];
    const worker: any = { state: 'installing', addEventListener: (_: string, fn: () => void) => listeners.push(fn), removeEventListener: jest.fn() };
    const order: string[] = [];
    const registration: any = {
      active: null,
      installing: worker,
      waiting: null,
      pushManager: {
        getSubscription: jest.fn(async () => null),
        subscribe: jest.fn(async () => {
          order.push(`subscribe while ${worker.state}`);
          return { endpoint: 'https://web.push.apple.com/x', toJSON: () => ({ endpoint: 'https://web.push.apple.com/x', keys: {} }) };
        }),
      },
    };
    push.serviceWorkerRegistration = registration;
    const pending = push.subscribeToPush('BEl62iUYgUivxIkv69yViEuiBIa-Ib9-SkvMeAtA3LFgDzkrxZJjSgSnfckjBJuBkr3qBUYIHBQFLXYp5Nksh8U');
    await new Promise((r) => setTimeout(r, 20));
    expect(registration.pushManager.subscribe).not.toHaveBeenCalled();
    worker.state = 'activated';
    registration.active = worker;
    listeners.forEach((fn) => fn());
    await pending;
    expect(order).toEqual(['subscribe while activated']);
  });
});

describe('prepared worker: register() subscribes first (Safari needs it right after the tap)', () => {
  beforeAll(() => {
    (window as any).PushManager = function PushManager() {};
  });
  afterAll(() => {
    delete (window as any).PushManager;
  });
  it('subscribes before asking for permission or anything slow, and reports the status', async () => {
    (Notification as any).permission = 'default';
    const order: string[] = [];
    const permissionMock = Notification.requestPermission as jest.Mock;
    permissionMock.mockImplementationOnce(async () => {
      order.push('permission');
      return 'granted';
    });
    const push: any = new RiviumPush({ apiKey: 'rv_live_test123', serviceWorkerScope: '/rivium-push/' });
    await push.waitForConfig();
    push.vapidPublicKey = 'BEl62iUYgUivxIkv69yViEuiBIa-Ib9-SkvMeAtA3LFgDzkrxZJjSgSnfckjBJuBkr3qBUYIHBQFLXYp5Nksh8U';
    push.serviceWorkerRegistration = {
      active: { state: 'activated' },
      installing: null,
      waiting: null,
      pushManager: {
        getSubscription: jest.fn(async () => null),
        subscribe: jest.fn(async () => {
          order.push('subscribe');
          return { endpoint: 'https://web.push.apple.com/x', toJSON: () => ({ endpoint: 'https://web.push.apple.com/x', keys: {} }) };
        }),
      },
    };
    (navigator.serviceWorker as any).register.mockClear();
    await push.register().catch(() => undefined);
    expect(order[0]).toBe('subscribe');
    expect(push.serviceWorkerRegistration.pushManager.subscribe).toHaveBeenCalledTimes(1);
    expect((navigator.serviceWorker as any).register).not.toHaveBeenCalled();
    expect(push.getWebPushStatus()).toBe('subscribed');
  });

  it('a refused subscription is reported, not thrown', async () => {
    (Notification as any).permission = 'granted';
    const push: any = new RiviumPush({ apiKey: 'rv_live_test123', serviceWorkerScope: '/rivium-push/' });
    await push.waitForConfig();
    push.vapidPublicKey = 'BEl62iUYgUivxIkv69yViEuiBIa-Ib9-SkvMeAtA3LFgDzkrxZJjSgSnfckjBJuBkr3qBUYIHBQFLXYp5Nksh8U';
    const refused = Object.assign(new Error('User denied push permission'), { name: 'NotAllowedError' });
    push.serviceWorkerRegistration = {
      active: { state: 'activated' },
      pushManager: { getSubscription: jest.fn(async () => null), subscribe: jest.fn(async () => { throw refused; }) },
    };
    await push.register().catch(() => undefined);
    expect(push.getWebPushStatus()).toBe('failed (after permission): NotAllowedError: User denied push permission');
    expect(push.webPushContextText).toMatch(/^before: notification=granted.* \| after: notification=granted.* \|\| then: notification=granted/);
  });
});

describe('one registration of the worker', () => {
  it('removes the same worker under another scope, keeps the current one and other workers', async () => {
    const push: any = new RiviumPush({ apiKey: 'rv_live_test123', serviceWorkerScope: '/' });
    const mk = (scope: string, script: string) => ({ scope, active: { scriptURL: script }, unregister: jest.fn(async () => true) });
    const current = mk('http://localhost/', 'http://localhost/rivium-push-sw.js?riviumApiKey=k');
    const old = mk('http://localhost/rivium-push/', 'http://localhost/rivium-push-sw.js?riviumApiKey=k');
    const other = mk('http://localhost/other/', 'http://localhost/other-sw.js');
    push.serviceWorkerRegistration = current;
    const original = (navigator.serviceWorker as any).getRegistrations;
    (navigator.serviceWorker as any).getRegistrations = jest.fn(async () => [current, old, other]);
    try {
      await push.removeOtherScopes();
    } finally {
      (navigator.serviceWorker as any).getRegistrations = original;
    }
    expect(old.unregister).toHaveBeenCalled();
    expect(current.unregister).not.toHaveBeenCalled();
    expect(other.unregister).not.toHaveBeenCalled();
  });
});
