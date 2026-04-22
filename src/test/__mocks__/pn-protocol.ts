/**
 * Mock for @rivium/pn-protocol
 */

export enum PNState {
  CONNECTING = 'connecting',
  CONNECTED = 'connected',
  DISCONNECTED = 'disconnected',
  ERROR = 'error',
}

export enum PNDeliveryMode {
  AT_MOST_ONCE = 0,
  AT_LEAST_ONCE = 1,
  EXACTLY_ONCE = 2,
}

export class PNMessage {
  topic = '';
  payload: any = {};
}

export class PNError extends Error {
  constructor(message?: string) {
    super(message);
    this.name = 'PNError';
  }
}

export interface PNConnectionListener {
  onStateChange?: (state: PNState) => void;
  onMessage?: (message: PNMessage) => void;
  onError?: (error: PNError) => void;
}

export class PNAuthFactory {
  static token(t: string) {
    return { type: 'token', value: t };
  }
}

export class PNConfigBuilder {
  private config: any = {};

  gateway(g: string) { this.config.gateway = g; return this; }
  port(p: number) { this.config.port = p; return this; }
  secure(s: boolean) { this.config.secure = s; return this; }
  clientId(c: string) { this.config.clientId = c; return this; }
  auth(a: any) { this.config.auth = a; return this; }
  keepAlive(k: number) { this.config.keepAlive = k; return this; }
  autoReconnect(a: boolean) { this.config.autoReconnect = a; return this; }
  maxReconnectDelay(m: number) { this.config.maxReconnectDelay = m; return this; }
  build() { return this.config; }
}

export class PNSocket {
  private listener: PNConnectionListener | null = null;

  constructor(_config: any) {}

  setListener(listener: PNConnectionListener) {
    this.listener = listener;
  }

  connect() {}
  disconnect() {}
  subscribe(_topic: string, _qos: PNDeliveryMode) {}
  unsubscribe(_topic: string, _qos: PNDeliveryMode) {}
  publish(_topic: string, _payload: any, _qos: PNDeliveryMode) {}
}
