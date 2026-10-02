/**
 * Signed user token support for the RiviumPush Web SDK.
 *
 * The token is the Rivium user token your server issues for the signed-in
 * user — the same one the other Rivium SDKs accept. The SDK treats it as an
 * opaque string: it only reads `exp` and `sub` from the payload and never
 * verifies the signature. It is kept in memory only.
 */
/**
 * Returns a user token for the current user, issued by your server, or
 * null / an empty string when no user is signed in.
 */
export type TokenProvider = () => Promise<string | null | undefined>;
/**
 * The server refused the user's identity, or your tokenProvider failed.
 * Informational: the request that hit it fails (or succeeds) as it always did.
 *
 * `code`:
 * - `token_invalid` — the token is not valid for this project
 * - `token_required` — the project requires a token and none was sent
 * - `token_mismatch` — the userId given to the SDK is not the token's user
 * - `token_expired` — the token expired and no fresh one could be fetched
 * - `token_provider_failed` — the tokenProvider threw or timed out
 */
export interface AuthErrorEvent {
    code: string;
    message: string;
    error?: unknown;
}
export type OnAuthErrorCallback = (event: AuthErrorEvent) => void;
/** Refresh this long before `exp`, to absorb clock skew and request time. */
export declare const TOKEN_REFRESH_MARGIN_MS = 60000;
/** A provider that takes longer than this counts as failed. */
export declare const TOKEN_PROVIDER_TIMEOUT_MS = 10000;
/** Header carrying the user token on every Push API request. */
export declare const USER_TOKEN_HEADER = "x-user-token";
/**
 * Reads `exp` and `sub` from a JWT payload. Tolerant: anything that cannot be
 * read is left undefined. Never throws.
 */
export declare function readTokenClaims(token: unknown): {
    exp?: number;
    sub?: string;
};
/**
 * Holds the current user token and refreshes it through the tokenProvider.
 *
 * - Reuses the cached token until shortly before it expires (a token without
 *   `exp` is reused until it is cleared or replaced).
 * - Concurrent callers share one in-flight provider call.
 * - Without a provider, a token set by hand is used until it expires.
 */
export declare class UserTokenManager {
    private provider;
    private readonly now;
    private readonly timeoutMs;
    private token;
    private expiresAt?;
    private sub?;
    private inFlight;
    private generation;
    constructor(provider?: TokenProvider | null, now?: () => number, timeoutMs?: number);
    /** True when a provider or a token is set, i.e. requests may carry a token. */
    hasSource(): boolean;
    hasProvider(): boolean;
    /** Sets, replaces or removes the provider. The cached token is forgotten. */
    setProvider(provider: TokenProvider | null): void;
    /** Uses this token from now on (null forgets it). */
    setToken(token: string | null): void;
    /** `sub` of the cached token, if there is one and it can be read. */
    subject(): string | undefined;
    /** True when a token is cached (whatever its expiry). */
    hasToken(): boolean;
    /**
     * A token valid for at least the refresh margin, or null when no user is
     * signed in. Rejects when the provider fails.
     */
    get(): Promise<string | null>;
    /** Fetches a new token even if the cached one looks valid. Joins a refresh in flight. */
    refresh(): Promise<string | null>;
    /** The cached token if it has not expired yet — used when the provider fails. */
    unexpired(): string | null;
    /** Forgets the cached token. A provider call in flight is not reused. */
    clear(): void;
    private store;
    private forget;
    private callProvider;
}
/**
 * The one place the SDK calls the Push API from. Adds the user token when one
 * is available and replays the request once when the server reports it
 * expired.
 *
 * Without a provider or token this is exactly `fetch(url, init)`.
 */
export declare class PushApiClient {
    private readonly tokens;
    private readonly onAuthError;
    constructor(tokens: UserTokenManager, onAuthError: (event: AuthErrorEvent) => void);
    fetch(url: string, init?: RequestInit): Promise<Response>;
    private fetchWithToken;
    /**
     * The token for the next request, or null to send it without one. A failing
     * provider is reported and never fails the request: the cached token is used
     * while it has not expired, otherwise the request goes out as it did before.
     */
    private userToken;
    private report;
}
