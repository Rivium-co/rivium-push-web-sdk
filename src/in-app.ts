/**
 * In-App Messages for the RiviumPush Web SDK.
 *
 * An in-app message is a campaign the server keeps for a device and the SDK
 * shows inside the page — a modal, a banner, a fullscreen takeover or a card —
 * when a trigger fires (app open, session start or a custom event).
 *
 * Reachable as `push.inApp` once the SDK is constructed; network calls need
 * a registered device (`register()`).
 *
 * The built-in UI renders into a shadow DOM root, so the host page's CSS can
 * never break it and the SDK's CSS never leaks into the page. Apps that want
 * to render their own UI set `display: 'manual'` and use `onMessageReady`.
 *
 * @packageDocumentation
 */

// ============================================================================
// Types
// ============================================================================

/** How a message is presented. */
export type InAppMessageType = 'modal' | 'banner' | 'fullscreen' | 'card';

/** What makes a message eligible to show. */
export type InAppTriggerType =
  | 'on_app_open'
  | 'on_event'
  | 'on_session_start'
  | 'scheduled'
  | 'manual';

/** What a button does when clicked. */
export type InAppButtonAction = 'dismiss' | 'deep_link' | 'url' | 'custom';

/** Visual weight of a button. */
export type InAppButtonStyle = 'primary' | 'secondary' | 'text' | 'destructive';

/** Interaction reported to the server. */
export type InAppImpressionAction = 'impression' | 'click' | 'dismiss' | 'button_click';

/** Where a banner is anchored. */
export type InAppBannerPosition = 'top' | 'bottom';

/** An action button on an in-app message. */
export interface InAppButton {
  /** Button id, reported with the click */
  id: string;
  /** Button label */
  text: string;
  /** What the button does */
  action: InAppButtonAction;
  /** URL or deep link for the `url` / `deep_link` actions */
  value?: string;
  /** Visual style (default: `primary`) */
  style?: InAppButtonStyle;
}

/** Content of an in-app message, in one locale. */
export interface InAppMessageContent {
  /** Message title */
  title: string;
  /** Message body */
  body: string;
  /** Large image URL */
  imageUrl?: string;
  /** Background colour, e.g. "#FFFFFF" */
  backgroundColor?: string;
  /** Text colour, e.g. "#111111" */
  textColor?: string;
  /** Action buttons */
  buttons?: InAppButton[];
  /** Banner anchor; falls back to the `inApp.bannerPosition` config */
  position?: InAppBannerPosition;
}

/** Content for one locale. */
export interface InAppLocalization {
  /** Locale tag, e.g. "fr" or "fr-CA" */
  locale: string;
  /** Content for that locale */
  content: InAppMessageContent;
}

/** A single in-app message campaign. */
export interface InAppMessage {
  /** Server-side message id */
  id: string;
  /** Internal campaign name */
  name: string;
  /** How the message is presented */
  type: InAppMessageType;
  /** Default content */
  content: InAppMessageContent;
  /** Per-locale content, when configured */
  localizations?: InAppLocalization[];
  /** What makes the message eligible */
  triggerType: InAppTriggerType;
  /** Event name for the `on_event` trigger */
  triggerEvent?: string | null;
  /** Extra trigger conditions */
  triggerConditions?: Record<string, any> | null;
  /** ISO date before which the message is not shown */
  startDate?: string | null;
  /** ISO date after which the message is not shown */
  endDate?: string | null;
  /** How many times this device may see the message */
  maxImpressions: number;
  /** Sessions required before the message may show */
  minSessionCount: number;
  /** Delay between the trigger and the display */
  delaySeconds: number;
  /** Higher priority wins when several messages qualify */
  priority: number;
}

/** Options for {@link InAppMessages.fetchMessages}. */
export interface InAppFilter {
  /** Only messages with this trigger */
  trigger?: InAppTriggerType;
  /** Only messages bound to this event name */
  event?: string;
  /** Preferred locale for localized content, e.g. "fr" */
  locale?: string;
}

/** Configuration for the in-app module (`RiviumPushConfig.inApp`). */
export interface InAppConfig {
  /** Turn in-app messages off entirely (default: true) */
  enabled?: boolean;
  /**
   * `auto` renders the built-in shadow-DOM UI (default).
   * `manual` renders nothing and only fires `onMessageReady`, so the app can
   * draw its own UI. It still reports the impression.
   */
  display?: 'auto' | 'manual';
  /**
   * Fire `on_session_start` and `on_app_open` automatically on page load
   * (default: false — call `triggerOnAppOpen()` when your app is ready).
   */
  autoTrigger?: boolean;
  /** Where banners are anchored when the content does not say (default: top) */
  bannerPosition?: InAppBannerPosition;
  /** Locale used to pick localized content (default: the browser locale) */
  locale?: string;
}

/** Called when a message is ready to be displayed. */
export type OnInAppMessageReadyCallback = (message: InAppMessage) => void;
/** Called when a button on a message is clicked. */
export type OnInAppButtonClickedCallback = (message: InAppMessage, button: InAppButton) => void;
/** Called when a message is dismissed. */
export type OnInAppDismissedCallback = (message: InAppMessage) => void;

/**
 * Wiring the SDK passes to the in-app module. Not part of the public API.
 * @internal
 */
export interface InAppDependencies {
  serverUrl: string;
  getApiKey: () => string;
  getDeviceId: () => string | null;
  getUserId: () => string | null;
  log: (level: number, message: string, ...args: any[]) => void;
  config?: InAppConfig;
}

// Mirrors RiviumPushLogLevel; kept local so this module stays independent.
const LOG_ERROR = 1;
const LOG_WARNING = 2;
const LOG_INFO = 3;
const LOG_DEBUG = 4;

const STORAGE_PREFIX = 'rivium_push_inapp_';
/** Messages are re-fetched when the cache is older than this. */
const CACHE_TTL_MS = 5 * 60 * 1000;
/** Guard rail so a campaign cannot fill the page with buttons. */
const MAX_BUTTONS = 3;

interface StoredInApp {
  messages: InAppMessage[];
  impressions: Record<string, number>;
  sessionCount: number;
  lastFetch: number;
}

/** Inputs the eligibility rules are evaluated against. */
export interface InAppEligibilityContext {
  /** Trigger being evaluated */
  trigger: InAppTriggerType;
  /** Event name, for the `on_event` trigger */
  event?: string;
  /** Sessions this device has started */
  sessionCount: number;
  /** Impressions this device already had, per message id */
  impressions: Record<string, number>;
  /** Evaluation time in epoch milliseconds */
  now: number;
}

/**
 * Whether a message may be shown for this trigger. Pure, so the frequency and
 * schedule rules can be reasoned about (and tested) on their own.
 */
export function isInAppMessageEligible(
  message: InAppMessage,
  context: InAppEligibilityContext,
): boolean {
  if (message.triggerType !== context.trigger) return false;
  if (context.trigger === 'on_event' && (message.triggerEvent ?? null) !== (context.event ?? null)) {
    return false;
  }
  if (context.sessionCount < (message.minSessionCount ?? 0)) return false;

  const seen = context.impressions[message.id] ?? 0;
  if (seen >= (message.maxImpressions ?? 1)) return false;

  const start = parseDate(message.startDate);
  if (start !== null && context.now < start) return false;
  const end = parseDate(message.endDate);
  if (end !== null && context.now > end) return false;

  return true;
}

/** Eligible messages for a trigger, highest priority first. */
export function selectInAppMessages(
  messages: InAppMessage[],
  context: InAppEligibilityContext,
): InAppMessage[] {
  return messages
    .filter((message) => isInAppMessageEligible(message, context))
    .sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0));
}

// ============================================================================
// In-App Messages
// ============================================================================

/**
 * In-App Messages client.
 *
 * ```typescript
 * push.inApp.onButtonClicked((message, button) => console.log(button.id));
 * await push.inApp.triggerOnAppOpen();
 * await push.inApp.triggerEvent('purchase_completed');
 * ```
 */
export class InAppMessages {
  private readonly deps: InAppDependencies;
  private cachedMessages: InAppMessage[] = [];
  private impressions: Record<string, number> = {};
  private sessionCount = 0;
  private lastFetch = 0;
  /** Device the in-memory cache was loaded for, so identity changes reload. */
  private loadedKey: string | null = null;

  private onMessageReadyCallback: OnInAppMessageReadyCallback | null = null;
  private onButtonClickedCallback: OnInAppButtonClickedCallback | null = null;
  private onDismissedCallback: OnInAppDismissedCallback | null = null;

  private presentation: Presentation | null = null;
  private showing = false;
  private pendingTimer: ReturnType<typeof setTimeout> | null = null;

  /** @internal */
  constructor(deps: InAppDependencies) {
    this.deps = deps;
  }

  // --------------------------------------------------------------------------
  // Listeners
  // --------------------------------------------------------------------------

  /**
   * Listen for a message becoming ready to display. Fires for the built-in UI
   * too; with `display: 'manual'` it is the only signal you get.
   * Returns a function that removes the listener.
   */
  onMessageReady(callback: OnInAppMessageReadyCallback): () => void {
    this.onMessageReadyCallback = callback;
    return () => {
      this.onMessageReadyCallback = null;
    };
  }

  /**
   * Listen for button clicks. `custom` buttons do nothing on their own —
   * handle them here.
   * Returns a function that removes the listener.
   */
  onButtonClicked(callback: OnInAppButtonClickedCallback): () => void {
    this.onButtonClickedCallback = callback;
    return () => {
      this.onButtonClickedCallback = null;
    };
  }

  /**
   * Listen for a message being dismissed (close button, backdrop, Escape or
   * a `dismiss` button).
   * Returns a function that removes the listener.
   */
  onDismissed(callback: OnInAppDismissedCallback): () => void {
    this.onDismissedCallback = callback;
    return () => {
      this.onDismissedCallback = null;
    };
  }

  // --------------------------------------------------------------------------
  // Fetching
  // --------------------------------------------------------------------------

  /**
   * Fetch the messages this device is eligible for and cache them. Messages
   * are filtered again locally before anything is shown.
   */
  async fetchMessages(filter: InAppFilter = {}): Promise<InAppMessage[]> {
    this.ensureLoaded();

    const deviceId = this.deps.getDeviceId();
    if (!deviceId) {
      this.deps.log(LOG_WARNING, 'InApp: no device yet — call register() first');
      return this.cachedMessages.slice();
    }

    const body: Record<string, any> = {
      deviceId,
      sessionCount: this.sessionCount,
      locale: filter.locale ?? this.locale(),
    };
    const userId = this.deps.getUserId();
    if (userId) body.userId = userId;
    if (filter.trigger) body.trigger = filter.trigger;
    if (filter.event) body.event = filter.event;

    try {
      const response = await fetch(`${this.deps.serverUrl}/in-app/fetch`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': this.deps.getApiKey() },
        body: JSON.stringify(body),
      });
      if (!response.ok) {
        this.deps.log(LOG_ERROR, `InApp: fetch returned HTTP ${response.status}`);
        return this.cachedMessages.slice();
      }
      const raw = await response.json();
      const messages = normalizeMessages(raw);
      this.cachedMessages = messages;
      this.lastFetch = Date.now();
      this.persist();
      this.deps.log(LOG_DEBUG, `InApp: fetched ${messages.length} messages`);
      return messages.slice();
    } catch (error) {
      // Offline or blocked — the cached campaigns still work.
      this.deps.log(LOG_ERROR, 'InApp: fetch failed:', (error as Error)?.message);
      return this.cachedMessages.slice();
    }
  }

  /** Messages cached locally — available immediately, no network call. */
  getCachedMessages(): InAppMessage[] {
    this.ensureLoaded();
    return this.cachedMessages.slice();
  }

  /** Sessions this device has started. */
  getSessionCount(): number {
    this.ensureLoaded();
    return this.sessionCount;
  }

  // --------------------------------------------------------------------------
  // Triggers
  // --------------------------------------------------------------------------

  /** Evaluate `on_app_open` messages and show the best match. */
  async triggerOnAppOpen(): Promise<void> {
    await this.trigger('on_app_open');
  }

  /**
   * Evaluate `on_event` messages bound to `name`. `properties` are matched
   * against a message's `triggerConditions` when both are present.
   */
  async triggerEvent(name: string, properties?: Record<string, any>): Promise<void> {
    await this.trigger('on_event', name, properties);
  }

  /** Count a new session and evaluate `on_session_start` messages. */
  async triggerSessionStart(): Promise<void> {
    this.incrementSessionCount();
    await this.trigger('on_session_start');
  }

  /**
   * Start a session on page load: counts the session and, when
   * `inApp.autoTrigger` is on, fires `on_session_start` then `on_app_open`.
   * @internal
   */
  startSession(): void {
    if (this.deps.config?.enabled === false) return;
    this.incrementSessionCount();
    if (!this.deps.config?.autoTrigger) return;
    void this.trigger('on_session_start').then(() => {
      if (!this.showing) return this.trigger('on_app_open');
      return undefined;
    });
  }

  /** Show a cached message by id, ignoring its trigger. */
  async showMessage(messageId: string): Promise<void> {
    this.ensureLoaded();
    let message = this.cachedMessages.find((m) => m.id === messageId);
    if (!message) {
      await this.fetchMessages();
      message = this.cachedMessages.find((m) => m.id === messageId);
    }
    if (!message) {
      this.deps.log(LOG_WARNING, 'InApp: message not found:', messageId);
      return;
    }
    this.present(message);
  }

  /** Close the message currently on screen, if any. */
  dismissCurrentMessage(): void {
    if (this.pendingTimer) {
      clearTimeout(this.pendingTimer);
      this.pendingTimer = null;
    }
    const presentation = this.presentation;
    if (!presentation) {
      this.showing = false;
      return;
    }
    this.finishPresentation(presentation);
  }

  // --------------------------------------------------------------------------
  // Reporting
  // --------------------------------------------------------------------------

  /**
   * Report an interaction. Called for you by the built-in UI; call it yourself
   * when you render messages with `display: 'manual'`. Never throws.
   */
  async recordImpression(
    messageId: string,
    action: InAppImpressionAction,
    buttonId?: string,
  ): Promise<void> {
    this.ensureLoaded();

    const deviceId = this.deps.getDeviceId();
    if (!deviceId) {
      this.deps.log(LOG_WARNING, 'InApp: cannot report without a device');
      return;
    }

    if (action === 'impression') {
      this.impressions[messageId] = (this.impressions[messageId] ?? 0) + 1;
      this.persist();
    }

    const body: Record<string, any> = { messageId, deviceId, action };
    const userId = this.deps.getUserId();
    if (userId) body.userId = userId;
    if (buttonId) body.buttonId = buttonId;

    try {
      const response = await fetch(`${this.deps.serverUrl}/in-app/impression`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': this.deps.getApiKey() },
        body: JSON.stringify(body),
      });
      if (!response.ok) {
        this.deps.log(LOG_WARNING, `InApp: impression returned HTTP ${response.status}`);
        return;
      }
      this.deps.log(LOG_DEBUG, `InApp: recorded ${action} for ${messageId}`);
    } catch (error) {
      // Reporting is best-effort — a failed report never breaks the UI.
      this.deps.log(LOG_WARNING, 'InApp: impression failed:', (error as Error)?.message);
    }
  }

  // --------------------------------------------------------------------------
  // Cache
  // --------------------------------------------------------------------------

  /** Drop cached messages, impression counts and the session count. */
  clearCache(): void {
    const key = this.storageKey();
    this.cachedMessages = [];
    this.impressions = {};
    this.sessionCount = 0;
    this.lastFetch = 0;
    this.loadedKey = key;
    if (key) {
      try {
        localStorage.removeItem(key);
      } catch {
        // Storage blocked (private mode) — the in-memory cache is already clear.
      }
    }
    this.deps.log(LOG_DEBUG, 'InApp: cache cleared');
  }

  /**
   * Point the module at a new identity. Campaign eligibility and impression
   * counts belong to the previous user, so they are dropped.
   * @internal
   */
  onIdentityChanged(): void {
    this.dismissCurrentMessage();
    this.cachedMessages = [];
    this.impressions = {};
    this.lastFetch = 0;
    this.loadedKey = null;
    this.ensureLoaded();
  }

  // --------------------------------------------------------------------------
  // Internals
  // --------------------------------------------------------------------------

  private async trigger(
    trigger: InAppTriggerType,
    event?: string,
    properties?: Record<string, any>,
  ): Promise<void> {
    this.ensureLoaded();

    if (this.deps.config?.enabled === false) return;
    if (this.showing) {
      this.deps.log(LOG_DEBUG, 'InApp: a message is already showing, skipping trigger');
      return;
    }

    if (Date.now() - this.lastFetch > CACHE_TTL_MS) {
      await this.fetchMessages();
    }

    const eligible = selectInAppMessages(this.cachedMessages, {
      trigger,
      event,
      sessionCount: this.sessionCount,
      impressions: this.impressions,
      now: Date.now(),
    }).filter((message) => conditionsMatch(message.triggerConditions, properties));

    const message = eligible[0];
    if (!message) {
      this.deps.log(LOG_DEBUG, `InApp: no eligible message for ${trigger}`);
      return;
    }

    const delay = Math.max(0, message.delaySeconds ?? 0) * 1000;
    if (delay > 0) {
      this.showing = true;
      this.pendingTimer = setTimeout(() => {
        this.pendingTimer = null;
        this.showing = false;
        this.present(message);
      }, delay);
      return;
    }
    this.present(message);
  }

  /** Shows a message: reports the impression once, then renders or delegates. */
  private present(message: InAppMessage): void {
    if (this.showing) return;
    this.showing = true;

    const content = localizedContent(message, this.locale());
    void this.recordImpression(message.id, 'impression');
    this.onMessageReadyCallback?.(message);

    if (this.deps.config?.display === 'manual') {
      // The app draws its own UI; it calls dismissCurrentMessage() when done.
      this.presentation = null;
      this.deps.log(LOG_INFO, 'InApp: message ready (manual display):', message.id);
      return;
    }
    if (typeof document === 'undefined') {
      this.showing = false;
      return;
    }

    try {
      this.presentation = renderMessage({
        message,
        content,
        bannerPosition: content.position ?? this.deps.config?.bannerPosition ?? 'top',
        onButton: (button) => this.handleButtonClick(message, button),
        onDismiss: () => this.dismissCurrentMessage(),
      });
      this.deps.log(LOG_INFO, 'InApp: message displayed:', message.id);
    } catch (error) {
      this.deps.log(LOG_ERROR, 'InApp: failed to display message:', (error as Error)?.message);
      this.showing = false;
      this.presentation = null;
    }
  }

  private handleButtonClick(message: InAppMessage, button: InAppButton): void {
    void this.recordImpression(message.id, 'button_click', button.id);
    this.onButtonClickedCallback?.(message, button);

    switch (button.action) {
      case 'url':
      case 'deep_link':
        if (button.value) openLink(button.value);
        this.dismissCurrentMessage();
        break;
      case 'dismiss':
        this.dismissCurrentMessage();
        break;
      case 'custom':
      default:
        // Custom actions belong to the app — it decides whether to close.
        break;
    }
  }

  /** Tears the UI down once, reports the dismissal once. */
  private finishPresentation(presentation: Presentation): void {
    this.presentation = null;
    this.showing = false;
    try {
      presentation.close();
    } catch {
      // The host page may have removed the node already.
    }
    void this.recordImpression(presentation.message.id, 'dismiss');
    this.onDismissedCallback?.(presentation.message);
  }

  private incrementSessionCount(): void {
    this.ensureLoaded();
    this.sessionCount += 1;
    this.persist();
    this.deps.log(LOG_DEBUG, `InApp: session count ${this.sessionCount}`);
  }

  private locale(): string {
    if (this.deps.config?.locale) return this.deps.config.locale;
    if (typeof navigator !== 'undefined' && navigator.language) return navigator.language;
    return 'en';
  }

  private storageKey(): string | null {
    const deviceId = this.deps.getDeviceId();
    return deviceId ? `${STORAGE_PREFIX}${deviceId}` : null;
  }

  /** Restores the persisted state the first time it is needed per device. */
  private ensureLoaded(): void {
    const key = this.storageKey();
    if (!key || key === this.loadedKey) return;
    this.loadedKey = key;

    try {
      const stored = localStorage.getItem(key);
      if (!stored) return;
      const parsed = JSON.parse(stored) as StoredInApp;
      if (Array.isArray(parsed?.messages)) this.cachedMessages = normalizeMessages(parsed.messages);
      if (parsed?.impressions && typeof parsed.impressions === 'object') {
        this.impressions = { ...parsed.impressions };
      }
      if (typeof parsed?.sessionCount === 'number') {
        this.sessionCount = Math.max(0, parsed.sessionCount);
      }
      if (typeof parsed?.lastFetch === 'number') this.lastFetch = parsed.lastFetch;
    } catch (error) {
      // Private mode, quota or corrupt data — start from an empty cache.
      this.deps.log(LOG_WARNING, 'InApp: could not restore cache:', (error as Error)?.message);
    }
  }

  private persist(): void {
    const key = this.storageKey();
    if (!key) return;
    try {
      const payload: StoredInApp = {
        messages: this.cachedMessages,
        impressions: this.impressions,
        sessionCount: this.sessionCount,
        lastFetch: this.lastFetch,
      };
      localStorage.setItem(key, JSON.stringify(payload));
    } catch (error) {
      // Storage full or blocked — the in-memory state still works.
      this.deps.log(LOG_WARNING, 'InApp: could not persist cache:', (error as Error)?.message);
    }
  }
}

// ============================================================================
// Parsing
// ============================================================================

const TYPES: InAppMessageType[] = ['modal', 'banner', 'fullscreen', 'card'];
const TRIGGERS: InAppTriggerType[] = [
  'on_app_open',
  'on_event',
  'on_session_start',
  'scheduled',
  'manual',
];
const BUTTON_ACTIONS: InAppButtonAction[] = ['dismiss', 'deep_link', 'url', 'custom'];
const BUTTON_STYLES: InAppButtonStyle[] = ['primary', 'secondary', 'text', 'destructive'];

function parseDate(value: string | null | undefined): number | null {
  if (!value) return null;
  const time = new Date(value).getTime();
  return Number.isNaN(time) ? null : time;
}

function normalizeButton(raw: any): InAppButton {
  const action = raw?.action as InAppButtonAction;
  const style = raw?.style as InAppButtonStyle;
  return {
    id: String(raw?.id ?? ''),
    text: String(raw?.text ?? ''),
    action: BUTTON_ACTIONS.includes(action) ? action : 'dismiss',
    value: typeof raw?.value === 'string' ? raw.value : undefined,
    style: BUTTON_STYLES.includes(style) ? style : 'primary',
  };
}

function normalizeContent(raw: any): InAppMessageContent {
  const buttons = Array.isArray(raw?.buttons)
    ? raw.buttons.slice(0, MAX_BUTTONS).map(normalizeButton)
    : undefined;
  const position = raw?.position === 'bottom' ? 'bottom' : raw?.position === 'top' ? 'top' : undefined;
  return {
    title: String(raw?.title ?? ''),
    body: String(raw?.body ?? ''),
    imageUrl: typeof raw?.imageUrl === 'string' ? raw.imageUrl : undefined,
    backgroundColor: typeof raw?.backgroundColor === 'string' ? raw.backgroundColor : undefined,
    textColor: typeof raw?.textColor === 'string' ? raw.textColor : undefined,
    buttons,
    position,
  };
}

function normalizeMessage(raw: any): InAppMessage {
  const type = raw?.type as InAppMessageType;
  const triggerType = raw?.triggerType as InAppTriggerType;
  const localizations = Array.isArray(raw?.localizations)
    ? raw.localizations
        .filter((entry: any) => typeof entry?.locale === 'string')
        .map((entry: any) => ({ locale: entry.locale, content: normalizeContent(entry.content) }))
    : undefined;

  return {
    id: String(raw?.id ?? ''),
    name: String(raw?.name ?? ''),
    type: TYPES.includes(type) ? type : 'modal',
    content: normalizeContent(raw?.content),
    localizations,
    triggerType: TRIGGERS.includes(triggerType) ? triggerType : 'on_app_open',
    triggerEvent: raw?.triggerEvent ?? null,
    triggerConditions: raw?.triggerConditions ?? null,
    startDate: raw?.startDate ?? null,
    endDate: raw?.endDate ?? null,
    maxImpressions: typeof raw?.maxImpressions === 'number' ? raw.maxImpressions : 1,
    minSessionCount: typeof raw?.minSessionCount === 'number' ? raw.minSessionCount : 0,
    delaySeconds: typeof raw?.delaySeconds === 'number' ? raw.delaySeconds : 0,
    priority: typeof raw?.priority === 'number' ? raw.priority : 0,
  };
}

/** Accepts both a bare array and `{ messages: [...] }`. */
function normalizeMessages(raw: any): InAppMessage[] {
  const list = Array.isArray(raw) ? raw : Array.isArray(raw?.messages) ? raw.messages : [];
  return list.map(normalizeMessage).filter((message: InAppMessage) => message.id !== '');
}

/** Exact locale match first, then the language part, then the default content. */
export function localizedContent(message: InAppMessage, locale: string): InAppMessageContent {
  const localizations = message.localizations ?? [];
  if (localizations.length === 0) return message.content;

  const wanted = locale.toLowerCase();
  const exact = localizations.find((entry) => entry.locale.toLowerCase() === wanted);
  if (exact) return exact.content;

  const language = wanted.split('-')[0];
  const partial = localizations.find((entry) => entry.locale.toLowerCase().split('-')[0] === language);
  return partial ? partial.content : message.content;
}

/** Every condition the campaign declares must equal the event property. */
function conditionsMatch(
  conditions: Record<string, any> | null | undefined,
  properties: Record<string, any> | undefined,
): boolean {
  if (!conditions) return true;
  const keys = Object.keys(conditions);
  if (keys.length === 0) return true;
  if (!properties) return false;
  return keys.every((key) => properties[key] === conditions[key]);
}

function openLink(value: string): void {
  try {
    window.open(value, '_blank', 'noopener,noreferrer');
  } catch {
    // Popup blocked — nothing else to do, the click was already reported.
  }
}

// ============================================================================
// Rendering (shadow DOM)
// ============================================================================

/** A message currently on screen. @internal */
interface Presentation {
  message: InAppMessage;
  host: HTMLElement;
  close: () => void;
}

interface RenderOptions {
  message: InAppMessage;
  content: InAppMessageContent;
  bannerPosition: InAppBannerPosition;
  onButton: (button: InAppButton) => void;
  onDismiss: () => void;
}

const STYLES = `
:host { all: initial; }
*, *::before, *::after { box-sizing: border-box; }
.layer {
  position: fixed;
  inset: 0;
  z-index: 2147483000;
  display: flex;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
  pointer-events: none;
}
.layer.center { align-items: center; justify-content: center; padding: 16px; }
.layer.top { align-items: flex-start; justify-content: center; padding: 16px; }
.layer.bottom { align-items: flex-end; justify-content: center; padding: 16px; }
.layer.fill { padding: 0; }
.backdrop {
  position: absolute;
  inset: 0;
  background: rgba(0, 0, 0, 0.55);
  pointer-events: auto;
  animation: fade 160ms ease-out;
}
.panel {
  position: relative;
  pointer-events: auto;
  width: 100%;
  max-width: 420px;
  background: #ffffff;
  color: #111318;
  border-radius: 14px;
  box-shadow: 0 12px 40px rgba(0, 0, 0, 0.28);
  overflow: hidden;
  animation: rise 180ms ease-out;
}
.panel.fullscreen {
  max-width: none;
  width: 100%;
  height: 100%;
  border-radius: 0;
  display: flex;
  flex-direction: column;
  justify-content: center;
}
.panel.card { box-shadow: 0 6px 20px rgba(0, 0, 0, 0.18); }
.panel.banner { max-width: 520px; border-radius: 12px; }
.image { display: block; width: 100%; max-height: 200px; object-fit: cover; }
.panel.fullscreen .image { max-height: 40vh; }
.body { padding: 20px; }
.panel.banner .body { padding: 14px 44px 14px 16px; }
.title { margin: 0 0 6px; font-size: 17px; font-weight: 600; line-height: 1.3; word-break: break-word; }
.text { margin: 0; font-size: 14px; line-height: 1.5; opacity: 0.85; word-break: break-word; }
.actions { display: flex; flex-wrap: wrap; gap: 8px; padding: 0 20px 20px; }
.panel.banner .actions { padding: 0 16px 14px; }
button {
  font: inherit;
  cursor: pointer;
  border: 1px solid transparent;
  border-radius: 10px;
  padding: 10px 16px;
  min-height: 40px;
  flex: 1 1 auto;
  background: #111318;
  color: #ffffff;
}
button.secondary { background: transparent; color: inherit; border-color: currentColor; opacity: 0.85; }
button.text { background: transparent; color: inherit; border-color: transparent; text-decoration: underline; }
button.destructive { background: #b3261e; color: #ffffff; }
button:focus-visible, .close:focus-visible { outline: 2px solid #4c8dff; outline-offset: 2px; }
.close {
  position: absolute;
  top: 8px;
  right: 8px;
  width: 32px;
  height: 32px;
  min-height: 32px;
  padding: 0;
  border-radius: 16px;
  background: rgba(0, 0, 0, 0.06);
  color: inherit;
  font-size: 18px;
  line-height: 1;
  flex: 0 0 auto;
}
@media (prefers-color-scheme: dark) {
  .panel { background: #1b1d21; color: #f2f3f5; box-shadow: 0 12px 40px rgba(0, 0, 0, 0.6); }
  button { background: #f2f3f5; color: #14161a; }
  button.destructive { background: #f2b8b5; color: #601410; }
  .close { background: rgba(255, 255, 255, 0.12); }
}
@media (max-width: 420px) {
  .panel { max-width: 100%; }
  .actions { flex-direction: column; }
}
@keyframes fade { from { opacity: 0; } to { opacity: 1; } }
@keyframes rise { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: none; } }
@media (prefers-reduced-motion: reduce) {
  .backdrop, .panel { animation: none; }
}
`;

const FOCUSABLE = 'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';

/**
 * Builds the message UI inside a shadow root attached to `document.body`.
 * @internal
 */
function renderMessage(options: RenderOptions): Presentation {
  const { message, content } = options;
  const modal = message.type === 'modal' || message.type === 'fullscreen';

  const host = document.createElement('div');
  host.setAttribute('data-rivium-in-app', message.id);
  const shadow = host.attachShadow({ mode: 'open' });

  const style = document.createElement('style');
  style.textContent = STYLES;
  shadow.appendChild(style);

  const layer = document.createElement('div');
  layer.className = `layer ${layerPlacement(message.type, options.bannerPosition)}`;
  shadow.appendChild(layer);

  if (modal) {
    const backdrop = document.createElement('div');
    backdrop.className = 'backdrop';
    backdrop.addEventListener('click', () => options.onDismiss());
    layer.appendChild(backdrop);
  }

  const panel = document.createElement('div');
  panel.className = `panel ${message.type}`;
  if (content.backgroundColor) panel.style.background = content.backgroundColor;
  if (content.textColor) panel.style.color = content.textColor;

  if (modal) {
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-modal', 'true');
  } else {
    // Banners and cards are announced without stealing focus.
    panel.setAttribute('role', 'status');
    panel.setAttribute('aria-live', 'polite');
  }

  const titleId = `rivium-in-app-title-${message.id}`;
  const bodyId = `rivium-in-app-body-${message.id}`;
  panel.setAttribute('aria-labelledby', titleId);
  panel.setAttribute('aria-describedby', bodyId);
  panel.tabIndex = -1;

  if (content.imageUrl) {
    const image = document.createElement('img');
    image.className = 'image';
    image.src = content.imageUrl;
    image.alt = '';
    panel.appendChild(image);
  }

  const body = document.createElement('div');
  body.className = 'body';

  const title = document.createElement('h2');
  title.className = 'title';
  title.id = titleId;
  title.textContent = content.title;
  body.appendChild(title);

  const text = document.createElement('p');
  text.className = 'text';
  text.id = bodyId;
  text.textContent = content.body;
  body.appendChild(text);
  panel.appendChild(body);

  const buttons = (content.buttons ?? []).slice(0, MAX_BUTTONS);
  if (buttons.length > 0) {
    const actions = document.createElement('div');
    actions.className = 'actions';
    for (const button of buttons) {
      const element = document.createElement('button');
      element.type = 'button';
      element.className = button.style ?? 'primary';
      element.textContent = button.text;
      element.setAttribute('data-button-id', button.id);
      element.addEventListener('click', () => options.onButton(button));
      actions.appendChild(element);
    }
    panel.appendChild(actions);
  }

  const close = document.createElement('button');
  close.type = 'button';
  close.className = 'close';
  close.setAttribute('aria-label', 'Close');
  close.textContent = '×';
  close.addEventListener('click', () => options.onDismiss());
  panel.appendChild(close);

  layer.appendChild(panel);

  const previousFocus = document.activeElement as HTMLElement | null;

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === 'Escape' && modal) {
      event.preventDefault();
      options.onDismiss();
      return;
    }
    if (event.key !== 'Tab' || !modal) return;

    const focusable = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE));
    if (focusable.length === 0) {
      event.preventDefault();
      panel.focus();
      return;
    }
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    const active = (shadow.activeElement as HTMLElement | null) ?? null;
    if (event.shiftKey && (active === first || active === null)) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && active === last) {
      event.preventDefault();
      first.focus();
    }
  };

  document.body.appendChild(host);
  host.addEventListener('keydown', onKeyDown);
  if (modal) {
    const firstFocusable = panel.querySelector<HTMLElement>(FOCUSABLE);
    (firstFocusable ?? panel).focus();
  }

  return {
    message,
    host,
    close: () => {
      host.removeEventListener('keydown', onKeyDown);
      host.remove();
      // Give focus back to whatever the user was on before the message.
      previousFocus?.focus?.();
    },
  };
}

function layerPlacement(type: InAppMessageType, bannerPosition: InAppBannerPosition): string {
  if (type === 'fullscreen') return 'fill';
  if (type === 'banner') return bannerPosition;
  if (type === 'card') return 'bottom';
  return 'center';
}
