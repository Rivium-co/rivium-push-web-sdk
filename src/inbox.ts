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

import { BoundedSet } from './internal';

// ============================================================================
// Types
// ============================================================================

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

// Mirrors RiviumPushLogLevel; kept local so this module stays independent.
const LOG_ERROR = 1;
const LOG_WARNING = 2;
const LOG_INFO = 3;
const LOG_DEBUG = 4;

const STORAGE_PREFIX = 'rivium_push_inbox_';
const DEFAULT_LIMIT = 50;
const INCOMING_DEDUPE_LIMIT = 200;

interface StoredInbox {
  messages: InboxMessage[];
  unreadCount: number;
}

// ============================================================================
// Inbox
// ============================================================================

/**
 * Message Inbox client.
 *
 * ```typescript
 * push.inbox.onMessage((message) => render(message));
 * const { messages, unreadCount } = await push.inbox.getMessages({ status: 'unread' });
 * await push.inbox.markAsRead(messages[0].id);
 * ```
 */
export class RiviumInbox {
  private readonly deps: InboxDependencies;
  private cachedMessages: InboxMessage[] = [];
  private unreadCount = 0;
  /** Device the in-memory cache was loaded for, so identity changes reload. */
  private loadedKey: string | null = null;
  private onMessageCallback: OnInboxMessageCallback | null = null;
  private onStatusChangeCallback: OnInboxStatusChangeCallback | null = null;
  private onUnreadCountCallback: OnInboxUnreadCountCallback | null = null;
  /** Real-time updates can arrive twice (socket + service worker). */
  private handledIncomingIds = new BoundedSet(INCOMING_DEDUPE_LIMIT);

  /** @internal */
  constructor(deps: InboxDependencies) {
    this.deps = deps;
  }

  // --------------------------------------------------------------------------
  // Listeners
  // --------------------------------------------------------------------------

  /**
   * Listen for inbox messages arriving in real time.
   * Returns a function that removes the listener.
   */
  onMessage(callback: OnInboxMessageCallback): () => void {
    this.onMessageCallback = callback;
    return () => {
      this.onMessageCallback = null;
    };
  }

  /**
   * Listen for status changes (read, archived, deleted).
   * Returns a function that removes the listener.
   */
  onStatusChange(callback: OnInboxStatusChangeCallback): () => void {
    this.onStatusChangeCallback = callback;
    return () => {
      this.onStatusChangeCallback = null;
    };
  }

  /**
   * Listen for unread-count changes — useful to drive a badge.
   * Returns a function that removes the listener.
   */
  onUnreadCountChange(callback: OnInboxUnreadCountCallback): () => void {
    this.onUnreadCountCallback = callback;
    return () => {
      this.onUnreadCountCallback = null;
    };
  }

  // --------------------------------------------------------------------------
  // Reads
  // --------------------------------------------------------------------------

  /**
   * Fetch inbox messages from the server. Messages are addressed by userId
   * when one is set, otherwise by deviceId. The result is cached locally.
   */
  async getMessages(filter: InboxFilter = {}): Promise<InboxMessagesResponse> {
    this.ensureLoaded();

    const offset = filter.offset ?? 0;
    const body: Record<string, any> = {
      ...this.identity(),
      limit: filter.limit ?? DEFAULT_LIMIT,
      offset,
    };
    if (filter.status) body.status = filter.status;
    if (filter.category) body.category = filter.category;
    if (filter.locale) body.locale = filter.locale;

    const raw = await this.request('POST', '/inbox/messages', body);
    const response = normalizeResponse(raw);

    if (offset === 0) {
      this.cachedMessages = response.messages.slice();
    } else {
      this.cachedMessages = mergeMessages(this.cachedMessages, response.messages);
    }
    this.setUnreadCount(response.unreadCount);
    this.persist();

    this.deps.log(LOG_DEBUG, `Inbox: fetched ${response.messages.length} messages, unread ${response.unreadCount}`);
    return response;
  }

  /** Fetch a single message by id. */
  async getMessage(messageId: string): Promise<InboxMessage> {
    const raw = await this.request('GET', `/inbox/messages/${encodeURIComponent(messageId)}`);
    return normalizeMessage(raw);
  }

  /** Messages cached locally — available immediately, no network call. */
  getCachedMessages(): InboxMessage[] {
    this.ensureLoaded();
    return this.cachedMessages.slice();
  }

  /** The last known unread count, without a network call. */
  getUnreadCount(): number {
    this.ensureLoaded();
    return this.unreadCount;
  }

  /** Ask the server for the current unread count. */
  async fetchUnreadCount(): Promise<number> {
    const response = await this.getMessages({ status: 'unread', limit: 1 });
    return response.unreadCount;
  }

  // --------------------------------------------------------------------------
  // Writes
  // --------------------------------------------------------------------------

  /** Mark a message as read. */
  async markAsRead(messageId: string): Promise<void> {
    await this.updateStatus(messageId, 'read');
  }

  /** Archive a message. */
  async archiveMessage(messageId: string): Promise<void> {
    await this.updateStatus(messageId, 'archived');
  }

  /** Delete a message. */
  async deleteMessage(messageId: string): Promise<void> {
    this.ensureLoaded();
    await this.request('DELETE', `/inbox/messages/${encodeURIComponent(messageId)}`);

    const existing = this.cachedMessages.find((m) => m.id === messageId);
    this.cachedMessages = this.cachedMessages.filter((m) => m.id !== messageId);
    if (existing?.status === 'unread') {
      this.setUnreadCount(this.unreadCount - 1);
    }
    this.persist();
    this.onStatusChangeCallback?.(messageId, 'deleted');
  }

  /** Apply a status to several messages at once. */
  async markMultiple(messageIds: string[], status: InboxMessageStatus): Promise<void> {
    this.ensureLoaded();
    await this.request('POST', '/inbox/messages/mark-multiple', { messageIds, status });

    let becameRead = 0;
    this.cachedMessages = this.cachedMessages.map((message) => {
      if (!messageIds.includes(message.id)) return message;
      if (message.status === 'unread' && status !== 'unread') becameRead++;
      return { ...message, status };
    });
    if (becameRead > 0) this.setUnreadCount(this.unreadCount - becameRead);
    this.persist();

    for (const id of messageIds) {
      this.onStatusChangeCallback?.(id, status);
    }
  }

  /** Mark every message in this inbox as read. */
  async markAllAsRead(): Promise<void> {
    this.ensureLoaded();
    await this.request('POST', '/inbox/messages/mark-all-read', this.identity());

    this.cachedMessages = this.cachedMessages.map((message) =>
      message.status === 'unread' ? { ...message, status: 'read' as InboxMessageStatus } : message,
    );
    this.setUnreadCount(0);
    this.persist();
  }

  /** Drop the local cache (in memory and in storage). */
  clearCache(): void {
    const key = this.storageKey();
    this.cachedMessages = [];
    this.setUnreadCount(0);
    this.loadedKey = key;
    if (key) {
      try {
        localStorage.removeItem(key);
      } catch {
        // Storage blocked (private mode) — the in-memory cache is already clear.
      }
    }
    this.deps.log(LOG_DEBUG, 'Inbox: cache cleared');
  }

  // --------------------------------------------------------------------------
  // Real-time
  // --------------------------------------------------------------------------

  /**
   * Add a message that arrived in real time to the cache and notify listeners.
   * Called by the SDK for `inbox_update` payloads; safe to call directly.
   */
  handleIncomingMessage(message: InboxMessage): void {
    this.ensureLoaded();

    if (!message.id) {
      this.deps.log(LOG_WARNING, 'Inbox: incoming message without an id, ignoring');
      return;
    }
    if (!this.handledIncomingIds.add(message.id)) {
      this.deps.log(LOG_DEBUG, 'Inbox: duplicate inbox update ignored:', message.id);
      return;
    }

    const existingIndex = this.cachedMessages.findIndex((m) => m.id === message.id);
    if (existingIndex >= 0) {
      this.cachedMessages[existingIndex] = message;
    } else {
      this.cachedMessages.unshift(message);
      if (message.status === 'unread') {
        this.setUnreadCount(this.unreadCount + 1);
      }
    }
    this.persist();

    this.deps.log(LOG_INFO, 'Inbox: new message received:', message.id);
    this.onMessageCallback?.(message);
  }

  /**
   * Turn a raw `inbox_update` payload into an InboxMessage and handle it.
   * @internal
   */
  handleIncomingPayload(payload: Record<string, any>): void {
    const id = payload.messageId || payload.id;
    if (!id) {
      this.deps.log(LOG_WARNING, 'Inbox: inbox_update without a messageId, ignoring');
      return;
    }

    const content = payload.content ?? {};
    this.handleIncomingMessage(
      normalizeMessage({
        id,
        userId: payload.userId ?? null,
        deviceId: payload.deviceId ?? null,
        content: {
          title: content.title ?? payload.title ?? '',
          body: content.body ?? payload.body ?? '',
          imageUrl: content.imageUrl ?? payload.imageUrl,
          iconUrl: content.iconUrl ?? payload.iconUrl,
          deepLink: content.deepLink ?? payload.deepLink,
          data: content.data ?? payload.data,
        },
        status: payload.status ?? 'unread',
        category: payload.category ?? null,
        createdAt: payload.createdAt,
      }),
    );
  }

  /**
   * Point the inbox at a new identity. The cache belongs to the previous
   * user, so it is dropped and listeners see an unread count of 0.
   * @internal
   */
  onIdentityChanged(): void {
    this.cachedMessages = [];
    this.setUnreadCount(0);
    this.loadedKey = null;
    this.handledIncomingIds = new BoundedSet(INCOMING_DEDUPE_LIMIT);
    this.ensureLoaded();
  }

  // --------------------------------------------------------------------------
  // Internals
  // --------------------------------------------------------------------------

  private async updateStatus(messageId: string, status: InboxMessageStatus): Promise<void> {
    this.ensureLoaded();
    await this.request('PUT', `/inbox/messages/${encodeURIComponent(messageId)}`, { status });

    const index = this.cachedMessages.findIndex((m) => m.id === messageId);
    if (index >= 0) {
      const previous = this.cachedMessages[index].status;
      this.cachedMessages[index] = { ...this.cachedMessages[index], status };
      if (previous === 'unread' && status !== 'unread') {
        this.setUnreadCount(this.unreadCount - 1);
      }
    }
    this.persist();
    this.onStatusChangeCallback?.(messageId, status);
  }

  /** Messages are addressed by user when one is known, by device otherwise. */
  private identity(): Record<string, string> {
    const userId = this.deps.getUserId();
    if (userId) return { userId };
    const deviceId = this.deps.getDeviceId();
    if (deviceId) return { deviceId };
    return {};
  }

  private async request(method: string, path: string, body?: Record<string, any>): Promise<any> {
    const deviceId = this.deps.getDeviceId();
    const userId = this.deps.getUserId();
    if (!deviceId && !userId) {
      throw this.deps.createError('notRegistered', 'Inbox requires a registered device — call register() first');
    }

    const headers: Record<string, string> = { 'x-api-key': this.deps.getApiKey() };
    if (body !== undefined) headers['Content-Type'] = 'application/json';

    let response: Response;
    try {
      response = await fetch(`${this.deps.serverUrl}${path}`, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch (error) {
      this.deps.log(LOG_ERROR, `Inbox: ${method} ${path} failed:`, (error as Error)?.message);
      throw this.deps.createError('network', `${method} ${path}: ${(error as Error)?.message}`);
    }

    if (!response.ok) {
      this.deps.log(LOG_ERROR, `Inbox: ${method} ${path} returned HTTP ${response.status}`);
      throw this.deps.createError('server', `${method} ${path}: HTTP ${response.status}`);
    }

    try {
      return await response.json();
    } catch {
      // Endpoints like DELETE answer with an empty body.
      return null;
    }
  }

  private setUnreadCount(count: number): void {
    const next = Math.max(0, count);
    if (next === this.unreadCount) return;
    this.unreadCount = next;
    this.onUnreadCountCallback?.(next);
  }

  private storageKey(): string | null {
    const deviceId = this.deps.getDeviceId();
    return deviceId ? `${STORAGE_PREFIX}${deviceId}` : null;
  }

  /** Restores the persisted cache the first time it is needed per device. */
  private ensureLoaded(): void {
    const key = this.storageKey();
    if (!key || key === this.loadedKey) return;
    this.loadedKey = key;

    try {
      const stored = localStorage.getItem(key);
      if (!stored) return;
      const parsed = JSON.parse(stored) as StoredInbox;
      if (Array.isArray(parsed?.messages)) {
        this.cachedMessages = parsed.messages.map(normalizeMessage);
      }
      if (typeof parsed?.unreadCount === 'number') {
        this.unreadCount = Math.max(0, parsed.unreadCount);
      }
      this.deps.log(LOG_DEBUG, `Inbox: restored ${this.cachedMessages.length} cached messages`);
    } catch (error) {
      // Private mode, quota or corrupt data — start from an empty cache.
      this.deps.log(LOG_WARNING, 'Inbox: could not restore cache:', (error as Error)?.message);
    }
  }

  private persist(): void {
    const key = this.storageKey();
    if (!key) return;
    try {
      const payload: StoredInbox = { messages: this.cachedMessages, unreadCount: this.unreadCount };
      localStorage.setItem(key, JSON.stringify(payload));
    } catch (error) {
      // Storage full or blocked — the in-memory cache still works.
      this.deps.log(LOG_WARNING, 'Inbox: could not persist cache:', (error as Error)?.message);
    }
  }
}

// ============================================================================
// Parsing
// ============================================================================

const STATUSES: InboxMessageStatus[] = ['unread', 'read', 'archived', 'deleted'];

function normalizeStatus(value: any): InboxMessageStatus {
  const status = typeof value === 'string' ? (value.toLowerCase() as InboxMessageStatus) : 'unread';
  return STATUSES.includes(status) ? status : 'unread';
}

function normalizeMessage(raw: any): InboxMessage {
  const content = raw?.content ?? {};
  return {
    id: String(raw?.id ?? ''),
    userId: raw?.userId ?? null,
    deviceId: raw?.deviceId ?? null,
    content: {
      title: content.title ?? '',
      body: content.body ?? '',
      imageUrl: content.imageUrl,
      iconUrl: content.iconUrl,
      deepLink: content.deepLink,
      data: content.data,
    },
    status: normalizeStatus(raw?.status),
    category: raw?.category ?? null,
    expiresAt: raw?.expiresAt ?? null,
    readAt: raw?.readAt ?? null,
    createdAt: raw?.createdAt ?? new Date().toISOString(),
    updatedAt: raw?.updatedAt ?? null,
  };
}

/** Accepts both `{ messages, total, unreadCount }` and a bare array. */
function normalizeResponse(raw: any): InboxMessagesResponse {
  if (Array.isArray(raw)) {
    const messages = raw.map(normalizeMessage);
    return {
      messages,
      total: messages.length,
      unreadCount: messages.filter((m) => m.status === 'unread').length,
    };
  }

  const messages = Array.isArray(raw?.messages) ? raw.messages.map(normalizeMessage) : [];
  return {
    messages,
    total: typeof raw?.total === 'number' ? raw.total : messages.length,
    unreadCount:
      typeof raw?.unreadCount === 'number'
        ? raw.unreadCount
        : messages.filter((m: InboxMessage) => m.status === 'unread').length,
  };
}

/** Keeps cache order stable while replacing messages that came back again. */
function mergeMessages(existing: InboxMessage[], incoming: InboxMessage[]): InboxMessage[] {
  const merged = existing.slice();
  for (const message of incoming) {
    const index = merged.findIndex((m) => m.id === message.id);
    if (index >= 0) merged[index] = message;
    else merged.push(message);
  }
  return merged;
}
