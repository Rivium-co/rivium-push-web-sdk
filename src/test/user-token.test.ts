/**
 * Signed user token tests: the token manager, the Push API transport and the
 * SDK wiring.
 */

import { jest } from '@jest/globals';
import RiviumPush, { RiviumInbox, type AuthErrorEvent } from '../index';
import { PushApiClient, UserTokenManager, readTokenClaims } from '../user-token';

const SERVER_URL = 'https://push-api.rivium.co';
const API_KEY = 'rv_live_test123';

function b64url(value: string): string {
  return btoa(value).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** An unsigned JWT-shaped token; `n` makes otherwise equal tokens differ. */
function jwt(claims: Record<string, any>, n = 0): string {
  return `${b64url('{"alg":"ES256"}')}.${b64url(JSON.stringify({ ...claims, n }))}.sig`;
}

const NOW = 1_800_000_000_000;
const inSeconds = (s: number) => Math.floor(NOW / 1000) + s;

function okResponse(body: any = {}) {
  return { ok: true, status: 200, json: () => Promise.resolve(body) };
}

function errorResponse(status: number, body: any) {
  const response: any = { ok: false, status, json: () => Promise.resolve(body) };
  response.clone = () => response;
  return response;
}

const registerBody = {
  deviceId: 'web_test-device-id',
  appId: 'test-app-id',
  mqtt: { host: 'h', wsHost: 'h', port: 8883, wsPort: 443, token: 'mqtt-token' },
};

/** Mocks fetch by URL: `routes` maps a path fragment to a list of responses (the last one repeats). */
function mockFetchByUrl(routes: Record<string, any[]> = {}) {
  const queues: Record<string, any[]> = {};
  for (const key of Object.keys(routes)) queues[key] = routes[key].slice();
  const fn = jest.fn().mockImplementation((...args: any[]) => {
    const url = args[0] as string;
    for (const key of Object.keys(queues)) {
      if (url.includes(key)) {
        const queue = queues[key];
        return Promise.resolve(queue.length > 1 ? queue.shift() : queue[0]);
      }
    }
    if (url.includes('/devices/config')) {
      return Promise.resolve(okResponse({ mqtt: { host: 'h', wsHost: 'h', port: 8883, wsPort: 443 } }));
    }
    if (url.includes('/devices/register')) return Promise.resolve(okResponse(registerBody));
    return Promise.resolve(okResponse({}));
  });
  (global as any).fetch = fn;
  return fn;
}

function callsTo(fetchMock: any, fragment: string): Array<{ url: string; init: any }> {
  return fetchMock.mock.calls
    .filter((call: any[]) => (call[0] as string).includes(fragment))
    .map((call: any[]) => ({ url: call[0] as string, init: call[1] as any }));
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

// ============================================================================
// readTokenClaims
// ============================================================================

describe('readTokenClaims', () => {
  it('reads exp and sub from a JWT payload', () => {
    expect(readTokenClaims(jwt({ sub: 'user_1', exp: 123 }))).toEqual({ exp: 123, sub: 'user_1' });
  });

  it('reads a non-ASCII sub', () => {
    const payload = b64url(unescape(encodeURIComponent(JSON.stringify({ sub: 'kullanıcı' }))));
    expect(readTokenClaims(`h.${payload}.s`).sub).toBe('kullanıcı');
  });

  it('never throws on a bad token', () => {
    for (const bad of ['', 'abc', 'a.b.c', 'a.%%%.c', `a.${b64url('not json')}.c`, `a.${b64url('"str"')}.c`, null, 42]) {
      expect(readTokenClaims(bad as any)).toEqual({});
    }
    expect(readTokenClaims(jwt({ sub: 7, exp: 'soon' }))).toEqual({});
  });
});

// ============================================================================
// UserTokenManager
// ============================================================================

describe('UserTokenManager', () => {
  it('caches the token until 60 s before exp', async () => {
    let now = NOW;
    const provider = jest
      .fn<() => Promise<string>>()
      .mockResolvedValueOnce(jwt({ sub: 'u', exp: inSeconds(300) }, 1))
      .mockResolvedValueOnce(jwt({ sub: 'u', exp: inSeconds(900) }, 2));
    const tokens = new UserTokenManager(provider, () => now);

    const first = await tokens.get();
    now = NOW + 239_000; // 61 s left
    expect(await tokens.get()).toBe(first);
    expect(provider).toHaveBeenCalledTimes(1);

    now = NOW + 241_000; // 59 s left
    const second = await tokens.get();
    expect(second).not.toBe(first);
    expect(provider).toHaveBeenCalledTimes(2);
  });

  it('reuses a token without exp until told otherwise', async () => {
    let now = NOW;
    const provider = jest.fn<() => Promise<string>>().mockResolvedValue('opaque-token');
    const tokens = new UserTokenManager(provider, () => now);

    await tokens.get();
    now = NOW + 10 * 365 * 24 * 3600 * 1000;
    expect(await tokens.get()).toBe('opaque-token');
    expect(provider).toHaveBeenCalledTimes(1);
  });

  it('shares one in-flight provider call between concurrent callers', async () => {
    let release!: (token: string) => void;
    const provider = jest.fn(() => new Promise<string>((resolve) => (release = resolve)));
    const tokens = new UserTokenManager(provider, () => NOW);

    const all = Promise.all([tokens.get(), tokens.get(), tokens.refresh()]);
    release(jwt({ sub: 'u', exp: inSeconds(300) }));
    const [a, b, c] = await all;

    expect(provider).toHaveBeenCalledTimes(1);
    expect(a).toBe(b);
    expect(b).toBe(c);
  });

  it('refresh() fetches a new token even when the cached one is valid', async () => {
    const provider = jest
      .fn<() => Promise<string>>()
      .mockResolvedValueOnce(jwt({ exp: inSeconds(300) }, 1))
      .mockResolvedValueOnce(jwt({ exp: inSeconds(300) }, 2));
    const tokens = new UserTokenManager(provider, () => NOW);

    const first = await tokens.get();
    const second = await tokens.refresh();
    expect(second).not.toBe(first);
    expect(await tokens.get()).toBe(second);
    expect(provider).toHaveBeenCalledTimes(2);
  });

  it('clear() forgets the token and ignores a provider call already in flight', async () => {
    let release!: (token: string) => void;
    const provider = jest
      .fn<() => Promise<string>>()
      .mockImplementationOnce(() => new Promise<string>((resolve) => (release = resolve)))
      .mockResolvedValueOnce('token-b');
    const tokens = new UserTokenManager(provider, () => NOW);

    const stale = tokens.get();
    tokens.clear();
    release('token-a');
    await stale;

    expect(tokens.hasToken()).toBe(false);
    expect(await tokens.get()).toBe('token-b');
    expect(provider).toHaveBeenCalledTimes(2);
  });

  it('treats null and empty provider results as signed out', async () => {
    const provider = jest
      .fn<() => Promise<string | null>>()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce('');
    const tokens = new UserTokenManager(provider, () => NOW);

    expect(await tokens.get()).toBeNull();
    expect(await tokens.get()).toBeNull();
    expect(tokens.hasToken()).toBe(false);
  });

  it('rejects when the provider throws, rejects or times out', async () => {
    const throwing = new UserTokenManager((() => {
      throw new Error('sync boom');
    }) as any);
    await expect(throwing.get()).rejects.toThrow('sync boom');

    const rejecting = new UserTokenManager(() => Promise.reject(new Error('boom')));
    await expect(rejecting.get()).rejects.toThrow('boom');

    const hanging = new UserTokenManager(() => new Promise<string>(() => {}), Date.now, 20);
    await expect(hanging.get()).rejects.toThrow('timed out');
  });

  it('keeps a hand-set token until it expires when there is no provider', async () => {
    let now = NOW;
    const tokens = new UserTokenManager(null, () => now);
    expect(tokens.hasSource()).toBe(false);

    const token = jwt({ sub: 'user_1', exp: inSeconds(120) });
    tokens.setToken(token);
    expect(tokens.hasSource()).toBe(true);
    expect(tokens.subject()).toBe('user_1');

    now = NOW + 90_000; // inside the margin, not expired
    expect(await tokens.get()).toBe(token);
    now = NOW + 121_000; // expired
    expect(await tokens.get()).toBeNull();
    expect(tokens.hasSource()).toBe(false);
  });

  it('setProvider() replaces the provider and drops the cached token', async () => {
    const tokens = new UserTokenManager(() => Promise.resolve('token-a'), () => NOW);
    expect(await tokens.get()).toBe('token-a');
    tokens.setProvider(() => Promise.resolve('token-b'));
    expect(await tokens.get()).toBe('token-b');
    tokens.setProvider(null);
    expect(await tokens.get()).toBeNull();
  });
});

// ============================================================================
// PushApiClient (HTTP layer)
// ============================================================================

describe('PushApiClient', () => {
  const URL = `${SERVER_URL}/topics/subscribe`;
  const init = () => ({
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': API_KEY },
    body: '{"deviceId":"d","topic":"news"}',
  });

  function makeClient(provider: any) {
    const errors: AuthErrorEvent[] = [];
    const tokens = new UserTokenManager(provider, () => NOW);
    const client = new PushApiClient(tokens, (event) => errors.push(event));
    return { client, tokens, errors };
  }

  it('without a provider calls fetch synchronously with the untouched arguments', () => {
    const fetchMock = mockFetchByUrl();
    const { client } = makeClient(null);
    const request = init();

    client.fetch(URL, request);

    // Same tick, same objects: nothing about the request changed.
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe(URL);
    expect(fetchMock.mock.calls[0][1]).toBe(request);
    expect(request.headers).toEqual({ 'Content-Type': 'application/json', 'x-api-key': API_KEY });
  });

  it('adds x-user-token when the provider returns a token, keeping the rest', async () => {
    const fetchMock = mockFetchByUrl();
    const token = jwt({ sub: 'u', exp: inSeconds(300) });
    const { client, errors } = makeClient(() => Promise.resolve(token));

    await client.fetch(URL, init());

    const sent = fetchMock.mock.calls[0][1] as any;
    expect(sent.headers).toEqual({ 'Content-Type': 'application/json', 'x-api-key': API_KEY, 'x-user-token': token });
    expect(sent.method).toBe('POST');
    expect(sent.body).toBe(init().body);
    expect(errors).toEqual([]);
  });

  it('sends no header when the provider returns null (signed out) and reports nothing', async () => {
    const fetchMock = mockFetchByUrl();
    const { client, errors } = makeClient(() => Promise.resolve(null));

    await client.fetch(URL, init());

    expect((fetchMock.mock.calls[0][1] as any).headers).toEqual(init().headers);
    expect(errors).toEqual([]);
  });

  it('retries exactly once with a fresh token on 401 token_expired', async () => {
    const expired = errorResponse(401, { statusCode: 401, code: 'token_expired', message: 'expired' });
    const fetchMock = mockFetchByUrl({ '/topics/subscribe': [expired, okResponse({ done: true })] });
    const provider = jest
      .fn<() => Promise<string>>()
      .mockResolvedValueOnce(jwt({ exp: inSeconds(300) }, 1))
      .mockResolvedValueOnce(jwt({ exp: inSeconds(300) }, 2));
    const { client, errors } = makeClient(provider);

    const response = await client.fetch(URL, init());

    expect(response.ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(provider).toHaveBeenCalledTimes(2);
    const [first, second] = fetchMock.mock.calls.map((call: any[]) => call[1].headers['x-user-token']);
    expect(first).toBe(jwt({ exp: inSeconds(300) }, 1));
    expect(second).toBe(jwt({ exp: inSeconds(300) }, 2));
    expect(errors).toEqual([]);
  });

  it('never loops: a second token_expired is returned and reported', async () => {
    const expired = errorResponse(401, { code: 'token_expired', message: 'expired' });
    const fetchMock = mockFetchByUrl({ '/topics/subscribe': [expired] });
    let n = 0;
    const { client, errors } = makeClient(() => Promise.resolve(jwt({ exp: inSeconds(300) }, ++n)));

    const response = await client.fetch(URL, init());

    expect(response.status).toBe(401);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(errors.map((e) => e.code)).toEqual(['token_expired']);
  });

  it('does not retry on token_invalid and reports it', async () => {
    const invalid = errorResponse(401, { code: 'token_invalid', message: 'bad signature' });
    const fetchMock = mockFetchByUrl({ '/topics/subscribe': [invalid] });
    const provider = jest.fn<() => Promise<string>>().mockResolvedValue(jwt({ exp: inSeconds(300) }));
    const { client, errors, tokens } = makeClient(provider);

    const response = await client.fetch(URL, init());

    expect(response.status).toBe(401);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(provider).toHaveBeenCalledTimes(1);
    expect(errors).toEqual([{ code: 'token_invalid', message: 'bad signature' }]);
    expect(tokens.hasToken()).toBe(false);
  });

  it('reports token_required when signed out against a strict project', async () => {
    const required = errorResponse(401, { code: 'token_required', message: 'token required' });
    const fetchMock = mockFetchByUrl({ '/topics/subscribe': [required] });
    const { client, errors } = makeClient(() => Promise.resolve(null));

    await client.fetch(URL, init());

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(errors.map((e) => e.code)).toEqual(['token_required']);
  });

  it('reports token_mismatch on the 403 and does not retry', async () => {
    const mismatch = errorResponse(403, { statusCode: 403, message: 'userId does not match the user token' });
    const fetchMock = mockFetchByUrl({ '/topics/subscribe': [mismatch] });
    const { client, errors } = makeClient(() => Promise.resolve(jwt({ sub: 'a', exp: inSeconds(300) })));

    const response = await client.fetch(URL, init());

    expect(response.status).toBe(403);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(errors.map((e) => e.code)).toEqual(['token_mismatch']);
  });

  it('ignores unrelated 401/403 responses', async () => {
    mockFetchByUrl({
      '/topics/subscribe': [errorResponse(401, { message: 'Invalid API key' }), errorResponse(403, { message: 'Forbidden' })],
    });
    const { client, errors } = makeClient(() => Promise.resolve(jwt({ exp: inSeconds(300) })));

    await client.fetch(URL, init());
    await client.fetch(URL, init());

    expect(errors).toEqual([]);
  });

  it('still sends the request, without the header, when the provider fails', async () => {
    const fetchMock = mockFetchByUrl();
    const boom = new Error('backend down');
    const { client, errors } = makeClient(() => Promise.reject(boom));

    const response = await client.fetch(URL, init());

    expect(response.ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect((fetchMock.mock.calls[0][1] as any).headers).toEqual(init().headers);
    expect(errors).toEqual([{ code: 'token_provider_failed', message: 'tokenProvider failed', error: boom }]);
  });

  it('a throwing auth-error listener does not break the request', async () => {
    mockFetchByUrl();
    const tokens = new UserTokenManager(() => Promise.reject(new Error('x')));
    const client = new PushApiClient(tokens, () => {
      throw new Error('listener bug');
    });
    await expect(client.fetch(URL, init())).resolves.toMatchObject({ ok: true });
  });
});

// ============================================================================
// SDK wiring
// ============================================================================

describe('RiviumPush user token', () => {
  beforeEach(() => {
    (window as any).Notification.permission = 'granted';
  });

  /** All calls except the constructor-time config fetch. */
  const apiCalls = (fetchMock: any) =>
    fetchMock.mock.calls.filter((call: any[]) => !(call[0] as string).includes('/devices/config'));

  it('without a provider sends no x-user-token on any request', async () => {
    const fetchMock = mockFetchByUrl();
    const push = new RiviumPush({ apiKey: API_KEY, autoRegisterServiceWorker: false, autoRefresh: false });

    // The config request leaves in the constructor, as before.
    expect(callsTo(fetchMock, '/devices/config')).toHaveLength(1);

    await push.setUserId('user_1');
    await push.subscribeTopic('news');
    await push.unsubscribeTopic('news');
    await push.inbox.getMessages();
    await push.inApp.fetchMessages();
    await push.clearUserId();

    expect(fetchMock.mock.calls.length).toBeGreaterThanOrEqual(7);
    for (const call of fetchMock.mock.calls as any[][]) {
      expect(Object.keys(call[1].headers).map((h) => h.toLowerCase())).not.toContain('x-user-token');
    }
    expect(callsTo(fetchMock, '/devices/register')[0].init.headers).toEqual({
      'Content-Type': 'application/json',
      'x-api-key': API_KEY,
    });
    expect(callsTo(fetchMock, '/user')[0].init).toEqual({ method: 'DELETE', headers: { 'x-api-key': API_KEY } });
  });

  it('sends the token on register, topics, inbox, in-app and clearUserId', async () => {
    const fetchMock = mockFetchByUrl();
    const token = jwt({ sub: 'user_1', exp: Math.floor(Date.now() / 1000) + 600 });
    const tokenProvider = jest.fn<() => Promise<string>>().mockResolvedValue(token);
    const push = new RiviumPush({ apiKey: API_KEY, autoRegisterServiceWorker: false, autoRefresh: false, tokenProvider });

    await push.setUserId('user_1');
    await push.subscribeTopic('news');
    await push.unsubscribeTopic('news');
    await push.inbox.getMessages();
    await push.inApp.fetchMessages();
    await push.refreshMqttToken();
    await push.clearUserId();

    for (const fragment of ['/devices/config', '/devices/register', '/topics/subscribe', '/topics/unsubscribe', '/inbox/', '/in-app/fetch', '/mqtt-token/refresh', '/user']) {
      const calls = callsTo(fetchMock, fragment);
      expect(calls.length).toBeGreaterThanOrEqual(1);
      expect(calls[0].init.headers['x-user-token']).toBe(token);
      expect(calls[0].init.headers['x-api-key']).toBe(API_KEY);
    }
    // One provider call served every request.
    expect(tokenProvider).toHaveBeenCalledTimes(1);
    // userId still travels in the body exactly as before.
    expect(JSON.parse(callsTo(fetchMock, '/devices/register')[0].init.body).userId).toBe('user_1');
  });

  it('setUserId drops a token that belongs to another user and asks the provider again', async () => {
    const fetchMock = mockFetchByUrl();
    const exp = Math.floor(Date.now() / 1000) + 600;
    const tokenA = jwt({ sub: 'alice', exp });
    const tokenB = jwt({ sub: 'bob', exp });
    const tokenProvider = jest.fn<() => Promise<string>>().mockResolvedValueOnce(tokenA).mockResolvedValue(tokenB);
    const push = new RiviumPush({ apiKey: API_KEY, autoRegisterServiceWorker: false, autoRefresh: false, tokenProvider });

    await push.setUserId('alice');
    await push.setUserId('alice');
    expect(tokenProvider).toHaveBeenCalledTimes(1);

    await push.setUserId('bob');
    expect(tokenProvider).toHaveBeenCalledTimes(2);
    const registers = callsTo(fetchMock, '/devices/register');
    expect(registers.map((c) => c.init.headers['x-user-token'])).toEqual([tokenA, tokenA, tokenB]);
  });

  it('clearUserId sends the current token, then forgets it', async () => {
    const fetchMock = mockFetchByUrl();
    const token = jwt({ sub: 'alice', exp: Math.floor(Date.now() / 1000) + 600 });
    const tokenProvider = jest.fn<() => Promise<string | null>>().mockResolvedValueOnce(token).mockResolvedValue(null);
    const push = new RiviumPush({ apiKey: API_KEY, autoRegisterServiceWorker: false, autoRefresh: false, tokenProvider });

    await push.setUserId('alice');
    await push.clearUserId();
    expect(callsTo(fetchMock, '/user')[0].init.headers['x-user-token']).toBe(token);

    await push.subscribeTopic('news');
    expect(tokenProvider).toHaveBeenCalledTimes(2);
    expect(callsTo(fetchMock, '/topics/subscribe')[0].init.headers['x-user-token']).toBeUndefined();
  });

  it('registration succeeds and onAuthError fires when the provider fails', async () => {
    const fetchMock = mockFetchByUrl();
    const push = new RiviumPush({
      apiKey: API_KEY,
      autoRegisterServiceWorker: false,
      autoRefresh: false,
      tokenProvider: () => Promise.reject(new Error('no session')),
    });
    const errors: AuthErrorEvent[] = [];
    push.onAuthError((event) => errors.push(event));

    await expect(push.setUserId('alice')).resolves.toBeUndefined();

    const register = callsTo(fetchMock, '/devices/register')[0];
    expect(register.init.headers).toEqual({ 'Content-Type': 'application/json', 'x-api-key': API_KEY });
    expect(errors.length).toBeGreaterThanOrEqual(1);
    expect(errors.every((e) => e.code === 'token_provider_failed')).toBe(true);
  });

  it('setUserToken and setTokenProvider work after init', async () => {
    const fetchMock = mockFetchByUrl();
    const push = new RiviumPush({ apiKey: API_KEY, autoRegisterServiceWorker: false, autoRefresh: false });
    const exp = Math.floor(Date.now() / 1000) + 600;
    const manual = jwt({ sub: 'alice', exp }, 1);
    const provided = jwt({ sub: 'alice', exp }, 2);

    push.setUserToken(manual);
    await push.subscribeTopic('a');
    push.setUserToken(null);
    await push.subscribeTopic('b');
    push.setTokenProvider(() => Promise.resolve(provided));
    await push.subscribeTopic('c');
    push.setTokenProvider(null);
    await push.subscribeTopic('d');

    const sent = callsTo(fetchMock, '/topics/subscribe').map((c) => c.init.headers['x-user-token']);
    expect(sent).toEqual([manual, undefined, provided, undefined]);
  });

  it('never stores the token in localStorage and never logs it', async () => {
    mockFetchByUrl();
    const token = jwt({ sub: 'alice', exp: Math.floor(Date.now() / 1000) + 600 });
    const spies = (['log', 'info', 'warn', 'error', 'debug'] as const).map((m) =>
      jest.spyOn(console, m).mockImplementation(() => {}),
    );
    const push = new RiviumPush({
      apiKey: API_KEY,
      autoRegisterServiceWorker: false,
      autoRefresh: false,
      logLevel: 5,
      tokenProvider: () => Promise.resolve(token),
    });
    push.setUserToken(token);
    await push.setUserId('alice');
    await flush();

    const stored = (localStorage.setItem as any).mock.calls.map((call: any[]) => String(call[1])).join('\n');
    expect(stored).not.toContain(token);
    const logged = spies.flatMap((spy) => spy.mock.calls.map((call) => call.map(String).join(' '))).join('\n');
    expect(logged).not.toContain(token);
    spies.forEach((spy) => spy.mockRestore());
  });
});

describe('RiviumInbox transport', () => {
  it('uses plain fetch when no transport is wired', async () => {
    const fetchMock = mockFetchByUrl({ '/inbox/': [okResponse({ messages: [], total: 0, unreadCount: 0 })] });
    const inbox = new RiviumInbox({
      serverUrl: SERVER_URL,
      getApiKey: () => API_KEY,
      getDeviceId: () => 'web_d',
      getUserId: () => null,
      log: () => {},
      createError: (kind, details) => new Error(`${kind}: ${details}`),
    });

    await inbox.getMessages();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][1]).toMatchObject({ headers: { 'x-api-key': API_KEY, 'Content-Type': 'application/json' } });
  });
});
