-- 011_security.sql — row-level security and least-privilege grants.
--
-- This migration is the second half of the org-isolation and audit-integrity story.
-- The first half is the application's repository layer, which scopes every query.
-- This half assumes the application layer will one day have a bug, and makes that bug
-- non-exploitable:
--
--   * ROW LEVEL SECURITY ... FORCE on every table carrying customer data. A query that
--     forgets its WHERE organization_id = $1 returns nothing, not another customer's rows.
--   * The application connects as `ekorails_app`, which is NOT a superuser, does NOT own
--     the tables and does NOT have BYPASSRLS. It cannot turn any of this off.
--   * UPDATE and DELETE are simply not granted on audit, ledger-entry and
--     compliance-decision tables. A System Administrator with every application
--     permission still has no SQL privilege with which to alter them.
--
-- Request context is established per transaction with set_config(..., is_local => true),
-- so it cannot leak across pooled connections.

BEGIN;

-- ---------------------------------------------------------------------------
-- Schema-level grants
-- ---------------------------------------------------------------------------

GRANT USAGE ON SCHEMA public TO ekorails_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO ekorails_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO ekorails_app;

-- Read everywhere the application legitimately reads.
GRANT SELECT ON ALL TABLES IN SCHEMA public TO ekorails_app;

-- ---------------------------------------------------------------------------
-- Write grants — enumerated deliberately, never wholesale
-- ---------------------------------------------------------------------------

-- Mutable operational tables.
GRANT INSERT, UPDATE ON
  organization, organization_profile, natural_person, person_capacity,
  bank_account, beneficiary, document, document_extraction,
  screening_case, compliance_case,
  corridor, fx_quote, transaction, funding_instruction, settlement_instruction,
  partner, partner_account, outbound_idempotency,
  reconciliation_run, exception_case,
  notification, support_case, complaint, security_incident, data_subject_request,
  report, system_configuration, feature_flag, fee_schedule, approval_matrix,
  required_document_rule, retention_policy, velocity_counter,
  app_user, user_session, user_role, break_glass_request,
  webhook_endpoint, webhook_delivery,
  ledger_account, partner_statement,
  decision_log, risk_register_entry, build_journal_entry,
  learning_module, learning_glossary, learning_assessment_question,
  risk_rule, simulation_directive
TO ekorails_app;

-- Insert-only tables. No UPDATE grant, no DELETE grant. Combined with the
-- append-only triggers, these rows are write-once from the application's perspective
-- and unreachable from the application's SQL privileges thereafter.
GRANT INSERT ON
  audit_event, login_attempt, document_access,
  screening_result, risk_assessment, rule_evaluation,
  compliance_decision, compliance_case_note,
  transaction_approval, transaction_transition, transaction_document,
  integration_event, journal_entry,
  reconciliation_item, exception_case_note,
  partner_statement_line, support_case_message,
  learning_assessment_attempt
TO ekorails_app;

-- journal gets UPDATE solely so the reversal workflow can mark a journal reversed.
-- The guard trigger permits no other column to change.
GRANT INSERT, UPDATE ON journal TO ekorails_app;

-- The only tables the application may delete from: ephemeral operational state that
-- is not evidence of anything. Nothing here is a financial, compliance or audit record.
GRANT INSERT, UPDATE, DELETE ON inbound_idempotency, job TO ekorails_app;
GRANT DELETE ON user_session TO ekorails_app;

-- ---------------------------------------------------------------------------
-- Row-level security
-- ---------------------------------------------------------------------------

-- Direct organisation ownership: the table carries organization_id.
DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'organization_profile', 'natural_person', 'person_capacity', 'bank_account',
    'beneficiary', 'document', 'document_extraction', 'screening_case',
    'risk_assessment', 'compliance_case', 'compliance_decision', 'transaction',
    'transaction_approval', 'transaction_transition', 'funding_instruction',
    'settlement_instruction', 'fx_quote', 'notification', 'support_case',
    'exception_case', 'webhook_endpoint', 'velocity_counter', 'data_subject_request',
    'journal', 'journal_entry', 'ledger_account', 'app_user', 'complaint'
  ] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    -- A back-office or auditor session (scope 'global') and internal jobs (scope
    -- 'system') read across organisations. A business session (scope 'org') is
    -- confined to its own organisation. Rows with a NULL organization_id are
    -- platform-level and are visible only to global/system scope.
    EXECUTE format($p$
      CREATE POLICY %I_org_isolation ON %I
        USING (
          ctx_scope() IN ('global', 'system')
          OR (ctx_scope() = 'org' AND organization_id IS NOT NULL AND organization_id = ctx_org_id())
        )
        WITH CHECK (
          ctx_scope() IN ('global', 'system')
          OR (ctx_scope() = 'org' AND organization_id IS NOT NULL AND organization_id = ctx_org_id())
        )
    $p$, t, t);
  END LOOP;
END $$;

-- `organization` keys on id rather than organization_id.
ALTER TABLE organization ENABLE ROW LEVEL SECURITY;
ALTER TABLE organization FORCE ROW LEVEL SECURITY;
CREATE POLICY organization_org_isolation ON organization
  USING (ctx_scope() IN ('global', 'system') OR (ctx_scope() = 'org' AND id = ctx_org_id()))
  WITH CHECK (ctx_scope() IN ('global', 'system') OR (ctx_scope() = 'org' AND id = ctx_org_id()));

-- Indirect ownership: the table reaches its organisation through a parent. Slower to
-- evaluate, but a child row leaking its parent's data is exactly the bug RLS exists
-- to stop, so the join is worth paying for.
DO $$
DECLARE
  spec TEXT[];
BEGIN
  FOREACH spec SLICE 1 IN ARRAY ARRAY[
    ARRAY['document_access',      'document',          'document_id'],
    ARRAY['compliance_case_note', 'compliance_case',   'compliance_case_id'],
    ARRAY['support_case_message', 'support_case',      'support_case_id'],
    ARRAY['exception_case_note',  'exception_case',    'exception_case_id'],
    ARRAY['screening_result',     'screening_case',    'screening_case_id'],
    ARRAY['rule_evaluation',      'risk_assessment',   'risk_assessment_id']
  ] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', spec[1]);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', spec[1]);
    EXECUTE format($p$
      CREATE POLICY %I_org_isolation ON %I
        USING (
          ctx_scope() IN ('global', 'system')
          OR EXISTS (SELECT 1 FROM %I p WHERE p.id = %I.%I)
        )
        WITH CHECK (
          ctx_scope() IN ('global', 'system')
          OR EXISTS (SELECT 1 FROM %I p WHERE p.id = %I.%I)
        )
    $p$, spec[1], spec[1], spec[2], spec[1], spec[3], spec[2], spec[1], spec[3]);
  END LOOP;
END $$;

-- transaction_document reaches its organisation through the transaction.
ALTER TABLE transaction_document ENABLE ROW LEVEL SECURITY;
ALTER TABLE transaction_document FORCE ROW LEVEL SECURITY;
CREATE POLICY transaction_document_org_isolation ON transaction_document
  USING (ctx_scope() IN ('global', 'system')
         OR EXISTS (SELECT 1 FROM transaction t WHERE t.id = transaction_document.transaction_id))
  WITH CHECK (ctx_scope() IN ('global', 'system')
         OR EXISTS (SELECT 1 FROM transaction t WHERE t.id = transaction_document.transaction_id));

-- The audit trail is readable across organisations only by global/system scope. A
-- business user reads only audit events about their own organisation.
ALTER TABLE audit_event ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_event FORCE ROW LEVEL SECURITY;
CREATE POLICY audit_event_read ON audit_event FOR SELECT
  USING (ctx_scope() IN ('global', 'system')
         OR (ctx_scope() = 'org' AND organization_id = ctx_org_id()));
-- Any authenticated context may append to the audit trail. Refusing an audit write
-- because of scope would create an incentive to skip auditing.
CREATE POLICY audit_event_append ON audit_event FOR INSERT WITH CHECK (true);

-- ---------------------------------------------------------------------------
-- Reference and platform tables
--
-- Deliberately NOT under RLS: they contain no customer data. Listed here so a
-- reviewer can see the decision was made rather than overlooked.
--   role, permission, role_permission, corridor, partner, partner_account,
--   risk_rule, feature_flag, system_configuration, fee_schedule, approval_matrix,
--   required_document_rule, retention_policy, learning_*, decision_log,
--   risk_register_entry, build_journal_entry, schema_migration, environment_stamp,
--   job, inbound_idempotency, outbound_idempotency, integration_event,
--   simulation_directive, reconciliation_run, reconciliation_item,
--   partner_statement, partner_statement_line, report, security_incident,
--   login_attempt, break_glass_request, user_role, user_session, webhook_delivery.
--
-- Of these, integration_event, reconciliation_item and report can reference a customer
-- indirectly. They are reachable only through back-office consoles, whose routes
-- require a back-office role, and the API masks customer identifiers for the
-- auditor/regulator masking profile.
-- ---------------------------------------------------------------------------

COMMIT;
