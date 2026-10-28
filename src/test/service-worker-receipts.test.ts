/**
 * The service worker reports what the user did with a notification:
 * `opened` for a body click, `clicked` (with the action id) for an action
 * button, `dismissed` when it is closed without a click. Once per message,
 * with the same headers as the delivery ack, and next to opening the window.
 */
import { jest } from '@jest/globals';
import { readFileSync } from 'fs';
import { createContext, runInContext } from 'vm';
import { join } from 'path';

const SW_PATH = join(process.cwd(), 'service-worker.js');
const HREF =
  'https://app.example/rivium-push-sw.js?riviumApiKey=rv_live_url&riviumDeviceId=web_url&riviumServerUrl=https://push-api.rivium.co';

function loadWorker(fetchImpl?: (...args: any[]) => Promise<any>) {
  const listeners: Record<string, (event: any) => void> = {};
  const fetchMock = jest.fn(fetchImpl ?? (async () => ({ ok: true, status: 200 })));
  const openWindow = jest.fn(async () => null);
  const sandbox: any = {
    self: {
      location: { href: HREF, origin: 'https://app.example' },
      addEventListener: (type: string, fn: (event: any) => void) => {
        listeners[type] = fn;
      },
      registration: {},
      clients: { matchAll: async () => [], openWindow, claim: async () => undefined },
      skipWaiting: () => undefined,
    },
    indexedDB: { open: () => ({}) },
    fetch: fetchMock,
    console: { log: jest.fn(), warn: jest.fn(), error: jest.fn() },
    URL,
    setTimeout: (fn: () => void) => setTimeout(fn, 0),
    clearTimeout,
    Promise,
    JSON,
    Set,
  };
  sandbox.globalThis = sandbox;
  runInContext(readFileSync(SW_PATH, 'utf8'), createContext(sandbox));

  const dispatch = async (type: string, event: any) => {
    const pending: Promise<any>[] = [];
    listeners[type]({ ...event, waitUntil: (p: Promise<any>) => pending.push(p) });
    await Promise.all(pending);
  };
  return { dispatch, fetchMock, openWindow };
}

const notification = (messageId: string, extra: Record<string, any> = {}) => ({
  title: 'T',
  body: 'B',
  close: jest.fn(),
  data: { messageId, deepLink: 'https://app.example/item/1', riviumPushPayload: { messageId, ...extra } },
});

const receiptCalls = (fetchMock: jest.Mock) =>
  fetchMock.mock.calls.map((c: any[]) => ({ url: c[0], init: c[1], body: JSON.parse(c[1].body) }));

describe('service worker interaction receipts', () => {
  it('reports a body click as opened and still opens the link', async () => {
    const { dispatch, fetchMock, openWindow } = loadWorker();
    await dispatch('notificationclick', { notification: notification('m-1'), action: '' });

    expect(openWindow).toHaveBeenCalledWith('https://app.example/item/1');
    const [call] = receiptCalls(fetchMock);
    expect(call.url).toBe('https://push-api.rivium.co/receipts/opened');
    expect(call.init.method).toBe('POST');
    expect(call.init.headers['x-api-key']).toBe('rv_live_url');
    expect(call.body).toEqual({ messageId: 'm-1', deviceId: 'web_url' });
  });

  it('reports an action button as clicked with its id', async () => {
    const { dispatch, fetchMock } = loadWorker();
    await dispatch('notificationclick', {
      notification: notification('m-2', { actions: [{ id: 'reply', title: 'Reply', action: 'https://app.example/reply' }] }),
      action: 'reply',
    });
    const [call] = receiptCalls(fetchMock);
    expect(call.url).toBe('https://push-api.rivium.co/receipts/clicked');
    expect(call.body).toEqual({ messageId: 'm-2', deviceId: 'web_url', actionId: 'reply' });
  });

  it('reports a close without a click as dismissed', async () => {
    const { dispatch, fetchMock } = loadWorker();
    await dispatch('notificationclose', { notification: notification('m-3') });
    const [call] = receiptCalls(fetchMock);
    expect(call.url).toBe('https://push-api.rivium.co/receipts/dismissed');
    expect(call.body).toEqual({ messageId: 'm-3', deviceId: 'web_url' });
  });

  it('reports each message once and skips notifications without an id', async () => {
    const { dispatch, fetchMock } = loadWorker();
    await dispatch('notificationclick', { notification: notification('m-4'), action: '' });
    await dispatch('notificationclick', { notification: notification('m-4'), action: '' });
    await dispatch('notificationclick', { notification: { ...notification(''), data: {} }, action: '' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('retries a transient failure and never rejects', async () => {
    const responses = [{ ok: false, status: 503 }, { ok: true, status: 200 }];
    const { dispatch, fetchMock } = loadWorker(async () => responses.shift());
    await dispatch('notificationclick', { notification: notification('m-5'), action: '' });
    expect(fetchMock).toHaveBeenCalledTimes(2);

    const offline = loadWorker(async () => {
      throw new Error('offline');
    });
    await expect(
      offline.dispatch('notificationclick', { notification: notification('m-6'), action: '' }),
    ).resolves.toBeUndefined();
    expect(offline.openWindow).toHaveBeenCalled();
    expect(offline.fetchMock).toHaveBeenCalledTimes(3);
  });

  it('does not retry a permanent rejection', async () => {
    const { dispatch, fetchMock } = loadWorker(async () => ({ ok: false, status: 404 }));
    await dispatch('notificationclose', { notification: notification('m-7') });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
