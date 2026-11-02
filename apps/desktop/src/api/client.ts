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
}

export class ApiClient {
  readonly baseUrl: string;
  private readonly fetchImpl: Fetch;
  private readonly attempts: number;
  private readonly retryDelayMs: number;
  private readonly timeoutMs: number;

  constructor(opts: ApiClientOptions) {
    this.baseUrl = opts.baseUrl.replace(/\/$/, '');
    this.fetchImpl = opts.fetch ?? ((input, init) => fetch(input, init));
    this.attempts = opts.attempts ?? 3;
    this.retryDelayMs = opts.retryDelayMs ?? 400;
    this.timeoutMs = opts.timeoutMs ?? 8_000;
  }

  get<T>(path: string): Promise<T> {
    return this.request<T>(path, { method: 'GET' });
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
    let lastNetworkError: ApiError | undefined;
    for (let attempt = 1; attempt <= this.attempts; attempt++) {
      try {
        return await this.request<CommandSuccess<R>>('/v1/commands', { method: 'POST', headers: { 'content-type': 'application/json' }, body });
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
      res = await this.fetchImpl(`${this.baseUrl}${path}`, { ...init, signal: ctrl.signal });
    } catch {
      throw new ApiError('NETWORK', 'Cannot reach the outlet server. On the master PC, open “DinePOS Server” from the Start menu; on a billing terminal, check the network and the server address in Settings.');
    } finally {
      clearTimeout(timer);
    }
    let json: unknown;
    try {
      json = await res.json();
    } catch {
      throw new ApiError('INTERNAL', `The server sent an unreadable answer (HTTP ${res.status}).`);
    }
    if (res.ok) return json as T;
    const fail = json as Partial<CommandFailure>;
    throw new ApiError(fail.error?.code ?? 'INTERNAL', fail.error?.message ?? `Request failed (HTTP ${res.status}).`, fail.error?.details, fail.order);
  }
}
