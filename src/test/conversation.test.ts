/**
 * data.conversationId: the messages of one conversation stack in one notification (tag), with the sender's photo.
 * Checked on the helper the page uses and on the service worker, which has its own copy.
 */
import { jest } from '@jest/globals';
import { readFileSync } from 'fs';
import { createContext, runInContext } from 'vm';
import { join } from 'path';
import { conversationOf, conversationView } from '../conversation';

describe('conversation helper (page)', () => {
  it('reads the keys, ignores a bad avatar, falls back to the title', () => {
    expect(conversationOf({ senderName: 'x' }, 'T')).toBeNull();
    const c = conversationOf({ conversationId: 'r', senderAvatarUrl: 'javascript:x', conversationIsGroup: 'TRUE' }, 'T')!;
    expect(c).toMatchObject({ id: 'r', senderName: 'T', isGroup: true });
    expect(c.avatarUrl).toBeUndefined();
  });

  it('a group shows its name and "sender: text"; at most 5 lines', () => {
    const c = conversationOf({ conversationId: 'r', senderName: '@sara', conversationIsGroup: true, conversationTitle: 'Family' }, 'T')!;
    const v = conversationView(c, 'six', ['1', '2', '3', '4', '5']);
    expect(v.title).toBe('Family');
    expect(v.lines).toEqual(['2', '3', '4', '5', '@sara: six']);
  });
});

describe('service worker', () => {
  function loadWorker() {
    const listeners: Record<string, (event: any) => void> = {};
    const shown: Array<{ title: string; options: any }> = [];
    const registration = {
      showNotification: jest.fn(async (title: string, options: any) => {
        const i = shown.findIndex((n) => n.options.tag === options.tag);
        if (i >= 0) shown.splice(i, 1);
        shown.push({ title, options });
      }),
      getNotifications: jest.fn(async ({ tag }: { tag: string }) =>
        shown.filter((n) => n.options.tag === tag).map((n) => ({ data: n.options.data })),
      ),
    };
    const sandbox: any = {
      self: {
        location: { href: 'https://app.example/rivium-push-sw.js?riviumApiKey=rv_live_url&riviumDeviceId=web_url&riviumServerUrl=https://push-api.rivium.co', origin: 'https://app.example' },
        addEventListener: (type: string, fn: (event: any) => void) => {
          listeners[type] = fn;
        },
        registration,
        clients: { matchAll: async () => [], openWindow: jest.fn(), claim: async () => undefined },
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
    const push = async (payload: any) => {
      const pending: Promise<any>[] = [];
      listeners.push({ data: { json: () => payload }, waitUntil: (p: Promise<any>) => pending.push(p) });
      await Promise.all(pending);
    };
    return { push, shown };
  }

  it('stacks one conversation in one notification with the sender photo', async () => {
    const { push, shown } = loadWorker();
    const data = { conversationId: 'room-1', senderName: '@kian', senderAvatarUrl: 'https://cdn.example/k.jpg' };
    await push({ title: '@kian', body: 'salam', messageId: 'm1', imageUrl: 'https://cdn.example/big.jpg', data });
    await push({ title: '@kian', body: 'khoobi?', messageId: 'm2', data });
    await push({ title: 'Lino', body: 'plain', messageId: 'm3', data: {} });

    expect(shown).toHaveLength(2);
    const conv = shown.find((n) => n.options.tag === 'rivium-conversation:room-1')!;
    expect(conv.title).toBe('@kian');
    expect(conv.options.body).toBe('salam\nkhoobi?');
    expect(conv.options.icon).toBe('https://cdn.example/k.jpg');
    expect(conv.options.image).toBeUndefined();
    const plain = shown.find((n) => n.title === 'Lino')!;
    expect(plain.options.tag).toBe('m3');
  });
});

describe('page without a service worker (Flutter web)', () => {
  it('one notification per conversation: same tag, earlier lines kept, sender photo', async () => {
    const { default: RiviumPush } = await import('../index');
    const shown: any[] = [];
    const Original = (window as any).Notification;
    class Capture {
      static permission = 'granted';
      static requestPermission = Original.requestPermission;
      onclick: any = null;
      onclose: any = null;
      close = jest.fn();
      constructor(public title: string, public options: any) {
        shown.push(this);
      }
    }
    Object.defineProperty(window, 'Notification', { value: Capture, writable: true, configurable: true });
    try {
      const push: any = new RiviumPush({ apiKey: 'rv_live_test123' });
      push.serviceWorkerRegistration = null;
      const data = { conversationId: 'room-1', senderName: '@kian', senderAvatarUrl: 'https://cdn.example/k.jpg' };
      push.showRichNotification({ title: '@kian', body: 'salam', messageId: 'm1', data });
      push.showRichNotification({ title: '@kian', body: 'khoobi?', messageId: 'm2', data });
      expect(shown).toHaveLength(2);
      expect(shown[1].options.tag).toBe('rivium-conversation:room-1');
      expect(shown[1].options.body).toBe('salam\nkhoobi?');
      expect(shown[1].options.icon).toBe('https://cdn.example/k.jpg');
    } finally {
      Object.defineProperty(window, 'Notification', { value: Original, writable: true, configurable: true });
    }
  });
});
