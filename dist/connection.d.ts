/**
 * Real-time connection helpers: server-provided endpoints with failover, the
 * memory of the endpoint that last worked, and the throttle for lifecycle
 * reconnect triggers. Kept free of SDK state so it can be unit tested.
 */
/** A gateway address (same shape as PNEndpoint from @rivium/pn-protocol). */
export interface MqttEndpoint {
    host: string;
    port: number;
    secure: boolean;
    path: string;
}
/** At most this many server endpoints are used. */
export declare const MAX_MQTT_ENDPOINTS = 5;
/** WebSocket path used when an endpoint does not specify one. */
export declare const DEFAULT_MQTT_PATH = "/mqtt";
/** Storage keys (localStorage). */
export declare const ENDPOINTS_STORAGE_KEY = "rivium_push_mqtt_endpoints";
export declare const WINNER_STORAGE_KEY = "rivium_push_mqtt_endpoint";
/** Lifecycle triggers closer together than this cause one reconnect. */
export declare const RECONNECT_TRIGGER_WINDOW_MS = 1000;
/** Check a "connected" socket after the page was hidden at least this long. */
export declare const PROBE_AFTER_HIDDEN_MS = 30000;
/** ...or when nothing arrived from the gateway for this long. */
export declare const PROBE_AFTER_SILENCE_MS = 45000;
/** How long a liveness check waits for the gateway to answer. */
export declare const PROBE_TIMEOUT_MS = 5000;
export declare function sameEndpoint(a: MqttEndpoint | null | undefined, b: MqttEndpoint | null | undefined): boolean;
/**
 * Parse and validate a `mqttEndpoints` value from the register response.
 * Invalid entries are skipped, unknown fields ignored, duplicates dropped and
 * at most MAX_MQTT_ENDPOINTS kept. Anything that is not an array yields [].
 */
export declare function parseMqttEndpoints(value: unknown, defaultPath?: string): MqttEndpoint[];
/**
 * Connection order for one round: `lastWinner` first (only if it is still one
 * of the known endpoints), then `server` in order, then `fallback` (today's
 * default URL) last. Without a server list only the default is used.
 */
export declare function orderEndpoints(server: MqttEndpoint[], fallback: MqttEndpoint | null, lastWinner: MqttEndpoint | null): MqttEndpoint[];
/**
 * Key suffix for remembering the winning endpoint: the connection type
 * (`wifi`, `cellular`, ...) when the Network Information API reports one,
 * otherwise empty (a single key).
 */
export declare function networkKey(nav?: unknown): string;
interface KeyValueStorage {
    getItem(key: string): string | null;
    setItem(key: string, value: string): void;
    removeItem(key: string): void;
}
/**
 * Persists the server endpoint list and the endpoint that last worked
 * (per connection type). Storage failures are ignored.
 */
export declare class EndpointMemory {
    private readonly storage;
    constructor(storage?: () => KeyValueStorage | null);
    serverEndpoints(): MqttEndpoint[];
    /** Save the list from a register response; an empty list clears it (behaviour = default only). */
    saveServerEndpoints(endpoints: MqttEndpoint[]): void;
    winner(key: string): MqttEndpoint | null;
    saveWinner(key: string, endpoint: MqttEndpoint): void;
    private winnerKey;
}
/**
 * Lets the first trigger through and ignores the ones that follow within
 * `windowMs` (visibilitychange, focus and pageshow usually fire together).
 */
export declare class ReconnectThrottle {
    private readonly windowMs;
    private readonly clock;
    private lastFiredAt;
    private fired;
    constructor(windowMs?: number, clock?: () => number);
    tryAcquire(): boolean;
    reset(): void;
}
export {};
