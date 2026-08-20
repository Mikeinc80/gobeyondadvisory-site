/**
 * Structured logging.
 *
 * Every record is a single JSON line so that a log pipeline can index it without
 * regex parsing. Every payload passes through the redaction layer on the way out —
 * a logger that trusts its callers to have already redacted is a logger that will
 * one day print a bank account number.
 */

import { redact } from './redact.js';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LEVEL_ORDER: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

export interface LogContext {
  requestId?: string;
  correlationId?: string;
  userId?: string;
  organizationId?: string;
  route?: string;
  [key: string]: unknown;
}

function configuredLevel(): LogLevel {
  const raw = (process.env['EKORAILS_LOG_LEVEL'] ?? 'info').toLowerCase();
  return (['debug', 'info', 'warn', 'error'] as const).includes(raw as LogLevel)
    ? (raw as LogLevel)
    : 'info';
}

export class Logger {
  private readonly base: LogContext;
  private readonly minLevel: number;

  constructor(base: LogContext = {}) {
    this.base = base;
    this.minLevel = LEVEL_ORDER[configuredLevel()];
  }

  child(context: LogContext): Logger {
    return new Logger({ ...this.base, ...context });
  }

  private emit(level: LogLevel, message: string, context?: LogContext): void {
    if (LEVEL_ORDER[level] < this.minLevel) return;
    const record = {
      ts: new Date().toISOString(),
      level,
      msg: message,
      service: 'ekorails-api',
      env: process.env['EKORAILS_ENV_MODE'] ?? 'DEMO',
      ...(redact({ ...this.base, ...context }) as Record<string, unknown>),
    };
    const line = JSON.stringify(record);
    if (level === 'error' || level === 'warn') process.stderr.write(line + '\n');
    else process.stdout.write(line + '\n');
  }

  debug(message: string, context?: LogContext): void { this.emit('debug', message, context); }
  info(message: string, context?: LogContext): void { this.emit('info', message, context); }
  warn(message: string, context?: LogContext): void { this.emit('warn', message, context); }
  error(message: string, context?: LogContext): void { this.emit('error', message, context); }
}

export const logger = new Logger();
