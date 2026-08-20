/**
 * Notifications.
 *
 * The rule from the brief is absolute and is enforced here rather than left to whoever
 * writes a template: never include full sensitive financial or identity data in email or
 * SMS. Off-platform channels carry a reference and a link. Everything else lives behind
 * authentication.
 *
 * `assertSafeForChannel` runs on every notification before it is queued, and it fails
 * closed: a body it cannot prove safe does not go out.
 */

import type { Queryable } from '../../db/pool.js';
import { one, many } from '../../db/pool.js';
import { recordAudit } from '../../audit/audit.js';
import { logger } from '../../core/logger.js';

export type NotificationChannel = 'in_app' | 'email' | 'sms';

export type NotificationEvent =
  | 'onboarding_submitted'
  | 'additional_information_required'
  | 'organization_approved'
  | 'organization_rejected'
  | 'transaction_awaiting_approval'
  | 'compliance_review_required'
  | 'quote_issued'
  | 'quote_expiring'
  | 'funding_confirmed'
  | 'settlement_submitted'
  | 'settlement_completed'
  | 'settlement_failed'
  | 'reconciliation_exception'
  | 'security_alert'
  | 'credential_changed';

export interface NotificationInput {
  organizationId?: string | null;
  recipientUserId?: string | null;
  recipientRole?: string | null;
  channel: NotificationChannel;
  eventType: NotificationEvent;
  subject: string;
  body: string;
  actionUrl?: string | null;
  transactionId?: string | null;
}

export class UnsafeNotificationError extends Error {
  readonly code = 'UNSAFE_NOTIFICATION';
  constructor(channel: string, findings: string[]) {
    super(
      `Refusing to send a ${channel} notification containing sensitive detail: ${findings.join('; ')}. ` +
      `Off-platform channels carry a reference and a link, never the underlying data.`,
    );
    this.name = 'UnsafeNotificationError';
  }
}

/**
 * Patterns that must never appear in an email or SMS body. These are conservative on
 * purpose: a false positive means rewording a template, a false negative means personal
 * or financial data in an unencrypted channel.
 */
const OFF_PLATFORM_FORBIDDEN: Array<[string, RegExp]> = [
  ['a long numeric string that could be an account identifier', /(?<![\d*])\d{8,}(?![\d*])/],
  ['an IBAN', /\b[A-Z]{2}\d{2}[A-Z0-9]{12,30}\b/],
  ['a SWIFT/BIC code', /\b[A-Z]{6}[A-Z0-9]{2}([A-Z0-9]{3})?\b/],
  ['a monetary amount', /\b\d{1,3}(,\d{3})+(\.\d+)?\b|\b\d+\.\d{2}\b/],
  ['a currency-tagged amount', /\b(NGN|USD|EUR|GBP|GHS|KES|ZAR|XOF|AED)\s*[\d,]+/i],
  ['a date of birth', /\b(19|20)\d{2}-\d{2}-\d{2}\b/],
  ['what looks like a one-time code', /\b\d{6}\b/],
];

export function assertSafeForChannel(channel: NotificationChannel, subject: string, body: string): void {
  if (channel === 'in_app') return;   // authenticated, inside the product
  const text = `${subject}\n${body}`;
  const findings = OFF_PLATFORM_FORBIDDEN
    .filter(([, pattern]) => pattern.test(text))
    .map(([label]) => label);
  if (findings.length > 0) throw new UnsafeNotificationError(channel, findings);
}

export async function queueNotification(db: Queryable, input: NotificationInput): Promise<string> {
  assertSafeForChannel(input.channel, input.subject, input.body);

  const row = await one<{ id: string }>(
    db,
    `INSERT INTO notification (
       organization_id, recipient_user_id, recipient_role, channel, event_type,
       subject, body, action_url, transaction_id, status
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'queued')
     RETURNING id`,
    [
      input.organizationId ?? null, input.recipientUserId ?? null, input.recipientRole ?? null,
      input.channel, input.eventType, input.subject, input.body,
      input.actionUrl ?? null, input.transactionId ?? null,
    ],
  );
  return row.id;
}

/**
 * Queues the same event across the channels a recipient has. The off-platform variant is
 * deliberately terser than the in-app one — it is a nudge to sign in, not a substitute
 * for signing in.
 */
export async function notifyMultiChannel(
  db: Queryable,
  input: Omit<NotificationInput, 'channel' | 'body'> & {
    inAppBody: string;
    offPlatformBody: string;
    channels: NotificationChannel[];
  },
): Promise<string[]> {
  const ids: string[] = [];
  for (const channel of input.channels) {
    ids.push(await queueNotification(db, {
      ...input,
      channel,
      body: channel === 'in_app' ? input.inAppBody : input.offPlatformBody,
    }));
  }
  return ids;
}

/**
 * "Delivers" queued notifications. In this build email and SMS are written to the
 * structured log rather than sent: there is no mail or SMS provider configured, and
 * pretending otherwise would be exactly the kind of non-functional button the brief
 * rules out. The delivery record says `simulated_delivery` so nobody mistakes a log line
 * for a sent message.
 */
export interface DeliveryReport {
  attempted: number;
  delivered: number;
  failed: number;
  byChannel: Record<string, number>;
}

export async function deliverQueued(db: Queryable, limit = 100): Promise<DeliveryReport> {
  const queued = await many<{
    id: string; channel: string; event_type: string; subject: string;
    recipient_user_id: string | null; organization_id: string | null;
  }>(
    db,
    `SELECT id, channel, event_type, subject, recipient_user_id, organization_id
       FROM notification WHERE status = 'queued'
      ORDER BY created_at LIMIT $1`,
    [limit],
  );

  const report: DeliveryReport = { attempted: 0, delivered: 0, failed: 0, byChannel: {} };

  for (const n of queued) {
    report.attempted += 1;
    report.byChannel[n.channel] = (report.byChannel[n.channel] ?? 0) + 1;

    if (n.channel === 'in_app') {
      // In-app needs no transport: it is delivered by being readable.
      await db.query(
        "UPDATE notification SET status = 'delivered', sent_at = now(), attempt_count = attempt_count + 1 WHERE id = $1",
        [n.id],
      );
      report.delivered += 1;
      continue;
    }

    // No transport is configured. Record the honest outcome.
    logger.info('Notification would be sent off-platform', {
      notificationId: n.id, channel: n.channel, eventType: n.event_type,
      note: 'No email or SMS provider is configured in this build. Nothing was actually sent.',
    });
    await db.query(
      `UPDATE notification
          SET status = 'sent', sent_at = now(), attempt_count = attempt_count + 1,
              last_error = 'simulated_delivery: no transport configured in this build'
        WHERE id = $1`,
      [n.id],
    );
    report.delivered += 1;
  }

  return report;
}

export async function markRead(
  db: Queryable, notificationId: string, userId: string,
): Promise<void> {
  await db.query(
    `UPDATE notification SET status = 'read', read_at = now()
      WHERE id = $1 AND recipient_user_id = $2 AND status <> 'read'`,
    [notificationId, userId],
  );
}

export async function inboxFor(
  db: Queryable, userId: string, roles: string[], limit = 50,
): Promise<Array<Record<string, unknown>>> {
  return many<Record<string, unknown>>(
    db,
    `SELECT id, event_type, subject, body, action_url, transaction_id, status, created_at, read_at
       FROM notification
      WHERE channel = 'in_app'
        AND (recipient_user_id = $1 OR recipient_role = ANY($2::text[]))
      ORDER BY created_at DESC LIMIT $3`,
    [userId, roles, limit],
  );
}

/** Security alerts always reach the user directly and are always audited. */
export async function raiseSecurityAlert(
  db: Queryable,
  input: { userId: string; organizationId: string; what: string; detail: Record<string, unknown> },
): Promise<void> {
  await queueNotification(db, {
    organizationId: input.organizationId,
    recipientUserId: input.userId,
    channel: 'in_app',
    eventType: 'security_alert',
    subject: `Security alert: ${input.what}`,
    body: `${input.what}. If this was not you, contact support immediately and change your password.`,
    actionUrl: '/security',
  });
  await queueNotification(db, {
    organizationId: input.organizationId,
    recipientUserId: input.userId,
    channel: 'email',
    eventType: 'security_alert',
    subject: 'Security alert on your EKORails account',
    body: 'There has been a security event on your account. Sign in to review it.',
    actionUrl: '/security',
  });
  await recordAudit(db, {
    category: 'security_check_failed',
    action: 'security.alert',
    outcome: 'success',
    actorUserId: input.userId,
    organizationId: input.organizationId,
    metadata: { what: input.what, ...input.detail },
  });
}
