/**
 * RiviumPush Web SDK
 * Push notifications for browsers - Firebase alternative
 *
 * Features:
 * - Web Push API for background notifications
 * - MQTT over WebSocket for real-time foreground messages
 * - Service Worker integration
 * - Rich notifications with images, action buttons, and localization
 * - Analytics event tracking
 * - Detailed error codes and handling
 * - Network and app state monitoring
 * - Works without Firebase
 *
 * @packageDocumentation
 */

import {
  PNSocket,
  PNConfigBuilder,
  PNAuthFactory,
  PNState,
  PNDeliveryMode,
  PNMessage,
  PNError as PNProtocolError,
  PNConnectionListener,
} from '@rivium/pn-protocol';

// ============================================================================
// Error Codes (matching Flutter SDK)
// ============================================================================

/**
 * Standardized error codes for RiviumPush SDK.
 * These codes help developers identify and handle specific error scenarios.
 */
export enum RiviumPushErrorCode {
  // Connection errors (1000-1099)
  CONNECTION_FAILED = 1000,
  CONNECTION_TIMEOUT = 1001,
  CONNECTION_LOST = 1002,
  CONNECTION_REFUSED = 1003,
  AUTHENTICATION_FAILED = 1004,
  SSL_ERROR = 1005,
  BROKER_UNAVAILABLE = 1006,

  // Subscription errors (1100-1199)
  SUBSCRIPTION_FAILED = 1100,
  UNSUBSCRIPTION_FAILED = 1101,
  INVALID_TOPIC = 1102,

  // Message errors (1200-1299)
  MESSAGE_DELIVERY_FAILED = 1200,
  MESSAGE_PARSE_ERROR = 1201,
  MESSAGE_TIMEOUT = 1202,

  // Configuration errors (1300-1399)
  INVALID_CONFIG = 1300,
  MISSING_API_KEY = 1301,
  /** @deprecated No longer used - server URL is internal */
  MISSING_SERVER_URL = 1302,
  INVALID_CREDENTIALS = 1303,

  // Registration errors (1400-1499)
  REGISTRATION_FAILED = 1400,
  DEVICE_ID_GENERATION_FAILED = 1401,
  SERVER_ERROR = 1402,
  NETWORK_ERROR = 1403,

  // State errors (1500-1599)
  NOT_INITIALIZED = 1500,
  NOT_CONNECTED = 1501,
  ALREADY_CONNECTED = 1502,
  SERVICE_NOT_RUNNING = 1503,

  // Permission errors (1600-1699)
  PERMISSION_DENIED = 1600,
  PERMISSION_DISMISSED = 1601,

  // Unknown error
  UNKNOWN_ERROR = 9999,
}

/**
 * Error code messages mapping
 */
const ERROR_MESSAGES: Record<RiviumPushErrorCode, string> = {
  [RiviumPushErrorCode.CONNECTION_FAILED]: 'Failed to connect to MQTT broker',
  [RiviumPushErrorCode.CONNECTION_TIMEOUT]: 'Connection timed out',
  [RiviumPushErrorCode.CONNECTION_LOST]: 'Connection to server was lost',
  [RiviumPushErrorCode.CONNECTION_REFUSED]: 'Connection was refused by server',
  [RiviumPushErrorCode.AUTHENTICATION_FAILED]: 'Authentication failed - invalid credentials',
  [RiviumPushErrorCode.SSL_ERROR]: 'SSL/TLS handshake failed',
  [RiviumPushErrorCode.BROKER_UNAVAILABLE]: 'MQTT broker is unavailable',
  [RiviumPushErrorCode.SUBSCRIPTION_FAILED]: 'Failed to subscribe to topic',
  [RiviumPushErrorCode.UNSUBSCRIPTION_FAILED]: 'Failed to unsubscribe from topic',
  [RiviumPushErrorCode.INVALID_TOPIC]: 'Invalid topic format',
  [RiviumPushErrorCode.MESSAGE_DELIVERY_FAILED]: 'Failed to deliver message',
  [RiviumPushErrorCode.MESSAGE_PARSE_ERROR]: 'Failed to parse message payload',
  [RiviumPushErrorCode.MESSAGE_TIMEOUT]: 'Message delivery timed out',
  [RiviumPushErrorCode.INVALID_CONFIG]: 'Invalid configuration',
  [RiviumPushErrorCode.MISSING_API_KEY]: 'API key is missing',
  [RiviumPushErrorCode.MISSING_SERVER_URL]: 'Server URL is missing',
  [RiviumPushErrorCode.INVALID_CREDENTIALS]: 'Invalid MQTT credentials',
  [RiviumPushErrorCode.REGISTRATION_FAILED]: 'Device registration failed',
  [RiviumPushErrorCode.DEVICE_ID_GENERATION_FAILED]: 'Failed to generate device ID',
  [RiviumPushErrorCode.SERVER_ERROR]: 'Server returned an error',
  [RiviumPushErrorCode.NETWORK_ERROR]: 'Network request failed',
  [RiviumPushErrorCode.NOT_INITIALIZED]: 'SDK is not initialized',
  [RiviumPushErrorCode.NOT_CONNECTED]: 'Not connected to server',
  [RiviumPushErrorCode.ALREADY_CONNECTED]: 'Already connected to server',
  [RiviumPushErrorCode.SERVICE_NOT_RUNNING]: 'Service worker is not running',
  [RiviumPushErrorCode.PERMISSION_DENIED]: 'Notification permission denied',
  [RiviumPushErrorCode.PERMISSION_DISMISSED]: 'Notification permission dismissed',
  [RiviumPushErrorCode.UNKNOWN_ERROR]: 'An unknown error occurred',
};

/**
 * Represents a RiviumPush error with code and additional details
 */
export class RiviumPushError extends Error {
  /** The error code */
  readonly code: RiviumPushErrorCode;
  /** Additional details about the error */
  readonly details?: string;

  constructor(code: RiviumPushErrorCode, details?: string) {
    super(ERROR_MESSAGES[code] || 'Unknown error');
    this.name = 'RiviumPushError';
    this.code = code;
    this.details = details;
  }

  toJSON() {
    return {
      code: this.code,
      message: this.message,
      details: this.details,
    };
  }
}

// ============================================================================
// Analytics Events (matching Flutter SDK)
// ============================================================================

/**
 * Analytics event types for tracking SDK usage.
 * Use with setAnalyticsHandler to track SDK events.
 */
export enum RiviumPushAnalyticsEvent {
  /** SDK was initialized */
  SDK_INITIALIZED = 'sdkInitialized',
  /** Device was registered */
  DEVICE_REGISTERED = 'deviceRegistered',
  /** Device was unregistered */
  DEVICE_UNREGISTERED = 'deviceUnregistered',
  /** Push message was received */
  MESSAGE_RECEIVED = 'messageReceived',
  /** Push message was displayed as notification */
  MESSAGE_DISPLAYED = 'messageDisplayed',
  /** Notification was clicked */
  NOTIFICATION_CLICKED = 'notificationClicked',
  /** Action button was clicked */
  ACTION_CLICKED = 'actionClicked',
  /** MQTT connected successfully */
  CONNECTED = 'connected',
  /** MQTT disconnected */
  DISCONNECTED = 'disconnected',
  /** Connection error occurred */
  CONNECTION_ERROR = 'connectionError',
  /** Retry attempt started (during exponential backoff) */
  RETRY_STARTED = 'retryStarted',
  /** Topic subscribed */
  TOPIC_SUBSCRIBED = 'topicSubscribed',
  /** Topic unsubscribed */
  TOPIC_UNSUBSCRIBED = 'topicUnsubscribed',
  /** Network state changed */
  NETWORK_STATE_CHANGED = 'networkStateChanged',
  /** App state changed (visible/hidden) */
  APP_STATE_CHANGED = 'appStateChanged',
  /** Permission requested */
  PERMISSION_REQUESTED = 'permissionRequested',
  /** Permission granted */
  PERMISSION_GRANTED = 'permissionGranted',
  /** Permission denied */
  PERMISSION_DENIED = 'permissionDenied',
}

// ============================================================================
// Log Levels
// ============================================================================

/**
 * Log levels for the RiviumPush SDK.
 * Controls verbosity of logging output.
 */
export enum RiviumPushLogLevel {
  /** No logging at all (for production) */
  NONE = 0,
  /** Only errors */
  ERROR = 1,
  /** Errors and warnings */
  WARNING = 2,
  /** Errors, warnings, and info messages */
  INFO = 3,
  /** All messages including debug output (default for development) */
  DEBUG = 4,
  /** Everything including very detailed traces */
  VERBOSE = 5,
}

// ============================================================================
// State Types
// ============================================================================

/**
 * Network type enumeration
 */
export enum NetworkType {
  WIFI = 'wifi',
  CELLULAR = 'cellular',
  ETHERNET = 'ethernet',
  NONE = 'none',
  UNKNOWN = 'unknown',
}

/**
 * Represents the current network state
 */
export interface NetworkState {
  /** Whether network is currently available */
  isAvailable: boolean;
  /** The type of network connection */
  networkType: NetworkType;
  /** Effective connection type (4g, 3g, 2g, slow-2g) */
  effectiveType?: string;
  /** Downlink speed in Mbps */
  downlink?: number;
  /** Round-trip time in ms */
  rtt?: number;
}

/**
 * Represents the app's visibility state
 */
export interface AppState {
  /** Whether the page is currently visible */
  isVisible: boolean;
  /** Visibility state: visible, hidden, prerender */
  visibilityState: DocumentVisibilityState;
}

/**
 * Represents the reconnection state during automatic retry
 */
export interface ReconnectionState {
  /** Current retry attempt number (0-based) */
  retryAttempt: number;
  /** Time in milliseconds until next retry */
  nextRetryMs: number;
  /** Maximum retry attempts */
  maxRetryAttempts: number;
}

// ============================================================================
// Types
// ============================================================================

/**
 * Configuration for initializing RiviumPush Web SDK
 *
 * `apiKey` is required.
 * MQTT configuration is automatically fetched from the server during initialization.
 */
export interface RiviumPushConfig {
  /** Your RiviumPush API key (starts with rv_live_) - REQUIRED */
  apiKey: string;
  /** Path to RiviumPush service worker file */
  serviceWorkerPath?: string;
  /** VAPID public key for Web Push */
  vapidPublicKey?: string;
  /** Auto-register service worker (default: true) */
  autoRegisterServiceWorker?: boolean;
  /** MQTT QoS level (default: 1) */
  mqttQos?: 0 | 1 | 2;
  /** Maximum reconnect attempts (default: 10) */
  maxReconnectAttempts?: number;
  /** Initial log level (default: DEBUG in dev, ERROR in prod) */
  logLevel?: RiviumPushLogLevel;
}

/**
 * Internal MQTT configuration fetched from server
 */
interface MqttConfigInternal {
  host: string;
  wsHost?: string;  // WebSocket host (for Cloudflare proxy)
  port: number;
  wsPort: number;
  // JWT token for authentication (provided at registration)
  token?: string;
}

/**
 * Notification action button
 */
export interface NotificationAction {
  /** Unique action identifier */
  id: string;
  /** Button display text */
  title: string;
  /** URL to open when action is clicked */
  action?: string;
  /** Icon for the action button */
  icon?: string;
  /** If true, action is marked as destructive */
  destructive?: boolean;
  /** If true, requires authentication */
  authRequired?: boolean;
}

/**
 * Localized content for i18n support
 */
export interface LocalizedContent {
  /** Locale code (e.g., 'en', 'fr', 'de') */
  locale: string;
  /** Localized title */
  title: string;
  /** Localized body */
  body: string;
}

/**
 * Push notification message with rich features
 */
export interface RiviumPushMessage {
  /** Notification title */
  title: string;
  /** Notification body */
  body: string;
  /** Custom data payload */
  data?: Record<string, any>;
  /** If true, message is delivered silently */
  silent?: boolean;
  // Rich notification features
  /** Large image URL */
  imageUrl?: string;
  /** Icon/avatar URL */
  iconUrl?: string;
  /** Action buttons (max 2 in browsers) */
  actions?: NotificationAction[];
  /** Deep link URL */
  deepLink?: string;
  // Badge management
  /** Badge count */
  badge?: number;
  /** Badge action: set, increment, decrement, clear */
  badgeAction?: 'set' | 'increment' | 'decrement' | 'clear';
  // Sound and grouping
  /** Custom sound name */
  sound?: string;
  /** Thread ID for grouping */
  threadId?: string;
  /** Collapse key for replacing notifications */
  collapseKey?: string;
  /** Category for filtering */
  category?: string;
  // Priority and TTL
  /** Priority: default, high, low */
  priority?: 'default' | 'high' | 'low';
  /** Time to live in seconds */
  ttl?: number;
  // Localization
  /** Localized content variations */
  localizations?: LocalizedContent[];
  /** Target timezone */
  timezone?: string;
  // Tracking
  /** Unique message ID */
  messageId?: string;
  /** Campaign ID for analytics */
  campaignId?: string;

  // Legacy fields for backwards compatibility
  /** @deprecated Use iconUrl instead */
  icon?: string;
  /** @deprecated Use imageUrl instead */
  image?: string;
  /** Notification tag for grouping (legacy) */
  tag?: string;
}

/**
 * Device registration options
 */
export interface RegisterOptions {
  /** User identifier */
  userId?: string;
  /** Additional metadata */
  metadata?: Record<string, string>;
}

/**
 * Connection state
 */
export type ConnectionState = 'connecting' | 'connected' | 'disconnected' | 'error';

// ============================================================================
// Callback Types
// ============================================================================

export type OnMessageCallback = (message: RiviumPushMessage) => void;
export type OnConnectionStateCallback = (state: ConnectionState) => void;
export type OnRegisteredCallback = (deviceId: string) => void;
export type OnErrorCallback = (error: Error) => void;
export type OnDetailedErrorCallback = (error: RiviumPushError) => void;
export type OnNotificationClickCallback = (message: RiviumPushMessage, action?: string) => void;
export type OnActionClickedCallback = (actionId: string, message: RiviumPushMessage) => void;
export type OnReconnectingCallback = (state: ReconnectionState) => void;
export type OnNetworkStateCallback = (state: NetworkState) => void;
export type OnAppStateCallback = (state: AppState) => void;
export type RiviumPushAnalyticsCallback = (
  event: RiviumPushAnalyticsEvent,
  properties?: Record<string, any>
) => void;

// ============================================================================
// Internal Constants
// ============================================================================

/** Internal server URL - not configurable by users */
const RIVIUM_PUSH_SERVER_URL = 'https://push-api.rivium.co';

// ============================================================================
// RiviumPush Web SDK Class
// ============================================================================

/**
 * RiviumPush Web SDK - Push notifications for browsers
 *
 * @example
 * ```typescript
 * import RiviumPush from '@rivium/push-web';
 *
 * // Initialize with API key
 * // MQTT config is auto-fetched from server
 * const riviumPush = new RiviumPush({
 *   apiKey: 'rv_live_your_api_key',  // Get from Rivium Console
 * });
 *
 * // Set up analytics tracking
 * riviumPush.setAnalyticsHandler((event, properties) => {
 *   console.log('Analytics:', event, properties);
 * });
 *
 * // Set up error handling
 * riviumPush.onDetailedError((error) => {
 *   console.error('Error:', error.code, error.message, error.details);
 * });
 *
 * // Set up message handling
 * riviumPush.onMessage((message) => {
 *   console.log('Received:', message.title);
 * });
 *
 * // Register device
 * await riviumPush.register({ userId: 'user123' });
 * ```
 */
class RiviumPush {
  private config: Required<Pick<RiviumPushConfig, 'apiKey'>> & RiviumPushConfig;
  private deviceId: string | null = null;
  private subscriptionId: string | null = null;
  private userId: string | null = null;
  private pnSocket: PNSocket | null = null;
  private serviceWorkerRegistration: ServiceWorkerRegistration | null = null;
  private pushSubscription: PushSubscription | null = null;
  private connectionState: ConnectionState = 'disconnected';
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 10;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private subscribedTopics: Set<string> = new Set();
  private badgeCount = 0;
  private initialized = false;
  private initialMessage: RiviumPushMessage | null = null;

  // MQTT configuration fetched from server
  private mqttConfig: MqttConfigInternal | null = null;
  private mqttConfigFetched = false;
  private appId: string | null = null; // For MQTT topics and token refresh
  private appIdentifier: string | null = null; // For per-app message routing

  // VAPID public key fetched from server (for Web Push background notifications)
  private vapidPublicKey: string | null = null;

  // Log level
  private logLevel: RiviumPushLogLevel = RiviumPushLogLevel.DEBUG;

  // Analytics
  private analyticsCallback: RiviumPushAnalyticsCallback | null = null;
  private analyticsEnabled = false;

  // Callbacks
  private onMessageCallback: OnMessageCallback | null = null;
  private onConnectionStateCallback: OnConnectionStateCallback | null = null;
  private onRegisteredCallback: OnRegisteredCallback | null = null;
  private onErrorCallback: OnErrorCallback | null = null;
  private onDetailedErrorCallback: OnDetailedErrorCallback | null = null;
  private onNotificationClickCallback: OnNotificationClickCallback | null = null;
  private onActionClickedCallback: OnActionClickedCallback | null = null;
  private onReconnectingCallback: OnReconnectingCallback | null = null;
  private onNetworkStateCallback: OnNetworkStateCallback | null = null;
  private onAppStateCallback: OnAppStateCallback | null = null;

  constructor(config: RiviumPushConfig) {
    if (!config.apiKey) {
      throw new Error('RiviumPush: apiKey is required');
    }
    this.config = {
      serviceWorkerPath: '/rivium-push-sw.js',
      autoRegisterServiceWorker: true,
      mqttQos: 1,
      maxReconnectAttempts: 10,
      logLevel: RiviumPushLogLevel.ERROR,
      ...config,
    };

    this.maxReconnectAttempts = this.config.maxReconnectAttempts!;
    this.logLevel = this.config.logLevel!;

    if (typeof window === 'undefined') {
      // SSR environment (Next.js server-side) - skip browser-only initialization
      this.initialized = true;
      return;
    }

    this.deviceId = this.getOrCreateDeviceId();
    // Restore previously-issued subscriptionId so we can stream the new topic
    // immediately on page load — register() will refresh it.
    this.subscriptionId = localStorage.getItem('rivium_push_subscription_id') || null;
    // Restore the userId set in a previous session so we can re-register with
    // the right user identity automatically (matches OneSignal/Airship).
    this.userId = localStorage.getItem('rivium_push_user_id') || null;
    this.badgeCount = parseInt(localStorage.getItem('rivium_push_badge_count') || '0', 10);

    // Check for initial message (from notification click that opened the page)
    this.checkInitialMessage();

    // Set up event listeners
    // Listen for messages from service worker
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.addEventListener('message', this.handleServiceWorkerMessage.bind(this));
    }

    // Listen for visibility changes (app state)
    document.addEventListener('visibilitychange', this.handleVisibilityChange.bind(this));

    // Listen for network changes
    if ('connection' in navigator) {
      (navigator as any).connection?.addEventListener('change', this.handleNetworkChange.bind(this));
    }
    window.addEventListener('online', this.handleOnline.bind(this));
    window.addEventListener('offline', this.handleOffline.bind(this));

    this.initialized = true;
    this.trackEvent(RiviumPushAnalyticsEvent.SDK_INITIALIZED);

    this.log(RiviumPushLogLevel.INFO, 'RiviumPush SDK initialized');

    // Fetch MQTT config from server
    this.fetchMqttConfig();
  }

  /**
   * Fetch MQTT and VAPID configuration from server
   */
  private async fetchMqttConfig(): Promise<void> {
    try {
      this.log(RiviumPushLogLevel.DEBUG, 'Fetching config from server...');

      const response = await fetch(`${RIVIUM_PUSH_SERVER_URL}/devices/config`, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': this.config.apiKey,
        },
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const data = await response.json();
      this.mqttConfig = data.mqtt;
      this.mqttConfigFetched = true;

      // Store VAPID public key for Web Push
      if (data.vapidPublicKey) {
        this.vapidPublicKey = data.vapidPublicKey;
        this.log(RiviumPushLogLevel.DEBUG, 'VAPID public key received from server');
      }

      this.log(RiviumPushLogLevel.INFO, `Config fetched successfully, vapid=${!!this.vapidPublicKey}`);
    } catch (error) {
      this.log(RiviumPushLogLevel.ERROR, 'Failed to fetch config:', error);
      this.emitError(RiviumPushErrorCode.INVALID_CONFIG, `Failed to fetch config: ${(error as Error).message}`);
    }
  }

  // ==========================================================================
  // Logging
  // ==========================================================================

  private log(level: RiviumPushLogLevel, message: string, ...args: any[]): void {
    if (level > this.logLevel) return;

    const prefix = '[RiviumPush]';
    switch (level) {
      case RiviumPushLogLevel.ERROR:
        console.error(prefix, message, ...args);
        break;
      case RiviumPushLogLevel.WARNING:
        console.warn(prefix, message, ...args);
        break;
      case RiviumPushLogLevel.INFO:
        console.info(prefix, message, ...args);
        break;
      case RiviumPushLogLevel.DEBUG:
      case RiviumPushLogLevel.VERBOSE:
        console.log(prefix, message, ...args);
        break;
    }
  }

  /**
   * Set the log level for SDK logging.
   *
   * @example
   * ```typescript
   * // In production, reduce logging
   * riviumPush.setLogLevel(RiviumPushLogLevel.ERROR);
   * ```
   */
  setLogLevel(level: RiviumPushLogLevel): void {
    this.logLevel = level;
    this.log(RiviumPushLogLevel.INFO, `Log level set to ${RiviumPushLogLevel[level]}`);
  }

  /**
   * Get current log level
   */
  getLogLevel(): RiviumPushLogLevel {
    return this.logLevel;
  }

  // ==========================================================================
  // Analytics
  // ==========================================================================

  private trackEvent(event: RiviumPushAnalyticsEvent, properties?: Record<string, any>): void {
    if (this.analyticsEnabled && this.analyticsCallback) {
      try {
        this.analyticsCallback(event, properties);
      } catch (e) {
        this.log(RiviumPushLogLevel.ERROR, 'Analytics callback error:', e);
      }
    }
    this.log(RiviumPushLogLevel.VERBOSE, `Analytics event: ${event}`, properties);
  }

  /**
   * Enable analytics tracking with a custom handler.
   *
   * @example
   * ```typescript
   * riviumPush.setAnalyticsHandler((event, properties) => {
   *   // Send to your analytics service
   *   analytics.track(`rivium_push_${event}`, properties);
   * });
   * ```
   */
  setAnalyticsHandler(callback: RiviumPushAnalyticsCallback): void {
    this.analyticsCallback = callback;
    this.analyticsEnabled = true;
    this.log(RiviumPushLogLevel.INFO, 'Analytics handler set');
  }

  /**
   * Disable analytics tracking
   */
  disableAnalytics(): void {
    this.analyticsCallback = null;
    this.analyticsEnabled = false;
    this.log(RiviumPushLogLevel.INFO, 'Analytics disabled');
  }

  /**
   * Check if analytics tracking is enabled
   */
  isAnalyticsEnabled(): boolean {
    return this.analyticsEnabled;
  }

  // ==========================================================================
  // Error Handling
  // ==========================================================================

  private emitError(code: RiviumPushErrorCode, details?: string): void {
    const error = new RiviumPushError(code, details);
    this.log(RiviumPushLogLevel.ERROR, `Error [${code}]: ${error.message}`, details);

    if (this.onDetailedErrorCallback) {
      this.onDetailedErrorCallback(error);
    }
    if (this.onErrorCallback) {
      this.onErrorCallback(error);
    }

    this.trackEvent(RiviumPushAnalyticsEvent.CONNECTION_ERROR, {
      errorCode: code,
      errorMessage: error.message,
      details,
    });
  }

  // ==========================================================================
  // Public API
  // ==========================================================================

  /**
   * Register device for push notifications
   */
  async register(options?: RegisterOptions): Promise<string> {
    try {
      // Wait for config to be fetched (includes VAPID key)
      if (!this.mqttConfigFetched) {
        this.log(RiviumPushLogLevel.DEBUG, 'Waiting for server config...');
        await this.waitForConfig();
      }

      // Register service worker if enabled
      if (this.config.autoRegisterServiceWorker) {
        await this.registerServiceWorker();
      }

      // Request notification permission
      this.trackEvent(RiviumPushAnalyticsEvent.PERMISSION_REQUESTED);
      const permission = await this.requestNotificationPermission();

      if (permission === 'denied') {
        this.trackEvent(RiviumPushAnalyticsEvent.PERMISSION_DENIED);
        this.emitError(RiviumPushErrorCode.PERMISSION_DENIED);
        throw new RiviumPushError(RiviumPushErrorCode.PERMISSION_DENIED);
      }

      if (permission === 'default') {
        this.trackEvent(RiviumPushAnalyticsEvent.PERMISSION_DENIED);
        this.emitError(RiviumPushErrorCode.PERMISSION_DISMISSED, 'User dismissed the permission prompt');
        throw new RiviumPushError(RiviumPushErrorCode.PERMISSION_DISMISSED);
      }

      this.trackEvent(RiviumPushAnalyticsEvent.PERMISSION_GRANTED);

      // Get Web Push subscription for background notifications
      // Use VAPID key from server (preferred) or from config
      const vapidKey = this.vapidPublicKey || this.config.vapidPublicKey;
      if (vapidKey && this.serviceWorkerRegistration) {
        try {
          this.pushSubscription = await this.subscribeToPush(vapidKey);
          this.log(RiviumPushLogLevel.INFO, 'Web Push subscription created for background notifications');
        } catch (e) {
          this.log(RiviumPushLogLevel.WARNING, 'Web Push subscription failed (will use MQTT only):', e);
        }
      }

      // Register with backend.
      // Fall back to the persisted userId so callers can call register()
      // on every page load without forgetting the user identity (matches
      // OneSignal/Airship behaviour).
      const effectiveOptions: RegisterOptions = {
        ...options,
        userId: options?.userId ?? this.userId ?? undefined,
      };
      const response = await this.registerDevice(effectiveOptions);
      this.deviceId = response.deviceId;

      // Connect MQTT for real-time messages
      this.connectToGateway();

      if (this.onRegisteredCallback) {
        this.onRegisteredCallback(response.deviceId);
      }

      this.trackEvent(RiviumPushAnalyticsEvent.DEVICE_REGISTERED, {
        deviceId: response.deviceId,
        userId: options?.userId,
        hasWebPush: !!this.pushSubscription,
      });

      this.log(RiviumPushLogLevel.INFO, 'Registered with device ID:', response.deviceId, 'Web Push:', !!this.pushSubscription);
      return response.deviceId;
    } catch (error) {
      if (error instanceof RiviumPushError) {
        throw error;
      }
      this.log(RiviumPushLogLevel.ERROR, 'Registration failed:', error);
      this.emitError(RiviumPushErrorCode.REGISTRATION_FAILED, (error as Error).message);
      throw error;
    }
  }

  /**
   * Wait for config to be fetched from server
   */
  private async waitForConfig(timeoutMs = 5000): Promise<void> {
    const startTime = Date.now();
    while (!this.mqttConfigFetched && Date.now() - startTime < timeoutMs) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    if (!this.mqttConfigFetched) {
      this.log(RiviumPushLogLevel.WARNING, 'Config fetch timed out, continuing without it');
    }
  }

  /**
   * Unregister device and disconnect
   */
  async unregister(): Promise<void> {
    this.disconnectFromGateway();

    if (this.pushSubscription) {
      await this.pushSubscription.unsubscribe();
      this.pushSubscription = null;
    }

    this.trackEvent(RiviumPushAnalyticsEvent.DEVICE_UNREGISTERED, {
      deviceId: this.deviceId,
    });

    this.log(RiviumPushLogLevel.INFO, 'Unregistered');
  }

  /**
   * Subscribe to a topic
   */
  async subscribeTopic(topic: string): Promise<void> {
    if (!topic || topic.trim() === '') {
      this.emitError(RiviumPushErrorCode.INVALID_TOPIC, 'Topic cannot be empty');
      return;
    }

    this.subscribedTopics.add(topic);

    // Register topic subscription on server (for Web Push delivery via sendToTopic)
    if (this.deviceId) {
      try {
        await fetch(`${RIVIUM_PUSH_SERVER_URL}/topics/subscribe`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': this.config.apiKey,
          },
          body: JSON.stringify({ deviceId: this.deviceId, topic }),
        });
      } catch (err) {
        this.log(RiviumPushLogLevel.WARNING, 'Failed to register topic on server:', err);
      }
    }

    // Also subscribe via MQTT for real-time foreground messages
    if (this.pnSocket && this.pnSocket.isConnected()) {
      const appId = this.config.apiKey.substring(0, 16);
      const channel = `rivium_push/${appId}/topic/${topic}`;
      this.pnSocket.stream(channel, (message: PNMessage) => {
        this.handlePNMessage(message);
      }, this.config.mqttQos as PNDeliveryMode);
      this.log(RiviumPushLogLevel.INFO, 'Subscribed to topic:', topic);
      this.trackEvent(RiviumPushAnalyticsEvent.TOPIC_SUBSCRIBED, { topic });
    }
  }

  /**
   * Unsubscribe from a topic
   */
  async unsubscribeTopic(topic: string): Promise<void> {
    this.subscribedTopics.delete(topic);

    // Unregister topic on server
    if (this.deviceId) {
      try {
        await fetch(`${RIVIUM_PUSH_SERVER_URL}/topics/unsubscribe`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': this.config.apiKey,
          },
          body: JSON.stringify({ deviceId: this.deviceId, topic }),
        });
      } catch (err) {
        this.log(RiviumPushLogLevel.WARNING, 'Failed to unregister topic on server:', err);
      }
    }

    if (this.pnSocket && this.pnSocket.isConnected()) {
      const appId = this.config.apiKey.substring(0, 16);
      const channel = `rivium_push/${appId}/topic/${topic}`;
      this.pnSocket.detach(channel);
      this.log(RiviumPushLogLevel.INFO, 'Unsubscribed from topic:', topic);
      this.trackEvent(RiviumPushAnalyticsEvent.TOPIC_UNSUBSCRIBED, { topic });
    }
  }

  /**
   * Check if connected to MQTT broker
   */
  isConnected(): boolean {
    return this.connectionState === 'connected';
  }

  /**
   * Get current device ID
   */
  getDeviceId(): string | null {
    return this.deviceId;
  }

  /**
   * Get the per-install subscription ID issued by the server during registration.
   * This is the canonical addressing key for inbox / A-B / in-app calls and the
   * new MQTT topic. Returns `null` until registration succeeds at least once.
   */
  getSubscriptionId(): string | null {
    return this.subscriptionId;
  }

  /**
   * Set user ID. Persisted in localStorage so subsequent page loads pick up
   * the same identity automatically (matches OneSignal/Airship behaviour).
   */
  async setUserId(userId: string): Promise<void> {
    this.userId = userId;
    localStorage.setItem('rivium_push_user_id', userId);

    // Re-register with new user ID
    await this.registerDevice({ userId });
    this.log(RiviumPushLogLevel.INFO, 'User ID set:', userId);
  }

  /**
   * Clear user ID. Call this on logout.
   */
  clearUserId(): void {
    this.userId = null;
    localStorage.removeItem('rivium_push_user_id');
    this.log(RiviumPushLogLevel.INFO, 'User ID cleared');
  }

  /**
   * Get the currently-stored userId, if any. Survives page reloads.
   */
  getUserId(): string | null {
    return this.userId;
  }

  /**
   * Get the message that launched/opened the app (when user tapped a notification)
   * Returns null if the app was not opened from a notification tap
   */
  getInitialMessage(): RiviumPushMessage | null {
    return this.initialMessage;
  }

  /**
   * Get current badge count
   */
  getBadgeCount(): number {
    return this.badgeCount;
  }

  /**
   * Set badge count
   */
  setBadgeCount(count: number): void {
    this.badgeCount = Math.max(0, count);
    localStorage.setItem('rivium_push_badge_count', this.badgeCount.toString());

    // Update favicon badge
    this.updateFaviconBadge(this.badgeCount);

    // Use Badge API if available
    if ('setAppBadge' in navigator) {
      if (this.badgeCount > 0) {
        (navigator as any).setAppBadge(this.badgeCount);
      } else {
        (navigator as any).clearAppBadge();
      }
    }
  }

  /**
   * Clear badge
   */
  clearBadge(): void {
    this.setBadgeCount(0);
  }

  /**
   * Refresh MQTT JWT token (called automatically when token expires)
   * Can also be called manually if needed
   */
  async refreshMqttToken(): Promise<void> {
    if (!this.deviceId) {
      throw new RiviumPushError(RiviumPushErrorCode.NOT_INITIALIZED, 'Device not registered');
    }

    try {
      const response = await fetch(`${RIVIUM_PUSH_SERVER_URL}/devices/${this.deviceId}/mqtt-token/refresh`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': this.config.apiKey,
        },
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new RiviumPushError(
          RiviumPushErrorCode.SERVER_ERROR,
          errorData.message || `HTTP ${response.status}`
        );
      }

      const data = await response.json();

      if (data.token && this.mqttConfig) {
        this.mqttConfig.token = data.token;
        this.log(RiviumPushLogLevel.INFO, 'MQTT token refreshed successfully');
      }
    } catch (error) {
      if (error instanceof RiviumPushError) throw error;
      throw new RiviumPushError(RiviumPushErrorCode.NETWORK_ERROR, (error as Error).message);
    }
  }

  /**
   * Get current network state
   */
  getNetworkState(): NetworkState {
    const connection = (navigator as any).connection;
    return {
      isAvailable: navigator.onLine,
      networkType: this.detectNetworkType(),
      effectiveType: connection?.effectiveType,
      downlink: connection?.downlink,
      rtt: connection?.rtt,
    };
  }

  /**
   * Get current app (visibility) state
   */
  getAppState(): AppState {
    return {
      isVisible: document.visibilityState === 'visible',
      visibilityState: document.visibilityState,
    };
  }

  /**
   * Check if notifications are supported
   */
  static isSupported(): boolean {
    return (
      typeof window !== 'undefined' &&
      'Notification' in window &&
      'serviceWorker' in navigator
    );
  }

  /**
   * Get current notification permission status
   */
  static getPermissionStatus(): NotificationPermission {
    if (typeof Notification === 'undefined') {
      return 'denied';
    }
    return Notification.permission;
  }

  // ==========================================================================
  // Event Listeners
  // ==========================================================================

  /**
   * Set callback for receiving messages
   */
  onMessage(callback: OnMessageCallback): () => void {
    this.onMessageCallback = callback;
    return () => {
      this.onMessageCallback = null;
    };
  }

  /**
   * Set callback for connection state changes
   */
  onConnectionState(callback: OnConnectionStateCallback): () => void {
    this.onConnectionStateCallback = callback;
    return () => {
      this.onConnectionStateCallback = null;
    };
  }

  /**
   * Set callback for registration success
   */
  onRegistered(callback: OnRegisteredCallback): () => void {
    this.onRegisteredCallback = callback;
    return () => {
      this.onRegisteredCallback = null;
    };
  }

  /**
   * Set callback for errors (simple)
   */
  onError(callback: OnErrorCallback): () => void {
    this.onErrorCallback = callback;
    return () => {
      this.onErrorCallback = null;
    };
  }

  /**
   * Set callback for detailed errors with error codes
   */
  onDetailedError(callback: OnDetailedErrorCallback): () => void {
    this.onDetailedErrorCallback = callback;
    return () => {
      this.onDetailedErrorCallback = null;
    };
  }

  /**
   * Set callback for notification clicks
   */
  onNotificationClick(callback: OnNotificationClickCallback): () => void {
    this.onNotificationClickCallback = callback;
    return () => {
      this.onNotificationClickCallback = null;
    };
  }

  /**
   * Set callback for action button clicks
   */
  onActionClicked(callback: OnActionClickedCallback): () => void {
    this.onActionClickedCallback = callback;
    return () => {
      this.onActionClickedCallback = null;
    };
  }

  /**
   * Set callback for reconnection state changes
   */
  onReconnecting(callback: OnReconnectingCallback): () => void {
    this.onReconnectingCallback = callback;
    return () => {
      this.onReconnectingCallback = null;
    };
  }

  /**
   * Set callback for network state changes
   */
  onNetworkState(callback: OnNetworkStateCallback): () => void {
    this.onNetworkStateCallback = callback;
    return () => {
      this.onNetworkStateCallback = null;
    };
  }

  /**
   * Set callback for app state changes (visibility)
   */
  onAppState(callback: OnAppStateCallback): () => void {
    this.onAppStateCallback = callback;
    return () => {
      this.onAppStateCallback = null;
    };
  }

  // ==========================================================================
  // Private Methods - Network & App State
  // ==========================================================================

  private detectNetworkType(): NetworkType {
    const connection = (navigator as any).connection;
    if (!connection) return NetworkType.UNKNOWN;

    const type = connection.type;
    switch (type) {
      case 'wifi':
        return NetworkType.WIFI;
      case 'cellular':
        return NetworkType.CELLULAR;
      case 'ethernet':
        return NetworkType.ETHERNET;
      case 'none':
        return NetworkType.NONE;
      default:
        return NetworkType.UNKNOWN;
    }
  }

  private handleNetworkChange(): void {
    const state = this.getNetworkState();
    this.log(RiviumPushLogLevel.DEBUG, 'Network state changed:', state);

    if (this.onNetworkStateCallback) {
      this.onNetworkStateCallback(state);
    }

    this.trackEvent(RiviumPushAnalyticsEvent.NETWORK_STATE_CHANGED, {
      isAvailable: state.isAvailable,
      networkType: state.networkType,
      effectiveType: state.effectiveType,
    });
  }

  private handleOnline(): void {
    this.log(RiviumPushLogLevel.INFO, 'Network online');
    this.handleNetworkChange();

    // Reconnect if disconnected
    if (this.connectionState === 'disconnected' && this.deviceId) {
      this.log(RiviumPushLogLevel.INFO, 'Reconnecting after network restored');
      this.connectToGateway();
    }
  }

  private handleOffline(): void {
    this.log(RiviumPushLogLevel.INFO, 'Network offline');
    this.handleNetworkChange();
  }

  private handleVisibilityChange(): void {
    const state = this.getAppState();
    this.log(RiviumPushLogLevel.DEBUG, 'App state changed:', state);

    if (this.onAppStateCallback) {
      this.onAppStateCallback(state);
    }

    this.trackEvent(RiviumPushAnalyticsEvent.APP_STATE_CHANGED, {
      isVisible: state.isVisible,
      visibilityState: state.visibilityState,
    });

    // Reconnect when becoming visible if disconnected
    if (state.isVisible && this.connectionState === 'disconnected' && this.deviceId) {
      this.log(RiviumPushLogLevel.INFO, 'Reconnecting after becoming visible');
      this.connectToGateway();
    }
  }

  // ==========================================================================
  // Private Methods - Initial Message
  // ==========================================================================

  private checkInitialMessage(): void {
    // Check URL parameters for notification data
    if (typeof window !== 'undefined') {
      const urlParams = new URLSearchParams(window.location.search);
      const notificationData = urlParams.get('rivium_push_notification');

      if (notificationData) {
        try {
          this.initialMessage = JSON.parse(decodeURIComponent(notificationData));
          this.log(RiviumPushLogLevel.INFO, 'Initial message found:', this.initialMessage);
        } catch (e) {
          this.log(RiviumPushLogLevel.WARNING, 'Failed to parse initial message:', e);
        }
      }

      // Also check sessionStorage (set by service worker)
      const storedMessage = sessionStorage.getItem('rivium_push_initial_message');
      if (storedMessage && !this.initialMessage) {
        try {
          this.initialMessage = JSON.parse(storedMessage);
          sessionStorage.removeItem('rivium_push_initial_message');
          this.log(RiviumPushLogLevel.INFO, 'Initial message from session:', this.initialMessage);
        } catch (e) {
          this.log(RiviumPushLogLevel.WARNING, 'Failed to parse stored message:', e);
        }
      }
    }
  }

  // ==========================================================================
  // Private Methods - Service Worker & Push
  // ==========================================================================

  private async registerServiceWorker(): Promise<void> {
    if (!('serviceWorker' in navigator)) {
      throw new RiviumPushError(RiviumPushErrorCode.SERVICE_NOT_RUNNING, 'Service Workers not supported');
    }

    try {
      this.serviceWorkerRegistration = await navigator.serviceWorker.register(
        this.config.serviceWorkerPath!,
        { scope: '/' }
      );
      this.log(RiviumPushLogLevel.INFO, 'Service Worker registered');
    } catch (error) {
      this.log(RiviumPushLogLevel.ERROR, 'Service Worker registration failed:', error);
      throw new RiviumPushError(RiviumPushErrorCode.SERVICE_NOT_RUNNING, (error as Error).message);
    }
  }

  private async requestNotificationPermission(): Promise<NotificationPermission> {
    if (typeof Notification === 'undefined') {
      return 'denied';
    }

    if (Notification.permission === 'granted') {
      return 'granted';
    }

    return await Notification.requestPermission();
  }

  private async subscribeToPush(vapidPublicKey: string): Promise<PushSubscription> {
    if (!this.serviceWorkerRegistration) {
      throw new RiviumPushError(RiviumPushErrorCode.SERVICE_NOT_RUNNING, 'Service Worker not registered');
    }

    // Check if there's an existing subscription
    const existingSubscription = await this.serviceWorkerRegistration.pushManager.getSubscription();
    if (existingSubscription) {
      this.log(RiviumPushLogLevel.DEBUG, 'Using existing Push subscription');
      return existingSubscription;
    }

    const subscription = await this.serviceWorkerRegistration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: this.urlBase64ToUint8Array(vapidPublicKey) as BufferSource,
    });

    this.log(RiviumPushLogLevel.INFO, 'Push subscription created');
    return subscription;
  }

  private async registerDevice(options?: RegisterOptions): Promise<{ deviceId: string; subscriptionId?: string; mqtt?: { token?: string } }> {
    try {
      // Build request body (use window.location.origin as appIdentifier for per-app isolation)
      const requestBody: Record<string, any> = {
        deviceId: this.deviceId,
        platform: 'web',
        userId: options?.userId,
        appIdentifier: typeof window !== 'undefined' ? window.location.origin : undefined,
        metadata: {
          ...options?.metadata,
          userAgent: navigator.userAgent,
          language: navigator.language,
          url: window.location.origin,
        },
      };

      // Add Web Push subscription if available (for background notifications)
      if (this.pushSubscription) {
        const subscriptionJson = this.pushSubscription.toJSON();
        requestBody.webPushSubscription = {
          endpoint: subscriptionJson.endpoint,
          keys: {
            p256dh: subscriptionJson.keys?.p256dh || '',
            auth: subscriptionJson.keys?.auth || '',
          },
        };
        this.log(RiviumPushLogLevel.DEBUG, 'Sending Web Push subscription to server');
      }

      const response = await fetch(`${RIVIUM_PUSH_SERVER_URL}/devices/register`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': this.config.apiKey,
        },
        body: JSON.stringify(requestBody),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new RiviumPushError(
          RiviumPushErrorCode.SERVER_ERROR,
          errorData.message || `HTTP ${response.status}`
        );
      }

      const data = await response.json();

      // Store appId for topic subscriptions
      if (data.appId) {
        this.appId = data.appId;
      }

      // Capture subscriptionId — the per-install UUID — and persist it.
      if (data.subscriptionId) {
        this.subscriptionId = data.subscriptionId;
        localStorage.setItem('rivium_push_subscription_id', data.subscriptionId);
        this.log(RiviumPushLogLevel.DEBUG, `Stored subscriptionId: ${data.subscriptionId}`);
      }

      // Store appIdentifier for per-app message routing
      if (data.appIdentifier) {
        this.appIdentifier = data.appIdentifier;
      }

      // Store connection token from registration response
      if (data.mqtt?.token && this.mqttConfig) {
        this.mqttConfig.token = data.mqtt.token;
        this.log(RiviumPushLogLevel.DEBUG, 'Connection token received from registration');
      }

      return data;
    } catch (error) {
      if (error instanceof RiviumPushError) throw error;
      throw new RiviumPushError(RiviumPushErrorCode.NETWORK_ERROR, (error as Error).message);
    }
  }

  // ==========================================================================
  // Private Methods - PN Protocol Connection
  // ==========================================================================

  private connectToGateway(): void {
    if (this.pnSocket) {
      this.pnSocket.close();
    }

    // Clear any pending reconnect timer
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    // Check if config is available
    if (!this.mqttConfig) {
      this.log(RiviumPushLogLevel.WARNING, 'Gateway config not available, retrying in 2s...');
      setTimeout(() => this.connectToGateway(), 2000);
      return;
    }

    // Check if we have JWT token for authentication
    if (!this.mqttConfig.token) {
      this.log(RiviumPushLogLevel.ERROR, 'Connection token not available. Device must be registered first.');
      this.emitError(RiviumPushErrorCode.AUTHENTICATION_FAILED, 'Connection token not available');
      return;
    }

    this.setConnectionState('connecting');

    // Use wsHost for WebSocket connections (via Cloudflare), fallback to host
    const gateway = this.mqttConfig.wsHost || this.mqttConfig.host;
    const port = this.mqttConfig.wsPort;

    // Determine if secure connection is needed
    const isSecurePage = typeof window !== 'undefined' && window.location.protocol === 'https:';
    const isSecurePort = port === 443;
    const secure = isSecurePage || isSecurePort;

    this.log(RiviumPushLogLevel.DEBUG, `Connecting to gateway (secure: ${secure})`);

    const clientId = `rivium_push_${this.appId}_${this.deviceId}`;

    // Build PNConfig using the protocol's builder
    const pnConfig = new PNConfigBuilder()
      .gateway(gateway)
      .port(port)
      .clientId(clientId)
      .auth(PNAuthFactory.token(this.mqttConfig.token))
      .secure(secure)
      .freshStart(false)
      .autoReconnect(false) // We handle reconnection ourselves
      .connectionTimeout(10)
      .build();

    this.pnSocket = new PNSocket(pnConfig);

    // Set up connection listener
    const connectionListener: PNConnectionListener = {
      onStateChanged: (state: PNState) => {
        this.log(RiviumPushLogLevel.DEBUG, `Connection state changed: ${state}`);
      },
      onConnected: () => {
        this.log(RiviumPushLogLevel.INFO, 'Connected to gateway');
        this.setConnectionState('connected');
        this.reconnectAttempts = 0;
        this.trackEvent(RiviumPushAnalyticsEvent.CONNECTED);

        const appId = this.config.apiKey.substring(0, 16);
        const appIdentifier = this.appIdentifier || (typeof window !== 'undefined' ? window.location.origin : '_default');

        // Per-install subscription channel — primary delivery channel for
        // every device-targeted message after the subscriptionId migration.
        if (this.subscriptionId) {
          const subscriptionChannel = `rivium_push/${appId}/sub/${this.subscriptionId}`;
          this.pnSocket!.stream(subscriptionChannel, (message: PNMessage) => {
            this.handlePNMessage(message);
          }, this.config.mqttQos as PNDeliveryMode);
          this.log(RiviumPushLogLevel.DEBUG, `Streaming from subscription channel ${subscriptionChannel}`);
        }

        // Stream broadcast channel
        const broadcastChannel = `rivium_push/${appId}/broadcast`;
        this.pnSocket!.stream(broadcastChannel, (message: PNMessage) => {
          this.handlePNMessage(message);
        }, this.config.mqttQos as PNDeliveryMode);
        this.log(RiviumPushLogLevel.DEBUG, 'Streaming from broadcast channel');

        // DEPRECATED: legacy device-scoped channel. The backend stopped
        // publishing here after the subscriptionId migration. Kept streamed
        // only to keep older test builds / out-of-tree backends working;
        // will be removed in a future SDK release.
        const deviceChannel = `rivium_push/${appId}/${this.deviceId}/${appIdentifier}`;
        this.pnSocket!.stream(deviceChannel, (message: PNMessage) => {
          this.handlePNMessage(message);
        }, this.config.mqttQos as PNDeliveryMode);
        this.log(RiviumPushLogLevel.DEBUG, 'Streaming from (deprecated) device channel');

        // Resubscribe to custom topics
        this.subscribedTopics.forEach((topic) => {
          const topicChannel = `rivium_push/${appId}/topic/${topic}`;
          this.pnSocket!.stream(topicChannel, (message: PNMessage) => {
            this.handlePNMessage(message);
          }, this.config.mqttQos as PNDeliveryMode);
        });
      },
      onDisconnected: (reason?: string) => {
        this.log(RiviumPushLogLevel.INFO, 'Disconnected from gateway', reason || '');
        this.setConnectionState('disconnected');
        this.trackEvent(RiviumPushAnalyticsEvent.DISCONNECTED);
        this.scheduleReconnect();
      },
      onReconnecting: (attempt: number, nextRetryMs: number) => {
        this.log(RiviumPushLogLevel.INFO, `Reconnecting attempt ${attempt} in ${nextRetryMs}ms`);
      },
    };

    this.pnSocket.addConnectionListener(connectionListener);

    // Set up error listener
    this.pnSocket.addErrorListener((error: PNProtocolError) => {
      this.log(RiviumPushLogLevel.ERROR, 'Gateway error:', error.message);
      this.setConnectionState('error');

      // Map PNProtocolError to RiviumPushErrorCode
      let errorCode = RiviumPushErrorCode.CONNECTION_FAILED;
      const errorMessage = error.message.toLowerCase();

      if (errorMessage.includes('timeout')) {
        errorCode = RiviumPushErrorCode.CONNECTION_TIMEOUT;
      } else if (errorMessage.includes('refused') || errorMessage.includes('not authorized')) {
        errorCode = RiviumPushErrorCode.CONNECTION_REFUSED;
        // Token might be expired - try to refresh it
        if (errorMessage.includes('not authorized')) {
          this.log(RiviumPushLogLevel.INFO, 'Token may be expired, attempting refresh...');
          this.refreshMqttToken().then(() => {
            this.log(RiviumPushLogLevel.INFO, 'Token refreshed, reconnecting...');
            this.connectToGateway();
          }).catch((refreshError) => {
            this.log(RiviumPushLogLevel.ERROR, 'Token refresh failed:', refreshError);
            this.emitError(RiviumPushErrorCode.AUTHENTICATION_FAILED, 'Token expired and refresh failed');
          });
          return;
        }
      } else if (errorMessage.includes('auth') || errorMessage.includes('credential')) {
        errorCode = RiviumPushErrorCode.AUTHENTICATION_FAILED;
      } else if (errorMessage.includes('ssl') || errorMessage.includes('tls')) {
        errorCode = RiviumPushErrorCode.SSL_ERROR;
      }

      this.emitError(errorCode, error.message);
    });

    // Open connection
    this.log(RiviumPushLogLevel.DEBUG, 'Opening connection to gateway...');
    this.pnSocket.open();
  }

  /**
   * Handle incoming PNMessage from the protocol layer
   */
  private handlePNMessage(message: PNMessage): void {
    try {
      const data = message.payloadAsJson();
      this.handleMqttMessage(message.channel, data);
    } catch (error) {
      this.log(RiviumPushLogLevel.ERROR, 'Message parse error:', error);
      this.emitError(RiviumPushErrorCode.MESSAGE_PARSE_ERROR, (error as Error).message);
    }
  }

  private disconnectFromGateway(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    if (this.pnSocket) {
      this.pnSocket.close();
      this.pnSocket = null;
    }

    this.setConnectionState('disconnected');
  }

  private scheduleReconnect(): void {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      this.log(RiviumPushLogLevel.WARNING, 'Max reconnect attempts reached');
      this.emitError(RiviumPushErrorCode.CONNECTION_FAILED, 'Max reconnect attempts reached');
      return;
    }

    // Check if we should reconnect (only if online and visible)
    if (!navigator.onLine) {
      this.log(RiviumPushLogLevel.DEBUG, 'Offline, skipping reconnect');
      return;
    }

    const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts), 30000);
    this.reconnectAttempts++;

    this.log(RiviumPushLogLevel.INFO, `Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts})`);

    // Emit reconnecting state
    const reconnectionState: ReconnectionState = {
      retryAttempt: this.reconnectAttempts,
      nextRetryMs: delay,
      maxRetryAttempts: this.maxReconnectAttempts,
    };

    if (this.onReconnectingCallback) {
      this.onReconnectingCallback(reconnectionState);
    }

    this.trackEvent(RiviumPushAnalyticsEvent.RETRY_STARTED, {
      retryAttempt: this.reconnectAttempts,
      nextRetryMs: delay,
    });

    this.reconnectTimer = setTimeout(() => {
      this.connectToGateway();
    }, delay);
  }

  private handleMqttMessage(topic: string, data: any): void {
    const message = this.normalizeMessage(data);

    this.log(RiviumPushLogLevel.DEBUG, 'Message received:', message.title);

    this.trackEvent(RiviumPushAnalyticsEvent.MESSAGE_RECEIVED, {
      messageId: message.messageId,
      title: message.title,
      silent: message.silent,
      hasImage: !!message.imageUrl,
      hasActions: !!message.actions?.length,
    });

    // Handle badge
    this.handleBadge(message);

    // Show notification if not silent and page is not visible
    if (!message.silent && document.visibilityState !== 'visible') {
      this.showRichNotification(message);
      this.trackEvent(RiviumPushAnalyticsEvent.MESSAGE_DISPLAYED, {
        messageId: message.messageId,
        title: message.title,
      });
    }

    if (this.onMessageCallback) {
      this.onMessageCallback(message);
    }
  }

  private normalizeMessage(data: any): RiviumPushMessage {
    // Get localized content
    const localizedTitle = this.getLocalizedContent(data, 'title');
    const localizedBody = this.getLocalizedContent(data, 'body');

    return {
      title: localizedTitle || data.title || '',
      body: localizedBody || data.body || '',
      data: data.data,
      silent: data.silent,
      // Rich features
      imageUrl: data.imageUrl || data.image,
      iconUrl: data.iconUrl || data.icon,
      actions: data.actions,
      deepLink: data.deepLink,
      // Badge
      badge: data.badge,
      badgeAction: data.badgeAction,
      // Sound and grouping
      sound: data.sound,
      threadId: data.threadId,
      collapseKey: data.collapseKey,
      category: data.category,
      // Priority
      priority: data.priority,
      ttl: data.ttl,
      // Localization
      localizations: data.localizations,
      timezone: data.timezone,
      // Tracking
      messageId: data.messageId,
      campaignId: data.campaignId,
      // Legacy fields
      icon: data.iconUrl || data.icon,
      image: data.imageUrl || data.image,
      tag: data.tag || data.collapseKey || data.threadId,
    };
  }

  private getLocalizedContent(data: any, field: 'title' | 'body'): string | null {
    if (!data.localizations || !Array.isArray(data.localizations)) {
      return null;
    }

    const deviceLocale = navigator.language.split('-')[0].toLowerCase();

    const localized = data.localizations.find((loc: LocalizedContent) =>
      loc.locale.toLowerCase().startsWith(deviceLocale)
    );

    return localized ? localized[field] : null;
  }

  private handleBadge(message: RiviumPushMessage): void {
    if (message.badge === undefined && !message.badgeAction) return;

    const action = message.badgeAction || 'set';
    let newBadge = message.badge || 0;

    switch (action) {
      case 'set':
        newBadge = message.badge || 0;
        break;
      case 'increment':
        newBadge = this.badgeCount + (message.badge || 1);
        break;
      case 'decrement':
        newBadge = Math.max(0, this.badgeCount - (message.badge || 1));
        break;
      case 'clear':
        newBadge = 0;
        break;
    }

    this.setBadgeCount(newBadge);
  }

  private handleServiceWorkerMessage(event: MessageEvent): void {
    const data = event.data;

    if (data.type === 'push-message') {
      // Message forwarded from service worker (when tab is visible)
      this.log(RiviumPushLogLevel.DEBUG, 'Push message received from SW:', data.message?.title);
      const message = this.normalizeMessage(data.message);

      this.trackEvent(RiviumPushAnalyticsEvent.MESSAGE_RECEIVED, {
        messageId: message.messageId,
        title: message.title,
        source: 'web-push',
      });

      // Handle badge
      this.handleBadge(message);

      // Notify callback
      if (this.onMessageCallback) {
        this.onMessageCallback(message);
      }
    } else if (data.type === 'notification-click') {
      this.log(RiviumPushLogLevel.INFO, 'Notification clicked from SW');
      const message = this.normalizeMessage(data.message || {});

      this.trackEvent(RiviumPushAnalyticsEvent.NOTIFICATION_CLICKED, {
        messageId: message.messageId,
        title: message.title,
        action: data.action,
      });

      if (this.onNotificationClickCallback) {
        this.onNotificationClickCallback(message, data.action);
      }
    } else if (data.type === 'action-clicked') {
      this.log(RiviumPushLogLevel.INFO, 'Action clicked from SW:', data.actionId);
      const message = this.normalizeMessage(data.message || {});

      this.trackEvent(RiviumPushAnalyticsEvent.ACTION_CLICKED, {
        actionId: data.actionId,
        messageId: message.messageId,
        title: message.title,
      });

      if (this.onActionClickedCallback) {
        this.onActionClickedCallback(data.actionId, message);
      }
    } else if (data.type === 'initial-message') {
      // Store initial message from service worker (when app opened via notification)
      this.log(RiviumPushLogLevel.INFO, 'Initial message received from SW');
      this.initialMessage = this.normalizeMessage(data.message || {});

      // Also trigger the notification click callback for initial messages
      if (this.onNotificationClickCallback && this.initialMessage) {
        this.onNotificationClickCallback(this.initialMessage, undefined);
      }
    } else if (data.type === 'navigate') {
      // Navigate to URL requested by service worker
      this.log(RiviumPushLogLevel.INFO, 'Navigating to:', data.url);
      if (data.url && typeof window !== 'undefined') {
        window.location.href = data.url;
      }
    }
  }

  private showRichNotification(message: RiviumPushMessage): void {
    if (Notification.permission !== 'granted') {
      return;
    }

    const options: NotificationOptions & { image?: string } = {
      body: message.body,
      icon: message.iconUrl || message.icon,
      badge: message.iconUrl || message.icon,
      image: message.imageUrl || message.image,
      tag: message.tag || message.collapseKey || message.threadId,
      data: {
        ...message.data,
        deepLink: message.deepLink,
        messageId: message.messageId,
        campaignId: message.campaignId,
        riviumPushMessage: message,
      },
      requireInteraction: message.priority === 'high',
      silent: message.sound === 'none',
    };

    // Add action buttons if supported
    if (message.actions && message.actions.length > 0) {
      const notificationActions = message.actions.slice(0, 2).map((action) => ({
        action: action.id,
        title: action.title,
        icon: action.icon,
      }));

      if (this.serviceWorkerRegistration) {
        (options as any).actions = notificationActions;
      }
    }

    if (this.serviceWorkerRegistration) {
      this.serviceWorkerRegistration.showNotification(message.title, options);
    } else {
      const notification = new Notification(message.title, options);

      notification.onclick = () => {
        window.focus();
        if (message.deepLink) {
          window.location.href = message.deepLink;
        }
        if (this.onNotificationClickCallback) {
          this.onNotificationClickCallback(message);
        }

        this.trackEvent(RiviumPushAnalyticsEvent.NOTIFICATION_CLICKED, {
          messageId: message.messageId,
          title: message.title,
        });

        notification.close();
      };
    }
  }

  private updateFaviconBadge(count: number): void {
    try {
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      const size = 32;
      canvas.width = size;
      canvas.height = size;

      const existingFavicon = document.querySelector('link[rel="icon"]') as HTMLLinkElement;
      const faviconUrl = existingFavicon?.href || '/favicon.ico';

      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => {
        ctx.drawImage(img, 0, 0, size, size);

        if (count > 0) {
          const badgeSize = 14;
          const x = size - badgeSize / 2;
          const y = badgeSize / 2;

          ctx.beginPath();
          ctx.arc(x, y, badgeSize / 2 + 1, 0, 2 * Math.PI);
          ctx.fillStyle = '#ef4444';
          ctx.fill();

          ctx.fillStyle = '#ffffff';
          ctx.font = 'bold 10px sans-serif';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText(count > 99 ? '99+' : count.toString(), x, y);
        }

        const newFavicon = document.createElement('link');
        newFavicon.rel = 'icon';
        newFavicon.href = canvas.toDataURL('image/png');

        if (existingFavicon) {
          existingFavicon.remove();
        }
        document.head.appendChild(newFavicon);
      };
      img.src = faviconUrl;
    } catch (e) {
      this.log(RiviumPushLogLevel.WARNING, 'Could not update favicon badge:', e);
    }
  }

  private setConnectionState(state: ConnectionState): void {
    this.connectionState = state;
    if (this.onConnectionStateCallback) {
      this.onConnectionStateCallback(state);
    }
  }

  private getOrCreateDeviceId(): string {
    const key = 'rivium_push_device_id';
    let deviceId = localStorage.getItem(key);

    if (!deviceId) {
      deviceId = 'web_' + this.generateUUID();
      localStorage.setItem(key, deviceId);
    }

    return deviceId;
  }

  private generateUUID(): string {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) {
      return crypto.randomUUID();
    }
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
      const r = (Math.random() * 16) | 0;
      const v = c === 'x' ? r : (r & 0x3) | 0x8;
      return v.toString(16);
    });
  }

  private urlBase64ToUint8Array(base64String: string): Uint8Array {
    const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
    const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
    const rawData = window.atob(base64);
    const outputArray = new Uint8Array(rawData.length);

    for (let i = 0; i < rawData.length; ++i) {
      outputArray[i] = rawData.charCodeAt(i);
    }

    return outputArray;
  }
}

export default RiviumPush;
export { RiviumPush };
