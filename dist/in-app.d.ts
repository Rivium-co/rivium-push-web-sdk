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
/** How a message is presented. */
export type InAppMessageType = 'modal' | 'banner' | 'fullscreen' | 'card';
/** What makes a message eligible to show. */
export type InAppTriggerType = 'on_app_open' | 'on_event' | 'on_session_start' | 'scheduled' | 'manual';
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
export declare function isInAppMessageEligible(message: InAppMessage, context: InAppEligibilityContext): boolean;
/** Eligible messages for a trigger, highest priority first. */
export declare function selectInAppMessages(messages: InAppMessage[], context: InAppEligibilityContext): InAppMessage[];
/**
 * In-App Messages client.
 *
 * ```typescript
 * push.inApp.onButtonClicked((message, button) => console.log(button.id));
 * await push.inApp.triggerOnAppOpen();
 * await push.inApp.triggerEvent('purchase_completed');
 * ```
 */
export declare class InAppMessages {
    private readonly deps;
    private cachedMessages;
    private impressions;
    private sessionCount;
    private lastFetch;
    /** Device the in-memory cache was loaded for, so identity changes reload. */
    private loadedKey;
    private onMessageReadyCallback;
    private onButtonClickedCallback;
    private onDismissedCallback;
    private presentation;
    private showing;
    private pendingTimer;
    /** @internal */
    constructor(deps: InAppDependencies);
    /**
     * Listen for a message becoming ready to display. Fires for the built-in UI
     * too; with `display: 'manual'` it is the only signal you get.
     * Returns a function that removes the listener.
     */
    onMessageReady(callback: OnInAppMessageReadyCallback): () => void;
    /**
     * Listen for button clicks. `custom` buttons do nothing on their own —
     * handle them here.
     * Returns a function that removes the listener.
     */
    onButtonClicked(callback: OnInAppButtonClickedCallback): () => void;
    /**
     * Listen for a message being dismissed (close button, backdrop, Escape or
     * a `dismiss` button).
     * Returns a function that removes the listener.
     */
    onDismissed(callback: OnInAppDismissedCallback): () => void;
    /**
     * Fetch the messages this device is eligible for and cache them. Messages
     * are filtered again locally before anything is shown.
     */
    fetchMessages(filter?: InAppFilter): Promise<InAppMessage[]>;
    /** Messages cached locally — available immediately, no network call. */
    getCachedMessages(): InAppMessage[];
    /** Sessions this device has started. */
    getSessionCount(): number;
    /** Evaluate `on_app_open` messages and show the best match. */
    triggerOnAppOpen(): Promise<void>;
    /**
     * Evaluate `on_event` messages bound to `name`. `properties` are matched
     * against a message's `triggerConditions` when both are present.
     */
    triggerEvent(name: string, properties?: Record<string, any>): Promise<void>;
    /** Count a new session and evaluate `on_session_start` messages. */
    triggerSessionStart(): Promise<void>;
    /**
     * Start a session on page load: counts the session and, when
     * `inApp.autoTrigger` is on, fires `on_session_start` then `on_app_open`.
     * @internal
     */
    startSession(): void;
    /** Show a cached message by id, ignoring its trigger. */
    showMessage(messageId: string): Promise<void>;
    /** Close the message currently on screen, if any. */
    dismissCurrentMessage(): void;
    /**
     * Report an interaction. Called for you by the built-in UI; call it yourself
     * when you render messages with `display: 'manual'`. Never throws.
     */
    recordImpression(messageId: string, action: InAppImpressionAction, buttonId?: string): Promise<void>;
    /** Drop cached messages, impression counts and the session count. */
    clearCache(): void;
    /**
     * Point the module at a new identity. Campaign eligibility and impression
     * counts belong to the previous user, so they are dropped.
     * @internal
     */
    onIdentityChanged(): void;
    private trigger;
    /** Shows a message: reports the impression once, then renders or delegates. */
    private present;
    private handleButtonClick;
    /** Tears the UI down once, reports the dismissal once. */
    private finishPresentation;
    private incrementSessionCount;
    private locale;
    private storageKey;
    /** Restores the persisted state the first time it is needed per device. */
    private ensureLoaded;
    private persist;
}
/** Exact locale match first, then the language part, then the default content. */
export declare function localizedContent(message: InAppMessage, locale: string): InAppMessageContent;
