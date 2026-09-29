/**
 * Mock for @rivium/pn-protocol
 *
 * Models the PNSocket surface the SDK uses. Every socket created is recorded in
 * `sockets` so tests can drive connection events and inspect calls.
 */

export enum PNState {
  DISCONNECTED = 'disconnected',
  CONNECTING = 'connecting',
  CONNECTED = 'connected',
  RECONNECTING = 'reconnecting',
  DISCONNECTING = 'disconnecting',
}

export enum PNDeliveryMode {
  FIRE_AND_FORGET = 0,
  RELIABLE = 1,
  EXACTLY_ONCE = 2,
}

export class PNMessage {
  channel = '';
  payload: Uint8Array = new Uint8Array();
  payloadAsJson() {
    return JSON.parse(new TextDecoder().decode(this.payload));
  }
}

export class PNError extends Error {
  code = 100;
  constructor(message?: string) {
    super(message);
    this.name = 'PNError';
  }
}

export interface PNConnectionListener {
  onStateChanged?(state: PNState): void;
  onConnected?(): void;
  onDisconnected?(reason?: string): void;
  onReconnecting?(attempt: number, nextRetryMs: number): void;
}

export interface PNEndpoint {
  host: string;
  port: number;
  secure: boolean;
  path: string;
}

export const PNAuthFactory = {
  token(token: string) {
    return { type: 'token', token };
  },
  basic(username: string, password: string) {
    return { type: 'basic', username, password };
  },
};

export class PNConfigBuilder {
  private config: Record<string, unknown> = {};
  private set(key: string, value: unknown) {
    this.config[key] = value;
    return this;
  }
  gateway(v: string) { return this.set('gateway', v); }
  port(v: number) { return this.set('port', v); }
  clientId(v: string) { return this.set('clientId', v); }
  auth(v: unknown) { return this.set('auth', v); }
  heartbeatInterval(v: number) { return this.set('heartbeatInterval', v); }
  connectionTimeout(v: number) { return this.set('connectionTimeout', v); }
  freshStart(v: boolean) { return this.set('freshStart', v); }
  autoReconnect(v: boolean) { return this.set('autoReconnect', v); }
  maxReconnectAttempts(v: number) { return this.set('maxReconnectAttempts', v); }
  reconnectDelay(v: number) { return this.set('reconnectDelay', v); }
  maxReconnectDelay(v: number) { return this.set('maxReconnectDelay', v); }
  secure(v: boolean) { return this.set('secure', v); }
  wsPath(v: string) { return this.set('wsPath', v); }
  build() { return { ...this.config }; }
}

export const sockets: PNSocket[] = [];

export class PNSocket {
  config: any;
  state: PNState = PNState.DISCONNECTED;
  closed = false;
  openCalls = 0;
  reconnectCalls: boolean[] = [];
  probeCalls: number[] = [];
  probeResult = true;
  lastActivity = 0;
  endpointProvider: (() => PNEndpoint[]) | null = null;
  connectionListeners: PNConnectionListener[] = [];
  errorListeners: Array<(e: PNError) => void> = [];
  endpointListeners: Array<(e: PNEndpoint) => void> = [];
  channels = new Set<string>();
  streamCalls: string[] = [];

  constructor(config: any) {
    this.config = config;
    sockets.push(this);
  }

  open() {
    this.openCalls++;
    this.setState(PNState.CONNECTING);
    return this;
  }
  close() {
    this.closed = true;
    this.channels.clear();
    this.state = PNState.DISCONNECTED;
    return this;
  }
  reconnectImmediately(force = false) {
    this.reconnectCalls.push(force);
    if (!force && (this.state === PNState.CONNECTED || this.state === PNState.CONNECTING)) return this;
    this.setState(PNState.CONNECTING);
    return this;
  }
  probe(timeoutMs = 5000) {
    this.probeCalls.push(timeoutMs);
    return Promise.resolve(this.probeResult);
  }
  updateAuth(auth: any) {
    this.config.auth = auth;
    return this;
  }
  lastActivityAt() {
    return this.lastActivity;
  }
  setEndpointProvider(p: (() => PNEndpoint[]) | null) {
    this.endpointProvider = p;
    return this;
  }
  addEndpointListener(l: (e: PNEndpoint) => void) {
    this.endpointListeners.push(l);
    return this;
  }
  addConnectionListener(l: PNConnectionListener) {
    this.connectionListeners.push(l);
    return this;
  }
  addErrorListener(l: (e: PNError) => void) {
    this.errorListeners.push(l);
    return this;
  }
  stream(channel: string) {
    this.streamCalls.push(channel);
    this.channels.add(channel);
    return this;
  }
  detach(channel: string) {
    this.channels.delete(channel);
    return this;
  }
  getActiveChannels() {
    return new Set(this.channels);
  }
  isConnected() {
    return this.state === PNState.CONNECTED;
  }

  // ---- test helpers ----
  setState(state: PNState) {
    this.state = state;
    this.connectionListeners.forEach((l) => l.onStateChanged?.(state));
  }
  simulateConnected(endpoint?: PNEndpoint) {
    this.setState(PNState.CONNECTED);
    this.connectionListeners.forEach((l) => l.onConnected?.());
    if (endpoint) this.endpointListeners.forEach((l) => l(endpoint));
  }
  simulateLost() {
    this.setState(PNState.DISCONNECTED);
    this.connectionListeners.forEach((l) => l.onDisconnected?.());
    this.setState(PNState.RECONNECTING);
    this.connectionListeners.forEach((l) => l.onReconnecting?.(0, 1000));
  }
  simulateError(message: string) {
    const e = new PNError(message);
    this.errorListeners.forEach((l) => l(e));
  }
}
