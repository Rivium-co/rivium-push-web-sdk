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
import { SDK_NAME, SDK_VERSION } from './version';
import {
  BoundedSet,
  detectDeviceInfo,
  getRefreshReason,
  parseFingerprint,
  RegistrationFingerprint,
} from './internal';
import { RiviumInbox } from './inbox';
import {
  PushApiClient,
  UserTokenManager,
  type AuthErrorEvent,
  type OnAuthErrorCallback,
  type TokenProvider,
} from './user-token';
import { InAppMessages, type InAppConfig } from './in-app';
import {
  DEFAULT_MQTT_PATH,
  EndpointMemory,
  MqttEndpoint,
  PROBE_AFTER_HIDDEN_MS,
  PROBE_AFTER_SILENCE_MS,
  PROBE_TIMEOUT_MS,
  ReconnectThrottle,
  networkKey,
  orderEndpoints,
  parseMqttEndpoints,
} from './connection';

export { SDK_NAME, SDK_VERSION };
export type { AuthErrorEvent, OnAuthErrorCallback, TokenProvider } from './user-token';
export { RiviumInbox } from './inbox';
export type {
  InboxContent,
  InboxFilter,
  InboxMessage,
  InboxMessagesResponse,
  InboxMessageStatus,
  OnInboxMessageCallback,
  OnInboxStatusChangeCallback,
  OnInboxUnreadCountCallback,
} from './inbox';
export { InAppMessages, isInAppMessageEligible, selectInAppMessages, localizedContent } from './in-app';
export type {
  InAppBannerPosition,
  InAppButton,
  InAppButtonAction,
  InAppButtonStyle,
  InAppConfig,
  InAppEligibilityContext,
  InAppFilter,
  InAppImpressionAction,
  InAppLocalization,
  InAppMessage,
  InAppMessageContent,
  InAppMessageType,
  InAppTriggerType,
  OnInAppButtonClickedCallback,
  OnInAppDismissedCallback,
  OnInAppMessageReadyCallback,
} from './in-app';

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
  /**
   * Maximum reconnect attempts after the real-time connection drops
   * (default: 0 = keep trying while registered, backing off up to 60 s).
   */
  maxReconnectAttempts?: number;
  /** Initial log level (default: DEBUG in dev, ERROR in prod) */
  logLevel?: RiviumPushLogLevel;
  /**
   * Your web app version (e.g. "2.0.0"). Sent to the backend on every
   * register() and surfaced as a first-class segment filter in the
   * dashboard so you can target specific releases. Web has no equivalent
   * of iOS CFBundleShortVersionString / Android versionName — you set
   * this at init time from your build config.
   */
  appVersion?: string;
  /**
   * Keep the server-side registration fresh without calling register() on
   * every page load (default: true). On startup, a browser that registered
   * before is silently re-registered in the background when 24h have passed,
   * the push subscription endpoint changed, or `appVersion`, the SDK version
   * or the userId changed. Never prompts: it only runs when notification
   * permission is already granted. Errors are logged, never thrown.
   */
  autoRefresh?: boolean;
  /**
   * In-App Messages options. Omit it to keep the defaults: the built-in
   * shadow-DOM UI, triggered by your calls to `inApp.triggerOnAppOpen()` /
   * `inApp.triggerEvent()`.
   */
  inApp?: InAppConfig;
  /**
   * Optional. Returns the Rivium user token for the signed-in user, issued by
   * **your server** (never put the server secret in the page), or null when
   * nobody is signed in. It is the same token, and can be the same function,
   * you give the other Rivium SDKs.
   *
   * With it every request proves who the user is, so nobody holding the
   * public API key can act as another user. The SDK calls it when it needs a
   * token, shortly before the token expires, and when the server reports an
   * expired token. A failing provider never blocks registration or delivery.
   *
   * Without it the SDK behaves exactly as before.
   */
  tokenProvider?: TokenProvider;
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

/** localStorage key for the last successful registration fingerprint */
const REGISTRATION_STATE_KEY = 'rivium_push_registration_state';

/** Delivery acks: attempts per message and delay before each retry */
const DELIVERY_ACK_RETRY_DELAYS_MS = [1000, 5000];
/** How many recently acked messageIds to remember for dedupe */
const DELIVERY_ACK_DEDUPE_LIMIT = 500;

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
  private maxReconnectAttempts = 0;
  // Real-time connection lifecycle (set while the SDK keeps a connection up)
  private connectionStarted = false;
  private configRetryTimer: ReturnType<typeof setTimeout> | null = null;
  private configRetryAttempt = 0;
  private tokenRefreshInFlight = false;
  private hiddenAt: number | null = null;
  private readonly reconnectThrottle = new ReconnectThrottle();
  private readonly endpointMemory = new EndpointMemory();
  private serverEndpoints: MqttEndpoint[] | null = null;
  private lifecycleListeners: Array<{ target: EventTarget; type: string; handler: EventListener }> = [];
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
  private onAuthErrorCallback: OnAuthErrorCallback | null = null;

  // Signed user token (memory only) and the single door to the Push API
  private readonly userTokens: UserTokenManager;
  private readonly api: PushApiClient;

  // Set once the app calls register() so the background refresh stands down
  private registerRequested = false;
  // messageIds this page already confirmed delivery for (MQTT can redeliver)
  private ackedMessageIds = new BoundedSet(DELIVERY_ACK_DEDUPE_LIMIT);
  // messageIds already handed to the app. A visible page can receive the same
  // push over the real-time channel and from the service worker, and the
  // onMessage callback must fire once per message.
  private receivedMessageIds = new BoundedSet(DELIVERY_ACK_DEDUPE_LIMIT);

  /**
   * Message Inbox. Listeners can be attached immediately; network calls need
   * a registered device.
   */
  readonly inbox: RiviumInbox;

  /**
   * In-App Messages. Listeners can be attached immediately; network calls
   * need a registered device.
   */
  readonly inApp: InAppMessages;

  constructor(config: RiviumPushConfig) {
    if (!config.apiKey) {
      throw new Error('RiviumPush: apiKey is required');
    }
    this.config = {
      serviceWorkerPath: '/rivium-push-sw.js',
      autoRegisterServiceWorker: true,
      autoRefresh: true,
      mqttQos: 1,
      maxReconnectAttempts: 0,
      logLevel: RiviumPushLogLevel.ERROR,
      ...config,
    };

    this.maxReconnectAttempts = this.config.maxReconnectAttempts!;
    this.logLevel = this.config.logLevel!;

    this.userTokens = new UserTokenManager(this.config.tokenProvider ?? null);
    this.api = new PushApiClient(this.userTokens, (event) => this.emitAuthError(event));

    this.inbox = new RiviumInbox({
      serverUrl: RIVIUM_PUSH_SERVER_URL,
      fetch: (url, init) => this.authedFetch(url, init),
      getApiKey: () => this.config.apiKey,
      getDeviceId: () => this.deviceId,
      getUserId: () => this.userId,
      log: (level, message, ...args) => this.log(level as RiviumPushLogLevel, message, ...args),
      createError: (kind, details) => {
        const code =
          kind === 'network'
            ? RiviumPushErrorCode.NETWORK_ERROR
            : kind === 'server'
              ? RiviumPushErrorCode.SERVER_ERROR
              : RiviumPushErrorCode.NOT_INITIALIZED;
        return new RiviumPushError(code, details);
      },
    });

    this.inApp = new InAppMessages({
      serverUrl: RIVIUM_PUSH_SERVER_URL,
      fetch: (url, init) => this.authedFetch(url, init),
      getApiKey: () => this.config.apiKey,
      getDeviceId: () => this.deviceId,
      getUserId: () => this.userId,
      log: (level, message, ...args) => this.log(level as RiviumPushLogLevel, message, ...args),
      config: this.config.inApp,
    });

    if (typeof window === 'undefined') {
      // SSR environment (Next.js server-side) - skip browser-only initialization
      this.initialized = true;
      return;
    }

    this.deviceId = this.getOrCreateDeviceId();
    // Restore previously-issued subscriptionId so we can stream the new topic
    // immediately on page load — register() will refresh it.
    this.subscriptionId = localStorage.getItem('rivium_push_subscription_id') || null;
    // Same for the backend's topic id, so the first connection of a page load
    // streams from the channel the backend publishes to (see topicAppId).
    this.appId = localStorage.getItem('rivium_push_app_id') || null;
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

    // Counts the page load as a session so `minSessionCount` works, and fires
    // the app-open triggers when `inApp.autoTrigger` is on.
    this.inApp.startSession();

    // Fetch MQTT config from server
    this.fetchMqttConfig();

    if (this.config.autoRefresh) {
      this.maybeAutoRefresh();
    }
  }

  /**
   * Fetch MQTT and VAPID configuration from server
   */
  private async fetchMqttConfig(): Promise<void> {
    try {
      this.log(RiviumPushLogLevel.DEBUG, 'Fetching config from server...');

      const response = await this.authedFetch(`${RIVIUM_PUSH_SERVER_URL}/devices/config`, {
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

  /**
   * Every Push API call goes through here, so the user token and its expiry
   * are handled once. Without a token provider or token it is plain `fetch`.
   */
  private authedFetch(url: string, init?: RequestInit): Promise<Response> {
    return this.api.fetch(url, init);
  }

  private emitAuthError(event: AuthErrorEvent): void {
    this.log(RiviumPushLogLevel.WARNING, `Auth error [${event.code}]: ${event.message}`);
    if (this.onAuthErrorCallback) {
      try {
        this.onAuthErrorCallback(event);
      } catch (error) {
        this.log(RiviumPushLogLevel.ERROR, 'onAuthError callback threw:', error);
      }
    }
  }

  /**
   * Drop a cached token that belongs to someone other than `userId`, so the
   * next request asks the provider for this user's token.
   */
  private dropTokenOfOtherUser(userId?: string | null): void {
    if (!userId || !this.userTokens.hasToken()) return;
    const sub = this.userTokens.subject();
    if (sub === userId) return;
    // A token whose user cannot be read is only dropped when a provider can
    // supply a new one.
    if (sub === undefined && !this.userTokens.hasProvider()) return;
    this.userTokens.clear();
  }

  // ==========================================================================
  // Public API
  // ==========================================================================

  /**
   * Set, replace or remove (null) the token provider after init. See
   * `RiviumPushConfig.tokenProvider`.
   */
  setTokenProvider(provider: TokenProvider | null): void {
    this.userTokens.setProvider(provider);
    this.log(RiviumPushLogLevel.DEBUG, provider ? 'Token provider set' : 'Token provider removed');
  }

  /**
   * Hand the SDK a user token you fetched yourself (null forgets it). Kept in
   * memory only. With a token provider set, the provider takes over when this
   * token is about to expire; without one, set a new token before it expires.
   */
  setUserToken(token: string | null): void {
    this.userTokens.setToken(token);
    this.log(RiviumPushLogLevel.DEBUG, token ? `User token set (${token.length} chars)` : 'User token cleared');
  }

  /**
   * Register device for push notifications
   */
  async register(options?: RegisterOptions): Promise<string> {
    this.registerRequested = true;
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
      this.dropTokenOfOtherUser(effectiveOptions.userId);
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
        await this.authedFetch(`${RIVIUM_PUSH_SERVER_URL}/topics/subscribe`, {
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
      const channel = `rivium_push/${this.topicAppId()}/topic/${topic}`;
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
        await this.authedFetch(`${RIVIUM_PUSH_SERVER_URL}/topics/unsubscribe`, {
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
      const channel = `rivium_push/${this.topicAppId()}/topic/${topic}`;
      this.pnSocket.detach(channel);
      this.log(RiviumPushLogLevel.INFO, 'Unsubscribed from topic:', topic);
      this.trackEvent(RiviumPushAnalyticsEvent.TOPIC_UNSUBSCRIBED, { topic });
    }
  }

  /**
   * Show an OS notification for a message the app received while its page was
   * visible.
   *
   * A message that arrives over the real-time connection is handed to
   * `onMessage` and, while the page is visible, deliberately not shown as an
   * OS notification - the app is in front and usually shows its own UI. Some
   * messages still deserve one: a chat message for a conversation the user is
   * not reading, for instance. The app knows that; the SDK does not.
   *
   * Goes through the service worker when there is one, so clicks are handled
   * the same way as a notification the worker showed itself.
   */
  showNotification(message: RiviumPushMessage): void {
    if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
    this.showRichNotification(message);
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
    // The cached inbox belongs to the previous identity.
    this.inbox.onIdentityChanged();
    this.inApp.onIdentityChanged();

    this.dropTokenOfOtherUser(userId);
    await this.registerDevice({ userId });
    this.log(RiviumPushLogLevel.INFO, 'User ID set:', userId);
  }

  /**
   * Clear user ID. Call this on logout.
   *
   * Also detaches the user on the server. Registration treats a missing
   * userId as "keep the existing one", so clearing only local state would
   * leave this browser receiving the logged-out user's notifications.
   */
  async clearUserId(): Promise<void> {
    this.userId = null;
    localStorage.removeItem('rivium_push_user_id');
    this.inbox.onIdentityChanged();
    this.inApp.onIdentityChanged();

    if (this.deviceId) {
      try {
        await this.authedFetch(
          `${RIVIUM_PUSH_SERVER_URL}/devices/${encodeURIComponent(this.deviceId)}/user`,
          {
            method: 'DELETE',
            headers: { 'x-api-key': this.config.apiKey },
          },
        );
      } catch (err) {
        this.log(RiviumPushLogLevel.WARNING, 'Failed to clear user ID on server:', err);
      }
    }
    // The request above carried the signed-out user's token; forget it now.
    this.userTokens.clear();
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
      const response = await this.authedFetch(`${RIVIUM_PUSH_SERVER_URL}/devices/${this.deviceId}/mqtt-token/refresh`, {
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
   * Set callback for user token problems: the server refused the token
   * (`token_invalid`, `token_required`, `token_mismatch`, `token_expired`) or
   * the token provider failed (`token_provider_failed`). Informational - the
   * call that hit it reports its own error as usual.
   */
  onAuthError(callback: OnAuthErrorCallback): () => void {
    this.onAuthErrorCallback = callback;
    return () => {
      this.onAuthErrorCallback = null;
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
    // Reconnecting is handled by the connection lifecycle listeners.
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
    // Reconnecting when the page comes back is handled by the connection
    // lifecycle listeners (see startConnectionLifecycle).
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
      // Pass config on the registration URL rather than by postMessage: a
      // service worker is terminated between pushes, so anything held in
      // memory is gone by the time a push arrives. The script URL is
      // persisted by the browser, so query params survive restarts and are
      // available to the worker on every wake-up.
      const swUrl = new URL(this.config.serviceWorkerPath!, self.location.origin);
      swUrl.searchParams.set('riviumApiKey', this.config.apiKey);
      swUrl.searchParams.set('riviumServerUrl', RIVIUM_PUSH_SERVER_URL);
      swUrl.searchParams.set('riviumDeviceId', this.getOrCreateDeviceId());
      swUrl.searchParams.set('riviumSdkVersion', SDK_VERSION);

      // The same config in storage, as the worker's fallback. A worker that
      // the app registered itself - a plain register('/rivium-push-sw.js'),
      // another library, or a hot reload in development - carries no query
      // string, and used to go on showing notifications while silently
      // confirming none of them. Written before registering, so a worker that
      // activates immediately already finds it.
      await this.storeServiceWorkerConfig();

      this.serviceWorkerRegistration = await navigator.serviceWorker.register(
        swUrl.pathname + swUrl.search,
        { scope: '/' }
      );
      this.log(RiviumPushLogLevel.INFO, 'Service Worker registered');
    } catch (error) {
      this.log(RiviumPushLogLevel.ERROR, 'Service Worker registration failed:', error);
      throw new RiviumPushError(RiviumPushErrorCode.SERVICE_NOT_RUNNING, (error as Error).message);
    }
  }

  /**
   * Keeps `rivium-push` / `config` up to date for the service worker.
   *
   * Rewritten on every load, so a device id or server URL that changed does
   * not leave a stale record behind. Best-effort: private browsing and
   * blocked site data make IndexedDB unavailable, and the worker then falls
   * back to its URL exactly as before.
   */
  private storeServiceWorkerConfig(): Promise<void> {
    return new Promise<void>((resolve) => {
      if (typeof indexedDB === 'undefined') return resolve();
      let request: IDBOpenDBRequest;
      try {
        request = indexedDB.open('rivium-push', 1);
      } catch {
        return resolve();
      }
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains('config')) {
          request.result.createObjectStore('config');
        }
      };
      request.onerror = () => resolve();
      request.onsuccess = () => {
        const db = request.result;
        try {
          const tx = db.transaction('config', 'readwrite');
          tx.objectStore('config').put(
            {
              apiKey: this.config.apiKey,
              serverUrl: RIVIUM_PUSH_SERVER_URL,
              deviceId: this.getOrCreateDeviceId(),
              sdkVersion: SDK_VERSION,
            },
            'config',
          );
          tx.oncomplete = () => {
            db.close();
            resolve();
          };
          tx.onerror = () => {
            db.close();
            resolve();
          };
        } catch {
          db.close();
          resolve();
        }
      };
    });
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

  /**
   * Whether an existing subscription was created with the given VAPID key.
   *
   * `applicationServerKey` comes back as an ArrayBuffer, so compare it against
   * the decoded form of the current key. If the browser doesn't expose the
   * option (older implementations), assume a match rather than churn a working
   * subscription.
   */
  private subscriptionMatchesVapidKey(
    subscription: PushSubscription,
    vapidPublicKey: string,
  ): boolean {
    try {
      const existingKey = subscription.options?.applicationServerKey;
      if (!existingKey) return true;

      const existingBytes = new Uint8Array(existingKey as ArrayBuffer);
      const currentBytes = this.urlBase64ToUint8Array(vapidPublicKey);

      if (existingBytes.length !== currentBytes.length) return false;
      return existingBytes.every((b, i) => b === currentBytes[i]);
    } catch {
      // Never let a comparison failure discard a working subscription.
      return true;
    }
  }

  private async subscribeToPush(vapidPublicKey: string): Promise<PushSubscription> {
    if (!this.serviceWorkerRegistration) {
      throw new RiviumPushError(RiviumPushErrorCode.SERVICE_NOT_RUNNING, 'Service Worker not registered');
    }

    // Check if there's an existing subscription
    const existingSubscription = await this.serviceWorkerRegistration.pushManager.getSubscription();
    if (existingSubscription) {
      // A subscription is bound to the VAPID key it was created with. If the
      // project's key has since been rotated, the old subscription still looks
      // valid here but every send is rejected by the push service — silently,
      // forever. Detect the mismatch and re-subscribe with the current key.
      if (this.subscriptionMatchesVapidKey(existingSubscription, vapidPublicKey)) {
        this.log(RiviumPushLogLevel.DEBUG, 'Using existing Push subscription');
        return existingSubscription;
      }

      this.log(
        RiviumPushLogLevel.INFO,
        'Push subscription was created with a different VAPID key, re-subscribing',
      );
      try {
        await existingSubscription.unsubscribe();
      } catch (e) {
        this.log(RiviumPushLogLevel.WARNING, 'Failed to unsubscribe stale subscription:', e);
      }
    }

    const subscription = await this.serviceWorkerRegistration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: this.urlBase64ToUint8Array(vapidPublicKey) as BufferSource,
    });

    this.log(RiviumPushLogLevel.INFO, 'Push subscription created');
    return subscription;
  }

  /**
   * Read platform-native device attributes. Sent on every register() so
   * the dashboard can segment by app version, OS, locale, timezone, etc.
   * without customers having to populate metadata manually. All fields
   * best-effort — SSR / older browser combos may leave some undefined.
   */
  private captureDeviceAttributes(): {
    appVersion?: string;
    osVersion?: string;
    deviceModel?: string;
    language?: string;
    country?: string;
    timezone?: string;
  } {
    if (typeof navigator === 'undefined') return {};

    // Language + country from navigator.language ("en-US" → ["en", "US"]).
    // Falls back to language-only if no region tag.
    const [lang, region] = (navigator.language || '').split('-');

    // Timezone from Intl. Guarded because older Safari can throw.
    let timezone: string | undefined;
    try {
      timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    } catch {
      timezone = undefined;
    }

    return {
      // Web has no bundle-version concept — leave empty. Customers can
      // still set `version` in options.metadata if they want to segment.
      appVersion: this.config.appVersion,
      // Best-effort from UA Client Hints / UA string, e.g. osVersion
      // "Android 14", deviceModel "Chrome 128" (the browser — web has no
      // hardware model).
      ...detectDeviceInfo(navigator),
      language: lang || undefined,
      country: region || undefined,
      timezone,
    };
  }

  private async registerDevice(options?: RegisterOptions): Promise<{ deviceId: string; subscriptionId?: string; mqtt?: { token?: string } }> {
    try {
      // Auto-captured device attributes — sent as top-level fields so the
      // dashboard's segment builder can filter on them as preset fields.
      // Everything guarded for SSR safety.
      const attrs = this.captureDeviceAttributes();

      // Build request body (use window.location.origin as appIdentifier for per-app isolation)
      const requestBody: Record<string, any> = {
        deviceId: this.deviceId,
        platform: 'web',
        // Sent in the body rather than the X-Rivium-SDK header: a custom
        // header would need a CORS preflight allowance on the push API.
        sdkName: SDK_NAME,
        sdkVersion: SDK_VERSION,
        userId: options?.userId,
        appIdentifier: typeof window !== 'undefined' ? window.location.origin : undefined,
        // Device attributes are now sent as top-level fields (see `attrs`
        // below) so they can be used as preset filters in the dashboard.
        // `metadata.language` is kept for one release as a deprecation
        // grace period for existing segments that filter on it — new
        // segments should use the top-level `language` field instead.
        metadata: {
          ...options?.metadata,
          userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : undefined,
          language: typeof navigator !== 'undefined' ? navigator.language : undefined,
          url: typeof window !== 'undefined' ? window.location.origin : undefined,
        },
        ...attrs,
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

      const response = await this.authedFetch(`${RIVIUM_PUSH_SERVER_URL}/devices/register`, {
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

      this.saveRegistrationState(options?.userId ?? null);

      // Store appId for topic subscriptions, and persist it: a page that
      // reconnects before register() finishes would otherwise fall back to the
      // API key prefix and stream from a channel nobody publishes to.
      if (data.appId) {
        this.appId = data.appId;
        try {
          localStorage.setItem('rivium_push_app_id', data.appId);
        } catch {
          // Storage blocked — register() sets it again on the next load.
        }
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

      // The config fetch may have failed; the register response carries the
      // same gateway fields, so use them rather than losing the token.
      if (!this.mqttConfig && data.mqtt && (data.mqtt.wsHost || data.mqtt.host) && data.mqtt.wsPort) {
        this.mqttConfig = { ...data.mqtt };
      }

      // Store connection token from registration response
      if (data.mqtt?.token && this.mqttConfig) {
        this.mqttConfig.token = data.mqtt.token;
        this.log(RiviumPushLogLevel.DEBUG, 'Connection token received from registration');
      }

      // Optional failover endpoints. Absent = default endpoint only (clears any old list).
      this.serverEndpoints = parseMqttEndpoints(data.mqttEndpoints, DEFAULT_MQTT_PATH);
      this.endpointMemory.saveServerEndpoints(this.serverEndpoints);

      return data;
    } catch (error) {
      if (error instanceof RiviumPushError) throw error;
      throw new RiviumPushError(RiviumPushErrorCode.NETWORK_ERROR, (error as Error).message);
    }
  }

  // ==========================================================================
  // Private Methods - PN Protocol Connection
  // ==========================================================================

  /** Today's default gateway: `wsHost`/`wsPort` from the config, path /mqtt. */
  private defaultEndpoint(): MqttEndpoint | null {
    if (!this.mqttConfig) return null;
    // Use wsHost for WebSocket connections (via Cloudflare), fallback to host
    const host = this.mqttConfig.wsHost || this.mqttConfig.host;
    const port = this.mqttConfig.wsPort;
    if (!host || !port) return null;
    // Determine if secure connection is needed
    const isSecurePage = typeof window !== 'undefined' && window.location.protocol === 'https:';
    const secure = isSecurePage || port === 443;
    return { host, port, secure, path: DEFAULT_MQTT_PATH };
  }

  /**
   * Endpoints for one connection round: the one that last worked on this
   * connection type, then the server list, then the default last.
   */
  private endpointsForRound(): MqttEndpoint[] {
    const fallback = this.defaultEndpoint();
    let server = this.serverEndpoints ?? this.endpointMemory.serverEndpoints();
    // An https page cannot open ws:// connections (mixed content).
    if (typeof window !== 'undefined' && window.location.protocol === 'https:') {
      server = server.filter((e) => e.secure);
    }
    return orderEndpoints(server, fallback, this.endpointMemory.winner(networkKey()));
  }

  private connectToGateway(): void {
    // Never two connections at once: drop the previous socket first
    if (this.pnSocket) {
      this.pnSocket.close();
      this.pnSocket = null;
    }
    this.clearConfigRetry();

    // Check if config is available
    if (!this.mqttConfig) {
      this.scheduleConfigRetry();
      return;
    }

    // Check if we have JWT token for authentication
    if (!this.mqttConfig.token) {
      this.log(RiviumPushLogLevel.ERROR, 'Connection token not available. Device must be registered first.');
      this.emitError(RiviumPushErrorCode.AUTHENTICATION_FAILED, 'Connection token not available');
      return;
    }

    const fallback = this.defaultEndpoint();
    if (!fallback) {
      this.log(RiviumPushLogLevel.ERROR, 'Gateway config incomplete');
      this.emitError(RiviumPushErrorCode.INVALID_CONFIG, 'Gateway config incomplete');
      return;
    }

    this.setConnectionState('connecting');
    this.log(RiviumPushLogLevel.DEBUG, `Connecting to gateway (secure: ${fallback.secure})`);

    const clientId = `rivium_push_${this.appId}_${this.deviceId}`;

    // Build PNConfig using the protocol's builder. The socket owns reconnection:
    // backoff 1 s .. 60 s with jitter, endpoint failover, 30 s keepalive.
    const pnConfig = new PNConfigBuilder()
      .gateway(fallback.host)
      .port(fallback.port)
      .clientId(clientId)
      .auth(PNAuthFactory.token(this.mqttConfig.token))
      .secure(fallback.secure)
      .wsPath(fallback.path)
      .freshStart(false)
      .heartbeatInterval(30)
      .autoReconnect(true)
      .maxReconnectAttempts(this.maxReconnectAttempts)
      .reconnectDelay(1000)
      .maxReconnectDelay(60000)
      .connectionTimeout(10)
      .build();

    const socket = new PNSocket(pnConfig);
    this.pnSocket = socket;

    socket.setEndpointProvider(() => this.endpointsForRound());
    socket.addEndpointListener((endpoint) => {
      this.endpointMemory.saveWinner(networkKey(), endpoint as MqttEndpoint);
    });

    // Set up connection listener. Every callback checks it still belongs to
    // the current socket, so a replaced socket can never act.
    const isCurrent = () => this.pnSocket === socket;
    const connectionListener: PNConnectionListener = {
      onStateChanged: (state: PNState) => {
        if (!isCurrent()) return;
        this.log(RiviumPushLogLevel.DEBUG, `Connection state changed: ${state}`);
        if (state === PNState.CONNECTING && this.connectionState !== 'connecting') {
          this.setConnectionState('connecting');
        }
      },
      onConnected: () => {
        if (!isCurrent()) return;
        this.log(RiviumPushLogLevel.INFO, 'Connected to gateway');
        this.setConnectionState('connected');
        this.trackEvent(RiviumPushAnalyticsEvent.CONNECTED);
        this.streamChannels(socket);
      },
      onDisconnected: (reason?: string) => {
        if (!isCurrent()) return;
        this.log(RiviumPushLogLevel.INFO, 'Disconnected from gateway', reason || '');
        this.setConnectionState('disconnected');
        this.trackEvent(RiviumPushAnalyticsEvent.DISCONNECTED);
      },
      onReconnecting: (attempt: number, nextRetryMs: number) => {
        if (!isCurrent()) return;
        if (this.connectionState === 'connected' || this.connectionState === 'connecting') {
          this.setConnectionState('disconnected');
        }
        this.log(RiviumPushLogLevel.INFO, `Reconnecting in ${nextRetryMs}ms (attempt ${attempt + 1})`);
        const reconnectionState: ReconnectionState = {
          retryAttempt: attempt + 1,
          nextRetryMs,
          maxRetryAttempts: this.maxReconnectAttempts,
        };
        if (this.onReconnectingCallback) {
          this.onReconnectingCallback(reconnectionState);
        }
        this.trackEvent(RiviumPushAnalyticsEvent.RETRY_STARTED, {
          retryAttempt: attempt + 1,
          nextRetryMs,
        });
      },
    };

    socket.addConnectionListener(connectionListener);

    // Set up error listener
    socket.addErrorListener((error: PNProtocolError) => {
      if (!isCurrent()) return;
      // Connection errors while backgrounded (iOS/Safari suspending the
      // PWA) are expected, not real errors. Log them at DEBUG so devtools
      // isn't flooded with red during normal background behavior.
      const isHidden = typeof document !== 'undefined' && document.hidden;
      this.log(
        isHidden ? RiviumPushLogLevel.DEBUG : RiviumPushLogLevel.ERROR,
        'Gateway error:',
        error.message,
      );
      this.setConnectionState('error');

      // Map PNProtocolError to RiviumPushErrorCode
      let errorCode = RiviumPushErrorCode.CONNECTION_FAILED;
      const errorMessage = error.message.toLowerCase();

      if (errorMessage.includes('timeout')) {
        errorCode = RiviumPushErrorCode.CONNECTION_TIMEOUT;
      } else if (errorMessage.includes('refused') || errorMessage.includes('not authorized')) {
        errorCode = RiviumPushErrorCode.CONNECTION_REFUSED;
        // Token might be expired - try to refresh it. The socket does not fail
        // over to another endpoint on a rejection; it backs off until the new
        // token is in place and reconnectImmediately() is called.
        if (errorMessage.includes('not authorized')) {
          this.refreshTokenAndReconnect(socket);
          return;
        }
      } else if (errorMessage.includes('auth') || errorMessage.includes('credential')) {
        errorCode = RiviumPushErrorCode.AUTHENTICATION_FAILED;
      } else if (errorMessage.includes('ssl') || errorMessage.includes('tls')) {
        errorCode = RiviumPushErrorCode.SSL_ERROR;
      }

      this.emitError(errorCode, error.message);
    });

    this.connectionStarted = true;
    this.startConnectionLifecycle();

    // Open connection
    this.log(RiviumPushLogLevel.DEBUG, 'Opening connection to gateway...');
    socket.open();
  }

  /**
   * Stream the device, broadcast and topic channels. The socket keeps its
   * channels across reconnects and resubscribes them itself, so only channels
   * it does not have yet are added.
   */
  private streamChannels(socket: PNSocket): void {
    const active = socket.getActiveChannels();
    const streamOnce = (channel: string) => {
      if (active.has(channel)) return;
      socket.stream(channel, (message: PNMessage) => {
        this.handlePNMessage(message);
      }, this.config.mqttQos as PNDeliveryMode);
      active.add(channel);
    };

    const appId = this.topicAppId();
    const appIdentifier = this.appIdentifier || (typeof window !== 'undefined' ? window.location.origin : '_default');

    // Per-install subscription channel — primary delivery channel for
    // every device-targeted message after the subscriptionId migration.
    if (this.subscriptionId) {
      const subscriptionChannel = `rivium_push/${appId}/sub/${this.subscriptionId}`;
      streamOnce(subscriptionChannel);
      this.log(RiviumPushLogLevel.DEBUG, `Streaming from subscription channel ${subscriptionChannel}`);
    }

    // Stream broadcast channel
    streamOnce(`rivium_push/${appId}/broadcast`);
    this.log(RiviumPushLogLevel.DEBUG, 'Streaming from broadcast channel');

    // DEPRECATED: legacy device-scoped channel. The backend stopped
    // publishing here after the subscriptionId migration. Kept streamed
    // only to keep older test builds / out-of-tree backends working;
    // will be removed in a future SDK release.
    streamOnce(`rivium_push/${appId}/${this.deviceId}/${appIdentifier}`);
    this.log(RiviumPushLogLevel.DEBUG, 'Streaming from (deprecated) device channel');

    // Resubscribe to custom topics
    this.subscribedTopics.forEach((topic) => {
      streamOnce(`rivium_push/${appId}/topic/${topic}`);
    });
  }

  /** "Not authorized": fetch a fresh token, then reconnect the same socket with it. */
  private refreshTokenAndReconnect(socket: PNSocket): void {
    if (this.tokenRefreshInFlight) return;
    this.tokenRefreshInFlight = true;
    this.log(RiviumPushLogLevel.INFO, 'Token may be expired, attempting refresh...');
    this.refreshMqttToken()
      .then(() => {
        if (this.pnSocket !== socket || !this.mqttConfig?.token) return;
        this.log(RiviumPushLogLevel.INFO, 'Token refreshed, reconnecting...');
        socket.updateAuth(PNAuthFactory.token(this.mqttConfig.token));
        socket.reconnectImmediately();
      })
      .catch((refreshError) => {
        this.log(RiviumPushLogLevel.ERROR, 'Token refresh failed:', refreshError);
        this.emitError(RiviumPushErrorCode.AUTHENTICATION_FAILED, 'Token expired and refresh failed');
      })
      .finally(() => {
        this.tokenRefreshInFlight = false;
      });
  }

  /** Config fetch failed earlier: fetch it again with backoff, then connect. */
  private scheduleConfigRetry(): void {
    const delay = Math.min(2000 * Math.pow(2, this.configRetryAttempt), 60000);
    this.configRetryAttempt++;
    this.log(RiviumPushLogLevel.WARNING, `Gateway config not available, retrying in ${delay}ms...`);
    this.connectionStarted = true;
    this.startConnectionLifecycle();
    this.configRetryTimer = setTimeout(async () => {
      this.configRetryTimer = null;
      if (!this.connectionStarted) return;
      if (!this.mqttConfig) await this.fetchMqttConfig();
      if (!this.connectionStarted || this.configRetryTimer) return;
      if (this.mqttConfig && !this.mqttConfig.token) {
        // A fresh config has no token: register() has to run again.
        this.log(RiviumPushLogLevel.WARNING, 'Gateway config fetched without a token; call register() again');
        return;
      }
      this.connectToGateway();
    }, delay);
  }

  private clearConfigRetry(): void {
    if (this.configRetryTimer) {
      clearTimeout(this.configRetryTimer);
      this.configRetryTimer = null;
    }
  }

  // ==========================================================================
  // Private Methods - Connection lifecycle (online / visible / focus / pageshow)
  // ==========================================================================

  /** Attach the reconnect triggers once per started connection. */
  private startConnectionLifecycle(): void {
    if (this.lifecycleListeners.length > 0 || typeof window === 'undefined') return;
    const add = (target: EventTarget | undefined, type: string, handler: EventListener) => {
      if (!target) return;
      target.addEventListener(type, handler);
      this.lifecycleListeners.push({ target, type, handler });
    };
    this.hiddenAt = typeof document !== 'undefined' && document.hidden ? Date.now() : null;

    add(window, 'online', () => this.onLifecycleTrigger('online'));
    add(window, 'focus', () => this.onLifecycleTrigger('focus'));
    add(window, 'pageshow', (event: Event) => {
      this.onLifecycleTrigger((event as PageTransitionEvent).persisted ? 'pageshow-restored' : 'pageshow');
    });
    if (typeof document !== 'undefined') {
      add(document, 'visibilitychange', () => {
        if (document.visibilityState === 'hidden') {
          if (this.hiddenAt === null) this.hiddenAt = Date.now();
          return;
        }
        this.onLifecycleTrigger('visible');
      });
    }
  }

  /** Remove the reconnect triggers (disconnect / unregister). */
  private stopConnectionLifecycle(): void {
    for (const { target, type, handler } of this.lifecycleListeners) {
      target.removeEventListener(type, handler);
    }
    this.lifecycleListeners = [];
    this.hiddenAt = null;
    this.reconnectThrottle.reset();
  }

  /**
   * The page came back (visible, focus, bfcache restore) or the network did.
   * Waiting to retry: connect now with the backoff reset. Connected: if the
   * page was away long enough for the connection to have died silently,
   * check it and replace it when it does not answer.
   */
  private onLifecycleTrigger(reason: string): void {
    if (!this.connectionStarted) return;
    if (typeof document !== 'undefined' && document.visibilityState === 'hidden' && reason !== 'online') return;

    const hiddenFor = this.hiddenAt === null ? 0 : Date.now() - this.hiddenAt;
    if (reason !== 'online') this.hiddenAt = null;

    if (!this.reconnectThrottle.tryAcquire()) {
      this.log(RiviumPushLogLevel.DEBUG, `Reconnect trigger (${reason}) debounced`);
      return;
    }

    const socket = this.pnSocket;
    if (!socket) {
      // Waiting for the gateway config: try it now.
      if (this.configRetryTimer) {
        this.configRetryAttempt = 0;
        this.clearConfigRetry();
        this.connectToGateway();
      }
      return;
    }

    switch (socket.state) {
      case PNState.CONNECTED: {
        const lastActivity = socket.lastActivityAt();
        const silentFor = lastActivity > 0 ? Date.now() - lastActivity : 0;
        const suspect =
          reason === 'online' ||
          reason === 'pageshow-restored' ||
          hiddenFor >= PROBE_AFTER_HIDDEN_MS ||
          silentFor >= PROBE_AFTER_SILENCE_MS;
        if (suspect) {
          this.log(RiviumPushLogLevel.DEBUG, `Reconnect trigger (${reason}) - checking the connection`);
          socket.probe(PROBE_TIMEOUT_MS).catch(() => undefined);
        }
        break;
      }
      case PNState.CONNECTING:
      case PNState.DISCONNECTING:
        break;
      default:
        this.log(RiviumPushLogLevel.INFO, `Reconnect trigger (${reason}) - reconnecting now`);
        socket.reconnectImmediately();
    }
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
    this.connectionStarted = false;
    this.clearConfigRetry();
    this.configRetryAttempt = 0;
    this.stopConnectionLifecycle();

    if (this.pnSocket) {
      const socket = this.pnSocket;
      this.pnSocket = null;
      socket.close();
    }

    this.setConnectionState('disconnected');
  }

  private handleMqttMessage(topic: string, data: any): void {
    if (this.routeInboxUpdate(data)) return;

    const message = this.normalizeMessage(data);

    if (!this.markReceived(message.messageId)) {
      this.log(RiviumPushLogLevel.DEBUG, 'Duplicate message ignored:', message.messageId);
      return;
    }

    this.log(RiviumPushLogLevel.DEBUG, 'Message received:', message.title);

    this.trackEvent(RiviumPushAnalyticsEvent.MESSAGE_RECEIVED, {
      messageId: message.messageId,
      title: message.title,
      silent: message.silent,
      hasImage: !!message.imageUrl,
      hasActions: !!message.actions?.length,
    });

    // Confirm delivery. Web Push arrivals are acked by the service worker;
    // messages over the real-time channel never reach it, so ack here.
    this.reportDelivered(message.messageId);

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

  /**
   * POST /receipts/delivered for a message received on this page. Deduped per
   * messageId (the server is idempotent too) and retried a bounded number of
   * times on network errors, 429 and 5xx. Never throws.
   */
  private async reportDelivered(messageId?: string): Promise<void> {
    if (!messageId || !this.deviceId || typeof fetch === 'undefined') return;
    if (!this.ackedMessageIds.add(messageId)) return;

    for (let attempt = 0; ; attempt++) {
      let retryable = true;
      try {
        const response = await this.authedFetch(`${RIVIUM_PUSH_SERVER_URL}/receipts/delivered`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': this.config.apiKey,
          },
          body: JSON.stringify({ messageId, deviceId: this.deviceId }),
          keepalive: true,
        });
        if (response.ok) {
          this.log(RiviumPushLogLevel.DEBUG, 'Delivery confirmed', messageId);
          return;
        }
        retryable = response.status === 429 || response.status >= 500;
        this.log(RiviumPushLogLevel.WARNING, `Delivery ack rejected: HTTP ${response.status}`, messageId);
      } catch (error) {
        this.log(RiviumPushLogLevel.WARNING, 'Delivery ack failed:', (error as Error)?.message);
      }

      if (!retryable || attempt >= DELIVERY_ACK_RETRY_DELAYS_MS.length) {
        // Forget it so a redelivery of the same message can try again.
        this.ackedMessageIds.delete(messageId);
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, DELIVERY_ACK_RETRY_DELAYS_MS[attempt]));
    }
  }

  // ==========================================================================
  // Private Methods - Automatic registration refresh
  // ==========================================================================

  private saveRegistrationState(userId: string | null): void {
    try {
      const state: RegistrationFingerprint = {
        registeredAt: Date.now(),
        endpoint: this.pushSubscription?.endpoint ?? null,
        appVersion: this.config.appVersion ?? null,
        sdkVersion: SDK_VERSION,
        userId,
      };
      localStorage.setItem(REGISTRATION_STATE_KEY, JSON.stringify(state));
    } catch {
      // Storage full / blocked — refresh just runs again next load.
    }
  }

  /**
   * Silently re-register a browser that registered before, when the server's
   * copy is likely stale. Never prompts for permission and never throws.
   */
  private async maybeAutoRefresh(): Promise<void> {
    try {
      const previous = parseFingerprint(localStorage.getItem(REGISTRATION_STATE_KEY));
      // 0.1.4 and earlier stored no fingerprint; a stored subscriptionId
      // still proves this browser registered.
      if (!previous && !localStorage.getItem('rivium_push_subscription_id')) return;
      if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return;

      await this.waitForConfig();
      // The app called register() itself on this page load — nothing to do.
      if (this.registerRequested) return;
      // Without the server config there is no VAPID key, and registering
      // without a subscription could drop a working one server-side.
      if (!this.mqttConfigFetched && !this.config.vapidPublicKey) return;

      if ('serviceWorker' in navigator) {
        if (this.config.autoRegisterServiceWorker) {
          await this.registerServiceWorker();
        } else {
          this.serviceWorkerRegistration = (await navigator.serviceWorker.getRegistration()) ?? null;
        }
      }

      // Permission is already granted, so this never prompts. It recreates a
      // subscription the browser dropped or one bound to an old VAPID key.
      let subscription: PushSubscription | null = null;
      const vapidKey = this.vapidPublicKey || this.config.vapidPublicKey;
      if (vapidKey && this.serviceWorkerRegistration) {
        subscription = await this.subscribeToPush(vapidKey);
      }

      const reason = getRefreshReason(
        previous,
        {
          endpoint: subscription?.endpoint ?? null,
          appVersion: this.config.appVersion ?? null,
          sdkVersion: SDK_VERSION,
          userId: this.userId,
        },
        Date.now(),
      );
      if (!reason || this.registerRequested) {
        this.log(RiviumPushLogLevel.DEBUG, 'Registration is fresh, skipping auto refresh');
        return;
      }

      this.log(RiviumPushLogLevel.INFO, `Refreshing registration in background (${reason})`);
      if (subscription) this.pushSubscription = subscription;
      await this.registerDevice({ userId: this.userId ?? undefined });
      this.log(RiviumPushLogLevel.INFO, 'Background registration refresh complete');
    } catch (error) {
      this.log(RiviumPushLogLevel.WARNING, 'Background registration refresh failed:', error);
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

  /**
   * Records a messageId as handed to the app. Returns false if it already was.
   * Messages without an id can't be deduped and always pass.
   */
  private markReceived(messageId?: string): boolean {
    if (!messageId) return true;
    return this.receivedMessageIds.add(messageId);
  }

  /**
   * `inbox_update` payloads update the Message Inbox instead of being shown
   * as a notification. Deduped by message id like delivery acks, so a payload
   * arriving over both the real-time channel and the service worker counts
   * once. Returns true when the payload was an inbox update.
   */
  private routeInboxUpdate(payload: any): boolean {
    const type = payload?.type ?? payload?.data?.type;
    if (type !== 'inbox_update') return false;

    const messageId = payload.messageId ?? payload.id;
    if (messageId && !this.markReceived(String(messageId))) {
      this.log(RiviumPushLogLevel.DEBUG, 'Duplicate inbox update ignored:', messageId);
      return true;
    }

    this.log(RiviumPushLogLevel.DEBUG, 'Routing inbox_update to inbox:', messageId);
    this.inbox.handleIncomingPayload(payload);
    return true;
  }

  private handleServiceWorkerMessage(event: MessageEvent): void {
    const data = event.data;
    if (!data || typeof data !== 'object') return;

    // The worker posts 'rivium-push-message'; 'push-message' is the name this
    // handler originally listened for, kept so older or customised service
    // workers still reach the page.
    if (data.type === 'rivium-push-message' || data.type === 'push-message') {
      // Message forwarded from service worker (when tab is visible)
      this.log(RiviumPushLogLevel.DEBUG, 'Push message received from SW:', data.message?.title);
      if (this.routeInboxUpdate(data.message || {})) return;

      const message = this.normalizeMessage(data.message || {});

      if (!this.markReceived(message.messageId)) {
        this.log(RiviumPushLogLevel.DEBUG, 'Duplicate message ignored:', message.messageId);
        return;
      }

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
      // Falls back to the message id, exactly as the service worker does: the
      // same push can arrive over both transports, and a shared tag makes the
      // second replace the first instead of showing a second notification.
      tag: message.tag || message.collapseKey || message.threadId || message.messageId,
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

  /**
   * The id the BACKEND uses in MQTT topics: the first 16 characters of the
   * project id, returned as `appId` by /devices/register.
   *
   * Channels were built from the API key prefix instead, so every channel this
   * SDK streamed from was one nothing is ever published to - the real-time
   * path silently delivered nothing on web, from 0.1.0 until 0.1.9. It went
   * unnoticed because Web Push carried every message on its own.
   *
   * The API key prefix stays as the fallback for a backend old enough not to
   * return `appId`; the native SDKs do exactly the same.
   */
  private topicAppId(): string {
    return this.appId || this.config.apiKey.substring(0, 16);
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
