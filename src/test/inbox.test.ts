/**
 * Message Inbox tests
 */

import { jest } from '@jest/globals';
import RiviumPush, { RiviumInbox, type InboxMessage } from '../index';

const SERVER_URL = 'https://push-api.rivium.co';
const API_KEY = 'rv_live_test123';
const DEVICE_ID = 'web_test-device-id';

function serverMessage(overrides: Partial<any> = {}) {
  return {
    id: 'msg-1',
    deviceId: DEVICE_ID,
    content: { title: 'Hello', body: 'World' },
    status: 'unread',
    createdAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function mockFetch(response: any = { messages: [], total: 0, unreadCount: 0 }, ok = true) {
  const fn = jest.fn().mockImplementation(() =>
    Promise.resolve({ ok, status: ok ? 200 : 500, json: () => Promise.resolve(response) }),
  );
  (global as any).fetch = fn;
  return fn;
}

function makeInbox(userId: string | null = null) {
  return new RiviumInbox({
    serverUrl: SERVER_URL,
    getApiKey: () => API_KEY,
    getDeviceId: () => DEVICE_ID,
    getUserId: () => userId,
    log: () => {},
    createError: (kind, details) => new Error(`${kind}: ${details}`),
  });
}

function lastCall(fetchMock: any) {
  const call = fetchMock.mock.calls[fetchMock.mock.calls.length - 1];
  return { url: call[0] as string, init: call[1] as any };
}

describe('RiviumInbox', () => {
  // ==========================================================================
  // Request shapes
  // ==========================================================================

  describe('request shapes', () => {
    it('posts device-addressed filters to /inbox/messages', async () => {
      const fetchMock = mockFetch({ messages: [serverMessage()], total: 1, unreadCount: 1 });
      const inbox = makeInbox();

      await inbox.getMessages({ status: 'unread', category: 'promotions', limit: 10, offset: 20, locale: 'fr' });

      const { url, init } = lastCall(fetchMock);
      expect(url).toBe(`${SERVER_URL}/inbox/messages`);
      expect(init.method).toBe('POST');
      expect(init.headers['x-api-key']).toBe(API_KEY);
      expect(init.headers['Content-Type']).toBe('application/json');
      expect(JSON.parse(init.body)).toEqual({
        deviceId: DEVICE_ID,
        status: 'unread',
        category: 'promotions',
        limit: 10,
        offset: 20,
        locale: 'fr',
      });
    });

    it('addresses by userId when a user is set', async () => {
      const fetchMock = mockFetch();
      await makeInbox('user-1').getMessages();

      expect(JSON.parse(lastCall(fetchMock).init.body)).toEqual({
        userId: 'user-1',
        limit: 50,
        offset: 0,
      });
    });

    it('gets a single message', async () => {
      const fetchMock = mockFetch(serverMessage({ id: 'msg-7' }));
      const message = await makeInbox().getMessage('msg-7');

      const { url, init } = lastCall(fetchMock);
      expect(url).toBe(`${SERVER_URL}/inbox/messages/msg-7`);
      expect(init.method).toBe('GET');
      expect(message.id).toBe('msg-7');
    });

    it('puts a status update when marking read or archived', async () => {
      const fetchMock = mockFetch({});
      const inbox = makeInbox();

      await inbox.markAsRead('msg-1');
      expect(lastCall(fetchMock).url).toBe(`${SERVER_URL}/inbox/messages/msg-1`);
      expect(lastCall(fetchMock).init.method).toBe('PUT');
      expect(JSON.parse(lastCall(fetchMock).init.body)).toEqual({ status: 'read' });

      await inbox.archiveMessage('msg-1');
      expect(JSON.parse(lastCall(fetchMock).init.body)).toEqual({ status: 'archived' });
    });

    it('posts mark-multiple and mark-all-read', async () => {
      const fetchMock = mockFetch({});
      const inbox = makeInbox();

      await inbox.markMultiple(['a', 'b'], 'read');
      expect(lastCall(fetchMock).url).toBe(`${SERVER_URL}/inbox/messages/mark-multiple`);
      expect(JSON.parse(lastCall(fetchMock).init.body)).toEqual({ messageIds: ['a', 'b'], status: 'read' });

      await inbox.markAllAsRead();
      expect(lastCall(fetchMock).url).toBe(`${SERVER_URL}/inbox/messages/mark-all-read`);
      expect(JSON.parse(lastCall(fetchMock).init.body)).toEqual({ deviceId: DEVICE_ID });
    });

    it('deletes a message', async () => {
      const fetchMock = mockFetch({});
      await makeInbox().deleteMessage('msg-1');

      expect(lastCall(fetchMock).url).toBe(`${SERVER_URL}/inbox/messages/msg-1`);
      expect(lastCall(fetchMock).init.method).toBe('DELETE');
    });

    it('surfaces errors from explicit calls', async () => {
      mockFetch({}, false);
      await expect(makeInbox().getMessages()).rejects.toThrow('HTTP 500');
    });
  });

  // ==========================================================================
  // Unread count bookkeeping
  // ==========================================================================

  describe('unread count', () => {
    it('takes the count from the server and notifies listeners', async () => {
      mockFetch({ messages: [serverMessage()], total: 1, unreadCount: 3 });
      const inbox = makeInbox();
      const listener = jest.fn();
      inbox.onUnreadCountChange(listener);

      await inbox.getMessages();

      expect(inbox.getUnreadCount()).toBe(3);
      expect(listener).toHaveBeenCalledWith(3);
    });

    it('decrements when a cached unread message is read, archived or deleted', async () => {
      mockFetch({
        messages: [serverMessage({ id: 'a' }), serverMessage({ id: 'b' }), serverMessage({ id: 'c' })],
        total: 3,
        unreadCount: 3,
      });
      const inbox = makeInbox();
      await inbox.getMessages();

      mockFetch({});
      await inbox.markAsRead('a');
      expect(inbox.getUnreadCount()).toBe(2);

      await inbox.markAsRead('a'); // already read - no double decrement
      expect(inbox.getUnreadCount()).toBe(2);

      await inbox.deleteMessage('b');
      expect(inbox.getUnreadCount()).toBe(1);
      expect(inbox.getCachedMessages().map((m) => m.id)).toEqual(['a', 'c']);

      await inbox.markMultiple(['c'], 'archived');
      expect(inbox.getUnreadCount()).toBe(0);
    });

    it('never goes below zero and is cleared by markAllAsRead', async () => {
      mockFetch({ messages: [serverMessage({ id: 'a' })], total: 1, unreadCount: 1 });
      const inbox = makeInbox();
      await inbox.getMessages();

      mockFetch({});
      await inbox.markAllAsRead();
      expect(inbox.getUnreadCount()).toBe(0);
      expect(inbox.getCachedMessages()[0].status).toBe('read');

      await inbox.markMultiple(['a'], 'read');
      expect(inbox.getUnreadCount()).toBe(0);
    });

    it('fetchUnreadCount asks the server for the unread page', async () => {
      const fetchMock = mockFetch({ messages: [], total: 0, unreadCount: 7 });
      const count = await makeInbox().fetchUnreadCount();

      expect(count).toBe(7);
      expect(JSON.parse(lastCall(fetchMock).init.body)).toEqual({
        deviceId: DEVICE_ID,
        status: 'unread',
        limit: 1,
        offset: 0,
      });
    });
  });

  // ==========================================================================
  // Cache persistence
  // ==========================================================================

  describe('cache', () => {
    it('persists messages and restores them into a new instance', async () => {
      mockFetch({ messages: [serverMessage({ id: 'kept' })], total: 1, unreadCount: 1 });
      await makeInbox().getMessages();

      const restored = makeInbox();
      expect(restored.getCachedMessages().map((m) => m.id)).toEqual(['kept']);
      expect(restored.getUnreadCount()).toBe(1);
    });

    it('clearCache empties memory and storage', async () => {
      mockFetch({ messages: [serverMessage()], total: 1, unreadCount: 1 });
      const inbox = makeInbox();
      await inbox.getMessages();

      inbox.clearCache();
      expect(inbox.getCachedMessages()).toEqual([]);
      expect(inbox.getUnreadCount()).toBe(0);
      expect(makeInbox().getCachedMessages()).toEqual([]);
    });

    it('keeps working when storage throws', async () => {
      const setItem = jest.spyOn(window.localStorage, 'setItem').mockImplementation(() => {
        throw new Error('QuotaExceededError');
      });
      const getItem = jest.spyOn(window.localStorage, 'getItem').mockImplementation(() => {
        throw new Error('SecurityError');
      });

      mockFetch({ messages: [serverMessage()], total: 1, unreadCount: 1 });
      const inbox = makeInbox();
      await expect(inbox.getMessages()).resolves.toBeDefined();
      expect(inbox.getCachedMessages()).toHaveLength(1);

      setItem.mockRestore();
      getItem.mockRestore();
    });

    it('ignores corrupt stored data', () => {
      window.localStorage.setItem(`rivium_push_inbox_${DEVICE_ID}`, 'not json');
      expect(makeInbox().getCachedMessages()).toEqual([]);
    });
  });

  // ==========================================================================
  // Real-time updates
  // ==========================================================================

  describe('incoming messages', () => {
    it('caches, counts and reports a new message once', () => {
      mockFetch({});
      const inbox = makeInbox();
      const onMessage = jest.fn();
      inbox.onMessage(onMessage as (m: InboxMessage) => void);

      inbox.handleIncomingPayload({
        type: 'inbox_update',
        messageId: 'live-1',
        title: 'Live',
        body: 'Update',
      });
      inbox.handleIncomingPayload({ type: 'inbox_update', messageId: 'live-1', title: 'Live', body: 'Update' });

      expect(onMessage).toHaveBeenCalledTimes(1);
      expect(inbox.getCachedMessages()).toHaveLength(1);
      expect(inbox.getCachedMessages()[0].content.title).toBe('Live');
      expect(inbox.getUnreadCount()).toBe(1);
    });

    it('ignores a payload without a message id', () => {
      mockFetch({});
      const inbox = makeInbox();
      const onMessage = jest.fn();
      inbox.onMessage(onMessage as (m: InboxMessage) => void);

      inbox.handleIncomingPayload({ type: 'inbox_update', title: 'No id' });

      expect(onMessage).not.toHaveBeenCalled();
      expect(inbox.getCachedMessages()).toEqual([]);
    });
  });
});

// ============================================================================
// Routing from the SDK
// ============================================================================

describe('inbox_update routing', () => {
  const payload = {
    type: 'inbox_update',
    messageId: 'routed-1',
    title: 'Inbox',
    body: 'Message',
  };

  function makeSdk() {
    return new RiviumPush({ apiKey: API_KEY });
  }

  it('routes real-time inbox updates to the inbox without showing a notification', () => {
    const push = makeSdk();
    const onMessage = jest.fn();
    const onInbox = jest.fn();
    push.onMessage(onMessage as any);
    push.inbox.onMessage(onInbox as (m: InboxMessage) => void);

    (document as any).visibilityState = 'hidden';
    (push as any).handleMqttMessage('topic', payload);
    (document as any).visibilityState = 'visible';

    expect(onInbox).toHaveBeenCalledTimes(1);
    expect(onMessage).not.toHaveBeenCalled();
    expect(push.inbox.getCachedMessages().map((m) => m.id)).toEqual(['routed-1']);
    expect(push.inbox.getUnreadCount()).toBe(1);
  });

  it('routes updates forwarded by the service worker', () => {
    const push = makeSdk();
    const onInbox = jest.fn();
    push.inbox.onMessage(onInbox as (m: InboxMessage) => void);

    (push as any).handleServiceWorkerMessage({
      data: { type: 'rivium-push-message', message: payload },
    } as MessageEvent);

    expect(onInbox).toHaveBeenCalledTimes(1);
  });

  it('handles the same update once when it arrives on both paths', () => {
    const push = makeSdk();
    const onInbox = jest.fn();
    push.inbox.onMessage(onInbox as (m: InboxMessage) => void);

    (push as any).handleMqttMessage('topic', payload);
    (push as any).handleServiceWorkerMessage({
      data: { type: 'rivium-push-message', message: payload },
    } as MessageEvent);

    expect(onInbox).toHaveBeenCalledTimes(1);
    expect(push.inbox.getCachedMessages()).toHaveLength(1);
  });
});
