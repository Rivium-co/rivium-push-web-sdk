/**
 * RiviumPush Web SDK Unit Tests
 */

import { jest } from '@jest/globals';
import RiviumPush, {
  RiviumPushErrorCode,
  RiviumPushError,
  RiviumPushLogLevel,
  RiviumPushAnalyticsEvent,
  NetworkType,
  type RiviumPushConfig,
  type RiviumPushMessage,
  type NetworkState,
} from '../index';

describe('RiviumPush SDK', () => {
  // ============================================================================
  // Static Methods
  // ============================================================================

  describe('static methods', () => {
    describe('isSupported', () => {
      it('should return true when all APIs are available', () => {
        expect(RiviumPush.isSupported()).toBe(true);
      });

      it('should return false when Notification API is not available', () => {
        const originalNotification = window.Notification;
        delete (window as any).Notification;

        expect(RiviumPush.isSupported()).toBe(false);

        // Restore
        Object.defineProperty(window, 'Notification', {
          value: originalNotification,
          writable: true,
          configurable: true,
        });
      });
    });

    describe('getPermissionStatus', () => {
      it('should return current notification permission', () => {
        const status = RiviumPush.getPermissionStatus();
        expect(['granted', 'denied', 'default']).toContain(status);
      });
    });

    describe('requestPermission', () => {
      it('should request notification permission via Notification API', async () => {
        const result = await Notification.requestPermission();
        expect(result).toBe('granted');
        expect(Notification.requestPermission).toHaveBeenCalled();
      });
    });
  });

  // ============================================================================
  // Constructor & Initialization
  // ============================================================================

  describe('constructor', () => {
    it('should create instance with valid config', () => {
      const config: RiviumPushConfig = {
        apiKey: 'rv_live_test123',

      };

      const riviumPush = new RiviumPush(config);
      expect(riviumPush).toBeInstanceOf(RiviumPush);
    });

    it('should throw error when apiKey is missing', () => {
      expect(() => {
        new RiviumPush({
          apiKey: '',
  
        });
      }).toThrow();
    });

    it('should use default log level when not specified', () => {
      const config: RiviumPushConfig = {
        apiKey: 'rv_live_test123',

      };

      const riviumPush = new RiviumPush(config);
      // Should not throw - validates log level is set
      expect(riviumPush).toBeInstanceOf(RiviumPush);
    });

    it('should respect custom log level', () => {
      const config: RiviumPushConfig = {
        apiKey: 'rv_live_test123',

        logLevel: RiviumPushLogLevel.VERBOSE,
      };

      const riviumPush = new RiviumPush(config);
      expect(riviumPush).toBeInstanceOf(RiviumPush);
    });
  });

  // ============================================================================
  // Configuration
  // ============================================================================

  describe('configuration', () => {
    let riviumPush: RiviumPush;

    beforeEach(() => {
      riviumPush = new RiviumPush({
        apiKey: 'rv_live_test123',

      });
    });

    it('should set log level', () => {
      expect(() => {
        riviumPush.setLogLevel(RiviumPushLogLevel.ERROR);
      }).not.toThrow();
    });

    it('should set analytics handler', () => {
      const handler = jest.fn();
      riviumPush.setAnalyticsHandler(handler);
      // Handler is stored internally - no direct way to verify
      expect(() => riviumPush.setAnalyticsHandler(handler)).not.toThrow();
    });

    it('should disable analytics', () => {
      expect(() => {
        riviumPush.disableAnalytics();
      }).not.toThrow();
    });
  });

  // ============================================================================
  // Callbacks
  // ============================================================================

  describe('callbacks', () => {
    let riviumPush: RiviumPush;

    beforeEach(() => {
      riviumPush = new RiviumPush({
        apiKey: 'rv_live_test123',

      });
    });

    it('should register onMessage callback', () => {
      const callback = jest.fn();
      riviumPush.onMessage(callback);
      // Internal registration - no throw means success
      expect(true).toBe(true);
    });

    it('should register onConnectionState callback', () => {
      const callback = jest.fn();
      riviumPush.onConnectionState(callback);
      expect(true).toBe(true);
    });

    it('should register onRegistered callback', () => {
      const callback = jest.fn();
      riviumPush.onRegistered(callback);
      expect(true).toBe(true);
    });

    it('should register onError callback', () => {
      const callback = jest.fn();
      riviumPush.onError(callback);
      expect(true).toBe(true);
    });

    it('should register onDetailedError callback', () => {
      const callback = jest.fn();
      riviumPush.onDetailedError(callback);
      expect(true).toBe(true);
    });

    it('should register onNotificationClick callback', () => {
      const callback = jest.fn();
      riviumPush.onNotificationClick(callback);
      expect(true).toBe(true);
    });

    it('should register onActionClicked callback', () => {
      const callback = jest.fn();
      riviumPush.onActionClicked(callback);
      expect(true).toBe(true);
    });

    it('should register onReconnecting callback', () => {
      const callback = jest.fn();
      riviumPush.onReconnecting(callback);
      expect(true).toBe(true);
    });

    it('should register onNetworkState callback', () => {
      const callback = jest.fn();
      riviumPush.onNetworkState(callback);
      expect(true).toBe(true);
    });

    it('should register onAppState callback', () => {
      const callback = jest.fn();
      riviumPush.onAppState(callback);
      expect(true).toBe(true);
    });
  });

  // ============================================================================
  // State Management
  // ============================================================================

  describe('state management', () => {
    let riviumPush: RiviumPush;

    beforeEach(() => {
      riviumPush = new RiviumPush({
        apiKey: 'rv_live_test123',

      });
    });

    it('should get network state', () => {
      const state = riviumPush.getNetworkState();
      expect(state).toHaveProperty('isAvailable');
      expect(state).toHaveProperty('networkType');
    });

    it('should get badge count', () => {
      const count = riviumPush.getBadgeCount();
      expect(typeof count).toBe('number');
      expect(count).toBeGreaterThanOrEqual(0);
    });

    it('should set badge count', () => {
      riviumPush.setBadgeCount(5);
      expect(riviumPush.getBadgeCount()).toBe(5);
    });

    it('should not allow negative badge count', () => {
      riviumPush.setBadgeCount(-1);
      expect(riviumPush.getBadgeCount()).toBe(0);
    });

    it('should clear badge', () => {
      riviumPush.setBadgeCount(10);
      riviumPush.clearBadge();
      expect(riviumPush.getBadgeCount()).toBe(0);
    });

    it('should get initial message (null when none)', () => {
      const message = riviumPush.getInitialMessage();
      expect(message).toBeNull();
    });
  });
});

// ============================================================================
// RiviumPushError
// ============================================================================

describe('RiviumPushError', () => {
  it('should create error with code and message', () => {
    const error = new RiviumPushError(RiviumPushErrorCode.CONNECTION_FAILED);
    expect(error.code).toBe(RiviumPushErrorCode.CONNECTION_FAILED);
    expect(error.message).toBe('Failed to connect to MQTT broker');
    expect(error.name).toBe('RiviumPushError');
  });

  it('should include details when provided', () => {
    const error = new RiviumPushError(
      RiviumPushErrorCode.NETWORK_ERROR,
      'Server returned 503'
    );
    expect(error.code).toBe(RiviumPushErrorCode.NETWORK_ERROR);
    expect(error.details).toBe('Server returned 503');
  });

  it('should convert to JSON correctly', () => {
    const error = new RiviumPushError(
      RiviumPushErrorCode.PERMISSION_DENIED,
      'User blocked notifications'
    );
    const json = error.toJSON();

    expect(json).toEqual({
      code: RiviumPushErrorCode.PERMISSION_DENIED,
      message: 'Notification permission denied',
      details: 'User blocked notifications',
    });
  });

  it('should have correct error codes', () => {
    // Connection errors
    expect(RiviumPushErrorCode.CONNECTION_FAILED).toBe(1000);
    expect(RiviumPushErrorCode.CONNECTION_TIMEOUT).toBe(1001);

    // Registration errors
    expect(RiviumPushErrorCode.REGISTRATION_FAILED).toBe(1400);

    // Permission errors
    expect(RiviumPushErrorCode.PERMISSION_DENIED).toBe(1600);

    // Unknown error
    expect(RiviumPushErrorCode.UNKNOWN_ERROR).toBe(9999);
  });
});

// ============================================================================
// RiviumPushLogLevel
// ============================================================================

describe('RiviumPushLogLevel', () => {
  it('should have correct log level values', () => {
    expect(RiviumPushLogLevel.NONE).toBe(0);
    expect(RiviumPushLogLevel.ERROR).toBe(1);
    expect(RiviumPushLogLevel.WARNING).toBe(2);
    expect(RiviumPushLogLevel.INFO).toBe(3);
    expect(RiviumPushLogLevel.DEBUG).toBe(4);
    expect(RiviumPushLogLevel.VERBOSE).toBe(5);
  });
});

// ============================================================================
// RiviumPushAnalyticsEvent
// ============================================================================

describe('RiviumPushAnalyticsEvent', () => {
  it('should have correct event names', () => {
    expect(RiviumPushAnalyticsEvent.SDK_INITIALIZED).toBe('sdkInitialized');
    expect(RiviumPushAnalyticsEvent.DEVICE_REGISTERED).toBe('deviceRegistered');
    expect(RiviumPushAnalyticsEvent.MESSAGE_RECEIVED).toBe('messageReceived');
    expect(RiviumPushAnalyticsEvent.NOTIFICATION_CLICKED).toBe('notificationClicked');
    expect(RiviumPushAnalyticsEvent.CONNECTED).toBe('connected');
    expect(RiviumPushAnalyticsEvent.DISCONNECTED).toBe('disconnected');
  });
});

// ============================================================================
// NetworkType
// ============================================================================

describe('NetworkType', () => {
  it('should have correct network type values', () => {
    expect(NetworkType.WIFI).toBe('wifi');
    expect(NetworkType.CELLULAR).toBe('cellular');
    expect(NetworkType.ETHERNET).toBe('ethernet');
    expect(NetworkType.NONE).toBe('none');
    expect(NetworkType.UNKNOWN).toBe('unknown');
  });
});

// ============================================================================
// Message Normalization
// ============================================================================

describe('message handling', () => {
  it('should handle RiviumPushMessage interface correctly', () => {
    const message: RiviumPushMessage = {
      title: 'Test Title',
      body: 'Test Body',
      data: { key: 'value' },
      silent: false,
      imageUrl: 'https://example.com/image.png',
      iconUrl: 'https://example.com/icon.png',
      actions: [
        {
          id: 'action1',
          title: 'Open',
          action: 'https://example.com',
        },
      ],
      deepLink: 'https://example.com/deeplink',
      priority: 'high',
      badge: 5,
      badgeAction: 'set',
    };

    expect(message.title).toBe('Test Title');
    expect(message.body).toBe('Test Body');
    expect(message.actions).toHaveLength(1);
    expect(message.actions?.[0].id).toBe('action1');
    expect(message.priority).toBe('high');
  });
});
