/**
 * Reporting.
 *
 * Every report is a declared definition: a key, a family, the permission needed to read
 * it, the filters it accepts, and a query. Declaring them as data means the report
 * catalogue, the OpenAPI document and the role matrix all stay consistent with what the
 * code actually does.
 *
 * Masking: the same report returns different content depending on the caller's masking
 * profile. An auditor or regulator sees organisation codes and aggregate figures, not
 * names, contact details or account fragments, unless they hold the specific unmask
 * permission — and every export is recorded with the profile that produced it.
 */

import type { Queryable } from '../../db/pool.js';
import { many, one } from '../../db/pool.js';
import { sha256Hex } from '../../core/crypto.js';
import { recordAudit } from '../../audit/audit.js';
import { maskTail } from '../../core/redact.js';
import type { MaskingProfile } from '../../auth/rbac.js';
import { environment, ENVIRONMENT_BANNER } from '../../core/env.js';
import { TRANSITIONS } from '../settlement/machine.js';

export interface ReportFilters {
  from?: string | null;
  to?: string | null;
  organizationId?: string | null;
  corridor?: string | null;
  currency?: string | null;
}

export interface ReportDefinition {
  key: string;
  title: string;
  family: 'operational' | 'compliance' | 'pilot' | 'financial' | 'audit' | 'regulatory';
  description: string;
  permission: string;
  filters: string[];
  /** Columns whose values are masked for restricted profiles. */
  maskedColumns?: string[];
  run: (db: Queryable, filters: ReportFilters) => Promise<{
    columns: string[];
    rows: Array<Record<string, unknown>>;
    summary?: Record<string, unknown>;
  }>;
}

const dateWindow = (f: ReportFilters): [string | null, string | null] => [f.from ?? null, f.to ?? null];

export const REPORT_DEFINITIONS: ReportDefinition[] = [
  // -------------------------------------------------------------------------
  // Customer
  //
  // These carry `report.own.read`, which is the only reporting permission the business
  // roles hold. Without them that permission would grant access to nothing, and the
  // Reports screen would be empty for every customer — which is how it was found.
  //
  // No organisation filter is honoured here even though the query accepts one: the route
  // overrides organizationId with the caller's own for any org-scoped user, so a customer
  // cannot widen the scope by asking.
  // -------------------------------------------------------------------------
  {
    key: 'my-transactions',
    title: 'Your transactions',
    family: 'operational',
    description: 'Every payment your organisation has initiated, with its charges and final state.',
    permission: 'report.own.read',
    filters: ['from', 'to'],
    run: async (db, f) => {
      const [from, to] = dateWindow(f);
      const rows = await many<Record<string, unknown>>(
        db,
        `SELECT t.reference, t.created_at, t.completed_at, t.state, t.purpose, t.invoice_number,
                b.legal_name AS beneficiary_name, b.country AS beneficiary_country,
                c.code AS corridor, t.send_currency, t.send_amount::text,
                t.receive_currency, t.expected_receive_amount::text AS expected_receive_amount,
                t.actual_receive_amount::text AS actual_receive_amount,
                q.provider_rate::text AS rate,
                (q.ekorails_fee + q.partner_fee + q.tax_or_levy)::text AS total_charges,
                q.is_simulated AS rate_simulated
           FROM transaction t
           JOIN beneficiary b ON b.id = t.beneficiary_id
           JOIN corridor c ON c.id = t.corridor_id
           LEFT JOIN fx_quote q ON q.id = t.fx_quote_id
          WHERE ($1::timestamptz IS NULL OR t.created_at >= $1)
            AND ($2::timestamptz IS NULL OR t.created_at < $2)
            AND ($3::uuid IS NULL OR t.organization_id = $3)
          ORDER BY t.created_at DESC LIMIT 5000`,
        [from, to, f.organizationId ?? null],
      );
      return {
        columns: [
          'reference', 'created_at', 'completed_at', 'state', 'beneficiary_name',
          'beneficiary_country', 'corridor', 'send_currency', 'send_amount', 'receive_currency',
          'expected_receive_amount', 'actual_receive_amount', 'rate', 'total_charges',
          'rate_simulated', 'purpose', 'invoice_number',
        ],
        rows,
        summary: {
          transactions: rows.length,
          note:
            'Every payment listed here was settled through a simulator and no real funds moved. ' +
            'Rates shown are simulated and were indicative until accepted.',
        },
      };
    },
  },
  {
    key: 'my-charges',
    title: 'Your charges',
    family: 'operational',
    description: 'What each payment cost you, broken into its parts.',
    permission: 'report.own.read',
    filters: ['from', 'to'],
    run: async (db, f) => {
      const [from, to] = dateWindow(f);
      const rows = await many<Record<string, unknown>>(
        db,
        `SELECT t.reference, t.created_at, t.send_currency, t.send_amount::text,
                q.provider_rate::text AS rate_applied,
                q.ekorails_fee::text AS ekorails_fee,
                q.partner_fee::text AS partner_fee,
                q.tax_or_levy::text AS tax_or_levy,
                (q.ekorails_fee + q.partner_fee + q.tax_or_levy)::text AS total_charges,
                q.is_simulated AS rate_simulated, t.state
           FROM transaction t
           JOIN fx_quote q ON q.id = t.fx_quote_id
          WHERE ($1::timestamptz IS NULL OR t.created_at >= $1)
            AND ($2::timestamptz IS NULL OR t.created_at < $2)
            AND ($3::uuid IS NULL OR t.organization_id = $3)
          ORDER BY t.created_at DESC LIMIT 5000`,
        [from, to, f.organizationId ?? null],
      );
      return {
        columns: [
          'reference', 'created_at', 'send_currency', 'send_amount', 'rate_applied',
          'ekorails_fee', 'partner_fee', 'tax_or_levy', 'total_charges', 'rate_simulated', 'state',
        ],
        rows,
        summary: {
          payments_with_a_quote: rows.length,
          note:
            'Charges are shown in full and separately: what EKORails charged, what the partner ' +
            'charged, and any levy. A payment appears here only once a quote has been issued for it.',
        },
      };
    },
  },

  // -------------------------------------------------------------------------
  // Operational
  // -------------------------------------------------------------------------
  {
    key: 'operational-summary',
    title: 'Operational summary',
    family: 'operational',
    description:
      'Transaction counts and values, success and failure rates, average processing and settlement ' +
      'times, and the size of each pending queue.',
    permission: 'report.operational.read',
    filters: ['from', 'to', 'organization_id', 'currency'],
    run: async (db, f) => {
      const [from, to] = dateWindow(f);
      const rows = await many<Record<string, unknown>>(
        db,
        `WITH scoped AS (
           SELECT t.*, c.code AS corridor_code
             FROM transaction t JOIN corridor c ON c.id = t.corridor_id
            WHERE ($1::timestamptz IS NULL OR t.created_at >= $1)
              AND ($2::timestamptz IS NULL OR t.created_at < $2)
              AND ($3::uuid IS NULL OR t.organization_id = $3)
              AND ($4::text IS NULL OR t.send_currency = $4)
         )
         SELECT send_currency AS currency,
                count(*)::text AS transaction_count,
                sum(send_amount)::text AS total_value,
                count(*) FILTER (WHERE state = 'completed')::text AS completed,
                count(*) FILTER (WHERE state IN ('failed','rejected','returned'))::text AS failed,
                count(*) FILTER (WHERE state NOT IN ('completed','failed','rejected','cancelled','expired','returned'))::text AS in_flight,
                round(100.0 * count(*) FILTER (WHERE state = 'completed') / NULLIF(count(*),0), 2)::text AS success_rate_percent,
                round(100.0 * count(*) FILTER (WHERE state IN ('failed','rejected','returned')) / NULLIF(count(*),0), 2)::text AS failure_rate_percent,
                round(avg(EXTRACT(EPOCH FROM (completed_at - created_at)) / 60.0) FILTER (WHERE completed_at IS NOT NULL), 1)::text AS avg_processing_minutes
           FROM scoped GROUP BY send_currency ORDER BY send_currency`,
        [from, to, f.organizationId ?? null, f.currency ?? null],
      );

      const queues = await one<Record<string, string>>(
        db,
        `SELECT
           (SELECT count(*)::text FROM transaction WHERE state = 'pending_business_approval') AS pending_business_approval,
           (SELECT count(*)::text FROM transaction WHERE state = 'pending_compliance') AS pending_compliance,
           (SELECT count(*)::text FROM transaction WHERE state = 'awaiting_funding') AS awaiting_funding,
           (SELECT count(*)::text FROM transaction WHERE state = 'ready_for_settlement') AS settlement_queue,
           (SELECT count(*)::text FROM transaction WHERE state = 'under_investigation') AS under_investigation,
           (SELECT count(*)::text FROM compliance_case WHERE status NOT LIKE 'closed%') AS open_compliance_cases,
           (SELECT count(*)::text FROM exception_case
             WHERE status NOT IN ('resolved','written_off','closed_no_action')) AS open_breaks`,
      );

      const settlementTime = await one<{ avg_minutes: string | null }>(
        db,
        `SELECT round(avg(EXTRACT(EPOCH FROM (settled.occurred_at - submitted.occurred_at)) / 60.0), 2)::text AS avg_minutes
           FROM transaction_transition submitted
           JOIN transaction_transition settled
             ON settled.transaction_id = submitted.transaction_id AND settled.to_state = 'settled'
          WHERE submitted.to_state = 'submitted_to_partner'`,
      );

      return {
        columns: [
          'currency', 'transaction_count', 'total_value', 'completed', 'failed', 'in_flight',
          'success_rate_percent', 'failure_rate_percent', 'avg_processing_minutes',
        ],
        rows,
        summary: {
          ...queues,
          average_settlement_minutes: settlementTime.avg_minutes,
          note: 'All values are SIMULATED. No real funds correspond to them.',
        },
      };
    },
  },
  {
    key: 'partner-performance',
    title: 'Partner performance',
    family: 'operational',
    description: 'Call volumes, failure rates and latency per partner, with the simulated scenarios that produced them.',
    permission: 'report.operational.read',
    filters: ['from', 'to'],
    run: async (db, f) => {
      const [from, to] = dateWindow(f);
      const rows = await many<Record<string, unknown>>(
        db,
        `SELECT p.code AS partner_code, p.display_name AS partner_name, p.partner_role,
                p.is_simulated, p.status,
                count(ie.id)::text AS calls,
                count(ie.id) FILTER (WHERE ie.outcome = 'success')::text AS successes,
                count(ie.id) FILTER (WHERE ie.outcome NOT IN ('success','duplicate_ignored'))::text AS failures,
                count(ie.id) FILTER (WHERE ie.outcome = 'timeout')::text AS timeouts,
                count(ie.id) FILTER (WHERE ie.outcome = 'duplicate_ignored')::text AS duplicates_blocked,
                round(avg(ie.latency_ms))::text AS avg_latency_ms,
                round(100.0 * count(ie.id) FILTER (WHERE ie.outcome = 'success')
                      / NULLIF(count(ie.id), 0), 2)::text AS success_rate_percent
           FROM partner p
           LEFT JOIN integration_event ie ON ie.partner_id = p.id
            AND ($1::timestamptz IS NULL OR ie.occurred_at >= $1)
            AND ($2::timestamptz IS NULL OR ie.occurred_at < $2)
          GROUP BY p.id ORDER BY p.partner_role, p.code`,
        [from, to],
      );
      return {
        columns: [
          'partner_code', 'partner_name', 'partner_role', 'is_simulated', 'status', 'calls',
          'successes', 'failures', 'timeouts', 'duplicates_blocked', 'avg_latency_ms',
          'success_rate_percent',
        ],
        rows,
        summary: {
          note:
            'Every partner in this build is a simulator. Latency and failure figures reflect the ' +
            'simulator, not a real institution, and must not be presented as partner service levels.',
        },
      };
    },
  },

  // -------------------------------------------------------------------------
  // Compliance
  // -------------------------------------------------------------------------
  {
    key: 'compliance-summary',
    title: 'Compliance summary',
    family: 'compliance',
    description:
      'Customers by risk rating, pending KYB cases, screening alerts, high-risk and rejected ' +
      'transactions, suspended accounts, EDD cases and analyst decision times.',
    permission: 'report.compliance.read',
    filters: ['from', 'to'],
    maskedColumns: ['organization_name'],
    run: async (db, f) => {
      const [from, to] = dateWindow(f);
      const rows = await many<Record<string, unknown>>(
        db,
        `SELECT o.display_code AS organization_code, o.legal_name AS organization_name,
                o.onboarding_status, COALESCE(o.risk_rating, 'not_assessed') AS risk_rating,
                (o.suspended_at IS NOT NULL) AS suspended,
                (SELECT count(*)::text FROM compliance_case c
                  WHERE c.organization_id = o.id AND c.status NOT LIKE 'closed%') AS open_cases,
                (SELECT count(*)::text FROM compliance_case c
                  WHERE c.organization_id = o.id AND c.case_type = 'enhanced_due_diligence') AS edd_cases,
                (SELECT count(*)::text FROM screening_case s
                  WHERE s.organization_id = o.id
                    AND s.status IN ('potential_match','confirmed_match')) AS screening_alerts,
                (SELECT count(*)::text FROM transaction t
                  WHERE t.organization_id = o.id AND t.risk_rating IN ('high','prohibited')) AS high_risk_transactions,
                (SELECT count(*)::text FROM transaction t
                  WHERE t.organization_id = o.id AND t.state = 'rejected') AS rejected_transactions
           FROM organization o
          WHERE o.kind = 'customer'
            AND ($1::timestamptz IS NULL OR o.created_at >= $1)
            AND ($2::timestamptz IS NULL OR o.created_at < $2)
          ORDER BY
            CASE COALESCE(o.risk_rating,'not_assessed')
              WHEN 'prohibited' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END,
            o.display_code`,
        [from, to],
      );

      const decisions = await one<Record<string, string | null>>(
        db,
        `SELECT
           count(*)::text AS total_decisions,
           round(avg(EXTRACT(EPOCH FROM (c.closed_at - c.opened_at)) / 3600.0), 2)::text AS avg_decision_hours,
           count(*) FILTER (WHERE c.closed_at > c.sla_due_at)::text AS sla_breaches,
           (SELECT count(*)::text FROM compliance_decision
             WHERE decision IN ('cleared_false_positive')) AS false_positives_cleared,
           (SELECT count(*)::text FROM compliance_decision d
             JOIN compliance_case cc ON cc.id = d.compliance_case_id
            WHERE cc.requires_manager AND d.decision = 'approved') AS manager_overrides
         FROM compliance_case c WHERE c.closed_at IS NOT NULL`,
      );

      const ruleTriggers = await many<{ rule_key: string; triggered: string; total: string }>(
        db,
        `SELECT rule_key,
                count(*) FILTER (WHERE triggered)::text AS triggered,
                count(*)::text AS total
           FROM rule_evaluation GROUP BY rule_key ORDER BY count(*) FILTER (WHERE triggered) DESC`,
      );

      return {
        columns: [
          'organization_code', 'organization_name', 'onboarding_status', 'risk_rating', 'suspended',
          'open_cases', 'edd_cases', 'screening_alerts', 'high_risk_transactions', 'rejected_transactions',
        ],
        rows,
        summary: { decision_times: decisions, rule_triggers: ruleTriggers },
      };
    },
  },
  {
    key: 'compliance-decisions',
    title: 'Compliance decision audit',
    family: 'compliance',
    description: 'Every compliance decision with its reason, decider and the assessment it rested on.',
    permission: 'report.compliance.read',
    filters: ['from', 'to', 'organization_id'],
    maskedColumns: ['decided_by_name'],
    run: async (db, f) => {
      const [from, to] = dateWindow(f);
      const rows = await many<Record<string, unknown>>(
        db,
        `SELECT c.reference AS case_reference, c.case_type, d.decision, d.reason,
                d.decided_by_role, u.display_name AS decided_by_name, d.decided_at,
                o.display_code AS organization_code,
                r.outcome AS risk_outcome, r.recommended_action, r.score::text AS risk_score,
                t.reference AS transaction_reference
           FROM compliance_decision d
           JOIN compliance_case c ON c.id = d.compliance_case_id
           JOIN organization o ON o.id = d.organization_id
           LEFT JOIN app_user u ON u.id = d.decided_by
           LEFT JOIN risk_assessment r ON r.id = d.risk_assessment_id
           LEFT JOIN transaction t ON t.id = c.subject_id AND c.subject_type = 'transaction'
          WHERE ($1::timestamptz IS NULL OR d.decided_at >= $1)
            AND ($2::timestamptz IS NULL OR d.decided_at < $2)
            AND ($3::uuid IS NULL OR d.organization_id = $3)
          ORDER BY d.decided_at DESC LIMIT 5000`,
        [from, to, f.organizationId ?? null],
      );
      return {
        columns: [
          'case_reference', 'case_type', 'decision', 'reason', 'decided_by_role', 'decided_by_name',
          'decided_at', 'organization_code', 'risk_outcome', 'recommended_action', 'risk_score',
          'transaction_reference',
        ],
        rows,
        summary: {
          note:
            'Compliance decisions are append-only. The application database role holds no UPDATE or ' +
            'DELETE privilege on this table.',
        },
      };
    },
  },

  // -------------------------------------------------------------------------
  // Financial
  // -------------------------------------------------------------------------
  {
    key: 'trial-balance',
    title: 'Trial balance',
    family: 'financial',
    description: 'Ledger balances by account and currency, derived from immutable journal entries.',
    permission: 'report.financial.read',
    filters: ['currency'],
    run: async (db, f) => {
      const rows = await many<Record<string, unknown>>(
        db,
        `SELECT code AS account_code, name AS account_name, category, account_type, normal_side,
                currency, total_debits::text, total_credits::text,
                balance_natural::text AS balance, entry_count::text, is_simulated
           FROM ledger_account_balance
          WHERE ($1::text IS NULL OR currency = $1)
          ORDER BY currency, category, code`,
        [f.currency ?? null],
      );
      const totals = await many<Record<string, unknown>>(
        db,
        'SELECT currency, total_debits::text, total_credits::text, difference::text FROM trial_balance ORDER BY currency',
      );
      return {
        columns: [
          'account_code', 'account_name', 'category', 'account_type', 'normal_side', 'currency',
          'total_debits', 'total_credits', 'balance', 'entry_count', 'is_simulated',
        ],
        rows,
        summary: {
          totals_by_currency: totals,
          balanced: totals.every((t) => Number(t['difference']) === 0),
          note: 'ALL BALANCES ARE SIMULATED. No real funds correspond to any figure in this report.',
        },
      };
    },
  },
  {
    key: 'financial-summary',
    title: 'Financial summary',
    family: 'financial',
    description:
      'Simulated settlement values, fee revenue, partner costs, currency positions, suspense ' +
      'balances and reconciliation differences.',
    permission: 'report.financial.read',
    filters: ['from', 'to', 'currency'],
    run: async (db, f) => {
      const rows = await many<Record<string, unknown>>(
        db,
        `SELECT currency,
                sum(balance_natural) FILTER (WHERE category = 'fee_revenue')::text AS fee_revenue,
                sum(balance_natural) FILTER (WHERE category = 'partner_fees_payable')::text AS partner_fees_payable,
                sum(balance_natural) FILTER (WHERE category = 'regulatory_charges_payable')::text AS regulatory_charges_payable,
                sum(balance_natural) FILTER (WHERE category = 'fx_clearing')::text AS fx_clearing_position,
                sum(balance_natural) FILTER (WHERE category = 'settlement_suspense')::text AS settlement_suspense,
                sum(balance_natural) FILTER (WHERE category = 'reconciliation_difference')::text AS reconciliation_difference,
                sum(balance_natural) FILTER (WHERE category = 'returned_funds')::text AS returned_funds,
                sum(balance_natural) FILTER (WHERE category = 'customer_settlement_payable')::text AS customer_settlement_payable,
                sum(balance_natural) FILTER (WHERE category = 'partner_settlement_account')::text AS partner_settlement_balance,
                sum(balance_natural) FILTER (WHERE category = 'test_liquidity')::text AS test_liquidity_injected
           FROM ledger_account_balance
          WHERE ($1::text IS NULL OR currency = $1)
          GROUP BY currency ORDER BY currency`,
        [f.currency ?? null],
      );
      const settled = await many<Record<string, unknown>>(
        db,
        `SELECT e.currency, sum(e.amount)::text AS settled_value, count(DISTINCT j.transaction_id)::text AS settled_count
           FROM journal j JOIN journal_entry e ON e.journal_id = j.id
          WHERE j.journal_type = 'settlement_payment' AND j.posting_status = 'posted'
            AND e.direction = 'debit'
            AND ($1::timestamptz IS NULL OR j.posted_at >= $1)
            AND ($2::timestamptz IS NULL OR j.posted_at < $2)
          GROUP BY e.currency`,
        dateWindow(f),
      );
      return {
        columns: [
          'currency', 'fee_revenue', 'partner_fees_payable', 'regulatory_charges_payable',
          'fx_clearing_position', 'settlement_suspense', 'reconciliation_difference',
          'returned_funds', 'customer_settlement_payable', 'partner_settlement_balance',
          'test_liquidity_injected',
        ],
        rows,
        summary: {
          settled_values: settled,
          note:
            'ALL FIGURES ARE SIMULATED. A non-zero fx_clearing_position is an open currency exposure; ' +
            'a non-zero settlement_suspense is an unexplained item awaiting resolution.',
        },
      };
    },
  },

  // -------------------------------------------------------------------------
  // Pilot
  // -------------------------------------------------------------------------
  {
    key: 'pilot-report',
    title: 'Pilot report',
    family: 'pilot',
    description:
      'Participants, transactions initiated and completed, completion rate, average cost and ' +
      'processing time, exceptions, complaints, incidents, availability and limit breaches.',
    permission: 'report.pilot.read',
    filters: ['from', 'to'],
    run: async (db, f) => {
      const [from, to] = dateWindow(f);
      const participants = await many<Record<string, unknown>>(
        db,
        `SELECT o.display_code AS organization_code, o.onboarding_status,
                COALESCE(o.risk_rating,'not_assessed') AS risk_rating,
                count(t.id)::text AS transactions_initiated,
                count(t.id) FILTER (WHERE t.state = 'completed')::text AS transactions_completed,
                count(t.id) FILTER (WHERE t.state IN ('failed','rejected','returned'))::text AS transactions_failed,
                round(100.0 * count(t.id) FILTER (WHERE t.state = 'completed')
                      / NULLIF(count(t.id),0), 2)::text AS completion_rate_percent,
                COALESCE(sum(t.send_amount) FILTER (WHERE t.state = 'completed'), 0)::text AS completed_value,
                max(t.send_currency) AS currency
           FROM organization o
           LEFT JOIN transaction t ON t.organization_id = o.id
            AND ($1::timestamptz IS NULL OR t.created_at >= $1)
            AND ($2::timestamptz IS NULL OR t.created_at < $2)
          WHERE o.kind = 'customer' AND o.onboarding_status = 'approved'
          GROUP BY o.id ORDER BY o.display_code`,
        [from, to],
      );

      const summary = await one<Record<string, string | null>>(
        db,
        `SELECT
           (SELECT count(*)::text FROM organization WHERE kind = 'customer' AND onboarding_status = 'approved') AS approved_participants,
           (SELECT count(*)::text FROM organization WHERE kind = 'customer') AS total_applicants,
           (SELECT count(*)::text FROM transaction) AS transactions_initiated,
           (SELECT count(*)::text FROM transaction WHERE state = 'completed') AS transactions_completed,
           (SELECT count(*)::text FROM exception_case) AS exceptions_raised,
           (SELECT count(*)::text FROM exception_case
             WHERE status NOT IN ('resolved','written_off','closed_no_action')) AS exceptions_open,
           (SELECT count(*)::text FROM complaint) AS complaints,
           (SELECT count(*)::text FROM security_incident) AS security_incidents,
           (SELECT count(*)::text FROM security_incident WHERE severity IN ('high','critical')) AS serious_incidents,
           (SELECT round(avg(EXTRACT(EPOCH FROM (completed_at - created_at))/60.0), 1)::text
              FROM transaction WHERE completed_at IS NOT NULL) AS avg_processing_minutes,
           (SELECT count(*)::text FROM rule_evaluation
             WHERE triggered AND rule_key IN ('TXN_ABOVE_SINGLE_LIMIT','VELOCITY_DAILY_LIMIT','VELOCITY_MONTHLY_LIMIT')) AS limit_breach_attempts`,
      );

      const cost = await many<{ currency: string; avg_cost: string; avg_cost_bps: string }>(
        db,
        `SELECT q.ekorails_fee_currency AS currency,
                round(avg(q.ekorails_fee + q.partner_fee + q.tax_or_levy), 2)::text AS avg_cost,
                round(avg(10000.0 * (q.ekorails_fee + q.partner_fee + q.tax_or_levy)
                          / NULLIF(q.send_amount, 0)), 2)::text AS avg_cost_bps
           FROM fx_quote q WHERE q.status = 'accepted' GROUP BY q.ekorails_fee_currency`,
      );

      return {
        columns: [
          'organization_code', 'onboarding_status', 'risk_rating', 'transactions_initiated',
          'transactions_completed', 'transactions_failed', 'completion_rate_percent',
          'completed_value', 'currency',
        ],
        rows: participants,
        summary: {
          ...summary,
          average_cost: cost,
          system_availability_percent: 'NOT MEASURED — uptime monitoring is not deployed in this build.',
          regulatory_observations: 'NONE RECORDED — no regulatory engagement has taken place.',
          pilot_scope_note:
            'Pilot duration, participant cap, transaction limits and success thresholds are UNCONFIRMED ' +
            'pending the CBN filing (founder decisions FD-003 and FD-007). This report computes the ' +
            'measures; it does not assert targets that have not been agreed.',
        },
      };
    },
  },

  // -------------------------------------------------------------------------
  // Regulatory
  // -------------------------------------------------------------------------
  {
    key: 'transaction-register',
    title: 'Transaction register',
    family: 'regulatory',
    description: 'Every transaction with its parties, amounts, risk outcome and final state.',
    permission: 'report.compliance.read',
    filters: ['from', 'to', 'organization_id', 'corridor', 'currency'],
    maskedColumns: ['organization_name', 'beneficiary_name'],
    run: async (db, f) => {
      const [from, to] = dateWindow(f);
      const rows = await many<Record<string, unknown>>(
        db,
        `SELECT t.reference, t.created_at, t.completed_at, t.state,
                o.display_code AS organization_code, o.legal_name AS organization_name,
                b.legal_name AS beneficiary_name, b.country AS beneficiary_country,
                c.code AS corridor, t.send_currency, t.send_amount::text,
                t.receive_currency, t.actual_receive_amount::text AS received_amount,
                COALESCE(t.risk_rating, 'not_assessed') AS risk_rating,
                q.provider_rate::text AS rate,
                (q.ekorails_fee + q.partner_fee + q.tax_or_levy)::text AS total_charges,
                q.is_simulated AS rate_simulated
           FROM transaction t
           JOIN organization o ON o.id = t.organization_id
           JOIN beneficiary b ON b.id = t.beneficiary_id
           JOIN corridor c ON c.id = t.corridor_id
           LEFT JOIN fx_quote q ON q.id = t.fx_quote_id
          WHERE ($1::timestamptz IS NULL OR t.created_at >= $1)
            AND ($2::timestamptz IS NULL OR t.created_at < $2)
            AND ($3::uuid IS NULL OR t.organization_id = $3)
            AND ($4::text IS NULL OR c.code = $4)
            AND ($5::text IS NULL OR t.send_currency = $5)
          ORDER BY t.created_at DESC LIMIT 10000`,
        [from, to, f.organizationId ?? null, f.corridor ?? null, f.currency ?? null],
      );
      return {
        columns: [
          'reference', 'created_at', 'completed_at', 'state', 'organization_code', 'organization_name',
          'beneficiary_name', 'beneficiary_country', 'corridor', 'send_currency', 'send_amount',
          'receive_currency', 'received_amount', 'risk_rating', 'rate', 'total_charges', 'rate_simulated',
        ],
        rows,
        summary: {
          note:
            'Every transaction in this register was settled through a simulator. No real funds moved. ' +
            'The statutory form identifier and submission route for this return are UNCONFIRMED ' +
            'pending the CBN filing (founder decision FD-006).',
        },
      };
    },
  },
  {
    key: 'reconciliation-report',
    title: 'Reconciliation report',
    family: 'financial',
    description: 'Reconciliation runs, their results and the breaks they opened.',
    permission: 'report.financial.read',
    filters: ['from', 'to'],
    run: async (db, f) => {
      const [from, to] = dateWindow(f);
      const rows = await many<Record<string, unknown>>(
        db,
        `SELECT r.reference, r.run_type, r.business_date, r.status,
                r.items_total::text, r.items_matched::text, r.items_broken::text,
                r.unexplained_amount::text, r.currency, r.started_at, r.finished_at,
                p.display_name AS partner_name,
                round(100.0 * r.items_matched / NULLIF(r.items_total,0), 2)::text AS match_rate_percent
           FROM reconciliation_run r LEFT JOIN partner p ON p.id = r.partner_id
          WHERE ($1::timestamptz IS NULL OR r.started_at >= $1)
            AND ($2::timestamptz IS NULL OR r.started_at < $2)
          ORDER BY r.started_at DESC LIMIT 1000`,
        [from, to],
      );
      const breaks = await many<Record<string, unknown>>(
        db,
        `SELECT exception_type, status, priority, count(*)::text AS n,
                round(avg(EXTRACT(EPOCH FROM (COALESCE(closed_at, now()) - opened_at))/3600.0),1)::text AS avg_age_hours
           FROM exception_case GROUP BY exception_type, status, priority
          ORDER BY exception_type, status`,
      );
      return {
        columns: [
          'reference', 'run_type', 'business_date', 'status', 'items_total', 'items_matched',
          'items_broken', 'unexplained_amount', 'currency', 'started_at', 'finished_at',
          'partner_name', 'match_rate_percent',
        ],
        rows,
        summary: { breaks_by_type: breaks },
      };
    },
  },
];

export async function run(
  db: Queryable, key: string, filters: ReportFilters, masking: MaskingProfile,
): Promise<{ key: string; title: string; columns: string[]; rows: Array<Record<string, unknown>>; summary?: Record<string, unknown>; masking_profile: string; generated_at: string; banner: string }> {
  const definition = REPORT_DEFINITIONS.find((d) => d.key === key);
  if (!definition) throw new Error(`Unknown report "${key}"`);
  const result = await definition.run(db, filters);

  // Apply masking. A restricted profile never sees the values in maskedColumns.
  const rows = masking === 'full' || !definition.maskedColumns
    ? result.rows
    : result.rows.map((row) => {
        const copy = { ...row };
        for (const col of definition.maskedColumns!) {
          if (masking === 'masked' && copy[col] !== undefined && copy[col] !== null) {
            copy[col] = maskTail(String(copy[col]), 0);
          }
        }
        return copy;
      });

  return {
    key: definition.key,
    title: definition.title,
    columns: result.columns,
    rows,
    summary: {
      ...(result.summary ?? {}),
      environment: environment().mode,
      settlement_is_simulated: environment().settlementIsSimulated,
    },
    masking_profile: masking,
    generated_at: new Date().toISOString(),
    banner: ENVIRONMENT_BANNER,
  };
}

export async function recordExport(
  db: Queryable,
  input: {
    reportKey: string; family: string; title: string; parameters: Record<string, unknown>;
    format: string; rowCount: number; content: Buffer | string;
    maskingProfile: string; generatedBy: string; generatedByRole: string | null;
  },
): Promise<void> {
  const buffer = Buffer.isBuffer(input.content) ? input.content : Buffer.from(input.content, 'utf8');
  const digest = sha256Hex(buffer);

  const row = await one<{ id: string }>(
    db,
    `INSERT INTO report (
       report_key, report_family, title, parameters, format, row_count,
       content_sha256, byte_size, masking_profile, generated_by, generated_by_role,
       retention_until
     ) VALUES ($1,$2,$3,$4::jsonb,$5,$6,$7,$8,$9,$10,$11, CURRENT_DATE + INTERVAL '7 years')
     RETURNING id`,
    [
      input.reportKey, input.family, input.title, JSON.stringify(input.parameters),
      input.format, input.rowCount, digest, buffer.length,
      input.maskingProfile, input.generatedBy, input.generatedByRole,
    ],
  );

  await recordAudit(db, {
    category: 'report_export', action: `report.export.${input.format}`, outcome: 'success',
    actorUserId: input.generatedBy, actorRole: input.generatedByRole,
    entityType: 'report', entityId: row.id,
    metadata: {
      report_key: input.reportKey, format: input.format, row_count: input.rowCount,
      content_sha256: digest, byte_size: buffer.length, masking_profile: input.maskingProfile,
      parameters: input.parameters,
    },
  });
}

/**
 * The regulator view: pilot scope, activity, control effectiveness, incidents,
 * complaints and availability, with no unnecessary personal information.
 */
export async function regulatorOverview(db: Queryable): Promise<Record<string, unknown>> {
  const scope = await many<Record<string, unknown>>(
    db,
    `SELECT code, origin_country, destination_country, origin_currency, destination_currency,
            is_placeholder, status, per_transaction_limit::text, daily_limit::text,
            monthly_limit::text, pilot_aggregate_cap::text, limit_currency, notes
       FROM corridor ORDER BY code`,
  );

  const participants = await many<Record<string, unknown>>(
    db,
    `SELECT display_code, onboarding_status, COALESCE(risk_rating,'not_assessed') AS risk_rating,
            (suspended_at IS NOT NULL) AS suspended, created_at
       FROM organization WHERE kind = 'customer' ORDER BY display_code`,
  );

  const activity = await one<Record<string, string | null>>(
    db,
    `SELECT
       (SELECT count(*)::text FROM transaction) AS transactions_total,
       (SELECT count(*)::text FROM transaction WHERE state = 'completed') AS transactions_completed,
       (SELECT count(*)::text FROM transaction WHERE state IN ('failed','rejected','returned')) AS transactions_unsuccessful,
       (SELECT coalesce(sum(send_amount),0)::text FROM transaction WHERE state = 'completed') AS completed_value,
       (SELECT max(send_currency) FROM transaction) AS currency,
       (SELECT count(*)::text FROM compliance_case) AS compliance_cases,
       (SELECT count(*)::text FROM screening_case WHERE status IN ('potential_match','confirmed_match')) AS screening_alerts,
       (SELECT count(*)::text FROM exception_case) AS exceptions,
       (SELECT count(*)::text FROM complaint) AS complaints,
       (SELECT count(*)::text FROM security_incident) AS security_incidents`,
  );

  const controls = await many<Record<string, unknown>>(
    db,
    `SELECT risk_ref, category, title, control_status, existing_controls, blocks_pilot
       FROM risk_register_entry ORDER BY blocks_pilot DESC, risk_ref`,
  );

  const incidents = await many<Record<string, unknown>>(
    db,
    `SELECT reference, title, severity, category, status, detected_at, resolved_at,
            personal_data_involved, notification_required, notified_at, is_simulated
       FROM security_incident ORDER BY detected_at DESC`,
  );

  const chain = await one<{ n: string }>(
    db, 'SELECT count(*)::text AS n FROM verify_audit_chain()',
  );

  const ledgerBalanced = await many<{ currency: string; difference: string }>(
    db, 'SELECT currency, difference::text FROM trial_balance',
  );

  return {
    pilot_scope: {
      corridors: scope,
      status_note:
        'Corridor, currencies and limits are UNCONFIRMED placeholders pending the CBN Regulatory ' +
        'Sandbox application, which was not available to this build. No regulatory fact has been invented.',
      sandbox_admission_status: 'NOT CONFIRMED. EKORails does not claim to be an admitted participant.',
    },
    environment: {
      mode: environment().mode,
      banner: ENVIRONMENT_BANNER,
      live_funds_enabled: environment().liveFundsEnabled,
      settlement_is_simulated: true,
      release_gates_met: environment().gates.filter((g) => g.met).length,
      release_gates_total: environment().gates.length,
    },
    approved_participants: participants,
    transaction_activity: activity,
    control_effectiveness: {
      audit_chain_intact: Number(chain.n) === 0,
      ledger_balanced: ledgerBalanced.every((r) => Number(r.difference) === 0),
      ledger_by_currency: ledgerBalanced,
      state_machine_edges: TRANSITIONS.length,
      controls: controls,
    },
    incidents,
    system_availability:
      'NOT MEASURED. Uptime monitoring is not deployed in this build and no availability figure ' +
      'is claimed.',
    personal_data_note:
      'This view deliberately shows organisation codes rather than names, and contains no ' +
      'individual personal data. Named detail is available on request through an audited access path.',
  };
}
