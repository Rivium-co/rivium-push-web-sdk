/**
 * unregister() detaches the user on the server (as on iOS), and a
 * notification the page shows itself reports `opened` when clicked.
 */
import { jest } from '@jest/globals';
import RiviumPush from '../index';

const API_KEY = 'rv_live_test123';

function okResponse(body: any = {}) {
  return { ok: true, status: 200, json: () => Promise.resolve(body) };
}

const registerBody = {
  deviceId: 'web_test-device-id',
  appId: 'test-app-id',
  mqtt: { host: 'h', wsHost: 'h', port: 8883, wsPort: 443, token: 'mqtt-token' },
};

function mockFetch() {
  const fn = jest.fn().mockImplementation((...args: any[]) => {
    const url = args[0] as string;
    if (url.includes('/devices/config')) {
      return Promise.resolve(okResponse({ mqtt: { host: 'h', wsHost: 'h', port: 8883, wsPort: 443 } }));
    }
    if (url.includes('/devices/register')) return Promise.resolve(okResponse(registerBody));
    return Promise.resolve(okResponse({}));
  });
  (global as any).fetch = fn;
  return fn;
}

const callsTo = (fetchMock: any, fragment: string) =>
  fetchMock.mock.calls
    .filter((call: any[]) => (call[0] as string).includes(fragment))
    .map((call: any[]) => ({ url: call[0] as string, init: call[1] as any }));

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('unregister', () => {
  beforeEach(() => {
    (window as any).Notification.permission = 'granted';
    localStorage.clear();
  });

  it('detaches the signed-in user on the server and forgets it locally', async () => {
    const fetchMock = mockFetch();
    const push = new RiviumPush({ apiKey: API_KEY, autoRegisterServiceWorker: false, autoRefresh: false });
    await push.setUserId('user_1');

    await push.unregister();

    const detach = callsTo(fetchMock, '/user');
    expect(detach).toHaveLength(1);
    expect(detach[0].url).toBe(`https://push-api.rivium.co/devices/${encodeURIComponent(push.getDeviceId()!)}/user`);
    expect(detach[0].init).toEqual({ method: 'DELETE', headers: { 'x-api-key': API_KEY } });
    expect(push.getUserId()).toBeNull();
    expect(localStorage.getItem('rivium_push_user_id')).toBeNull();
  });

  it('sends nothing extra when no user is set', async () => {
    const fetchMock = mockFetch();
    const push = new RiviumPush({ apiKey: API_KEY, autoRegisterServiceWorker: false, autoRefresh: false });
    await push.unregister();
    expect(callsTo(fetchMock, '/user')).toHaveLength(0);
  });

  it('still completes when the server cannot be reached', async () => {
    const fetchMock = mockFetch();
    const push = new RiviumPush({ apiKey: API_KEY, autoRegisterServiceWorker: false, autoRefresh: false });
    await push.setUserId('user_1');
    fetchMock.mockImplementation(() => Promise.reject(new Error('offline')));
    await expect(push.unregister()).resolves.toBeUndefined();
    expect(push.getUserId()).toBeNull();
  });
});

describe('page notification receipts', () => {
  const Original = (window as any).Notification;
  let created: any[];

  beforeEach(() => {
    created = [];
    class Recording extends Original {
      constructor(title: string, options?: NotificationOptions) {
        super(title, options);
        created.push(this);
      }
    }
    (Recording as any).permission = 'granted';
    (window as any).Notification = Recording;
    (window as any).focus = jest.fn();
    localStorage.clear();
  });

  afterEach(() => {
    (window as any).Notification = Original;
  });

  it('reports a click on a page-shown notification as opened, once', async () => {
    const fetchMock = mockFetch();
    const push = new RiviumPush({ apiKey: API_KEY, autoRegisterServiceWorker: false, autoRefresh: false });
    const onClick = jest.fn();
    push.onNotificationClick(onClick as any);

    push.showNotification({ title: 'Hi', body: 'There', messageId: 'msg-1' } as any);
    expect(created).toHaveLength(1);
    created[0].onclick();
    created[0].onclick();
    await flush();

    expect(onClick).toHaveBeenCalled();
    const opened = callsTo(fetchMock, '/receipts/opened');
    expect(opened).toHaveLength(1);
    expect(opened[0].init.headers['x-api-key']).toBe(API_KEY);
    expect(JSON.parse(opened[0].init.body)).toEqual({ messageId: 'msg-1', deviceId: push.getDeviceId() });
  });
});
