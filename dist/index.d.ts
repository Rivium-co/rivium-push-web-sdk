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
/**
 * Standardized error codes for RiviumPush SDK.
 * These codes help developers identify and handle specific error scenarios.
 */
export declare enum RiviumPushErrorCode {
    CONNECTION_FAILED = 1000,
    CONNECTION_TIMEOUT = 1001,
    CONNECTION_LOST = 1002,
    CONNECTION_REFUSED = 1003,
    AUTHENTICATION_FAILED = 1004,
    SSL_ERROR = 1005,
    BROKER_UNAVAILABLE = 1006,
    SUBSCRIPTION_FAILED = 1100,
    UNSUBSCRIPTION_FAILED = 1101,
    INVALID_TOPIC = 1102,
    MESSAGE_DELIVERY_FAILED = 1200,
    MESSAGE_PARSE_ERROR = 1201,
    MESSAGE_TIMEOUT = 1202,
    INVALID_CONFIG = 1300,
    MISSING_API_KEY = 1301,
    /** @deprecated No longer used - server URL is internal */
    MISSING_SERVER_URL = 1302,
    INVALID_CREDENTIALS = 1303,
    REGISTRATION_FAILED = 1400,
    DEVICE_ID_GENERATION_FAILED = 1401,
    SERVER_ERROR = 1402,
    NETWORK_ERROR = 1403,
    NOT_INITIALIZED = 1500,
    NOT_CONNECTED = 1501,
    ALREADY_CONNECTED = 1502,
    SERVICE_NOT_RUNNING = 1503,
    PERMISSION_DENIED = 1600,
    PERMISSION_DISMISSED = 1601,
    UNKNOWN_ERROR = 9999
}
/**
 * Represents a RiviumPush error with code and additional details
 */
export declare class RiviumPushError extends Error {
    /** The error code */
    readonly code: RiviumPushErrorCode;
    /** Additional details about the error */
    readonly details?: string;
    constructor(code: RiviumPushErrorCode, details?: string);
    toJSON(): {
        code: RiviumPushErrorCode;
        message: string;
        details: string | undefined;
    };
}
/**
 * Analytics event types for tracking SDK usage.
 * Use with setAnalyticsHandler to track SDK events.
 */
export declare enum RiviumPushAnalyticsEvent {
    /** SDK was initialized */
    SDK_INITIALIZED = "sdkInitialized",
    /** Device was registered */
    DEVICE_REGISTERED = "deviceRegistered",
    /** Device was unregistered */
    DEVICE_UNREGISTERED = "deviceUnregistered",
    /** Push message was received */
    MESSAGE_RECEIVED = "messageReceived",
    /** Push message was displayed as notification */
    MESSAGE_DISPLAYED = "messageDisplayed",
    /** Notification was clicked */
    NOTIFICATION_CLICKED = "notificationClicked",
    /** Action button was clicked */
    ACTION_CLICKED = "actionClicked",
    /** MQTT connected successfully */
    CONNECTED = "connected",
    /** MQTT disconnected */
    DISCONNECTED = "disconnected",
    /** Connection error occurred */
    CONNECTION_ERROR = "connectionError",
    /** Retry attempt started (during exponential backoff) */
    RETRY_STARTED = "retryStarted",
    /** Topic subscribed */
    TOPIC_SUBSCRIBED = "topicSubscribed",
    /** Topic unsubscribed */
    TOPIC_UNSUBSCRIBED = "topicUnsubscribed",
    /** Network state changed */
    NETWORK_STATE_CHANGED = "networkStateChanged",
    /** App state changed (visible/hidden) */
    APP_STATE_CHANGED = "appStateChanged",
    /** Permission requested */
    PERMISSION_REQUESTED = "permissionRequested",
    /** Permission granted */
    PERMISSION_GRANTED = "permissionGranted",
    /** Permission denied */
    PERMISSION_DENIED = "permissionDenied"
}
/**
 * Log levels for the RiviumPush SDK.
 * Controls verbosity of logging output.
 */
export declare enum RiviumPushLogLevel {
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
    VERBOSE = 5
}
/**
 * Network type enumeration
 */
export declare enum NetworkType {
    WIFI = "wifi",
    CELLULAR = "cellular",
    ETHERNET = "ethernet",
    NONE = "none",
    UNKNOWN = "unknown"
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
    /** Large image URL */
    imageUrl?: string;
    /** Icon/avatar URL */
    iconUrl?: string;
    /** Action buttons (max 2 in browsers) */
    actions?: NotificationAction[];
    /** Deep link URL */
    deepLink?: string;
    /** Badge count */
    badge?: number;
    /** Badge action: set, increment, decrement, clear */
    badgeAction?: 'set' | 'increment' | 'decrement' | 'clear';
    /** Custom sound name */
    sound?: string;
    /** Thread ID for grouping */
    threadId?: string;
    /** Collapse key for replacing notifications */
    collapseKey?: string;
    /** Category for filtering */
    category?: string;
    /** Priority: default, high, low */
    priority?: 'default' | 'high' | 'low';
    /** Time to live in seconds */
    ttl?: number;
    /** Localized content variations */
    localizations?: LocalizedContent[];
    /** Target timezone */
    timezone?: string;
    /** Unique message ID */
    messageId?: string;
    /** Campaign ID for analytics */
    campaignId?: string;
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
export type RiviumPushAnalyticsCallback = (event: RiviumPushAnalyticsEvent, properties?: Record<string, any>) => void;
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
declare class RiviumPush {
    private config;
    private deviceId;
    private pnSocket;
    private serviceWorkerRegistration;
    private pushSubscription;
    private connectionState;
    private reconnectAttempts;
    private maxReconnectAttempts;
    private reconnectTimer;
    private subscribedTopics;
    private badgeCount;
    private initialized;
    private initialMessage;
    private mqttConfig;
    private mqttConfigFetched;
    private appId;
    private appIdentifier;
    private vapidPublicKey;
    private logLevel;
    private analyticsCallback;
    private analyticsEnabled;
    private onMessageCallback;
    private onConnectionStateCallback;
    private onRegisteredCallback;
    private onErrorCallback;
    private onDetailedErrorCallback;
    private onNotificationClickCallback;
    private onActionClickedCallback;
    private onReconnectingCallback;
    private onNetworkStateCallback;
    private onAppStateCallback;
    constructor(config: RiviumPushConfig);
    /**
     * Fetch MQTT and VAPID configuration from server
     */
    private fetchMqttConfig;
    private log;
    /**
     * Set the log level for SDK logging.
     *
     * @example
     * ```typescript
     * // In production, reduce logging
     * riviumPush.setLogLevel(RiviumPushLogLevel.ERROR);
     * ```
     */
    setLogLevel(level: RiviumPushLogLevel): void;
    /**
     * Get current log level
     */
    getLogLevel(): RiviumPushLogLevel;
    private trackEvent;
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
    setAnalyticsHandler(callback: RiviumPushAnalyticsCallback): void;
    /**
     * Disable analytics tracking
     */
    disableAnalytics(): void;
    /**
     * Check if analytics tracking is enabled
     */
    isAnalyticsEnabled(): boolean;
    private emitError;
    /**
     * Register device for push notifications
     */
    register(options?: RegisterOptions): Promise<string>;
    /**
     * Wait for config to be fetched from server
     */
    private waitForConfig;
    /**
     * Unregister device and disconnect
     */
    unregister(): Promise<void>;
    /**
     * Subscribe to a topic
     */
    subscribeTopic(topic: string): Promise<void>;
    /**
     * Unsubscribe from a topic
     */
    unsubscribeTopic(topic: string): Promise<void>;
    /**
     * Check if connected to MQTT broker
     */
    isConnected(): boolean;
    /**
     * Get current device ID
     */
    getDeviceId(): string | null;
    /**
     * Set user ID
     */
    setUserId(userId: string): Promise<void>;
    /**
     * Clear user ID
     */
    clearUserId(): void;
    /**
     * Get the message that launched/opened the app (when user tapped a notification)
     * Returns null if the app was not opened from a notification tap
     */
    getInitialMessage(): RiviumPushMessage | null;
    /**
     * Get current badge count
     */
    getBadgeCount(): number;
    /**
     * Set badge count
     */
    setBadgeCount(count: number): void;
    /**
     * Clear badge
     */
    clearBadge(): void;
    /**
     * Refresh MQTT JWT token (called automatically when token expires)
     * Can also be called manually if needed
     */
    refreshMqttToken(): Promise<void>;
    /**
     * Get current network state
     */
    getNetworkState(): NetworkState;
    /**
     * Get current app (visibility) state
     */
    getAppState(): AppState;
    /**
     * Check if notifications are supported
     */
    static isSupported(): boolean;
    /**
     * Get current notification permission status
     */
    static getPermissionStatus(): NotificationPermission;
    /**
     * Set callback for receiving messages
     */
    onMessage(callback: OnMessageCallback): () => void;
    /**
     * Set callback for connection state changes
     */
    onConnectionState(callback: OnConnectionStateCallback): () => void;
    /**
     * Set callback for registration success
     */
    onRegistered(callback: OnRegisteredCallback): () => void;
    /**
     * Set callback for errors (simple)
     */
    onError(callback: OnErrorCallback): () => void;
    /**
     * Set callback for detailed errors with error codes
     */
    onDetailedError(callback: OnDetailedErrorCallback): () => void;
    /**
     * Set callback for notification clicks
     */
    onNotificationClick(callback: OnNotificationClickCallback): () => void;
    /**
     * Set callback for action button clicks
     */
    onActionClicked(callback: OnActionClickedCallback): () => void;
    /**
     * Set callback for reconnection state changes
     */
    onReconnecting(callback: OnReconnectingCallback): () => void;
    /**
     * Set callback for network state changes
     */
    onNetworkState(callback: OnNetworkStateCallback): () => void;
    /**
     * Set callback for app state changes (visibility)
     */
    onAppState(callback: OnAppStateCallback): () => void;
    private detectNetworkType;
    private handleNetworkChange;
    private handleOnline;
    private handleOffline;
    private handleVisibilityChange;
    private checkInitialMessage;
    private registerServiceWorker;
    private requestNotificationPermission;
    private subscribeToPush;
    private registerDevice;
    private connectToGateway;
    /**
     * Handle incoming PNMessage from the protocol layer
     */
    private handlePNMessage;
    private disconnectFromGateway;
    private scheduleReconnect;
    private handleMqttMessage;
    private normalizeMessage;
    private getLocalizedContent;
    private handleBadge;
    private handleServiceWorkerMessage;
    private showRichNotification;
    private updateFaviconBadge;
    private setConnectionState;
    private getOrCreateDeviceId;
    private generateUUID;
    private urlBase64ToUint8Array;
}
export default RiviumPush;
export { RiviumPush };
