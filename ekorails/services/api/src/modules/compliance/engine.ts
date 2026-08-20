/**
 * The compliance engine.
 *
 * Responsibilities, in order:
 *   1. Gather a canonical input document for the subject under assessment.
 *   2. Evaluate the active rule set against it — every rule, not just the ones that fire.
 *   3. Write an immutable risk_assessment plus one rule_evaluation row per rule.
 *   4. Aggregate to an outcome and a recommended action.
 *   5. Open a compliance case where a human decision is required.
 *
 * The guarantee the brief asks for — "no compliance decision may disappear when rules
 * are updated" — is met by storing, with every assessment: the rule key and version, the
 * literal trigger condition text, the parameter values in force, the specific data the
 * rule read, and a hash of the whole input document. None of that is a foreign key to
 * something that can later change.
 */

import type { Queryable } from '../../db/pool.js';
import { many, maybeOne, one } from '../../db/pool.js';
import { canonicalHash, canonicalJson, sha256Hex } from '../../core/crypto.js';
import { nextReference } from '../../core/ids.js';
import { recordAudit } from '../../audit/audit.js';
import { Decimal } from '../../core/money.js';
import {
  RULES, SEVERITY_RANK, ACTION_RANK,
  type ComplianceInput, type RuleAction, type RiskSeverity, type RuleDefinition,
} from './rules.js';

export const ENGINE_VERSION = '1.0.0';

export interface RuleResultRecord {
  ruleKey: string;
  ruleVersion: number;
  ruleId: string;
  triggered: boolean;
  severity: RiskSeverity | null;
  action: RuleAction | null;
  message: string;
  dataUsed: Record<string, unknown>;
}

export interface AssessmentResult {
  riskAssessmentId: string;
  outcome: RiskSeverity;
  recommendedAction: RuleAction;
  score: number;
  triggered: RuleResultRecord[];
  all: RuleResultRecord[];
  inputHash: string;
  rulesetHash: string;
  complianceCaseId: string | null;
  complianceCaseReference: string | null;
}

interface ActiveRuleRow {
  id: string;
  rule_key: string;
  version: number;
  parameters: Record<string, unknown>;
  severity: RiskSeverity;
  on_trigger_action: RuleAction;
  trigger_condition: string;
}

/**
 * Loads the rule set that is active right now, pairing each database row with its
 * evaluator. A rule present in the database but absent from the code catalogue is
 * reported rather than silently skipped: a rule nobody can evaluate is a control gap.
 */
async function loadActiveRules(db: Queryable): Promise<{
  pairs: Array<{ row: ActiveRuleRow; def: RuleDefinition }>;
  orphaned: string[];
}> {
  const rows = await many<ActiveRuleRow>(
    db,
    `SELECT id, rule_key, version, parameters, severity, on_trigger_action, trigger_condition
       FROM risk_rule
      WHERE status = 'active'
      ORDER BY rule_key`,
  );
  const pairs: Array<{ row: ActiveRuleRow; def: RuleDefinition }> = [];
  const orphaned: string[] = [];
  for (const row of rows) {
    const def = RULES.find((r) => r.key === row.rule_key && r.version === row.version);
    if (def) pairs.push({ row, def });
    else orphaned.push(`${row.rule_key}/v${row.version}`);
  }
  return { pairs, orphaned };
}

export async function evaluate(
  db: Queryable,
  input: ComplianceInput,
  subject: { type: 'transaction' | 'organization' | 'beneficiary'; id: string; organizationId: string },
  actor: { userId: string | null; role: string | null } = { userId: null, role: null },
): Promise<AssessmentResult> {
  const { pairs, orphaned } = await loadActiveRules(db);
  if (orphaned.length > 0) {
    // Loud, not silent. An unevaluatable rule is a control that exists on paper only,
    // which is exactly the failure mode the brief asks us not to produce.
    throw new Error(
      `COMPLIANCE_ENGINE_RULE_GAP: ${orphaned.length} active rule(s) have no evaluator in this build: ` +
      `${orphaned.join(', ')}. Refusing to produce an assessment that silently omits a control.`,
    );
  }

  const results: RuleResultRecord[] = [];
  for (const { row, def } of pairs) {
    let outcome;
    try {
      outcome = def.evaluate(input, row.parameters ?? {});
    } catch (error) {
      // A rule that throws is treated as triggered at its declared severity. Failing
      // open would let a crash become an approval.
      outcome = {
        triggered: true,
        message:
          `Rule evaluation failed: ${error instanceof Error ? error.message : String(error)}. ` +
          `Treated as triggered so that an engine fault cannot become an approval.`,
        dataUsed: { evaluation_error: true },
      };
    }
    results.push({
      ruleKey: row.rule_key,
      ruleVersion: row.version,
      ruleId: row.id,
      triggered: outcome.triggered,
      severity: outcome.triggered ? (outcome.severity ?? row.severity) : null,
      action: outcome.triggered ? (outcome.action ?? row.on_trigger_action) : null,
      message: outcome.message,
      dataUsed: outcome.dataUsed,
    });
  }

  const triggered = results.filter((r) => r.triggered);

  // Aggregate: highest severity, highest-precedence action.
  let outcomeSeverity: RiskSeverity = 'low';
  let recommendedAction: RuleAction = 'auto_continue';
  for (const r of triggered) {
    if (r.severity && SEVERITY_RANK[r.severity] > SEVERITY_RANK[outcomeSeverity]) {
      outcomeSeverity = r.severity;
    }
    if (r.action && ACTION_RANK[r.action] > ACTION_RANK[recommendedAction]) {
      recommendedAction = r.action;
    }
  }

  // A numeric score for trend reporting. Not used to make the decision — the action
  // does that — but useful for spotting drift in alert volume over a pilot.
  const score = triggered.reduce(
    (sum, r) => sum + (r.severity ? (SEVERITY_RANK[r.severity] + 1) * 10 : 0), 0,
  );

  const rulesetSnapshot = pairs.map(({ row }) => ({
    rule_key: row.rule_key, version: row.version, severity: row.severity,
    on_trigger_action: row.on_trigger_action, parameters: row.parameters,
  }));
  const rulesetHash = canonicalHash(rulesetSnapshot);
  const inputHash = canonicalHash(input);

  const assessment = await one<{ id: string }>(
    db,
    `INSERT INTO risk_assessment (
       organization_id, subject_type, subject_id, ruleset_snapshot, ruleset_hash,
       input_hash, outcome, recommended_action, score, engine_version
     ) VALUES ($1,$2,$3,$4::jsonb,$5,$6,$7,$8,$9,$10)
     RETURNING id`,
    [
      subject.organizationId, subject.type, subject.id,
      JSON.stringify(rulesetSnapshot), rulesetHash, inputHash,
      outcomeSeverity, recommendedAction, score, ENGINE_VERSION,
    ],
  );

  for (const { row, def } of pairs) {
    const result = results.find((r) => r.ruleKey === row.rule_key)!;
    await db.query(
      `INSERT INTO rule_evaluation (
         risk_assessment_id, rule_key, rule_version, rule_id, triggered,
         evaluated_condition, parameters_used, data_used,
         result_severity, result_action, message
       ) VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8::jsonb,$9,$10,$11)`,
      [
        assessment.id, row.rule_key, row.version, row.id, result.triggered,
        row.trigger_condition, JSON.stringify(row.parameters ?? {}),
        JSON.stringify(result.dataUsed), result.severity, result.action, result.message,
      ],
    );
  }

  // Open a compliance case wherever a human must decide.
  let complianceCaseId: string | null = null;
  let complianceCaseReference: string | null = null;
  if (recommendedAction !== 'auto_continue') {
    const created = await openCaseForAssessment(db, {
      organizationId: subject.organizationId,
      subjectType: subject.type,
      subjectId: subject.id,
      riskAssessmentId: assessment.id,
      action: recommendedAction,
      severity: outcomeSeverity,
      triggered,
    });
    complianceCaseId = created.id;
    complianceCaseReference = created.reference;
  }

  await recordAudit(db, {
    category: 'compliance_decision',
    action: 'risk.assess',
    outcome: 'success',
    actorUserId: actor.userId,
    actorRole: actor.role,
    actorType: actor.userId ? 'user' : 'system',
    organizationId: subject.organizationId,
    entityType: subject.type,
    entityId: subject.id,
    transactionId: subject.type === 'transaction' ? subject.id : null,
    metadata: {
      risk_assessment_id: assessment.id,
      outcome: outcomeSeverity,
      recommended_action: recommendedAction,
      score,
      rules_evaluated: results.length,
      rules_triggered: triggered.length,
      triggered_keys: triggered.map((r) => r.ruleKey),
      ruleset_hash: rulesetHash,
      input_hash: inputHash,
      compliance_case: complianceCaseReference,
    },
  });

  return {
    riskAssessmentId: assessment.id,
    outcome: outcomeSeverity,
    recommendedAction,
    score,
    triggered,
    all: results,
    inputHash,
    rulesetHash,
    complianceCaseId,
    complianceCaseReference,
  };
}

const CASE_TYPE_BY_TRIGGER: Array<[string, string]> = [
  ['SANCTIONS_MATCH', 'sanctions_match'],
  ['PEP_EXPOSURE', 'pep_escalation'],
  ['ADVERSE_MEDIA_FLAG', 'adverse_media'],
  ['HIGH_RISK_JURISDICTION', 'enhanced_due_diligence'],
  ['HIGH_RISK_INDUSTRY', 'enhanced_due_diligence'],
  ['BENEFICIARY_NOT_APPROVED', 'beneficiary_review'],
];

/** Service-level targets by priority, in hours. Drives the analyst workload report. */
const SLA_HOURS: Record<string, number> = { critical: 4, high: 24, normal: 72, low: 120 };

async function openCaseForAssessment(
  db: Queryable,
  input: {
    organizationId: string;
    subjectType: string;
    subjectId: string;
    riskAssessmentId: string;
    action: RuleAction;
    severity: RiskSeverity;
    triggered: RuleResultRecord[];
  },
): Promise<{ id: string; reference: string }> {
  const keys = input.triggered.map((t) => t.ruleKey);
  const specific = CASE_TYPE_BY_TRIGGER.find(([k]) => keys.includes(k));
  const caseType = specific
    ? specific[1]
    : input.subjectType === 'transaction'
      ? 'transaction_alert'
      : input.subjectType === 'beneficiary'
        ? 'beneficiary_review'
        : 'kyb_review';

  const priority =
    input.severity === 'prohibited' ? 'critical'
    : input.severity === 'high' ? 'high'
    : input.severity === 'medium' ? 'normal' : 'low';

  const requiresManager =
    input.action === 'enhanced_due_diligence' ||
    input.action === 'escalate' ||
    input.severity === 'prohibited' ||
    input.severity === 'high';

  const reference = await nextReference(db, 'compliance_case');
  const row = await one<{ id: string }>(
    db,
    `INSERT INTO compliance_case (
       reference, organization_id, case_type, subject_type, subject_id,
       risk_assessment_id, priority, status, requires_manager, sla_due_at
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,'open',$8, now() + ($9 || ' hours')::interval)
     RETURNING id`,
    [
      reference, input.organizationId, caseType, input.subjectType, input.subjectId,
      input.riskAssessmentId, priority, requiresManager, String(SLA_HOURS[priority] ?? 72),
    ],
  );

  // The case opens with a note summarising exactly why, so an analyst picking it up
  // does not have to reconstruct the engine's reasoning.
  await db.query(
    `INSERT INTO compliance_case_note (compliance_case_id, author_id, visibility, body)
     VALUES ($1, (SELECT id FROM app_user WHERE email_normalised = 'system@ekorails.invalid'), 'internal', $2)`,
    [
      row.id,
      `Opened automatically by the compliance engine (v${ENGINE_VERSION}).\n` +
      `Outcome: ${input.severity}. Recommended action: ${input.action}.\n\n` +
      `Rules triggered (${input.triggered.length}):\n` +
      input.triggered.map((t) => `  - ${t.ruleKey} v${t.ruleVersion} [${t.severity}/${t.action}]: ${t.message}`).join('\n'),
    ],
  );

  return { id: row.id, reference };
}

// ---------------------------------------------------------------------------
// Input gathering
// ---------------------------------------------------------------------------

/**
 * Builds the canonical input document for a transaction assessment. Every value the
 * rules can read is collected here, so that the input hash covers the complete basis
 * for the decision.
 */
export async function buildTransactionInput(
  db: Queryable,
  transactionId: string,
  deviceContext: { ipHash: string | null } = { ipHash: null },
): Promise<ComplianceInput> {
  const t = await one<{
    id: string; reference: string; organization_id: string; beneficiary_id: string;
    corridor_id: string; send_amount: string; send_currency: string; receive_currency: string;
    purpose: string; source_of_funds: string; initiated_by: string;
    invoice_number: string | null; invoice_fingerprint: string | null; created_at: Date;
  }>(
    db,
    `SELECT id, reference, organization_id, beneficiary_id, corridor_id, send_amount,
            send_currency, receive_currency, purpose, source_of_funds, initiated_by,
            invoice_number, invoice_fingerprint, created_at
       FROM transaction WHERE id = $1`,
    [transactionId],
  );

  const org = await one<{
    id: string; display_code: string; onboarding_status: string; risk_rating: string | null;
    suspended_at: Date | null; jurisdiction: string | null; industry_code: string | null;
    expected_monthly_volume: string | null; expected_monthly_currency: string | null;
    expected_transaction_size: string | null; expected_txn_currency: string | null;
    source_of_funds: string | null; profile_created_at: Date | null;
  }>(
    db,
    `SELECT o.id, o.display_code, o.onboarding_status, o.risk_rating, o.suspended_at,
            p.jurisdiction, p.industry_code, p.expected_monthly_volume, p.expected_monthly_currency,
            p.expected_transaction_size, p.expected_txn_currency, p.source_of_funds,
            p.created_at AS profile_created_at
       FROM organization o
       LEFT JOIN organization_profile p ON p.organization_id = o.id AND p.is_current
      WHERE o.id = $1`,
    [t.organization_id],
  );

  const ben = await one<{
    id: string; status: string; country: string; requires_rereview: boolean;
    created_at: Date; first_used_at: Date | null; relationship_to_sender: string;
    account_fingerprint: string; account_country: string;
  }>(
    db,
    `SELECT b.id, b.status, b.country, b.requires_rereview, b.created_at, b.first_used_at,
            b.relationship_to_sender,
            a.identifier_fingerprint AS account_fingerprint,
            a.institution_country AS account_country
       FROM beneficiary b JOIN bank_account a ON a.id = b.bank_account_id
      WHERE b.id = $1`,
    [t.beneficiary_id],
  );

  const corridor = await one<{
    code: string; origin_country: string; destination_country: string;
    origin_currency: string; destination_currency: string; is_placeholder: boolean;
    status: string; per_transaction_limit: string | null; daily_limit: string | null;
    monthly_limit: string | null; pilot_aggregate_cap: string | null; limit_currency: string | null;
  }>(
    db,
    `SELECT code, origin_country, destination_country, origin_currency, destination_currency,
            is_placeholder, status, per_transaction_limit, daily_limit, monthly_limit,
            pilot_aggregate_cap, limit_currency
       FROM corridor WHERE id = $1`,
    [t.corridor_id],
  );

  // Duplicate invoice candidates. Matched on fingerprint, excluding this transaction.
  const duplicates = t.invoice_fingerprint
    ? await many<{ reference: string; state: string; created_at: Date }>(
        db,
        `SELECT reference, state, created_at FROM transaction
          WHERE organization_id = $1 AND invoice_fingerprint = $2 AND id <> $3
          ORDER BY created_at DESC LIMIT 20`,
        [t.organization_id, t.invoice_fingerprint, t.id],
      )
    : [];

  const docRoles = await many<{ role: string }>(
    db, 'SELECT DISTINCT role FROM transaction_document WHERE transaction_id = $1', [t.id],
  );
  const roles = docRoles.map((r) => r.role);

  // Velocity. Counted over transactions that have not been rejected or cancelled,
  // because an in-flight transaction consumes limit just as a settled one does.
  const LIVE_STATES = `('pending_business_approval','pending_compliance','compliance_approved',
    'quote_issued','quote_accepted','awaiting_funding','funding_confirmed','ready_for_settlement',
    'submitted_to_partner','partner_processing','settled','beneficiary_confirmed','reconciled','completed')`;

  const velocity = await one<{
    daily_count: string; daily_amount: string; monthly_count: string; monthly_amount: string;
    pilot_amount: string;
  }>(
    db,
    `SELECT
       count(*) FILTER (WHERE created_at >= date_trunc('day', now()))::text AS daily_count,
       COALESCE(sum(send_amount) FILTER (WHERE created_at >= date_trunc('day', now())), 0)::text AS daily_amount,
       count(*) FILTER (WHERE created_at >= date_trunc('month', now()))::text AS monthly_count,
       COALESCE(sum(send_amount) FILTER (WHERE created_at >= date_trunc('month', now())), 0)::text AS monthly_amount,
       COALESCE(sum(send_amount), 0)::text AS pilot_amount
     FROM transaction
     WHERE organization_id = $1 AND id <> $2 AND send_currency = $3
       AND state IN ${LIVE_STATES}`,
    [t.organization_id, t.id, t.send_currency],
  );

  const recent = await many<{ send_amount: string }>(
    db,
    `SELECT send_amount::text FROM transaction
      WHERE organization_id = $1 AND id <> $2 AND send_currency = $3
        AND created_at >= now() - interval '24 hours'
        AND state IN ${LIVE_STATES}
      ORDER BY created_at DESC LIMIT 50`,
    [t.organization_id, t.id, t.send_currency],
  );

  // Screening: the most recent completed case per subject.
  const screening = await gatherScreening(db, {
    organizationId: t.organization_id, beneficiaryId: ben.id, transactionId: t.id,
  });

  // Shared bank account across organisations, by keyed fingerprint. Never decrypts.
  const shared = await one<{ n: string }>(
    db,
    `SELECT count(DISTINCT b.organization_id)::text AS n
       FROM beneficiary b JOIN bank_account a ON a.id = b.bank_account_id
      WHERE a.identifier_fingerprint = $1 AND b.organization_id <> $2`,
    [ben.account_fingerprint, t.organization_id],
  );

  const recentBeneficiaries = await one<{ n: string }>(
    db,
    `SELECT count(*)::text AS n FROM beneficiary
      WHERE organization_id = $1 AND created_at >= now() - interval '7 days'`,
    [t.organization_id],
  );

  // Related party: does the beneficiary's legal name match a controller of the sender?
  const relatedParty = await one<{ shares: boolean }>(
    db,
    `SELECT EXISTS (
       SELECT 1
         FROM person_capacity pc
         JOIN natural_person np ON np.id = pc.person_id
         JOIN beneficiary b ON b.id = $2
        WHERE pc.organization_id = $1
          AND pc.capacity IN ('director', 'ultimate_beneficial_owner')
          AND lower(b.legal_name) LIKE '%' || lower(np.full_name) || '%'
     ) AS shares`,
    [t.organization_id, ben.id],
  );

  const initiator = await one<{ roles: string[] | null }>(
    db,
    `SELECT (SELECT array_agg(role_code) FROM user_role WHERE user_id = $1
              AND (expires_at IS NULL OR expires_at > now())) AS roles`,
    [t.initiated_by],
  );
  const initiatorRoles = initiator.roles ?? [];

  const device = await gatherDeviceSignals(db, t.organization_id, deviceContext.ipHash);

  const profileAgeDays = org.profile_created_at
    ? Math.floor((Date.now() - org.profile_created_at.getTime()) / 86_400_000)
    : null;

  return {
    subjectType: 'transaction',
    evaluatedAt: new Date().toISOString(),
    organization: {
      id: org.id,
      displayCode: org.display_code,
      onboardingStatus: org.onboarding_status,
      riskRating: org.risk_rating,
      suspended: org.suspended_at !== null,
      jurisdiction: org.jurisdiction,
      industryCode: org.industry_code,
      expectedMonthlyVolume: org.expected_monthly_volume,
      expectedMonthlyCurrency: org.expected_monthly_currency,
      expectedTransactionSize: org.expected_transaction_size,
      expectedTxnCurrency: org.expected_txn_currency,
      sourceOfFundsDeclared: (org.source_of_funds ?? '').trim().length > 0,
      profileAgeDays,
    },
    transaction: {
      id: t.id,
      reference: t.reference,
      sendAmount: t.send_amount,
      sendCurrency: t.send_currency,
      receiveCurrency: t.receive_currency,
      purpose: t.purpose,
      sourceOfFundsText: t.source_of_funds,
      initiatedByUserId: t.initiated_by,
      initiatorHoldsInitiatePermission: initiatorRoles.includes('business_initiator'),
      initiatorIsAuthorisedSignatory: initiatorRoles.includes('business_approver'),
      invoiceNumber: t.invoice_number,
      invoiceFingerprint: t.invoice_fingerprint,
      duplicateInvoiceMatches: duplicates.map((d) => ({
        reference: d.reference, state: d.state, createdAt: d.created_at.toISOString(),
      })),
      linkedDocumentRoles: roles,
      hasSourceOfFundsEvidence: roles.includes('source_of_funds'),
    },
    beneficiary: {
      id: ben.id,
      status: ben.status,
      country: ben.country,
      requiresRereview: ben.requires_rereview,
      createdAt: ben.created_at.toISOString(),
      firstUsedAt: ben.first_used_at ? ben.first_used_at.toISOString() : null,
      bankAccountFingerprint: ben.account_fingerprint,
      bankAccountCountry: ben.account_country,
      sharedAccountWithOtherOrgs: Number(shared.n),
      recentBeneficiaryAdditions: Number(recentBeneficiaries.n),
      relationshipToSender: ben.relationship_to_sender,
      sharesControllerWithSender: relatedParty.shares,
    },
    corridor: {
      code: corridor.code,
      originCountry: corridor.origin_country,
      destinationCountry: corridor.destination_country,
      originCurrency: corridor.origin_currency,
      destinationCurrency: corridor.destination_currency,
      isPlaceholder: corridor.is_placeholder,
      status: corridor.status,
      perTransactionLimit: corridor.per_transaction_limit,
      dailyLimit: corridor.daily_limit,
      monthlyLimit: corridor.monthly_limit,
      pilotAggregateCap: corridor.pilot_aggregate_cap,
      limitCurrency: corridor.limit_currency,
    },
    velocity: {
      dailyCount: Number(velocity.daily_count),
      dailyAmount: Decimal.fromString(velocity.daily_amount).toString(),
      monthlyCount: Number(velocity.monthly_count),
      monthlyAmount: Decimal.fromString(velocity.monthly_amount).toString(),
      pilotTotalAmount: Decimal.fromString(velocity.pilot_amount).toString(),
      currency: t.send_currency,
      recentAmounts: recent.map((r) => Decimal.fromString(r.send_amount).toString()),
    },
    screening,
    device,
  };
}

async function gatherScreening(
  db: Queryable,
  subjects: { organizationId: string; beneficiaryId: string; transactionId: string },
): Promise<ComplianceInput['screening']> {
  const rows = await many<{
    screening_type: string; status: string; match_score: string | null;
    matched_name: string | null; match_details: Record<string, unknown>;
  }>(
    db,
    `SELECT r.screening_type, c.status, r.match_score::text, r.matched_name, r.match_details
       FROM screening_case c
       JOIN screening_result r ON r.screening_case_id = c.id
      WHERE c.subject_id = ANY($1::uuid[])
        AND c.status <> 'pending'
      ORDER BY c.requested_at DESC`,
    [[subjects.organizationId, subjects.beneficiaryId, subjects.transactionId]],
  );

  const pick = (type: string) => rows.filter((r) => r.screening_type === type);

  const sanctionsRows = pick('sanctions');
  const pepRows = pick('pep');
  const mediaRows = pick('adverse_media');

  const worstStatus = (candidates: Array<{ status: string }>): string => {
    const order = ['clear', 'false_positive', 'error', 'provider_unavailable', 'potential_match', 'confirmed_match'];
    let worst = 'clear';
    for (const c of candidates) {
      if (order.indexOf(c.status) > order.indexOf(worst)) worst = c.status;
    }
    return candidates.length === 0 ? 'not_screened' : worst;
  };

  const highestScore = (candidates: Array<{ match_score: string | null }>): number | null => {
    const scores = candidates.map((c) => (c.match_score === null ? null : Number(c.match_score)))
      .filter((s): s is number => s !== null);
    return scores.length ? Math.max(...scores) : null;
  };

  return {
    sanctions: {
      status: worstStatus(sanctionsRows),
      highestScore: highestScore(sanctionsRows),
      matchedNames: sanctionsRows.map((r) => r.matched_name).filter((n): n is string => n !== null),
    },
    pep: {
      status: worstStatus(pepRows),
      isPep: pepRows.some((r) => r.status === 'potential_match' || r.status === 'confirmed_match'),
      categories: pepRows
        .map((r) => (r.match_details?.['category'] as string | undefined))
        .filter((c): c is string => typeof c === 'string'),
    },
    adverseMedia: {
      status: worstStatus(mediaRows),
      flagged: mediaRows.some((r) => r.status === 'potential_match' || r.status === 'confirmed_match'),
      topics: mediaRows
        .flatMap((r) => ((r.match_details?.['topics'] as string[] | undefined) ?? [])),
    },
  };
}

async function gatherDeviceSignals(
  db: Queryable, organizationId: string, ipHash: string | null,
): Promise<ComplianceInput['device']> {
  const stats = await one<{ distinct_ips: string; failed_logins: string; seen_before: boolean }>(
    db,
    `SELECT
       count(DISTINCT la.ip_hash) FILTER (WHERE la.occurred_at >= now() - interval '24 hours')::text AS distinct_ips,
       count(*) FILTER (WHERE NOT la.succeeded AND la.occurred_at >= now() - interval '24 hours')::text AS failed_logins,
       EXISTS (SELECT 1 FROM login_attempt la2
                 JOIN app_user u2 ON u2.id = la2.user_id
                WHERE u2.organization_id = $1 AND la2.ip_hash = $2 AND la2.succeeded
                  AND la2.occurred_at < now() - interval '1 hour') AS seen_before
     FROM login_attempt la
     JOIN app_user u ON u.id = la.user_id
     WHERE u.organization_id = $1`,
    [organizationId, ipHash],
  );

  return {
    ipHash,
    distinctIpCount24h: Number(stats.distinct_ips),
    // Absent an IP we do not claim it is new; an unknown signal is not a positive one.
    newIpForOrganisation: ipHash !== null && !stats.seen_before,
    failedLogins24h: Number(stats.failed_logins),
    knownFraudSignal: false,
  };
}

/** Records a human compliance decision against a case. Append-only by construction. */
export async function recordDecision(
  db: Queryable,
  input: {
    complianceCaseId: string;
    organizationId: string;
    decision: string;
    reason: string;
    decidedBy: string;
    decidedByRole: string;
    evidenceRefs?: unknown[];
    riskAssessmentId?: string | null;
    reviewsDecisionId?: string | null;
  },
): Promise<string> {
  if (input.reason.trim().length < 20) {
    throw new Error(
      'COMPLIANCE_REASON_TOO_SHORT: a compliance decision requires a written reason of at least ' +
      '20 characters. A decision nobody can explain later is not evidence.',
    );
  }
  const row = await one<{ id: string }>(
    db,
    `INSERT INTO compliance_decision (
       compliance_case_id, organization_id, decision, reason, decided_by, decided_by_role,
       evidence_refs, risk_assessment_id, reviews_decision_id
     ) VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9)
     RETURNING id`,
    [
      input.complianceCaseId, input.organizationId, input.decision, input.reason,
      input.decidedBy, input.decidedByRole,
      JSON.stringify(input.evidenceRefs ?? []),
      input.riskAssessmentId ?? null, input.reviewsDecisionId ?? null,
    ],
  );

  await recordAudit(db, {
    category: 'compliance_decision',
    action: `compliance.${input.decision}`,
    outcome: 'success',
    actorUserId: input.decidedBy,
    actorRole: input.decidedByRole,
    organizationId: input.organizationId,
    entityType: 'compliance_case',
    entityId: input.complianceCaseId,
    reason: input.reason,
    metadata: { decision_id: row.id, decision: input.decision },
  });

  return row.id;
}

/**
 * Reconstructs a past decision exactly as it was made: the rule versions, the parameter
 * values, the data each rule read, and the input hash. This is what an examiner asks for
 * when they want to know why a particular payment was allowed 8 months ago.
 */
export async function explainAssessment(
  db: Queryable, riskAssessmentId: string,
): Promise<Record<string, unknown> | null> {
  const assessment = await maybeOne<Record<string, unknown>>(
    db,
    `SELECT id, organization_id, subject_type, subject_id, outcome, recommended_action,
            score, evaluated_at, engine_version, ruleset_hash, input_hash, ruleset_snapshot
       FROM risk_assessment WHERE id = $1`,
    [riskAssessmentId],
  );
  if (!assessment) return null;

  const evaluations = await many<Record<string, unknown>>(
    db,
    `SELECT rule_key, rule_version, triggered, evaluated_condition, parameters_used,
            data_used, result_severity, result_action, message, evaluated_at
       FROM rule_evaluation WHERE risk_assessment_id = $1 ORDER BY rule_key`,
    [riskAssessmentId],
  );

  const decisions = await many<Record<string, unknown>>(
    db,
    `SELECT d.id, d.decision, d.reason, d.decided_by_role, d.decided_at, u.full_name AS decided_by_name
       FROM compliance_decision d
       LEFT JOIN app_user u ON u.id = d.decided_by
      WHERE d.risk_assessment_id = $1 ORDER BY d.decided_at`,
    [riskAssessmentId],
  );

  return {
    assessment,
    rules_evaluated: evaluations.length,
    rules_triggered: evaluations.filter((e) => e['triggered'] === true).length,
    evaluations,
    human_decisions: decisions,
    reproducibility_note:
      'This record is self-contained. The rule text, parameter values and input data shown here ' +
      'are those in force at evaluation time, copied at the moment of the decision. They are not ' +
      'read back from current configuration and are unaffected by any subsequent rule change.',
    integrity: {
      ruleset_hash: assessment['ruleset_hash'],
      input_hash: assessment['input_hash'],
      recomputed_ruleset_hash: sha256Hex(canonicalJson(assessment['ruleset_snapshot'])),
    },
  };
}
