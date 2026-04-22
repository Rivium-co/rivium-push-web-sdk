/**
 * Mock for @rivium/pn-protocol
 */
export declare enum PNState {
    CONNECTING = "connecting",
    CONNECTED = "connected",
    DISCONNECTED = "disconnected",
    ERROR = "error"
}
export declare enum PNDeliveryMode {
    AT_MOST_ONCE = 0,
    AT_LEAST_ONCE = 1,
    EXACTLY_ONCE = 2
}
export declare class PNMessage {
    topic: string;
    payload: any;
}
export declare class PNError extends Error {
    constructor(message?: string);
}
export interface PNConnectionListener {
    onStateChange?: (state: PNState) => void;
    onMessage?: (message: PNMessage) => void;
    onError?: (error: PNError) => void;
}
export declare class PNAuthFactory {
    static token(t: string): {
        type: string;
        value: string;
    };
}
export declare class PNConfigBuilder {
    private config;
    gateway(g: string): this;
    port(p: number): this;
    secure(s: boolean): this;
    clientId(c: string): this;
    auth(a: any): this;
    keepAlive(k: number): this;
    autoReconnect(a: boolean): this;
    maxReconnectDelay(m: number): this;
    build(): any;
}
export declare class PNSocket {
    private listener;
    constructor(_config: any);
    setListener(listener: PNConnectionListener): void;
    connect(): void;
    disconnect(): void;
    subscribe(_topic: string, _qos: PNDeliveryMode): void;
    unsubscribe(_topic: string, _qos: PNDeliveryMode): void;
    publish(_topic: string, _payload: any, _qos: PNDeliveryMode): void;
}
