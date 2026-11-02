// Error codes and HTTP statuses from docs/03-command-api.md.
import type { ErrorCode, OrderSnapshot } from '@dinepos/shared';

export type { ErrorCode };

export const ERROR_STATUS: Record<ErrorCode, number> = {
  VALIDATION: 400,
  UNAUTHENTICATED: 401,
  PIN_REQUIRED: 401,
  LICENSE: 402,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  VERSION_CONFLICT: 409,
  INVALID_STATE: 422,
  DAY_CLOSED: 423,
  INTERNAL: 500,
};

export class PosError extends Error {
  readonly code: ErrorCode;
  readonly httpStatus: number;
  readonly details: unknown;
  /** Current order snapshot, sent with VERSION_CONFLICT so the client can rebase without a refetch. */
  order?: OrderSnapshot;

  constructor(code: ErrorCode, message: string, details?: unknown, httpStatus: number = ERROR_STATUS[code]) {
    super(message);
    this.name = 'PosError';
    this.code = code;
    this.httpStatus = httpStatus;
    this.details = details;
  }
}

/** Raised while the server starts (bad config, locked data dir, refused database). Never sent to clients. */
export class StartupError extends Error {
  readonly code: string;

  constructor(code: string, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'StartupError';
    this.code = code;
  }
}
