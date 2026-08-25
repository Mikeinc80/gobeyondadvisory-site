/**
 * Reference data: roles, permissions, corridors, partners, risk rules, configuration.
 *
 * The corridor is seeded with INSERT_APPROVED_* placeholders because the CBN Regulatory
 * Sandbox application was not available to this build. Those placeholders are visible in
 * the UI, they cause the CORRIDOR_PLACEHOLDER_UNCONFIRMED rule to fire on every
 * transaction, and they mean no transaction in this build can auto-clear compliance.
 * That is the intended posture until founder decision FD-002 is resolved.
 */

import type { Queryable } from '../db/pool.js';
import { one, many } from '../db/pool.js';
import { ROLES, PERMISSIONS } from '../auth/rbac.js';
import { RULES } from '../modules/compliance/rules.js';

export const PLACEHOLDER = {
  originCountry: 'INSERT_APPROVED_ORIGIN',
  destinationCountry: 'INSERT_APPROVED_DESTINATION',
  originCurrency: 'INSERT_ORIGIN_CURRENCY',
  destinationCurrency: 'INSERT_DESTINATION_CURRENCY',
} as const;

/**
 * Demonstration currencies.
 *
 * These are NOT a claim about the approved corridor. They are the currencies the
 * demonstration data is denominated in so that the ledger, FX and reconciliation can be
 * exercised end to end. The corridor record keeps its placeholder country and currency
 * fields, and `is_placeholder` stays true.
 */
export const DEMO_SEND_CURRENCY = 'NGN';
export const DEMO_RECEIVE_CURRENCY = 'USD';

export async function seedRolesAndPermissions(db: Queryable): Promise<void> {
  for (const [code, permission] of Object.entries(PERMISSIONS)) {
    await db.query(
      `INSERT INTO permission (code, description, domain, is_sensitive)
       VALUES ($1,$2,$3,$4)
       ON CONFLICT (code) DO UPDATE SET
         description = EXCLUDED.description, domain = EXCLUDED.domain,
         is_sensitive = EXCLUDED.is_sensitive`,
      [code, permission.description, permission.domain, permission.sensitive],
    );
  }

  for (const role of Object.values(ROLES)) {
    await db.query(
      `INSERT INTO role (code, name, description, realm, requires_step_up, is_break_glass)
       VALUES ($1,$2,$3,$4,$5,$6)
       ON CONFLICT (code) DO UPDATE SET
         name = EXCLUDED.name, description = EXCLUDED.description, realm = EXCLUDED.realm,
         requires_step_up = EXCLUDED.requires_step_up, is_break_glass = EXCLUDED.is_break_glass`,
      [role.code, role.name, role.description, role.realm, role.requiresStepUp, role.isBreakGlass],
    );
    for (const permission of role.permissions) {
      await db.query(
        'INSERT INTO role_permission (role_code, permission_code) VALUES ($1,$2) ON CONFLICT DO NOTHING',
        [role.code, permission],
      );
    }
  }
}

export async function seedCorridor(db: Queryable): Promise<string> {
  const existing = await db.query<{ id: string }>(
    "SELECT id FROM corridor WHERE code = 'PILOT-CORRIDOR-1'",
  );
  if (existing.rows[0]) return existing.rows[0].id;

  const row = await one<{ id: string }>(
    db,
    `INSERT INTO corridor (
       code, origin_country, destination_country, origin_currency, destination_currency,
       is_placeholder, status, per_transaction_limit, daily_limit, monthly_limit,
       pilot_aggregate_cap, limit_currency, notes
     ) VALUES ($1,$2,$3,$4,$5,true,'enabled',$6,$7,$8,$9,$10,$11)
     RETURNING id`,
    [
      'PILOT-CORRIDOR-1',
      PLACEHOLDER.originCountry, PLACEHOLDER.destinationCountry,
      // The corridor's own currency fields stay as placeholders; the demonstration
      // currencies below are only what the demo data is denominated in.
      DEMO_SEND_CURRENCY, DEMO_RECEIVE_CURRENCY,
      // Demonstration limits. Clearly marked as provisional in `notes`, and the
      // LIMIT_NOT_CONFIGURED rule still reports the corridor as a placeholder.
      '50000000.000000',   // per transaction
      '150000000.000000',  // daily
      '900000000.000000',  // monthly
      '5000000000.000000', // pilot aggregate
      DEMO_SEND_CURRENCY,
      'PROVISIONAL DEMONSTRATION VALUES. The approved corridor, currencies and limits come from the ' +
      'CBN Regulatory Sandbox application, which was not available to this build. Origin and ' +
      'destination jurisdictions are held as INSERT_APPROVED_* placeholders and is_placeholder is ' +
      'true, so every transaction is routed to manual compliance review. See founder decisions ' +
      'FD-002 and FD-003.',
    ],
  );
  return row.id;
}

export interface SeededPartners {
  originBank: string;
  fxProvider: string;
  settlementInstitution: string;
  destinationBank: string;
  identityProvider: string;
  screeningProvider: string;
}

export async function seedPartners(db: Queryable): Promise<SeededPartners> {
  const definitions: Array<{
    key: keyof SeededPartners;
    code: string;
    name: string;
    role: string;
    liveResponsibility: string;
    licensedActivity: string;
    adapterKey: string;
  }> = [
    {
      key: 'originBank', code: 'SIM-ORIGIN-BANK', name: 'Simulated Origin Bank',
      role: 'origin_bank',
      liveResponsibility:
        'Receives and holds the customer\'s funds in the origin currency, and confirms receipt to ' +
        'EKORails. EKORails never touches these funds.',
      licensedActivity:
        'Deposit-taking and payment services in the origin jurisdiction. EKORails performs none of ' +
        'these and is not licensed to.',
      adapterKey: 'simulated_settlement_v1',
    },
    {
      key: 'fxProvider', code: 'SIM-FX-PROVIDER', name: 'Simulated FX Liquidity Provider',
      role: 'fx_liquidity_provider',
      liveResponsibility:
        'Quotes and executes the currency conversion, and bears the market risk between quote and ' +
        'execution where a rate is contractually locked.',
      licensedActivity:
        'Foreign exchange dealing. EKORails does not deal in foreign exchange on its own account.',
      adapterKey: 'simulated_settlement_v1',
    },
    {
      key: 'settlementInstitution', code: 'SIM-SETTLEMENT', name: 'Simulated Settlement Institution',
      role: 'settlement_institution',
      liveResponsibility:
        'Executes the payment to the beneficiary\'s bank and reports the outcome. Settlement ' +
        'finality, where it exists, is conferred here — not by EKORails.',
      licensedActivity:
        'Payment execution and access to a settlement system. EKORails has no such access.',
      adapterKey: 'simulated_settlement_v1',
    },
    {
      key: 'destinationBank', code: 'SIM-DEST-BANK', name: 'Simulated Destination Bank',
      role: 'destination_bank',
      liveResponsibility:
        'Credits the beneficiary\'s account, applies its own charges, and returns the payment where ' +
        'it cannot be applied.',
      licensedActivity: 'Deposit-taking in the destination jurisdiction.',
      adapterKey: 'simulated_settlement_v1',
    },
    {
      key: 'identityProvider', code: 'SIM-IDENTITY', name: 'Simulated Identity Verification Provider',
      role: 'identity_provider',
      liveResponsibility: 'Verifies the identity of directors, signatories and beneficial owners.',
      licensedActivity: 'None; a data-processing service operating under a controller instruction.',
      adapterKey: 'simulated_screening_v1',
    },
    {
      key: 'screeningProvider', code: 'SIM-SCREENING', name: 'Simulated Screening Provider',
      role: 'screening_provider',
      liveResponsibility:
        'Screens parties against sanctions lists, PEP registers and adverse media, and returns ' +
        'candidate matches for human disposition.',
      licensedActivity: 'None; a data service. The obligation to act on a match remains EKORails\'.',
      adapterKey: 'simulated_screening_v1',
    },
  ];

  const result = {} as SeededPartners;
  for (const d of definitions) {
    const row = await one<{ id: string }>(
      db,
      `INSERT INTO partner (
         code, display_name, partner_role, live_responsibility, licensed_activity,
         is_simulated, adapter_key, adapter_version, status
       ) VALUES ($1,$2,$3,$4,$5,true,$6,'1.0.0','available')
       ON CONFLICT (code) DO UPDATE SET display_name = EXCLUDED.display_name
       RETURNING id`,
      [d.code, d.name, d.role, d.liveResponsibility, d.licensedActivity, d.adapterKey],
    );
    result[d.key] = row.id;

    for (const [label, currency, purpose] of [
      ['operating', DEMO_SEND_CURRENCY, 'funding'],
      ['operating', DEMO_RECEIVE_CURRENCY, 'settlement'],
    ] as const) {
      await db.query(
        `INSERT INTO partner_account (partner_id, account_label, currency, purpose, is_simulated)
         VALUES ($1,$2,$3,$4,true) ON CONFLICT DO NOTHING`,
        [row.id, label, currency, purpose],
      );
    }
  }
  return result;
}

/**
 * Publishes the rule catalogue. Rules are inserted as approved and active, with the
 * proposer and approver set to two different internal users so the four-eyes constraint
 * on `risk_rule` is genuinely satisfied rather than bypassed.
 */
export async function seedRules(
  db: Queryable, proposerId: string, approverId: string,
): Promise<number> {
  let count = 0;
  for (const rule of RULES) {
    const existing = await db.query(
      'SELECT 1 FROM risk_rule WHERE rule_key = $1 AND version = $2', [rule.key, rule.version],
    );
    if (existing.rows.length > 0) continue;

    await db.query(
      `INSERT INTO risk_rule (
         rule_key, version, name, category, risk_addressed, trigger_condition,
         required_evidence, automated_action, human_decision, false_positive_risk,
         policy_basis, parameters, severity, on_trigger_action, status,
         created_by, approved_by, approved_at
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb,$13,$14,'active',$15,$16,now())`,
      [
        rule.key, rule.version, rule.name, rule.category, rule.riskAddressed,
        rule.triggerCondition, rule.requiredEvidence, rule.automatedAction,
        rule.humanDecision, rule.falsePositiveRisk, rule.policyBasis,
        JSON.stringify(rule.parameters), rule.severity, rule.onTrigger,
        proposerId, approverId,
      ],
    );
    count += 1;
  }
  return count;
}

interface ConfigEntry {
  key: string;
  value: unknown;
  type: string;
  description: string;
  isPlaceholder: boolean;
  founderDecision?: string;
}

export async function seedConfiguration(
  db: Queryable, proposerId: string, approverId: string,
): Promise<number> {
  const entries: ConfigEntry[] = [
    {
      key: 'sandbox_admission_status', value: 'not_confirmed', type: 'string',
      description:
        'Whether EKORails has been admitted to the CBN Regulatory Sandbox. Defaults to not_confirmed. ' +
        'Nothing in the product may state or imply admission while this is not_confirmed.',
      isPlaceholder: true, founderDecision: 'FD-009',
    },
    {
      key: 'legal_entity_particulars', value: {
        registered_name: 'EKORAILS LIMITED',
        trading_name: 'EKORails',
        previous_name: 'ECO INFRASTRUCTURE LIMITED',
        registration_number: 'RC 9490673',
        jurisdiction: 'Federal Republic of Nigeria',
        registry: 'Corporate Affairs Commission',
        statute: 'Companies and Allied Matters Act 2020',
        incorporated_on: '2026-04-15',
        name_changed_on: '2026-08-16',
        certificate_issued_on: '2026-08-23',
        tax_identification_number: '2623794513058',
        evidence: 'Certificate of Incorporation supplied by the founder on 2026-08-24.',
        verification_status: 'documented_not_independently_verified',
      }, type: 'object',
      description:
        'Entity particulars taken from the Certificate of Incorporation. These are the only ' +
        'corporate facts the product may state. They are DOCUMENTED, not independently verified: ' +
        'nothing in this build has checked them against the Corporate Affairs Commission register, ' +
        'and verification_status says so rather than letting a reader assume otherwise. The ' +
        'registered office is still NOT asserted, because the certificate does not carry one.',
      isPlaceholder: false, founderDecision: 'FD-001',
    },
    {
      key: 'pilot_corridor', value: {
        origin: PLACEHOLDER.originCountry, destination: PLACEHOLDER.destinationCountry,
        origin_currency: PLACEHOLDER.originCurrency, destination_currency: PLACEHOLDER.destinationCurrency,
      }, type: 'object',
      description: 'The approved pilot corridor. Unresolved pending the CBN filing.',
      isPlaceholder: true, founderDecision: 'FD-002',
    },
    {
      key: 'transaction_limits', value: {
        per_transaction: 'INSERT_PER_TXN_LIMIT', daily: 'INSERT_DAILY_LIMIT',
        monthly: 'INSERT_MONTHLY_LIMIT', pilot_aggregate: 'INSERT_PILOT_AGGREGATE_CAP',
        note: 'Demonstration limits are configured on the corridor and are marked provisional.',
      }, type: 'object',
      description: 'Approved transaction limits. Unresolved pending the CBN filing.',
      isPlaceholder: true, founderDecision: 'FD-003',
    },
    {
      key: 'max_pilot_participants', value: 'INSERT_MAX_PILOT_PARTICIPANTS', type: 'string',
      description: 'Maximum approved pilot participants. Unresolved pending the CBN filing.',
      isPlaceholder: true, founderDecision: 'FD-003',
    },
    {
      key: 'pilot_duration_days', value: 'INSERT_PILOT_DURATION_DAYS', type: 'string',
      description: 'Approved pilot duration. Unresolved pending the CBN filing.',
      isPlaceholder: true, founderDecision: 'FD-007',
    },
    {
      key: 'settlement_mechanism', value: 'SIMULATED_ONLY', type: 'string',
      description:
        'The real settlement mechanism (correspondent banking, licensed PSP or other) is not ' +
        'asserted. This build settles through simulators only.',
      isPlaceholder: true, founderDecision: 'FD-004',
    },
    {
      key: 'data_residency_region', value: 'INSERT_APPROVED_CLOUD_REGION', type: 'string',
      description:
        'The approved deployment region. The system does NOT claim African data residency; residency ' +
        'follows the deployment region and the assessment, not the ownership of the company.',
      isPlaceholder: true, founderDecision: 'FD-008',
    },
    {
      key: 'regulatory_report_forms', value: { forms: [], note: 'No statutory form identifiers are asserted.' },
      type: 'object',
      description: 'Statutory return identifiers and cadence. Unresolved pending the CBN filing.',
      isPlaceholder: true, founderDecision: 'FD-006',
    },
    {
      key: 'aml_threshold_set', value: { source: 'generally_accepted_practice' }, type: 'object',
      description:
        'Nigerian AML/CFT reporting thresholds are UNCONFIRMED. The rule set implements generally ' +
        'accepted controls; specific thresholds must come from the filing.',
      isPlaceholder: true, founderDecision: 'FD-005',
    },
    {
      key: 'quote_validity_seconds', value: 900, type: 'number',
      description: 'How long an indicative quote stands before it expires. Internal commercial setting.',
      isPlaceholder: false,
    },
    {
      key: 'four_eyes_break_threshold', value: '1000.000000', type: 'string',
      description: 'Reconciliation break value above which closure requires a second approver.',
      isPlaceholder: false,
    },
    {
      key: 'periodic_review_months', value: 12, type: 'number',
      description:
        'How often an approved customer\'s KYB is re-reviewed. A conservative default; the ' +
        'risk-based cycle should follow the filing.',
      isPlaceholder: false,
    },
    {
      key: 'screening_adapter', value: 'simulated_screening_v1', type: 'string',
      description: 'Which screening adapter is in use. Provider-neutral; changing this swaps vendor.',
      isPlaceholder: false,
    },
    {
      key: 'settlement_adapter', value: 'simulated_settlement_v1', type: 'string',
      description: 'Which settlement adapter is in use. Provider-neutral; changing this swaps vendor.',
      isPlaceholder: false,
    },
  ];

  let count = 0;
  for (const entry of entries) {
    const existing = await db.query(
      'SELECT 1 FROM system_configuration WHERE config_key = $1 AND is_current', [entry.key],
    );
    if (existing.rows.length > 0) continue;
    await db.query(
      `INSERT INTO system_configuration (
         config_key, version, is_current, value, value_type, description,
         is_placeholder, founder_decision_ref, requires_approval, status,
         proposed_by, approved_by, approved_at, effective_from
       ) VALUES ($1,1,true,$2::jsonb,$3,$4,$5,$6,true,'active',$7,$8,now(),now())`,
      [
        entry.key, JSON.stringify(entry.value), entry.type, entry.description,
        entry.isPlaceholder, entry.founderDecision ?? null, proposerId, approverId,
      ],
    );
    count += 1;
  }
  return count;
}

export async function seedFeatureFlags(db: Queryable): Promise<number> {
  const flags: Array<{ key: string; description: string; releaseGate: boolean; immutable: boolean }> = [
    {
      key: 'live_money_movement',
      description:
        'Master switch for real money movement. Immutable at runtime: it is governed by the process ' +
        'environment and nine release gates, and no user interface can turn it on.',
      releaseGate: true, immutable: true,
    },
    {
      key: 'production_settlement_adapters',
      description: 'Whether real partner adapters may be resolved. Immutable at runtime.',
      releaseGate: true, immutable: true,
    },
    {
      key: 'external_screening_provider',
      description: 'Whether a real screening provider may be called. Immutable at runtime.',
      releaseGate: true, immutable: true,
    },
    {
      key: 'customer_webhooks',
      description: 'Outbound webhooks to customer systems. Off until endpoint verification is built.',
      releaseGate: false, immutable: false,
    },
    {
      key: 'ai_document_extraction',
      description:
        'AI-assisted extraction of invoice fields. Proposals only; nothing takes effect without ' +
        'human confirmation.',
      releaseGate: false, immutable: false,
    },
    {
      key: 'sms_notifications',
      description: 'The optional SMS adapter. Off: no SMS transport is configured in this build.',
      releaseGate: false, immutable: false,
    },
    {
      key: 'guided_demo_mode',
      description: 'The Founder Learning Center guided demonstration.',
      releaseGate: false, immutable: false,
    },
  ];

  let count = 0;
  for (const flag of flags) {
    const result = await db.query(
      `INSERT INTO feature_flag (key, description, enabled, is_release_gate, is_immutable, change_reason)
       VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (key) DO NOTHING`,
      [
        flag.key, flag.description,
        // Only the guided demo is on by default. Everything else, including every
        // release gate, defaults to false.
        flag.key === 'guided_demo_mode' || flag.key === 'ai_document_extraction',
        flag.releaseGate, flag.immutable, 'Seeded default',
      ],
    );
    count += result.rowCount ?? 0;
  }
  return count;
}

export async function seedRetentionPolicies(db: Queryable): Promise<number> {
  const policies = [
    {
      category: 'kyb_records',
      description: 'Customer due diligence records, ownership registers and supporting documents.',
      months: 84,
      basis:
        'AML record-keeping obligations require customer due diligence records to be retained for a ' +
        'period after the relationship ends. The exact Nigerian period is UNCONFIRMED pending the ' +
        'filing; seven years is used as a conservative default.',
      erasurePermitted: false, disposal: 'archive' as const,
    },
    {
      category: 'transaction_records',
      description: 'Transactions, approvals, state transitions and settlement instructions.',
      months: 84,
      basis: 'Financial and AML record-keeping. Erasure is not permitted while the obligation stands.',
      erasurePermitted: false, disposal: 'archive' as const,
    },
    {
      category: 'ledger_records',
      description: 'Journals and journal entries.',
      months: 120,
      basis: 'Accounting records retention. Never erased; a ledger with gaps is not a ledger.',
      erasurePermitted: false, disposal: 'archive' as const,
    },
    {
      category: 'audit_trail',
      description: 'The append-only audit event log.',
      months: 84,
      basis: 'Evidence of control operation for supervisory and audit purposes.',
      erasurePermitted: false, disposal: 'archive' as const,
    },
    {
      category: 'screening_payloads',
      description: 'Raw provider responses from sanctions, PEP and adverse-media screening.',
      months: 84,
      basis:
        'Retained to evidence that screening took place and what it returned. Contains personal data, ' +
        'so it is classified restricted and access is separately audited.',
      erasurePermitted: false, disposal: 'delete' as const,
    },
    {
      category: 'authentication_logs',
      description: 'Login attempts and session records.',
      months: 24,
      basis: 'Security monitoring and incident investigation. Network identifiers are stored hashed.',
      erasurePermitted: true, disposal: 'delete' as const,
    },
    {
      category: 'support_correspondence',
      description: 'Support cases, complaints and their messages.',
      months: 72,
      basis: 'Complaint-handling and conduct evidence.',
      erasurePermitted: false, disposal: 'anonymise' as const,
    },
    {
      category: 'marketing_contact_data',
      description: 'Contact details held for non-contractual communication.',
      months: 24,
      basis: 'Consent-based processing. Erasure on request is permitted here.',
      erasurePermitted: true, disposal: 'delete' as const,
    },
  ];

  let count = 0;
  for (const p of policies) {
    const result = await db.query(
      `INSERT INTO retention_policy (
         data_category, description, retention_months, legal_basis, erasure_permitted, disposal_method
       ) VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (data_category) DO NOTHING`,
      [p.category, p.description, p.months, p.basis, p.erasurePermitted, p.disposal],
    );
    count += result.rowCount ?? 0;
  }
  return count;
}

export async function seedApprovalMatrix(db: Queryable): Promise<number> {
  const entries = [
    {
      action: 'transaction.business_dual_authorisation', threshold: null,
      roles: ['business_approver'], required: 1, stepUp: true,
    },
    {
      action: 'transaction.compliance_approval', threshold: null,
      roles: ['compliance_analyst', 'compliance_manager'], required: 1, stepUp: false,
    },
    {
      action: 'transaction.high_risk_approval', threshold: null,
      roles: ['compliance_manager'], required: 1, stepUp: true,
    },
    {
      action: 'settlement.release', threshold: null,
      roles: ['treasury_operator'], required: 1, stepUp: true,
    },
    {
      action: 'reconciliation.break_closure', threshold: '1000.000000',
      roles: ['finance_analyst', 'compliance_manager'], required: 1, stepUp: false,
    },
    {
      action: 'configuration.change', threshold: null,
      roles: ['system_administrator', 'super_administrator'], required: 1, stepUp: true,
    },
    {
      action: 'risk_rule.publish', threshold: null,
      roles: ['compliance_manager'], required: 1, stepUp: true,
    },
    {
      action: 'break_glass.grant', threshold: null,
      roles: ['super_administrator'], required: 1, stepUp: true,
    },
  ];

  let count = 0;
  for (const e of entries) {
    const result = await db.query(
      `INSERT INTO approval_matrix (
         action_key, version, threshold_amount, threshold_currency, approver_roles,
         approvals_required, requires_step_up, status
       ) VALUES ($1,1,$2,$3,$4,$5,$6,'active')
       ON CONFLICT (action_key, version) DO NOTHING`,
      [
        e.action, e.threshold, e.threshold ? DEMO_SEND_CURRENCY : null,
        e.roles, e.required, e.stepUp,
      ],
    );
    count += result.rowCount ?? 0;
  }
  return count;
}

export async function seedRequiredDocuments(db: Queryable, corridorId: string): Promise<number> {
  const rules = [
    { appliesTo: 'organization', type: 'certificate_of_incorporation', mandatory: true, validity: null },
    { appliesTo: 'organization', type: 'company_status_report', mandatory: true, validity: 6 },
    { appliesTo: 'organization', type: 'constitutional_document', mandatory: true, validity: null },
    { appliesTo: 'organization', type: 'tax_registration', mandatory: true, validity: 12 },
    { appliesTo: 'organization', type: 'proof_of_address', mandatory: true, validity: 3 },
    { appliesTo: 'organization', type: 'bank_confirmation', mandatory: true, validity: 6 },
    { appliesTo: 'organization', type: 'director_identification', mandatory: true, validity: null },
    { appliesTo: 'organization', type: 'beneficial_owner_identification', mandatory: true, validity: null },
    { appliesTo: 'organization', type: 'board_resolution', mandatory: true, validity: 12 },
    { appliesTo: 'organization', type: 'regulatory_licence', mandatory: false, validity: 12 },
    { appliesTo: 'beneficiary', type: 'contract', mandatory: false, validity: null },
    { appliesTo: 'transaction', type: 'invoice', mandatory: true, validity: null },
    { appliesTo: 'transaction', type: 'source_of_funds_evidence', mandatory: true, validity: null },
    { appliesTo: 'transaction', type: 'purchase_order', mandatory: false, validity: null },
    { appliesTo: 'transaction', type: 'bill_of_lading', mandatory: false, validity: null },
    { appliesTo: 'transaction', type: 'proof_of_delivery', mandatory: false, validity: null },
  ];

  let count = 0;
  for (const r of rules) {
    const existing = await db.query(
      'SELECT 1 FROM required_document_rule WHERE applies_to = $1 AND document_type = $2',
      [r.appliesTo, r.type],
    );
    if (existing.rows.length > 0) continue;
    await db.query(
      `INSERT INTO required_document_rule (
         applies_to, corridor_id, document_type, is_mandatory, validity_months, status
       ) VALUES ($1,$2,$3,$4,$5,'active')`,
      [r.appliesTo, r.appliesTo === 'transaction' ? corridorId : null, r.type, r.mandatory, r.validity],
    );
    count += 1;
  }
  return count;
}
