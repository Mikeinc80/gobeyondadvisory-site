/**
 * Background worker.
 *
 * Handles the scheduled work a settlement platform needs between requests: expiring
 * stale quotes, delivering queued notifications, flagging documents approaching expiry,
 * ageing service-level breaches, and running the daily reconciliation.
 *
 * The queue is a database table rather than an external broker. That is a deliberate
 * trade for the MVP — one fewer moving part, and job state is transactional with the work
 * it describes — and its limitation is stated plainly: this is a single-process worker,
 * and a multi-instance deployment needs a distributed lock. That is a named item in the
 * pilot readiness report, not a hidden assumption.
 */

import { withContext, one, many } from '../db/pool.js';
import { logger } from '../core/logger.js';
import { expireStaleQuotes } from '../modules/fx/quotes.js';
import { deliverQueued, queueNotification } from '../modules/notification/notify.js';
import { runDailyReconciliation } from '../modules/recon/reconcile.js';
import { recordAudit } from '../audit/audit.js';

const TICK_MS = Number(process.env['EKORAILS_WORKER_TICK_MS'] ?? 30_000);

export interface WorkerHandle {
  stop: () => void;
  /** Runs one full cycle immediately. Used by tests. */
  tick: () => Promise<Record<string, unknown>>;
}

async function expireQuotes(): Promise<number> {
  return withContext({ scope: 'system' }, async (db) => {
    const expired = await expireStaleQuotes(db);
    if (expired > 0) {
      // Transactions sitting on a now-expired quote move to `expired` too, so the state
      // machine and the quote table cannot disagree about whether a price still stands.
      const stranded = await many<{ id: string; reference: string; organization_id: string }>(
        db,
        `SELECT t.id, t.reference, t.organization_id
           FROM transaction t JOIN fx_quote q ON q.id = t.fx_quote_id
          WHERE t.state = 'quote_issued' AND q.status = 'expired'`,
      );
      const { transition } = await import('../modules/settlement/machine.js');
      for (const txn of stranded) {
        await transition(db, {
          transactionId: txn.id, event: 'quote_expire', actorType: 'job',
          reason: 'The quote validity window elapsed without acceptance. A stale rate is not a price.',
        });
        await queueNotification(db, {
          organizationId: txn.organization_id, recipientRole: 'business_initiator',
          channel: 'in_app', eventType: 'quote_expiring',
          subject: `${txn.reference}: quote expired`,
          body: `The quote for ${txn.reference} expired before it was accepted. Request a new one.`,
          actionUrl: `/transactions/${txn.id}`, transactionId: txn.id,
        });
      }
    }
    return expired;
  });
}

async function warnExpiringQuotes(): Promise<number> {
  return withContext({ scope: 'system' }, async (db) => {
    const soon = await many<{ id: string; reference: string; organization_id: string; accepted_by: string | null }>(
      db,
      `SELECT q.id, q.reference, q.organization_id, q.issued_by AS accepted_by
         FROM fx_quote q
        WHERE q.status = 'issued'
          AND q.expires_at BETWEEN now() AND now() + interval '3 minutes'
          AND NOT EXISTS (
            SELECT 1 FROM notification n
             WHERE n.event_type = 'quote_expiring' AND n.subject LIKE '%' || q.reference || '%')`,
    );
    for (const quote of soon) {
      await queueNotification(db, {
        organizationId: quote.organization_id, recipientRole: 'business_approver',
        channel: 'in_app', eventType: 'quote_expiring',
        subject: `Quote ${quote.reference} expires shortly`,
        body: `Quote ${quote.reference} is about to expire. Sign in to accept it or request a new one.`,
        actionUrl: '/transactions',
      });
    }
    return soon.length;
  });
}

async function flagExpiringDocuments(): Promise<number> {
  return withContext({ scope: 'system' }, async (db) => {
    const docs = await many<{ id: string; organization_id: string; document_type: string; expires_on: Date }>(
      db,
      `SELECT id, organization_id, document_type, expires_on
         FROM document
        WHERE is_current AND expires_on IS NOT NULL
          AND expires_on <= CURRENT_DATE + interval '30 days'
          AND expiry_notified_at IS NULL`,
    );
    for (const doc of docs) {
      await queueNotification(db, {
        organizationId: doc.organization_id, recipientRole: 'compliance_analyst',
        channel: 'in_app', eventType: 'additional_information_required',
        subject: `Document expiring: ${doc.document_type.replace(/_/g, ' ')}`,
        body: `A document expires on ${doc.expires_on.toISOString().slice(0, 10)} and needs refreshing.`,
        actionUrl: '/compliance/documents',
      });
      await db.query('UPDATE document SET expiry_notified_at = now() WHERE id = $1', [doc.id]);
    }
    return docs.length;
  });
}

async function markPeriodicReviews(): Promise<number> {
  return withContext({ scope: 'system' }, async (db) => {
    // An approved customer whose KYB is older than the review cycle moves to
    // "periodic review due". The cycle length is a configuration value; where it is a
    // placeholder we use a conservative twelve months and say so.
    const { rowCount } = await db.query(
      `UPDATE organization o
          SET onboarding_status = 'periodic_review_due'
        WHERE o.onboarding_status = 'approved'
          AND EXISTS (
            SELECT 1 FROM organization_profile p
             WHERE p.organization_id = o.id AND p.is_current
               AND p.submitted_at < now() - interval '12 months')`,
    );
    return rowCount ?? 0;
  });
}

async function ageServiceLevels(): Promise<{ complianceBreaches: number; exceptionBreaches: number }> {
  return withContext({ scope: 'system' }, async (db) => {
    const compliance = await one<{ n: string }>(
      db,
      `SELECT count(*)::text AS n FROM compliance_case
        WHERE sla_due_at < now() AND status NOT LIKE 'closed%'`,
    );
    const exceptionCases = await one<{ n: string }>(
      db,
      `SELECT count(*)::text AS n FROM exception_case
        WHERE sla_due_at < now() AND status NOT IN ('resolved','written_off','closed_no_action')`,
    );
    return {
      complianceBreaches: Number(compliance.n),
      exceptionBreaches: Number(exceptionCases.n),
    };
  });
}

async function pruneExpiredState(): Promise<number> {
  return withContext({ scope: 'system' }, async (db) => {
    const idem = await db.query('DELETE FROM inbound_idempotency WHERE expires_at < now()');
    const sessions = await db.query(
      "DELETE FROM user_session WHERE absolute_expiry < now() - interval '7 days'",
    );
    return (idem.rowCount ?? 0) + (sessions.rowCount ?? 0);
  });
}

export async function runDailyReconciliationJob(): Promise<Record<string, unknown>> {
  return withContext({ scope: 'system' }, async (db) => {
    const result = await runDailyReconciliation(db, new Date(), null);
    if (!result.allClean) {
      await queueNotification(db, {
        recipientRole: 'finance_analyst', channel: 'in_app',
        eventType: 'reconciliation_exception',
        subject: `Daily reconciliation found ${result.totalBreaks} break(s)`,
        body: `The reconciliation run for ${result.businessDate} opened ${result.totalBreaks} break(s). Sign in to investigate.`,
        actionUrl: '/finance/reconciliation',
      });
    }
    await recordAudit(db, {
      category: 'data_create', action: 'job.daily_reconciliation', outcome: 'success',
      actorType: 'job',
      metadata: {
        business_date: result.businessDate, runs: result.runs.length,
        total_breaks: result.totalBreaks, all_clean: result.allClean,
      },
    });
    return result as unknown as Record<string, unknown>;
  });
}

export function startWorker(): WorkerHandle {
  let running = false;
  let stopped = false;

  const tick = async (): Promise<Record<string, unknown>> => {
    if (running) return { skipped: 'already_running' };
    running = true;
    const started = Date.now();
    const result: Record<string, unknown> = {};
    try {
      result['quotes_expired'] = await expireQuotes();
      result['quote_expiry_warnings'] = await warnExpiringQuotes();
      result['documents_flagged'] = await flagExpiringDocuments();
      result['periodic_reviews_due'] = await markPeriodicReviews();
      result['notifications'] = await withContext({ scope: 'system' }, (db) => deliverQueued(db));
      result['sla'] = await ageServiceLevels();
      result['pruned'] = await pruneExpiredState();
      result['duration_ms'] = Date.now() - started;

      const interesting = Object.entries(result).some(
        ([k, v]) => k !== 'duration_ms' && typeof v === 'number' && v > 0,
      );
      if (interesting) logger.info('worker tick', result);
    } catch (error) {
      logger.error('worker tick failed', {
        error: error instanceof Error ? error.message : String(error),
      });
      result['error'] = true;
    } finally {
      running = false;
    }
    return result;
  };

  const timer = setInterval(() => {
    if (!stopped) void tick();
  }, TICK_MS);
  timer.unref();

  return {
    stop: () => { stopped = true; clearInterval(timer); },
    tick,
  };
}
