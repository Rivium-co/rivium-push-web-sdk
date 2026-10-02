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
export const TOKEN_REFRESH_MARGIN_MS = 60_000;

/** A provider that takes longer than this counts as failed. */
export const TOKEN_PROVIDER_TIMEOUT_MS = 10_000;

/** Header carrying the user token on every Push API request. */
export const USER_TOKEN_HEADER = 'x-user-token';

/**
 * Reads `exp` and `sub` from a JWT payload. Tolerant: anything that cannot be
 * read is left undefined. Never throws.
 */
export function readTokenClaims(token: unknown): { exp?: number; sub?: string } {
  try {
    if (typeof token !== 'string') return {};
    const part = token.split('.')[1];
    if (!part) return {};
    const base64 = part.replace(/-/g, '+').replace(/_/g, '/');
    const binary = atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, '='));
    let json = binary;
    try {
      // UTF-8 payloads (a non-ASCII `sub`).
      json = decodeURIComponent(
        binary
          .split('')
          .map((c) => '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2))
          .join(''),
      );
    } catch {
      // Not valid UTF-8 — the raw bytes are good enough for exp/sub.
    }
    const payload = JSON.parse(json);
    if (!payload || typeof payload !== 'object') return {};
    return {
      exp: typeof payload.exp === 'number' && isFinite(payload.exp) ? payload.exp : undefined,
      sub: typeof payload.sub === 'string' ? payload.sub : undefined,
    };
  } catch {
    return {};
  }
}

/**
 * Holds the current user token and refreshes it through the tokenProvider.
 *
 * - Reuses the cached token until shortly before it expires (a token without
 *   `exp` is reused until it is cleared or replaced).
 * - Concurrent callers share one in-flight provider call.
 * - Without a provider, a token set by hand is used until it expires.
 */
export class UserTokenManager {
  private token: string | null = null;
  private expiresAt?: number;
  private sub?: string;
  private inFlight: Promise<string | null> | null = null;
  // Bumped whenever the cached token is dropped or replaced by hand, so a
  // provider call that started before does not overwrite the newer state.
  private generation = 0;

  constructor(
    private provider: TokenProvider | null = null,
    private readonly now: () => number = Date.now,
    private readonly timeoutMs: number = TOKEN_PROVIDER_TIMEOUT_MS,
  ) {}

  /** True when a provider or a token is set, i.e. requests may carry a token. */
  hasSource(): boolean {
    return !!this.provider || !!this.token;
  }

  hasProvider(): boolean {
    return !!this.provider;
  }

  /** Sets, replaces or removes the provider. The cached token is forgotten. */
  setProvider(provider: TokenProvider | null): void {
    this.provider = provider || null;
    this.clear();
  }

  /** Uses this token from now on (null forgets it). */
  setToken(token: string | null): void {
    this.clear();
    if (token) this.store(token);
  }

  /** `sub` of the cached token, if there is one and it can be read. */
  subject(): string | undefined {
    return this.token ? this.sub : undefined;
  }

  /** True when a token is cached (whatever its expiry). */
  hasToken(): boolean {
    return !!this.token;
  }

  /**
   * A token valid for at least the refresh margin, or null when no user is
   * signed in. Rejects when the provider fails.
   */
  get(): Promise<string | null> {
    if (this.token) {
      if (this.expiresAt === undefined || this.now() < this.expiresAt - TOKEN_REFRESH_MARGIN_MS) {
        return Promise.resolve(this.token);
      }
      if (!this.provider) {
        // Nothing can renew it: keep sending it until it really expires.
        if (this.now() < this.expiresAt) return Promise.resolve(this.token);
        this.clear();
        return Promise.resolve(null);
      }
    }
    return this.refresh();
  }

  /** Fetches a new token even if the cached one looks valid. Joins a refresh in flight. */
  refresh(): Promise<string | null> {
    if (!this.provider) return Promise.resolve(null);
    if (this.inFlight) return this.inFlight;

    const generation = this.generation;
    const call: Promise<string | null> = this.callProvider(this.provider)
      .then((token) => {
        const value = typeof token === 'string' && token ? token : null;
        if (generation === this.generation) {
          if (value) this.store(value);
          else this.forget();
        }
        return value;
      })
      .finally(() => {
        if (this.inFlight === call) this.inFlight = null;
      });
    this.inFlight = call;
    return call;
  }

  /** The cached token if it has not expired yet — used when the provider fails. */
  unexpired(): string | null {
    if (!this.token) return null;
    if (this.expiresAt !== undefined && this.now() >= this.expiresAt) return null;
    return this.token;
  }

  /** Forgets the cached token. A provider call in flight is not reused. */
  clear(): void {
    this.generation++;
    this.inFlight = null;
    this.forget();
  }

  private store(token: string): void {
    const claims = readTokenClaims(token);
    this.token = token;
    this.expiresAt = claims.exp === undefined ? undefined : claims.exp * 1000;
    this.sub = claims.sub;
  }

  private forget(): void {
    this.token = null;
    this.expiresAt = undefined;
    this.sub = undefined;
  }

  private callProvider(provider: TokenProvider): Promise<string | null | undefined> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('tokenProvider timed out')), this.timeoutMs);
      let pending: Promise<string | null | undefined>;
      try {
        pending = Promise.resolve(provider());
      } catch (error) {
        clearTimeout(timer);
        reject(error);
        return;
      }
      pending.then(
        (token) => {
          clearTimeout(timer);
          resolve(token);
        },
        (error) => {
          clearTimeout(timer);
          reject(error);
        },
      );
    });
  }
}

/** `code` and `message` of a Push API error body. Never throws. */
async function readErrorBody(response: Response): Promise<{ code?: string; message?: string }> {
  try {
    const source = typeof response.clone === 'function' ? response.clone() : response;
    const body = await source.json();
    if (!body || typeof body !== 'object') return {};
    return {
      code: typeof body.code === 'string' ? body.code : undefined,
      message: typeof body.message === 'string' ? body.message : undefined,
    };
  } catch {
    return {};
  }
}

function withToken(init: RequestInit | undefined, token: string): RequestInit {
  return {
    ...init,
    headers: { ...((init?.headers as Record<string, string>) ?? {}), [USER_TOKEN_HEADER]: token },
  };
}

/**
 * The one place the SDK calls the Push API from. Adds the user token when one
 * is available and replays the request once when the server reports it
 * expired.
 *
 * Without a provider or token this is exactly `fetch(url, init)`.
 */
export class PushApiClient {
  constructor(
    private readonly tokens: UserTokenManager,
    private readonly onAuthError: (event: AuthErrorEvent) => void,
  ) {}

  fetch(url: string, init?: RequestInit): Promise<Response> {
    // No token source: the request is the same call, made at the same moment,
    // as before token support existed.
    if (!this.tokens.hasSource()) return fetch(url, init);
    return this.fetchWithToken(url, init);
  }

  private async fetchWithToken(url: string, init?: RequestInit): Promise<Response> {
    const hadToken = this.tokens.hasToken();
    let token = await this.userToken(false);
    if (!token && hadToken && !this.tokens.hasProvider()) {
      // A token set by hand ran out and nothing can renew it.
      this.report({ code: 'token_expired', message: 'User token expired' });
    }
    let response = await fetch(url, token ? withToken(init, token) : init);

    if (token && response.status === 401) {
      const { code } = await readErrorBody(response);
      if (code === 'token_expired') {
        // Routine: fetch a new token and replay the request once.
        const fresh = await this.userToken(true);
        if (!fresh || fresh === token) {
          this.tokens.clear();
          this.report({ code: 'token_expired', message: 'User token expired and could not be refreshed' });
          return response;
        }
        token = fresh;
        response = await fetch(url, withToken(init, fresh));
      }
    }

    if (response.status === 401 || response.status === 403) {
      const { code, message } = await readErrorBody(response);
      if (response.status === 401 && (code === 'token_invalid' || code === 'token_required' || code === 'token_expired')) {
        // Do not keep sending a token the server refuses.
        if (code !== 'token_required') this.tokens.clear();
        this.report({ code, message: message || code });
      } else if (response.status === 403 && message && /does not match the user token/i.test(message)) {
        this.report({ code: 'token_mismatch', message });
      }
    }
    return response;
  }

  /**
   * The token for the next request, or null to send it without one. A failing
   * provider is reported and never fails the request: the cached token is used
   * while it has not expired, otherwise the request goes out as it did before.
   */
  private async userToken(forceRefresh: boolean): Promise<string | null> {
    try {
      return await (forceRefresh ? this.tokens.refresh() : this.tokens.get());
    } catch (error) {
      this.report({ code: 'token_provider_failed', message: 'tokenProvider failed', error });
      return forceRefresh ? null : this.tokens.unexpired();
    }
  }

  private report(event: AuthErrorEvent): void {
    try {
      this.onAuthError(event);
    } catch {
      // A throwing listener must not break the request.
    }
  }
}
