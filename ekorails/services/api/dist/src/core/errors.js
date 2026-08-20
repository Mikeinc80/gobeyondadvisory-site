/**
 * Typed application errors.
 *
 * Error responses carry a stable machine-readable `code` and a message safe to show a
 * user. Anything a caller should not learn — whether a record exists in another
 * organisation, why exactly authentication failed, what a rule threshold is — stays in
 * `internalDetail`, which is logged but never serialised to the client.
 */
const STATUS_BY_CATEGORY = {
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
    code;
    category;
    status;
    details;
    internalDetail;
    constructor(category, code, message, options = {}) {
        super(message, options.cause !== undefined ? { cause: options.cause } : undefined);
        this.name = 'AppError';
        this.category = category;
        this.code = code;
        this.status = STATUS_BY_CATEGORY[category];
        this.details = options.details ?? {};
        this.internalDetail = options.internalDetail;
    }
    toResponse() {
        return { code: this.code, message: this.message, details: this.details };
    }
}
export const invalid = (code, message, details) => new AppError('validation', code, message, { details: details ?? {} });
export const unauthenticated = (code, message = 'Authentication required', internalDetail) => new AppError('authentication', code, message, { internalDetail: internalDetail ?? '' });
export const forbidden = (code, message, internalDetail) => new AppError('authorisation', code, message, { internalDetail: internalDetail ?? '' });
/**
 * Used for anything the caller is not entitled to see. Note that cross-organisation
 * access returns 404, not 403: telling a caller "this exists but is not yours" is
 * itself a disclosure.
 */
export const notFound = (code, message = 'Not found', internalDetail) => new AppError('not_found', code, message, { internalDetail: internalDetail ?? '' });
export const conflict = (code, message, details) => new AppError('conflict', code, message, { details: details ?? {} });
export const precondition = (code, message, details) => new AppError('precondition', code, message, { details: details ?? {} });
export const rateLimited = (retryAfterSeconds) => new AppError('rate_limit', 'RATE_LIMITED', 'Too many requests. Try again shortly.', {
    details: { retry_after_seconds: retryAfterSeconds },
});
export const dependencyFailure = (code, message, internalDetail) => new AppError('dependency', code, message, { internalDetail: internalDetail ?? '' });
export const internal = (code, internalDetail) => new AppError('internal', code, 'An internal error occurred.', { internalDetail });
//# sourceMappingURL=errors.js.map