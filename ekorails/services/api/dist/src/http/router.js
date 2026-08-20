/**
 * A small typed HTTP router over Node's built-in server.
 *
 * Why not a framework: the dependency surface of a settlement system is part of its
 * attack surface, and everything needed here (routing, body parsing, cookies, headers) is
 * a few hundred lines. Fewer transitive dependencies means fewer supply-chain advisories
 * to triage during a pilot. That trade-off is recorded as founder decision FD-010.
 *
 * Security behaviours implemented here rather than left to individual handlers:
 *   - a strict Content-Security-Policy and the standard hardening headers on every response
 *   - CSRF double-submit verification on every state-changing method
 *   - body size limits and JSON parse guards
 *   - per-identity and per-route rate limiting
 *   - a request id and correlation id on every request, echoed in responses and logs
 *   - uniform error shaping, so an unexpected throw never leaks a stack trace
 */
import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { AppError, internal, invalid, rateLimited } from '../core/errors.js';
import { logger } from '../core/logger.js';
import { environment, ENVIRONMENT_BANNER } from '../core/env.js';
import { sha256Hex } from '../core/crypto.js';
const MAX_BODY_BYTES = 1024 * 1024; // 1 MB for JSON; document upload uses its own limit
const MAX_UPLOAD_BYTES = 26 * 1024 * 1024;
export class Router {
    routes = [];
    register(route) {
        const segments = route.pattern.split('/').filter(Boolean);
        const paramNames = segments.filter((s) => s.startsWith(':')).map((s) => s.slice(1));
        this.routes.push({ ...route, segments, paramNames });
        return this;
    }
    all() {
        return this.routes;
    }
    match(method, path) {
        const parts = path.split('/').filter(Boolean);
        for (const route of this.routes) {
            if (route.method !== method)
                continue;
            if (route.segments.length !== parts.length)
                continue;
            const params = {};
            let ok = true;
            for (let i = 0; i < route.segments.length; i += 1) {
                const seg = route.segments[i];
                const part = parts[i];
                if (seg.startsWith(':'))
                    params[seg.slice(1)] = decodeURIComponent(part);
                else if (seg !== part) {
                    ok = false;
                    break;
                }
            }
            if (ok)
                return { route, params };
        }
        return null;
    }
    /** True when a path exists under a different method, so we can answer 405 not 404. */
    pathExists(path) {
        const parts = path.split('/').filter(Boolean);
        return this.routes.some((route) => {
            if (route.segments.length !== parts.length)
                return false;
            return route.segments.every((seg, i) => seg.startsWith(':') || seg === parts[i]);
        });
    }
}
/**
 * In-process fixed-window limiter. Adequate for a single-instance pilot and honest about
 * it: a multi-instance deployment needs a shared store, which is a named item in the
 * pilot readiness report.
 */
export class RateLimiter {
    buckets = new Map();
    check(key, windowMs, max) {
        const now = Date.now();
        const bucket = this.buckets.get(key);
        if (!bucket || bucket.resetAt <= now) {
            this.buckets.set(key, { count: 1, resetAt: now + windowMs });
            return { allowed: true, retryAfterSeconds: 0 };
        }
        bucket.count += 1;
        if (bucket.count > max) {
            return { allowed: false, retryAfterSeconds: Math.ceil((bucket.resetAt - now) / 1000) };
        }
        return { allowed: true, retryAfterSeconds: 0 };
    }
    sweep() {
        const now = Date.now();
        for (const [key, bucket] of this.buckets) {
            if (bucket.resetAt <= now)
                this.buckets.delete(key);
        }
    }
}
// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
export function parseCookies(header) {
    const out = {};
    if (!header)
        return out;
    for (const part of header.split(';')) {
        const idx = part.indexOf('=');
        if (idx <= 0)
            continue;
        const key = part.slice(0, idx).trim();
        const value = part.slice(idx + 1).trim();
        if (key)
            out[key] = decodeURIComponent(value);
    }
    return out;
}
export function serialiseCookie(name, value, options = {}) {
    const parts = [`${name}=${encodeURIComponent(value)}`];
    parts.push(`Path=${options.path ?? '/'}`);
    if (options.maxAgeSeconds !== undefined)
        parts.push(`Max-Age=${options.maxAgeSeconds}`);
    if (options.httpOnly !== false)
        parts.push('HttpOnly');
    parts.push(`SameSite=${options.sameSite ?? 'Strict'}`);
    // Secure is set whenever we are not obviously on plain local development. A cookie
    // that omits Secure in production is a session waiting to be stolen.
    if (process.env['EKORAILS_INSECURE_COOKIES'] !== 'true')
        parts.push('Secure');
    return parts.join('; ');
}
function readBody(req, limit) {
    return new Promise((resolve, reject) => {
        const chunks = [];
        let total = 0;
        let overLimit = false;
        req.on('data', (chunk) => {
            if (overLimit)
                return;
            total += chunk.length;
            if (total > limit) {
                overLimit = true;
                // Stop buffering but keep draining. Destroying the socket here would abort the
                // connection before the response could be written, so the caller would see a
                // network error instead of a clear refusal — and would have no idea why.
                chunks.length = 0;
                req.resume();
                reject(invalid('PAYLOAD_TOO_LARGE', `Request body exceeds ${limit} bytes.`, {
                    limit_bytes: limit,
                }));
                return;
            }
            chunks.push(chunk);
        });
        req.on('end', () => { if (!overLimit)
            resolve(Buffer.concat(chunks)); });
        req.on('error', reject);
        req.on('aborted', () => reject(invalid('REQUEST_ABORTED', 'The request was aborted.')));
    });
}
/**
 * Security headers applied to every response.
 *
 * The CSP is deliberately strict: no inline script, no eval, no external origins, and
 * `frame-ancestors 'none'`. The web client is written to work under it rather than the
 * policy being loosened to accommodate the client.
 */
export function securityHeaders(nonce) {
    return {
        'content-security-policy': [
            "default-src 'self'",
            `script-src 'self' 'nonce-${nonce}'`,
            "style-src 'self' 'unsafe-inline'",
            "img-src 'self' data:",
            "font-src 'self'",
            "connect-src 'self'",
            "object-src 'none'",
            "base-uri 'none'",
            "form-action 'self'",
            "frame-ancestors 'none'",
            'upgrade-insecure-requests',
        ].join('; '),
        'x-content-type-options': 'nosniff',
        'x-frame-options': 'DENY',
        'referrer-policy': 'no-referrer',
        'permissions-policy': 'geolocation=(), microphone=(), camera=(), payment=(), usb=()',
        'strict-transport-security': 'max-age=31536000; includeSubDomains',
        'cross-origin-opener-policy': 'same-origin',
        'cross-origin-resource-policy': 'same-origin',
        'cache-control': 'no-store',
        // The banner travels on every single response, including errors.
        'x-ekorails-environment': `${environment().mode}; ${ENVIRONMENT_BANNER}`,
    };
}
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
export function createHttpServer(options) {
    const limiter = new RateLimiter();
    setInterval(() => limiter.sweep(), 60_000).unref();
    return createServer(async (req, res) => {
        const started = Date.now();
        const requestId = randomUUID();
        const correlationId = req.headers['x-correlation-id'] ?? randomUUID();
        const nonce = Buffer.from(randomUUID()).toString('base64url');
        const url = new URL(req.url ?? '/', 'http://internal');
        const path = url.pathname;
        const method = (req.method ?? 'GET').toUpperCase();
        const forwarded = req.headers['x-forwarded-for']?.split(',')[0]?.trim();
        const ip = forwarded || req.socket.remoteAddress || null;
        const ipHash = ip ? sha256Hex(ip) : null;
        const userAgent = req.headers['user-agent'];
        const userAgentHash = userAgent ? sha256Hex(String(userAgent)) : null;
        const log = logger.child({ requestId, correlationId, route: `${method} ${path}` });
        const baseHeaders = {
            ...securityHeaders(nonce),
            'x-request-id': requestId,
            'x-correlation-id': correlationId,
        };
        const send = (status, payload, extra = {}, cookies = []) => {
            const body = typeof payload === 'string' || Buffer.isBuffer(payload)
                ? payload
                : JSON.stringify(payload);
            const headers = {
                ...baseHeaders,
                'content-type': extra['content-type'] ?? 'application/json; charset=utf-8',
                ...extra,
            };
            if (cookies.length > 0)
                headers['set-cookie'] = cookies;
            res.writeHead(status, headers);
            res.end(body);
            log.info('request', {
                status, durationMs: Date.now() - started, method, path,
            });
        };
        try {
            if (method === 'OPTIONS') {
                send(204, '');
                return;
            }
            // Static assets for the web client.
            if (options.serveStatic && (method === 'GET' || method === 'HEAD')) {
                const asset = await options.serveStatic(path);
                if (asset) {
                    const body = asset.nonce
                        ? Buffer.from(asset.body.toString('utf8').replaceAll('__CSP_NONCE__', nonce), 'utf8')
                        : asset.body;
                    send(200, body, {
                        'content-type': asset.contentType,
                        'cache-control': path.startsWith('/assets/') ? 'public, max-age=3600' : 'no-store',
                    });
                    return;
                }
            }
            const matched = options.router.match(method, path);
            if (!matched) {
                if (options.router.pathExists(path)) {
                    send(405, { error: { code: 'METHOD_NOT_ALLOWED', message: 'Method not allowed.' } });
                }
                else {
                    send(404, { error: { code: 'NOT_FOUND', message: 'Not found.' } });
                }
                return;
            }
            const { route, params } = matched;
            const cookies = parseCookies(req.headers.cookie);
            const sessionToken = cookies['ekorails_session'] ?? null;
            // Rate limit before doing any work. Keyed by session where we have one, by hashed
            // network identifier otherwise, so one caller cannot exhaust another's budget.
            const limit = route.rateLimit ?? { windowMs: 60_000, max: 120 };
            const limitKey = `${route.pattern}:${sessionToken ? sha256Hex(sessionToken) : ipHash ?? 'anon'}`;
            const limitResult = limiter.check(limitKey, limit.windowMs, limit.max);
            if (!limitResult.allowed) {
                const err = rateLimited(limitResult.retryAfterSeconds);
                log.warn('rate limited', { path, retryAfter: limitResult.retryAfterSeconds });
                send(429, { error: err.toResponse() }, { 'retry-after': String(limitResult.retryAfterSeconds) });
                return;
            }
            // Body.
            const isUpload = (req.headers['content-type'] ?? '').startsWith('application/octet-stream');
            let body = null;
            if (!SAFE_METHODS.has(method)) {
                const raw = await readBody(req, isUpload ? MAX_UPLOAD_BYTES : MAX_BODY_BYTES);
                if (isUpload) {
                    body = raw;
                }
                else if (raw.length > 0) {
                    try {
                        body = JSON.parse(raw.toString('utf8'));
                    }
                    catch {
                        send(400, { error: { code: 'INVALID_JSON', message: 'Request body is not valid JSON.' } });
                        return;
                    }
                }
            }
            // Authentication.
            let user = null;
            if (route.auth !== 'none') {
                if (!sessionToken) {
                    send(401, { error: { code: 'SESSION_REQUIRED', message: 'Sign in to continue.' } });
                    return;
                }
                user = await options.authenticate(sessionToken);
                if (route.auth === 'session' && !user.mfaSatisfied) {
                    send(401, {
                        error: {
                            code: 'MFA_REQUIRED',
                            message: 'Complete multi-factor authentication to continue.',
                        },
                    });
                    return;
                }
            }
            // CSRF on every state-changing request that carries a session.
            if (!SAFE_METHODS.has(method) && sessionToken) {
                const presented = req.headers['x-csrf-token'] ?? '';
                const ok = presented.length > 0 && await options.verifyCsrf(sessionToken, presented);
                if (!ok) {
                    log.warn('csrf rejected', { path });
                    send(403, {
                        error: {
                            code: 'CSRF_TOKEN_INVALID',
                            message: 'Your session could not be verified. Reload the page and try again.',
                        },
                    });
                    return;
                }
            }
            // Permissions.
            if (route.permissions && route.permissions.length > 0) {
                const held = user?.permissions ?? new Set();
                const ok = route.permissions.some((p) => held.has(p));
                if (!ok) {
                    log.warn('permission denied', { path, required: route.permissions, roles: user?.roles });
                    send(403, {
                        error: {
                            code: 'PERMISSION_DENIED',
                            message: 'You do not have permission to perform this action.',
                        },
                    });
                    return;
                }
            }
            const ctx = {
                method: method,
                path,
                params,
                query: url.searchParams,
                body,
                headers: req.headers,
                cookies,
                requestId,
                correlationId,
                ipHash,
                userAgentHash,
                log: user ? log.child({ userId: user.userId, organizationId: user.organizationId }) : log,
                user,
                sessionToken,
                responseHeaders: {},
                setCookies: [],
            };
            const result = await route.handler(ctx);
            // Every successful envelope carries the environment banner, so a client cannot
            // render the product without it.
            const envelope = {
                data: result ?? null,
                meta: {
                    request_id: requestId,
                    environment: environment().mode,
                    banner: ENVIRONMENT_BANNER,
                    simulated: environment().settlementIsSimulated,
                },
            };
            send(route.successStatus ?? 200, envelope, ctx.responseHeaders, ctx.setCookies);
        }
        catch (error) {
            if (error instanceof AppError) {
                // Log the internal detail; never send it.
                log.warn('handled error', {
                    code: error.code, status: error.status, internalDetail: error.internalDetail,
                });
                send(error.status, { error: error.toResponse() });
                return;
            }
            const wrapped = error instanceof Error ? error : new Error(String(error));
            // Integrity-guard errors carry a stable code and a message that is safe to show.
            const guarded = wrapped;
            if (guarded.code && /^[A-Z_]+$/.test(guarded.code)) {
                log.warn('integrity guard', { code: guarded.code, message: wrapped.message });
                send(422, { error: { code: guarded.code, message: wrapped.message, details: {} } });
                return;
            }
            log.error('unhandled error', { message: wrapped.message, stack: wrapped.stack });
            const err = internal('INTERNAL_ERROR', wrapped.message);
            send(500, { error: err.toResponse() });
        }
    });
}
/** Reads and validates a JSON body field. Throws a 400 with a precise message. */
export function field(body, name, check, expectation, required = true) {
    const record = (body ?? {});
    const value = record[name];
    if (value === undefined || value === null) {
        if (required)
            throw invalid('FIELD_REQUIRED', `"${name}" is required (${expectation}).`, { field: name });
        return undefined;
    }
    if (!check(value)) {
        throw invalid('FIELD_INVALID', `"${name}" must be ${expectation}.`, { field: name });
    }
    return value;
}
export const isString = (v) => typeof v === 'string';
export const isNonEmptyString = (v) => typeof v === 'string' && v.trim().length > 0;
export const isBoolean = (v) => typeof v === 'boolean';
export const isObject = (v) => typeof v === 'object' && v !== null && !Array.isArray(v);
export const isArray = (v) => Array.isArray(v);
export const isUuid = (v) => typeof v === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
export const isDecimalString = (v) => typeof v === 'string' && /^-?\d+(\.\d{1,6})?$/.test(v);
export const isCurrency = (v) => typeof v === 'string' && /^[A-Z]{3}$/.test(v);
export const isIsoDate = (v) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v);
export const oneOf = (...values) => (v) => typeof v === 'string' && values.includes(v);
//# sourceMappingURL=router.js.map