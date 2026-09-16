/**
 * Message Inbox for the RiviumPush Web SDK.
 *
 * An inbox message is a message that is stored server-side and stays
 * available to the app until the user reads, archives or deletes it —
 * independent of whether a notification was ever displayed.
 *
 * Reachable as `push.inbox` once the SDK is constructed; network calls need
 * a registered device (`register()`).
 *
 * @packageDocumentation
 */
/** Status of an inbox message. */
export type InboxMessageStatus = 'unread' | 'read' | 'archived' | 'deleted';
/** Content of an inbox message. */
export interface InboxContent {
    /** Message title */
    title: string;
    /** Message body */
    body: string;
    /** Large image URL */
    imageUrl?: string;
    /** Icon/avatar URL */
    iconUrl?: string;
    /** Deep link URL */
    deepLink?: string;
    /** Custom data payload */
    data?: Record<string, any>;
}
/** A single inbox message. */
export interface InboxMessage {
    /** Server-side message id */
    id: string;
    /** User this message belongs to, when addressed by user */
    userId?: string | null;
    /** Device this message belongs to, when addressed by device */
    deviceId?: string | null;
    /** Message content */
    content: InboxContent;
    /** Current status (defaults to `unread`) */
    status: InboxMessageStatus;
    /** Optional category, e.g. "promotions" */
    category?: string | null;
    /** ISO date after which the message is no longer returned */
    expiresAt?: string | null;
    /** ISO date the message was marked read */
    readAt?: string | null;
    /** ISO date the message was created */
    createdAt: string;
    /** ISO date the message was last updated */
    updatedAt?: string | null;
}
/** Filter options for {@link RiviumInbox.getMessages}. */
export interface InboxFilter {
    /** Only messages with this status */
    status?: InboxMessageStatus;
    /** Only messages in this category */
    category?: string;
    /** Page size (default: 50) */
    limit?: number;
    /** Page offset (default: 0) */
    offset?: number;
    /** Preferred locale for localized content, e.g. "fr" */
    locale?: string;
}
/** Response of {@link RiviumInbox.getMessages}. */
export interface InboxMessagesResponse {
    /** The messages for this page */
    messages: InboxMessage[];
    /** Total number of messages matching the filter */
    total: number;
    /** Number of unread messages */
    unreadCount: number;
}
/** Called when a new inbox message arrives in real time. */
export type OnInboxMessageCallback = (message: InboxMessage) => void;
/** Called when the status of a message changes. */
export type OnInboxStatusChangeCallback = (messageId: string, status: InboxMessageStatus) => void;
/** Called whenever the unread count changes. */
export type OnInboxUnreadCountCallback = (count: number) => void;
/**
 * Wiring the SDK passes to the inbox. Not part of the public API.
 * @internal
 */
export interface InboxDependencies {
    serverUrl: string;
    getApiKey: () => string;
    getDeviceId: () => string | null;
    getUserId: () => string | null;
    log: (level: number, message: string, ...args: any[]) => void;
    createError: (kind: 'network' | 'server' | 'notRegistered', details: string) => Error;
}
/**
 * Message Inbox client.
 *
 * ```typescript
 * push.inbox.onMessage((message) => render(message));
 * const { messages, unreadCount } = await push.inbox.getMessages({ status: 'unread' });
 * await push.inbox.markAsRead(messages[0].id);
 * ```
 */
export declare class RiviumInbox {
    private readonly deps;
    private cachedMessages;
    private unreadCount;
    /** Device the in-memory cache was loaded for, so identity changes reload. */
    private loadedKey;
    private onMessageCallback;
    private onStatusChangeCallback;
    private onUnreadCountCallback;
    /** Real-time updates can arrive twice (socket + service worker). */
    private handledIncomingIds;
    /** @internal */
    constructor(deps: InboxDependencies);
    /**
     * Listen for inbox messages arriving in real time.
     * Returns a function that removes the listener.
     */
    onMessage(callback: OnInboxMessageCallback): () => void;
    /**
     * Listen for status changes (read, archived, deleted).
     * Returns a function that removes the listener.
     */
    onStatusChange(callback: OnInboxStatusChangeCallback): () => void;
    /**
     * Listen for unread-count changes — useful to drive a badge.
     * Returns a function that removes the listener.
     */
    onUnreadCountChange(callback: OnInboxUnreadCountCallback): () => void;
    /**
     * Fetch inbox messages from the server. Messages are addressed by userId
     * when one is set, otherwise by deviceId. The result is cached locally.
     */
    getMessages(filter?: InboxFilter): Promise<InboxMessagesResponse>;
    /** Fetch a single message by id. */
    getMessage(messageId: string): Promise<InboxMessage>;
    /** Messages cached locally — available immediately, no network call. */
    getCachedMessages(): InboxMessage[];
    /** The last known unread count, without a network call. */
    getUnreadCount(): number;
    /** Ask the server for the current unread count. */
    fetchUnreadCount(): Promise<number>;
    /** Mark a message as read. */
    markAsRead(messageId: string): Promise<void>;
    /** Archive a message. */
    archiveMessage(messageId: string): Promise<void>;
    /** Delete a message. */
    deleteMessage(messageId: string): Promise<void>;
    /** Apply a status to several messages at once. */
    markMultiple(messageIds: string[], status: InboxMessageStatus): Promise<void>;
    /** Mark every message in this inbox as read. */
    markAllAsRead(): Promise<void>;
    /** Drop the local cache (in memory and in storage). */
    clearCache(): void;
    /**
     * Add a message that arrived in real time to the cache and notify listeners.
     * Called by the SDK for `inbox_update` payloads; safe to call directly.
     */
    handleIncomingMessage(message: InboxMessage): void;
    /**
     * Turn a raw `inbox_update` payload into an InboxMessage and handle it.
     * @internal
     */
    handleIncomingPayload(payload: Record<string, any>): void;
    /**
     * Point the inbox at a new identity. The cache belongs to the previous
     * user, so it is dropped and listeners see an unread count of 0.
     * @internal
     */
    onIdentityChanged(): void;
    private updateStatus;
    /** Messages are addressed by user when one is known, by device otherwise. */
    private identity;
    private request;
    private setUnreadCount;
    private storageKey;
    /** Restores the persisted cache the first time it is needed per device. */
    private ensureLoaded;
    private persist;
}
