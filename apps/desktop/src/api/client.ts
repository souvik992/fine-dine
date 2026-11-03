// HTTP client for the outlet server: GET queries and the command envelope (docs/03-command-api.md).
import { newId, type CommandFailure, type CommandSuccess, type ErrorCode, type OrderSnapshot } from '@dinepos/shared';

export class ApiError extends Error {
  constructor(
    readonly code: ErrorCode | 'NETWORK',
    message: string,
    readonly details?: unknown,
    readonly order?: OrderSnapshot,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export interface CommandOptions {
  orderId?: string;
  expectedVersion?: number;
  /** Reuse an id when the user retries the same action (idempotent replay on the server). */
  commandId?: string;
}

export type Fetch = (input: string, init?: RequestInit) => Promise<Response>;

export interface ApiClientOptions {
  baseUrl: string;
  fetch?: Fetch;
  /** Network attempts per command; the same commandId is reused each time. */
  attempts?: number;
  retryDelayMs?: number;
  timeoutMs?: number;
  /** Staff session token sent as X-User-Session. */
  getToken?: () => string | null;
  /** Called when the server says the session is missing or over (except while signing in). */
  onUnauthenticated?: () => void;
  /**
   * Asks for a manager PIN when a command answers PIN_REQUIRED. Resolve with the PIN to resend the SAME command,
   * or null to give up (the PIN_REQUIRED error is then thrown).
   */
  requestManagerPin?: (err: ApiError) => Promise<string | null>;
}

export class ApiClient {
  readonly baseUrl: string;
  private readonly fetchImpl: Fetch;
  private readonly attempts: number;
  private readonly retryDelayMs: number;
  private readonly timeoutMs: number;
  private readonly opts: ApiClientOptions;

  constructor(opts: ApiClientOptions) {
    this.opts = opts;
    this.baseUrl = opts.baseUrl.replace(/\/$/, '');
    this.fetchImpl = opts.fetch ?? ((input, init) => fetch(input, init));
    this.attempts = opts.attempts ?? 3;
    this.retryDelayMs = opts.retryDelayMs ?? 400;
    this.timeoutMs = opts.timeoutMs ?? 8_000;
  }

  get<T>(path: string): Promise<T> {
    return this.request<T>(path, { method: 'GET' });
  }

  /** POST/DELETE outside the command envelope (sign-in, sign-out). */
  send<T>(method: 'POST' | 'DELETE', path: string, body?: unknown, headers: Record<string, string> = {}): Promise<T> {
    return this.request<T>(path, {
      method,
      headers: { ...(body === undefined ? {} : { 'content-type': 'application/json' }), ...headers },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  }

  /**
   * Sends one command. Network failures are retried with the SAME commandId, so a lost response can never
   * apply the command twice (the server answers a replay with the original result).
   */
  async command<R = unknown>(type: string, payload: unknown, opts: CommandOptions = {}): Promise<CommandSuccess<R>> {
    const body = JSON.stringify({
      commandId: opts.commandId ?? newId(),
      type,
      ...(opts.orderId ? { orderId: opts.orderId, expectedVersion: opts.expectedVersion } : {}),
      payload,
      createdAt: new Date().toISOString(),
    });
    let managerPin: string | null = null;
    for (;;) {
      try {
        return await this.sendCommand<R>(body, managerPin);
      } catch (err) {
        // A manager approves by PIN; the same command (same commandId) is sent again with it.
        const askable = err instanceof ApiError && err.code === 'PIN_REQUIRED' && (err.details as { reason?: string } | undefined)?.reason !== 'too_many_tries';
        if (!askable || !this.opts.requestManagerPin) throw err;
        managerPin = await this.opts.requestManagerPin(err);
        if (managerPin === null) throw err;
      }
    }
  }

  private async sendCommand<R>(body: string, managerPin: string | null): Promise<CommandSuccess<R>> {
    const headers: Record<string, string> = { 'content-type': 'application/json', ...(managerPin ? { 'x-manager-pin': managerPin } : {}) };
    let lastNetworkError: ApiError | undefined;
    for (let attempt = 1; attempt <= this.attempts; attempt++) {
      try {
        return await this.request<CommandSuccess<R>>('/v1/commands', { method: 'POST', headers, body });
      } catch (err) {
        if (!(err instanceof ApiError) || err.code !== 'NETWORK') throw err;
        lastNetworkError = err;
        if (attempt < this.attempts) await new Promise((r) => setTimeout(r, this.retryDelayMs * attempt));
      }
    }
    throw lastNetworkError!;
  }

  private async request<T>(path: string, init: RequestInit): Promise<T> {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), this.timeoutMs);
    let res: Response;
    try {
      const token = this.opts.getToken?.();
      const headers = { ...(init.headers as Record<string, string> | undefined), ...(token ? { 'x-user-session': token } : {}) };
      res = await this.fetchImpl(`${this.baseUrl}${path}`, { ...init, headers, signal: ctrl.signal });
    } catch {
      throw new ApiError('NETWORK', 'Cannot reach the outlet server. On the master PC, open “DinePOS Server” from the Start menu; on a billing terminal, check the network and the server address in Settings.');
    } finally {
      clearTimeout(timer);
    }
    if (res.status === 204) return undefined as T;
    let json: unknown;
    try {
      json = await res.json();
    } catch {
      throw new ApiError('INTERNAL', `The server sent an unreadable answer (HTTP ${res.status}).`);
    }
    if (res.ok) return json as T;
    const fail = json as Partial<CommandFailure>;
    if (fail.error?.code === 'UNAUTHENTICATED' && path !== '/v1/sessions') this.opts.onUnauthenticated?.();
    throw new ApiError(fail.error?.code ?? 'INTERNAL', fail.error?.message ?? `Request failed (HTTP ${res.status}).`, fail.error?.details, fail.order);
  }
}
