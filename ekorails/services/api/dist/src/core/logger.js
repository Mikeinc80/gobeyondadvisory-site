/**
 * Structured logging.
 *
 * Every record is a single JSON line so that a log pipeline can index it without
 * regex parsing. Every payload passes through the redaction layer on the way out —
 * a logger that trusts its callers to have already redacted is a logger that will
 * one day print a bank account number.
 */
import { redact } from './redact.js';
const LEVEL_ORDER = { debug: 10, info: 20, warn: 30, error: 40 };
function configuredLevel() {
    const raw = (process.env['EKORAILS_LOG_LEVEL'] ?? 'info').toLowerCase();
    return ['debug', 'info', 'warn', 'error'].includes(raw)
        ? raw
        : 'info';
}
export class Logger {
    base;
    minLevel;
    constructor(base = {}) {
        this.base = base;
        this.minLevel = LEVEL_ORDER[configuredLevel()];
    }
    child(context) {
        return new Logger({ ...this.base, ...context });
    }
    emit(level, message, context) {
        if (LEVEL_ORDER[level] < this.minLevel)
            return;
        const record = {
            ts: new Date().toISOString(),
            level,
            msg: message,
            service: 'ekorails-api',
            env: process.env['EKORAILS_ENV_MODE'] ?? 'DEMO',
            ...redact({ ...this.base, ...context }),
        };
        const line = JSON.stringify(record);
        if (level === 'error' || level === 'warn')
            process.stderr.write(line + '\n');
        else
            process.stdout.write(line + '\n');
    }
    debug(message, context) { this.emit('debug', message, context); }
    info(message, context) { this.emit('info', message, context); }
    warn(message, context) { this.emit('warn', message, context); }
    error(message, context) { this.emit('error', message, context); }
}
export const logger = new Logger();
//# sourceMappingURL=logger.js.map