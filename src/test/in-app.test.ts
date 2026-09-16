/**
 * In-App Messages tests
 */

import { jest } from '@jest/globals';
import {
  InAppMessages,
  isInAppMessageEligible,
  selectInAppMessages,
  type InAppConfig,
  type InAppMessage,
} from '../index';

const SERVER_URL = 'https://push-api.rivium.co';
const API_KEY = 'rv_live_test123';
const DEVICE_ID = 'web_test-device-id';

function serverMessage(overrides: Partial<any> = {}) {
  return {
    id: 'msg-1',
    name: 'Welcome',
    type: 'modal',
    content: {
      title: 'Hello',
      body: 'World',
      buttons: [{ id: 'btn-1', text: 'Learn more', action: 'url', value: 'https://rivium.co' }],
    },
    triggerType: 'on_app_open',
    maxImpressions: 1,
    minSessionCount: 0,
    delaySeconds: 0,
    priority: 0,
    ...overrides,
  };
}

function message(overrides: Partial<InAppMessage> = {}): InAppMessage {
  return {
    id: 'msg-1',
    name: 'Welcome',
    type: 'modal',
    content: { title: 'Hello', body: 'World' },
    triggerType: 'on_app_open',
    triggerEvent: null,
    triggerConditions: null,
    startDate: null,
    endDate: null,
    maxImpressions: 1,
    minSessionCount: 0,
    delaySeconds: 0,
    priority: 0,
    ...overrides,
  };
}

function mockFetch(response: any = [], ok = true) {
  const fn = jest.fn().mockImplementation(() =>
    Promise.resolve({ ok, status: ok ? 200 : 500, json: () => Promise.resolve(response) }),
  );
  (global as any).fetch = fn;
  return fn;
}

function makeInApp(config: InAppConfig = {}, userId: string | null = null) {
  return new InAppMessages({
    serverUrl: SERVER_URL,
    getApiKey: () => API_KEY,
    getDeviceId: () => DEVICE_ID,
    getUserId: () => userId,
    log: () => {},
    config,
  });
}

function callsTo(fetchMock: any, path: string) {
  return fetchMock.mock.calls.filter((call: any[]) => call[0] === `${SERVER_URL}${path}`);
}

function bodyOf(call: any[]) {
  return JSON.parse(call[1].body);
}

/** Waits for the promise chain kicked off by a trigger/report to settle. */
async function flush() {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

function shadowOf(): ShadowRoot {
  const host = document.body.querySelector('[data-rivium-in-app]') as HTMLElement;
  expect(host).not.toBeNull();
  return host.shadowRoot as ShadowRoot;
}

describe('InAppMessages', () => {
  beforeEach(() => {
    localStorage.clear();
    document.body.innerHTML = '';
    jest.useRealTimers();
  });

  // ==========================================================================
  // Request shapes
  // ==========================================================================

  describe('request shapes', () => {
    it('posts the device context to /in-app/fetch', async () => {
      const fetchMock = mockFetch([serverMessage()]);
      const inApp = makeInApp({ locale: 'fr-CA' }, 'user-1');

      await inApp.fetchMessages();

      const call = callsTo(fetchMock, '/in-app/fetch')[0];
      expect(call[1].method).toBe('POST');
      expect(call[1].headers['x-api-key']).toBe(API_KEY);
      expect(call[1].headers['Content-Type']).toBe('application/json');
      expect(bodyOf(call)).toEqual({
        deviceId: DEVICE_ID,
        sessionCount: 0,
        locale: 'fr-CA',
        userId: 'user-1',
      });
    });

    it('passes trigger and event filters through', async () => {
      const fetchMock = mockFetch([]);
      await makeInApp({ locale: 'en' }).fetchMessages({ trigger: 'on_event', event: 'checkout' });

      expect(bodyOf(callsTo(fetchMock, '/in-app/fetch')[0])).toEqual({
        deviceId: DEVICE_ID,
        sessionCount: 0,
        locale: 'en',
        trigger: 'on_event',
        event: 'checkout',
      });
    });

    it('posts impressions to /in-app/impression with the button id', async () => {
      const fetchMock = mockFetch({ success: true });
      const inApp = makeInApp({}, 'user-1');

      await inApp.recordImpression('msg-1', 'button_click', 'btn-1');

      expect(bodyOf(callsTo(fetchMock, '/in-app/impression')[0])).toEqual({
        messageId: 'msg-1',
        deviceId: DEVICE_ID,
        action: 'button_click',
        userId: 'user-1',
        buttonId: 'btn-1',
      });
    });

    it('never throws when reporting fails', async () => {
      (global as any).fetch = jest.fn().mockImplementation(() => Promise.reject(new Error('offline')));
      await expect(makeInApp().recordImpression('msg-1', 'impression')).resolves.toBeUndefined();
    });

    it('keeps cached messages when a fetch fails', async () => {
      mockFetch([serverMessage()]);
      const inApp = makeInApp({ locale: 'en' });
      await inApp.fetchMessages();

      mockFetch([], false);
      const messages = await inApp.fetchMessages();
      expect(messages.map((m) => m.id)).toEqual(['msg-1']);
    });
  });

  // ==========================================================================
  // Eligibility as a pure function
  // ==========================================================================

  describe('eligibility', () => {
    const base = { trigger: 'on_app_open' as const, sessionCount: 5, impressions: {}, now: 1_000 };

    it('requires the trigger to match', () => {
      expect(isInAppMessageEligible(message({ triggerType: 'manual' }), base)).toBe(false);
      expect(isInAppMessageEligible(message(), base)).toBe(true);
    });

    it('requires the event name to match for on_event', () => {
      const context = { ...base, trigger: 'on_event' as const, event: 'checkout' };
      const msg = message({ triggerType: 'on_event', triggerEvent: 'checkout' });
      expect(isInAppMessageEligible(msg, context)).toBe(true);
      expect(isInAppMessageEligible(msg, { ...context, event: 'other' })).toBe(false);
    });

    it('honours minSessionCount', () => {
      const msg = message({ minSessionCount: 6 });
      expect(isInAppMessageEligible(msg, base)).toBe(false);
      expect(isInAppMessageEligible(msg, { ...base, sessionCount: 6 })).toBe(true);
    });

    it('honours maxImpressions', () => {
      const msg = message({ maxImpressions: 2 });
      expect(isInAppMessageEligible(msg, { ...base, impressions: { 'msg-1': 1 } })).toBe(true);
      expect(isInAppMessageEligible(msg, { ...base, impressions: { 'msg-1': 2 } })).toBe(false);
    });

    it('honours the schedule window', () => {
      const msg = message({
        startDate: '2026-01-01T00:00:00.000Z',
        endDate: '2026-02-01T00:00:00.000Z',
      });
      const inside = new Date('2026-01-15T00:00:00.000Z').getTime();
      expect(isInAppMessageEligible(msg, { ...base, now: inside })).toBe(true);
      expect(isInAppMessageEligible(msg, { ...base, now: inside - 40 * 86400000 })).toBe(false);
      expect(isInAppMessageEligible(msg, { ...base, now: inside + 40 * 86400000 })).toBe(false);
    });

    it('orders eligible messages by priority', () => {
      const selected = selectInAppMessages(
        [message({ id: 'a', priority: 1 }), message({ id: 'b', priority: 9 })],
        base,
      );
      expect(selected.map((m) => m.id)).toEqual(['b', 'a']);
    });
  });

  // ==========================================================================
  // Triggers
  // ==========================================================================

  describe('triggers', () => {
    it('shows the highest-priority message for on_app_open', async () => {
      mockFetch([
        serverMessage({ id: 'low', priority: 1 }),
        serverMessage({ id: 'high', priority: 5, content: { title: 'Top', body: 'Pick me' } }),
      ]);
      const inApp = makeInApp();

      await inApp.triggerOnAppOpen();
      await flush();

      expect(shadowOf().querySelector('.title')?.textContent).toBe('Top');
    });

    it('matches on_event by event name', async () => {
      mockFetch([
        serverMessage({ id: 'other', triggerType: 'on_event', triggerEvent: 'signup' }),
        serverMessage({
          id: 'wanted',
          triggerType: 'on_event',
          triggerEvent: 'checkout',
          content: { title: 'Checkout', body: 'Done' },
        }),
      ]);
      const inApp = makeInApp();

      await inApp.triggerEvent('checkout');
      await flush();

      expect(shadowOf().querySelector('.title')?.textContent).toBe('Checkout');
    });

    it('shows nothing when no message matches', async () => {
      mockFetch([serverMessage({ triggerType: 'manual' })]);
      await makeInApp().triggerOnAppOpen();
      await flush();

      expect(document.body.querySelector('[data-rivium-in-app]')).toBeNull();
    });

    it('does not show a second message while one is on screen', async () => {
      mockFetch([serverMessage()]);
      const inApp = makeInApp();

      await inApp.triggerOnAppOpen();
      await flush();
      await inApp.triggerOnAppOpen();
      await flush();

      expect(document.body.querySelectorAll('[data-rivium-in-app]')).toHaveLength(1);
    });

    it('counts a session and respects minSessionCount', async () => {
      mockFetch([serverMessage({ minSessionCount: 2 })]);
      const inApp = makeInApp();

      await inApp.triggerSessionStart();
      await flush();
      expect(inApp.getSessionCount()).toBe(1);
      expect(document.body.querySelector('[data-rivium-in-app]')).toBeNull();
    });

    it('does nothing when disabled', async () => {
      const fetchMock = mockFetch([serverMessage()]);
      await makeInApp({ enabled: false }).triggerOnAppOpen();
      await flush();

      expect(callsTo(fetchMock, '/in-app/fetch')).toHaveLength(0);
      expect(document.body.querySelector('[data-rivium-in-app]')).toBeNull();
    });
  });

  // ==========================================================================
  // Rendering
  // ==========================================================================

  describe('rendering', () => {
    it.each([
      ['modal', 'center', 'dialog'],
      ['banner', 'top', 'status'],
      ['fullscreen', 'fill', 'dialog'],
      ['card', 'bottom', 'status'],
    ])('renders a %s into the shadow root', async (type, placement, role) => {
      mockFetch([serverMessage({ type, content: { title: 'T', body: 'B', imageUrl: 'https://x/i.png' } })]);
      const inApp = makeInApp();

      await inApp.triggerOnAppOpen();
      await flush();

      const shadow = shadowOf();
      expect(shadow.querySelector('.layer')?.className).toContain(placement);
      const panel = shadow.querySelector('.panel') as HTMLElement;
      expect(panel.className).toContain(type);
      expect(panel.getAttribute('role')).toBe(role);
      expect(shadow.querySelector('.title')?.textContent).toBe('T');
      expect(shadow.querySelector('.text')?.textContent).toBe('B');
      expect(shadow.querySelector('img.image')?.getAttribute('src')).toBe('https://x/i.png');
      expect(shadow.querySelector('.close')?.getAttribute('aria-label')).toBe('Close');
    });

    it('marks modals as dialogs and banners as live regions', async () => {
      mockFetch([serverMessage({ type: 'banner' })]);
      const inApp = makeInApp({ bannerPosition: 'bottom' });

      await inApp.triggerOnAppOpen();
      await flush();

      const panel = shadowOf().querySelector('.panel') as HTMLElement;
      expect(panel.getAttribute('aria-live')).toBe('polite');
      expect(panel.getAttribute('aria-modal')).toBeNull();
      expect(shadowOf().querySelector('.layer')?.className).toContain('bottom');
    });

    it('sets aria-modal and a backdrop on modals', async () => {
      mockFetch([serverMessage()]);
      await makeInApp().triggerOnAppOpen();
      await flush();

      const shadow = shadowOf();
      expect(shadow.querySelector('.panel')?.getAttribute('aria-modal')).toBe('true');
      expect(shadow.querySelector('.backdrop')).not.toBeNull();
    });

    it('uses localized content for the configured locale', async () => {
      mockFetch([
        serverMessage({
          localizations: [{ locale: 'fr', content: { title: 'Bonjour', body: 'Salut' } }],
        }),
      ]);
      await makeInApp({ locale: 'fr-FR' }).triggerOnAppOpen();
      await flush();

      expect(shadowOf().querySelector('.title')?.textContent).toBe('Bonjour');
    });

    it('caps the number of buttons', async () => {
      mockFetch([
        serverMessage({
          content: {
            title: 'T',
            body: 'B',
            buttons: [1, 2, 3, 4, 5].map((n) => ({ id: `b${n}`, text: `B${n}`, action: 'dismiss' })),
          },
        }),
      ]);
      await makeInApp().triggerOnAppOpen();
      await flush();

      expect(shadowOf().querySelectorAll('.actions button')).toHaveLength(3);
    });
  });

  // ==========================================================================
  // Buttons and dismissal
  // ==========================================================================

  describe('buttons', () => {
    it('opens the URL, reports the click and closes', async () => {
      const fetchMock = mockFetch([serverMessage()]);
      const open = jest.fn();
      (window as any).open = open;
      const clicked = jest.fn();
      const inApp = makeInApp();
      inApp.onButtonClicked(clicked as any);

      await inApp.triggerOnAppOpen();
      await flush();
      (shadowOf().querySelector('.actions button') as HTMLElement).click();
      await flush();

      expect(open).toHaveBeenCalledWith('https://rivium.co', '_blank', 'noopener,noreferrer');
      expect(clicked).toHaveBeenCalled();
      const click = callsTo(fetchMock, '/in-app/impression').map(bodyOf).find((b: any) => b.action === 'button_click');
      expect(click).toMatchObject({ messageId: 'msg-1', buttonId: 'btn-1' });
      expect(document.body.querySelector('[data-rivium-in-app]')).toBeNull();
    });

    it('keeps a custom-action message open and lets the app decide', async () => {
      mockFetch([
        serverMessage({
          content: { title: 'T', body: 'B', buttons: [{ id: 'c1', text: 'Go', action: 'custom' }] },
        }),
      ]);
      const clicked = jest.fn();
      const inApp = makeInApp();
      inApp.onButtonClicked(clicked as any);

      await inApp.triggerOnAppOpen();
      await flush();
      (shadowOf().querySelector('.actions button') as HTMLElement).click();
      await flush();

      expect(clicked).toHaveBeenCalled();
      expect(document.body.querySelector('[data-rivium-in-app]')).not.toBeNull();
    });
  });

  describe('dismissal', () => {
    async function show(inApp: InAppMessages) {
      await inApp.triggerOnAppOpen();
      await flush();
    }

    it('closes on the close button', async () => {
      const fetchMock = mockFetch([serverMessage()]);
      const dismissed = jest.fn();
      const inApp = makeInApp();
      inApp.onDismissed(dismissed as any);

      await show(inApp);
      (shadowOf().querySelector('.close') as HTMLElement).click();
      await flush();

      expect(document.body.querySelector('[data-rivium-in-app]')).toBeNull();
      expect(dismissed).toHaveBeenCalled();
      expect(callsTo(fetchMock, '/in-app/impression').map(bodyOf).filter((b: any) => b.action === 'dismiss')).toHaveLength(1);
    });

    it('closes on a backdrop click', async () => {
      mockFetch([serverMessage()]);
      const inApp = makeInApp();
      await show(inApp);

      (shadowOf().querySelector('.backdrop') as HTMLElement).click();
      await flush();
      expect(document.body.querySelector('[data-rivium-in-app]')).toBeNull();
    });

    it('closes on Escape', async () => {
      mockFetch([serverMessage()]);
      const inApp = makeInApp();
      await show(inApp);

      const host = document.body.querySelector('[data-rivium-in-app]') as HTMLElement;
      host.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      await flush();
      expect(document.body.querySelector('[data-rivium-in-app]')).toBeNull();
    });

    it('ignores Escape for banners', async () => {
      mockFetch([serverMessage({ type: 'banner' })]);
      const inApp = makeInApp();
      await show(inApp);

      const host = document.body.querySelector('[data-rivium-in-app]') as HTMLElement;
      host.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      await flush();
      expect(document.body.querySelector('[data-rivium-in-app]')).not.toBeNull();
    });

    it('reports a dismissal only once', async () => {
      const fetchMock = mockFetch([serverMessage()]);
      const inApp = makeInApp();
      await show(inApp);

      inApp.dismissCurrentMessage();
      inApp.dismissCurrentMessage();
      await flush();

      expect(callsTo(fetchMock, '/in-app/impression').map(bodyOf).filter((b: any) => b.action === 'dismiss')).toHaveLength(1);
    });
  });

  // ==========================================================================
  // Focus management
  // ==========================================================================

  describe('focus', () => {
    it('moves focus into the dialog and restores it on close', async () => {
      mockFetch([serverMessage()]);
      const trigger = document.createElement('button');
      document.body.appendChild(trigger);
      trigger.focus();
      expect(document.activeElement).toBe(trigger);

      const inApp = makeInApp();
      await inApp.triggerOnAppOpen();
      await flush();

      const shadow = shadowOf();
      expect(shadow.activeElement).toBe(shadow.querySelector('.actions button'));

      inApp.dismissCurrentMessage();
      await flush();
      expect(document.activeElement).toBe(trigger);
    });

    it('wraps Tab inside the dialog', async () => {
      mockFetch([serverMessage()]);
      const inApp = makeInApp();
      await inApp.triggerOnAppOpen();
      await flush();

      const shadow = shadowOf();
      const buttons = Array.from(shadow.querySelectorAll('.panel button')) as HTMLElement[];
      const last = buttons[buttons.length - 1];
      last.focus();

      const host = document.body.querySelector('[data-rivium-in-app]') as HTMLElement;
      host.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }));
      expect(shadow.activeElement).toBe(buttons[0]);

      host.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true }));
      expect(shadow.activeElement).toBe(last);
    });
  });

  // ==========================================================================
  // Manual display mode
  // ==========================================================================

  describe('manual display', () => {
    it('inserts no DOM and fires onMessageReady', async () => {
      const fetchMock = mockFetch([serverMessage()]);
      const ready = jest.fn();
      const inApp = makeInApp({ display: 'manual' });
      inApp.onMessageReady(ready as any);

      await inApp.triggerOnAppOpen();
      await flush();

      expect(document.body.querySelector('[data-rivium-in-app]')).toBeNull();
      expect(ready).toHaveBeenCalledTimes(1);
      expect(callsTo(fetchMock, '/in-app/impression').map(bodyOf).filter((b: any) => b.action === 'impression')).toHaveLength(1);
    });
  });

  // ==========================================================================
  // Impressions and storage
  // ==========================================================================

  describe('impressions', () => {
    it('reports one impression per display', async () => {
      const fetchMock = mockFetch([serverMessage({ maxImpressions: 5 })]);
      const inApp = makeInApp();

      await inApp.triggerOnAppOpen();
      await flush();
      await inApp.triggerOnAppOpen(); // already showing — must not report again
      await flush();

      expect(callsTo(fetchMock, '/in-app/impression').map(bodyOf).filter((b: any) => b.action === 'impression')).toHaveLength(1);
    });

    it('stops showing a message once maxImpressions is reached', async () => {
      mockFetch([serverMessage({ maxImpressions: 1 })]);
      const inApp = makeInApp();

      await inApp.triggerOnAppOpen();
      await flush();
      inApp.dismissCurrentMessage();
      await flush();

      await inApp.triggerOnAppOpen();
      await flush();
      expect(document.body.querySelector('[data-rivium-in-app]')).toBeNull();
    });

    it('clearCache resets counts and cached messages', async () => {
      mockFetch([serverMessage()]);
      const inApp = makeInApp();
      await inApp.fetchMessages();
      expect(inApp.getCachedMessages()).toHaveLength(1);

      inApp.clearCache();
      expect(inApp.getCachedMessages()).toHaveLength(0);
      expect(inApp.getSessionCount()).toBe(0);
    });
  });

  describe('storage failures', () => {
    it('keeps working when localStorage throws', async () => {
      const getItem = jest.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
        throw new Error('blocked');
      });
      const setItem = jest.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
        throw new Error('blocked');
      });

      mockFetch([serverMessage()]);
      const inApp = makeInApp();
      await inApp.triggerOnAppOpen();
      await flush();

      expect(shadowOf().querySelector('.title')?.textContent).toBe('Hello');

      getItem.mockRestore();
      setItem.mockRestore();
    });

    it('ignores corrupt stored state', async () => {
      localStorage.setItem(`rivium_push_inapp_${DEVICE_ID}`, '{not json');
      const inApp = makeInApp();
      expect(inApp.getCachedMessages()).toEqual([]);
    });
  });
});
