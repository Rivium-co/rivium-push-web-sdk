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
export const MAX_MQTT_ENDPOINTS = 5;

/** WebSocket path used when an endpoint does not specify one. */
export const DEFAULT_MQTT_PATH = '/mqtt';

/** Storage keys (localStorage). */
export const ENDPOINTS_STORAGE_KEY = 'rivium_push_mqtt_endpoints';
export const WINNER_STORAGE_KEY = 'rivium_push_mqtt_endpoint';

/** Lifecycle triggers closer together than this cause one reconnect. */
export const RECONNECT_TRIGGER_WINDOW_MS = 1000;

/** Check a "connected" socket after the page was hidden at least this long. */
export const PROBE_AFTER_HIDDEN_MS = 30_000;

/** ...or when nothing arrived from the gateway for this long. */
export const PROBE_AFTER_SILENCE_MS = 45_000;

/** How long a liveness check waits for the gateway to answer. */
export const PROBE_TIMEOUT_MS = 5000;

function normalizePath(path: unknown, fallback: string): string | null {
  if (path === undefined || path === null) return fallback;
  if (typeof path !== 'string') return null;
  const trimmed = path.trim();
  if (!trimmed) return fallback;
  if (/[\s?#]/.test(trimmed)) return null;
  return trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
}

function isValidHost(host: string): boolean {
  if (!host || host.length > 253) return false;
  return !/[\s/?#@]/.test(host);
}

export function sameEndpoint(a: MqttEndpoint | null | undefined, b: MqttEndpoint | null | undefined): boolean {
  if (!a || !b) return false;
  return (
    a.host.toLowerCase() === b.host.toLowerCase() &&
    a.port === b.port &&
    a.secure === b.secure &&
    a.path === b.path
  );
}

function parseEntry(item: unknown, defaultPath: string): MqttEndpoint | null {
  if (!item || typeof item !== 'object' || Array.isArray(item)) return null;
  const obj = item as Record<string, unknown>;

  if (typeof obj.host !== 'string') return null;
  const host = obj.host.trim();
  if (!isValidHost(host)) return null;

  if (typeof obj.port !== 'number' || !Number.isInteger(obj.port) || obj.port < 1 || obj.port > 65535) {
    return null;
  }

  let secure = true;
  if (obj.tls !== undefined && obj.tls !== null) {
    if (typeof obj.tls !== 'boolean') return null;
    secure = obj.tls;
  }

  const path = normalizePath(obj.path, defaultPath);
  if (path === null) return null;

  return { host, port: obj.port, secure, path };
}

/**
 * Parse and validate a `mqttEndpoints` value from the register response.
 * Invalid entries are skipped, unknown fields ignored, duplicates dropped and
 * at most MAX_MQTT_ENDPOINTS kept. Anything that is not an array yields [].
 */
export function parseMqttEndpoints(value: unknown, defaultPath: string = DEFAULT_MQTT_PATH): MqttEndpoint[] {
  if (!Array.isArray(value)) return [];
  const result: MqttEndpoint[] = [];
  for (const item of value) {
    if (result.length >= MAX_MQTT_ENDPOINTS) break;
    const endpoint = parseEntry(item, defaultPath);
    if (endpoint && !result.some((e) => sameEndpoint(e, endpoint))) result.push(endpoint);
  }
  return result;
}

/**
 * Connection order for one round: `lastWinner` first (only if it is still one
 * of the known endpoints), then `server` in order, then `fallback` (today's
 * default URL) last. Without a server list only the default is used.
 */
export function orderEndpoints(
  server: MqttEndpoint[],
  fallback: MqttEndpoint | null,
  lastWinner: MqttEndpoint | null,
): MqttEndpoint[] {
  if (server.length === 0) return fallback ? [fallback] : [];

  const ordered: MqttEndpoint[] = [];
  const add = (e: MqttEndpoint) => {
    if (!ordered.some((o) => sameEndpoint(o, e))) ordered.push(e);
  };
  if (lastWinner && server.some((e) => sameEndpoint(e, lastWinner))) add(lastWinner);
  server.filter((e) => !sameEndpoint(e, fallback)).forEach(add);
  if (fallback) {
    // the default always goes last, even when it was the last winner
    const i = ordered.findIndex((o) => sameEndpoint(o, fallback));
    if (i !== -1) ordered.splice(i, 1);
    ordered.push(fallback);
  }
  return ordered;
}

/**
 * Key suffix for remembering the winning endpoint: the connection type
 * (`wifi`, `cellular`, ...) when the Network Information API reports one,
 * otherwise empty (a single key).
 */
export function networkKey(nav: unknown = typeof navigator !== 'undefined' ? navigator : undefined): string {
  try {
    const type = (nav as { connection?: { type?: unknown } } | undefined)?.connection?.type;
    if (typeof type === 'string' && /^[a-z0-9_-]{1,32}$/i.test(type)) return type.toLowerCase();
  } catch {
    // ignore
  }
  return '';
}

interface KeyValueStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

function defaultStorage(): KeyValueStorage | null {
  try {
    return typeof localStorage !== 'undefined' ? localStorage : null;
  } catch {
    return null;
  }
}

/**
 * Persists the server endpoint list and the endpoint that last worked
 * (per connection type). Storage failures are ignored.
 */
export class EndpointMemory {
  constructor(private readonly storage: () => KeyValueStorage | null = defaultStorage) {}

  serverEndpoints(): MqttEndpoint[] {
    try {
      const raw = this.storage()?.getItem(ENDPOINTS_STORAGE_KEY);
      return raw ? parseMqttEndpoints(JSON.parse(raw)) : [];
    } catch {
      return [];
    }
  }

  /** Save the list from a register response; an empty list clears it (behaviour = default only). */
  saveServerEndpoints(endpoints: MqttEndpoint[]): void {
    try {
      const s = this.storage();
      if (!s) return;
      if (endpoints.length === 0) {
        s.removeItem(ENDPOINTS_STORAGE_KEY);
      } else {
        s.setItem(
          ENDPOINTS_STORAGE_KEY,
          JSON.stringify(endpoints.map((e) => ({ host: e.host, port: e.port, tls: e.secure, path: e.path }))),
        );
      }
    } catch {
      // Storage blocked: the list is still used for this page load via memory.
    }
  }

  winner(key: string): MqttEndpoint | null {
    try {
      const raw = this.storage()?.getItem(this.winnerKey(key));
      if (!raw) return null;
      return parseMqttEndpoints([JSON.parse(raw)])[0] ?? null;
    } catch {
      return null;
    }
  }

  saveWinner(key: string, endpoint: MqttEndpoint): void {
    try {
      this.storage()?.setItem(
        this.winnerKey(key),
        JSON.stringify({ host: endpoint.host, port: endpoint.port, tls: endpoint.secure, path: endpoint.path }),
      );
    } catch {
      // ignore
    }
  }

  private winnerKey(key: string): string {
    return key ? `${WINNER_STORAGE_KEY}_${key}` : WINNER_STORAGE_KEY;
  }
}

/**
 * Lets the first trigger through and ignores the ones that follow within
 * `windowMs` (visibilitychange, focus and pageshow usually fire together).
 */
export class ReconnectThrottle {
  private lastFiredAt = 0;
  private fired = false;

  constructor(
    private readonly windowMs: number = RECONNECT_TRIGGER_WINDOW_MS,
    private readonly clock: () => number = () => Date.now(),
  ) {}

  tryAcquire(): boolean {
    const now = this.clock();
    if (this.fired && now - this.lastFiredAt < this.windowMs) return false;
    this.fired = true;
    this.lastFiredAt = now;
    return true;
  }

  reset(): void {
    this.fired = false;
    this.lastFiredAt = 0;
  }
}
