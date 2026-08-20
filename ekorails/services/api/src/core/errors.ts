/**
 * Typed application errors.
 *
 * Error responses carry a stable machine-readable `code` and a message safe to show a
 * user. Anything a caller should not learn — whether a record exists in another
 * organisation, why exactly authentication failed, what a rule threshold is — stays in
 * `internalDetail`, which is logged but never serialised to the client.
 */

export type ErrorCategory =
  | 'validation'
  | 'authentication'
  | 'authorisation'
  | 'not_found'
  | 'conflict'
  | 'precondition'
  | 'rate_limit'
  | 'dependency'
  | 'internal';

const STATUS_BY_CATEGORY: Record<ErrorCategory, number> = {
  validation: 400,
  authentication: 401,
  authorisation: 403,
  not_found: 404,
  conflict: 409,
  precondition: 422,
  rate_limit: 429,
  dependency: 502,
  internal: 500,
};

export class AppError extends Error {
  readonly code: string;
  readonly category: ErrorCategory;
  readonly status: number;
  readonly details: Record<string, unknown>;
  readonly internalDetail: string | undefined;

  constructor(
    category: ErrorCategory,
    code: string,
    message: string,
    options: { details?: Record<string, unknown>; internalDetail?: string; cause?: unknown } = {},
  ) {
    super(message, options.cause !== undefined ? { cause: options.cause } : undefined);
    this.name = 'AppError';
    this.category = category;
    this.code = code;
    this.status = STATUS_BY_CATEGORY[category];
    this.details = options.details ?? {};
    this.internalDetail = options.internalDetail;
  }

  toResponse(): { code: string; message: string; details: Record<string, unknown> } {
    return { code: this.code, message: this.message, details: this.details };
  }
}

export const invalid = (code: string, message: string, details?: Record<string, unknown>) =>
  new AppError('validation', code, message, { details: details ?? {} });

export const unauthenticated = (code: string, message = 'Authentication required', internalDetail?: string) =>
  new AppError('authentication', code, message, { internalDetail: internalDetail ?? '' });

export const forbidden = (code: string, message: string, internalDetail?: string) =>
  new AppError('authorisation', code, message, { internalDetail: internalDetail ?? '' });

/**
 * Used for anything the caller is not entitled to see. Note that cross-organisation
 * access returns 404, not 403: telling a caller "this exists but is not yours" is
 * itself a disclosure.
 */
export const notFound = (code: string, message = 'Not found', internalDetail?: string) =>
  new AppError('not_found', code, message, { internalDetail: internalDetail ?? '' });

export const conflict = (code: string, message: string, details?: Record<string, unknown>) =>
  new AppError('conflict', code, message, { details: details ?? {} });

export const precondition = (code: string, message: string, details?: Record<string, unknown>) =>
  new AppError('precondition', code, message, { details: details ?? {} });

export const rateLimited = (retryAfterSeconds: number) =>
  new AppError('rate_limit', 'RATE_LIMITED', 'Too many requests. Try again shortly.', {
    details: { retry_after_seconds: retryAfterSeconds },
  });

export const dependencyFailure = (code: string, message: string, internalDetail?: string) =>
  new AppError('dependency', code, message, { internalDetail: internalDetail ?? '' });

export const internal = (code: string, internalDetail: string) =>
  new AppError('internal', code, 'An internal error occurred.', { internalDetail });
