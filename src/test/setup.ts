/**
 * Jest test setup file
 * Sets up browser API mocks for testing
 */

import { jest } from '@jest/globals';

// Mock localStorage
const localStorageMock = (() => {
  let store: Record<string, string> = {};
  return {
    getItem: jest.fn((key: string) => store[key] || null),
    setItem: jest.fn((key: string, value: string) => {
      store[key] = value;
    }),
    removeItem: jest.fn((key: string) => {
      delete store[key];
    }),
    clear: jest.fn(() => {
      store = {};
    }),
    get length() {
      return Object.keys(store).length;
    },
    key: jest.fn((index: number) => Object.keys(store)[index] || null),
  };
})();

Object.defineProperty(window, 'localStorage', {
  value: localStorageMock,
});

// Mock navigator
Object.defineProperty(navigator, 'onLine', {
  writable: true,
  value: true,
});

// Mock Notification API
class MockNotification {
  static permission: NotificationPermission = 'default';
  static requestPermission = jest.fn<() => Promise<NotificationPermission>>().mockResolvedValue('granted');

  title: string;
  options: NotificationOptions;

  constructor(title: string, options?: NotificationOptions) {
    this.title = title;
    this.options = options || {};
  }

  close = jest.fn();
  addEventListener = jest.fn();
  removeEventListener = jest.fn();
}

Object.defineProperty(window, 'Notification', {
  value: MockNotification,
  writable: true,
  configurable: true,
});

// Mock Service Worker
const mockServiceWorkerRegistration = {
  scope: '/',
  installing: null,
  waiting: null,
  active: {
    postMessage: jest.fn(),
    state: 'activated',
  },
  pushManager: {
    subscribe: jest.fn<() => Promise<PushSubscription>>().mockResolvedValue({
      endpoint: 'https://mock-push-endpoint.com/12345',
      getKey: jest.fn().mockReturnValue(new Uint8Array([1, 2, 3, 4])),
      toJSON: jest.fn().mockReturnValue({
        endpoint: 'https://mock-push-endpoint.com/12345',
        keys: {
          p256dh: 'mock-p256dh-key',
          auth: 'mock-auth-key',
        },
      }),
    } as unknown as PushSubscription),
    getSubscription: jest.fn<() => Promise<PushSubscription | null>>().mockResolvedValue(null),
    permissionState: jest.fn<() => Promise<PermissionState>>().mockResolvedValue('granted'),
  },
  showNotification: jest.fn<() => Promise<void>>().mockResolvedValue(undefined),
  update: jest.fn<() => Promise<void>>().mockResolvedValue(undefined),
  unregister: jest.fn<() => Promise<boolean>>().mockResolvedValue(true),
  addEventListener: jest.fn(),
  removeEventListener: jest.fn(),
};

Object.defineProperty(navigator, 'serviceWorker', {
  value: {
    register: jest.fn<() => Promise<ServiceWorkerRegistration>>().mockResolvedValue(mockServiceWorkerRegistration as unknown as ServiceWorkerRegistration),
    ready: Promise.resolve(mockServiceWorkerRegistration),
    controller: {
      postMessage: jest.fn(),
    },
    addEventListener: jest.fn(),
    removeEventListener: jest.fn(),
  },
  writable: true,
});

// Mock fetch
(global as any).fetch = jest.fn().mockImplementation((...args: any[]) => {
  const url = args[0] as string;
  // Mock /devices/config endpoint
  if (url.includes('/devices/config')) {
    return Promise.resolve({
      ok: true,
      json: () =>
        Promise.resolve({
          mqtt: {
            host: 'test-mqtt.example.com',
            wsHost: 'test-mqtt-ws.example.com',
            port: 8883,
            wsPort: 443,
          },
          vapidPublicKey: 'mock-vapid-public-key',
        }),
    });
  }

  // Mock /devices/register endpoint
  if (url.includes('/devices/register')) {
    return Promise.resolve({
      ok: true,
      json: () =>
        Promise.resolve({
          deviceId: 'web_test-device-id',
          appId: 'test-app-id',
          mqtt: {
            host: 'test-mqtt.example.com',
            wsHost: 'test-mqtt-ws.example.com',
            port: 8883,
            wsPort: 443,
            token: 'mock-mqtt-token',
          },
        }),
    });
  }

  // Default mock response
  return Promise.resolve({
    ok: true,
    json: () => Promise.resolve({}),
  });
});

// Mock document.visibilityState
Object.defineProperty(document, 'visibilityState', {
  writable: true,
  value: 'visible',
});

// Mock crypto for UUID generation
Object.defineProperty(global, 'crypto', {
  value: {
    randomUUID: jest.fn(() => 'mock-uuid-1234-5678-9012'),
    getRandomValues: jest.fn((arr: Uint8Array) => {
      for (let i = 0; i < arr.length; i++) {
        arr[i] = Math.floor(Math.random() * 256);
      }
      return arr;
    }),
  },
});

// Mock HTMLCanvasElement.getContext (jsdom doesn't support canvas)
HTMLCanvasElement.prototype.getContext = jest.fn().mockReturnValue(null) as any;

// Clear mocks between tests
beforeEach(() => {
  jest.clearAllMocks();
  localStorageMock.clear();
});
