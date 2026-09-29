/**
 * Real-time connection: socket settings, endpoint failover wiring, one socket
 * at a time, token refresh on "not authorized", and the lifecycle triggers
 * (online / visible / focus / pageshow) that reconnect or check the connection.
 */
import { jest } from '@jest/globals';
import { RiviumPush } from '../index';
import { sockets, PNState } from './__mocks__/pn-protocol';

const API_KEY = 'rv_live_61aabb6a08a1fa3f37fbe030f1dccc9f';

function setVisibility(state: 'visible' | 'hidden') {
  // setup.ts makes visibilityState a writable own property
  (document as any).visibilityState = state;
  Object.defineProperty(document, 'hidden', { configurable: true, get: () => document.visibilityState === 'hidden' });
}

function client(): any {
  const c: any = new RiviumPush({ apiKey: API_KEY });
  c.mqttConfig = { host: 'mqtt.example', wsHost: 'ws.example', port: 8883, wsPort: 443, token: 'tok-1' };
  c.mqttConfigFetched = true;
  c.appId = 'app16chars000000';
  c.deviceId = 'web_device';
  c.subscriptionId = 'sub-1';
  return c;
}

const live = () => sockets.filter((s) => !s.closed);
const current = () => sockets[sockets.length - 1];

let started: any[] = [];
const originalFetch = (global as any).fetch;
function connected(): any {
  const c = client();
  started.push(c);
  c.connectToGateway();
  return c;
}

beforeEach(() => {
  sockets.length = 0;
  started = [];
  setVisibility('visible');
  jest.useFakeTimers();
  jest.setSystemTime(new Date('2026-09-29T10:00:00Z'));
});

afterEach(() => {
  started.forEach((c) => c.disconnectFromGateway());
  (global as any).fetch = originalFetch;
  jest.useRealTimers();
});

describe('socket settings', () => {
  it('uses 30 s keepalive, backoff 1 s..60 s and never gives up by default', () => {
    connected();
    expect(sockets).toHaveLength(1);
    const cfg = current().config;
    expect(cfg.heartbeatInterval).toBe(30);
    expect(cfg.autoReconnect).toBe(true);
    expect(cfg.maxReconnectAttempts).toBe(0);
    expect(cfg.reconnectDelay).toBe(1000);
    expect(cfg.maxReconnectDelay).toBe(60000);
    expect(cfg.gateway).toBe('ws.example');
    expect(cfg.port).toBe(443);
    expect(cfg.secure).toBe(true);
    expect(cfg.wsPath).toBe('/mqtt');
    expect(current().openCalls).toBe(1);
  });

  it('still honours an explicit maxReconnectAttempts', () => {
    const c: any = new RiviumPush({ apiKey: API_KEY, maxReconnectAttempts: 7 });
    Object.assign(c, { mqttConfig: { host: 'h', wsHost: 'ws.example', port: 1, wsPort: 443, token: 't' }, appId: 'a', deviceId: 'd' });
    started.push(c);
    c.connectToGateway();
    expect(current().config.maxReconnectAttempts).toBe(7);
  });
});

describe('endpoints', () => {
  it('without mqttEndpoints only today\'s default URL is used', () => {
    const c = connected();
    expect(current().endpointProvider!()).toEqual([{ host: 'ws.example', port: 443, secure: true, path: '/mqtt' }]);
    expect(c.serverEndpoints).toBeNull();
  });

  it('parses mqttEndpoints from the register response and orders: winner, list, default', async () => {
    const c = client();
    started.push(c);
    const fetchMock = jest.fn<(...args: any[]) => Promise<any>>(async () => ({
      ok: true,
      json: async () => ({
        deviceId: 'web_device',
        appId: 'app16chars000000',
        mqtt: { token: 'tok-2' },
        mqttEndpoints: [
          { host: 'a.example', port: 443, tls: true, path: '/mqtt', extra: 1 },
          { host: 'b.example', port: 8443 },
          { host: '', port: 443 },
        ],
      }),
    }));
    (global as any).fetch = fetchMock;
    await c.registerDevice({});
    // the constructor's config fetch resolved meanwhile; pin the test gateway again
    c.mqttConfig = { host: 'mqtt.example', wsHost: 'ws.example', port: 8883, wsPort: 443, token: 'tok-2' };
    expect(c.serverEndpoints).toEqual([
      { host: 'a.example', port: 443, secure: true, path: '/mqtt' },
      { host: 'b.example', port: 8443, secure: true, path: '/mqtt' },
    ]);
    expect(JSON.parse(localStorage.getItem('rivium_push_mqtt_endpoints')!)).toHaveLength(2);

    c.connectToGateway();
    const provider = current().endpointProvider!;
    expect(provider().map((e: any) => e.host)).toEqual(['a.example', 'b.example', 'ws.example']);

    // b worked: it goes first next time, and is remembered across page loads
    current().simulateConnected({ host: 'b.example', port: 8443, secure: true, path: '/mqtt' });
    expect(provider().map((e: any) => e.host)).toEqual(['b.example', 'a.example', 'ws.example']);
    const next = client();
    started.push(next);
    next.connectToGateway();
    expect(current().endpointProvider!().map((e: any) => e.host)).toEqual(['b.example', 'a.example', 'ws.example']);

    // a later response without the field goes back to the default only
    fetchMock.mockImplementation(async () => ({ ok: true, json: async () => ({ deviceId: 'web_device', mqtt: { token: 't' } }) }));
    await c.registerDevice({});
    expect(localStorage.getItem('rivium_push_mqtt_endpoints')).toBeNull();
    c.connectToGateway();
    expect(current().endpointProvider!().map((e: any) => e.host)).toEqual(['ws.example']);
  });
});

describe('one socket at a time', () => {
  it('closes the previous socket before opening a new one', () => {
    const c = connected();
    c.connectToGateway();
    c.connectToGateway();
    expect(sockets).toHaveLength(3);
    expect(live()).toHaveLength(1);
  });

  it('ignores events from a replaced socket', () => {
    const c = connected();
    const old = current();
    c.connectToGateway();
    const states: string[] = [];
    c.onConnectionState((s: string) => states.push(s));
    old.simulateConnected();
    old.simulateLost();
    expect(states).toEqual([]);
    expect(c.isConnected()).toBe(false);
  });

  it('streams each channel once, across reconnects', () => {
    const c = connected();
    c.subscribedTopics = new Set(['news']);
    current().simulateConnected();
    const first = [...current().streamCalls];
    expect(first).toEqual([
      'rivium_push/app16chars000000/sub/sub-1',
      'rivium_push/app16chars000000/broadcast',
      `rivium_push/app16chars000000/web_device/${window.location.origin}`,
      'rivium_push/app16chars000000/topic/news',
    ]);
    current().simulateLost();
    current().simulateConnected();
    expect(current().streamCalls).toEqual(first);
    expect(c.isConnected()).toBe(true);
  });

  it('reports reconnect attempts to onReconnecting', () => {
    const c = connected();
    const seen: any[] = [];
    c.onReconnecting((s: any) => seen.push(s));
    current().simulateConnected();
    current().simulateLost();
    expect(seen).toEqual([{ retryAttempt: 1, nextRetryMs: 1000, maxRetryAttempts: 0 }]);
  });
});

describe('auth rejection', () => {
  it('refreshes the token once and reconnects the same socket with it', async () => {
    const c = connected();
    const fetchMock = jest.fn<(...args: any[]) => Promise<any>>(async () => ({ ok: true, json: async () => ({ token: 'tok-fresh' }) }));
    (global as any).fetch = fetchMock;
    current().simulateError('Connection refused: Not authorized');
    current().simulateError('Connection refused: Not authorized');
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect((fetchMock.mock.calls[0] as any[])[0]).toContain('/mqtt-token/refresh');
    expect(current().config.auth).toEqual({ type: 'token', token: 'tok-fresh' });
    expect(current().reconnectCalls).toEqual([false]);
    expect(sockets).toHaveLength(1);
  });
});

describe('lifecycle triggers', () => {
  it('does nothing before a connection was started', () => {
    client();
    window.dispatchEvent(new Event('online'));
    window.dispatchEvent(new Event('focus'));
    expect(sockets).toHaveLength(0);
  });

  it('online reconnects now (backoff reset) while waiting to retry', () => {
    connected();
    current().simulateConnected();
    current().simulateLost();
    expect(current().state).toBe(PNState.RECONNECTING);
    window.dispatchEvent(new Event('online'));
    expect(current().reconnectCalls).toEqual([false]);
  });

  it('visible, focus and pageshow together cause one reconnect (1 s debounce)', () => {
    connected();
    current().simulateLost();
    document.dispatchEvent(new Event('visibilitychange'));
    window.dispatchEvent(new Event('focus'));
    window.dispatchEvent(new Event('pageshow'));
    expect(current().reconnectCalls).toHaveLength(1);

    current().simulateLost();
    jest.advanceTimersByTime(1001);
    window.dispatchEvent(new Event('focus'));
    expect(current().reconnectCalls).toHaveLength(2);
    expect(sockets).toHaveLength(1);
  });

  it('becoming hidden does not reconnect', () => {
    connected();
    current().simulateLost();
    setVisibility('hidden');
    document.dispatchEvent(new Event('visibilitychange'));
    window.dispatchEvent(new Event('focus'));
    expect(current().reconnectCalls).toHaveLength(0);
  });

  it('checks a "connected" socket after the page was hidden a long time', () => {
    connected();
    current().simulateConnected();
    current().lastActivity = Date.now();
    setVisibility('hidden');
    document.dispatchEvent(new Event('visibilitychange'));
    jest.advanceTimersByTime(5 * 60_000);
    current().lastActivity = Date.now(); // not silent: only the hidden time matters here
    setVisibility('visible');
    document.dispatchEvent(new Event('visibilitychange'));
    expect(current().probeCalls).toEqual([5000]);
    expect(current().reconnectCalls).toHaveLength(0);
  });

  it('does not check after a short hide', () => {
    connected();
    current().simulateConnected();
    current().lastActivity = Date.now();
    setVisibility('hidden');
    document.dispatchEvent(new Event('visibilitychange'));
    jest.advanceTimersByTime(3000);
    current().lastActivity = Date.now();
    setVisibility('visible');
    document.dispatchEvent(new Event('visibilitychange'));
    expect(current().probeCalls).toEqual([]);
  });

  it('checks the connection on a bfcache restore and when the network returns', () => {
    connected();
    current().simulateConnected();
    current().lastActivity = Date.now();
    const restored = new Event('pageshow') as any;
    restored.persisted = true;
    window.dispatchEvent(restored);
    expect(current().probeCalls).toHaveLength(1);
    jest.advanceTimersByTime(1001);
    current().lastActivity = Date.now();
    window.dispatchEvent(new Event('online'));
    expect(current().probeCalls).toHaveLength(2);
  });

  it('does not interrupt a connect in progress', () => {
    connected();
    expect(current().state).toBe(PNState.CONNECTING);
    window.dispatchEvent(new Event('online'));
    expect(current().reconnectCalls).toHaveLength(0);
    expect(current().probeCalls).toHaveLength(0);
  });

  it('removes its listeners on disconnect / unregister', async () => {
    const c = connected();
    const removeSpy = jest.spyOn(window, 'removeEventListener');
    const socket = current();
    await c.unregister();
    expect(socket.closed).toBe(true);
    expect(c.lifecycleListeners).toHaveLength(0);
    expect(removeSpy.mock.calls.map((call) => call[0]).sort()).toEqual(['focus', 'online', 'pageshow']);
    window.dispatchEvent(new Event('online'));
    window.dispatchEvent(new Event('focus'));
    expect(socket.reconnectCalls).toHaveLength(0);
    expect(sockets).toHaveLength(1);
    removeSpy.mockRestore();
  });
});
