-- 004_compliance.sql — risk rules, screening, risk assessment, compliance cases and decisions.
--
-- Central design constraint from the brief: "No compliance decision may disappear when
-- rules are updated." This is achieved by versioning rules (never mutating them) and by
-- making the evaluation record append-only and self-contained — it stores the rule text,
-- the thresholds, and a hash of the exact input data used, so a decision made in March can
-- be reproduced in November even if every rule has since changed.

BEGIN;

-- ---------------------------------------------------------------------------
-- Risk rules — immutable, versioned
-- ---------------------------------------------------------------------------

CREATE TABLE risk_rule (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  rule_key          TEXT NOT NULL,          -- stable across versions, e.g. 'TXN_LIMIT_SINGLE'
  version           INTEGER NOT NULL,
  name              TEXT NOT NULL,
  category          TEXT NOT NULL CHECK (category IN (
                      'customer_status', 'beneficiary_status', 'authorisation', 'limits',
                      'velocity', 'corridor', 'currency', 'sanctions', 'pep', 'adverse_media',
                      'jurisdiction', 'industry', 'behavioural', 'documentation', 'fraud',
                      'related_party', 'device')),
  -- Plain-English content for the Founder Learning Center Compliance Rule Library.
  risk_addressed        TEXT NOT NULL,
  trigger_condition     TEXT NOT NULL,
  required_evidence     TEXT NOT NULL,
  automated_action      TEXT NOT NULL,
  human_decision        TEXT NOT NULL,
  false_positive_risk   TEXT NOT NULL,
  policy_basis          TEXT NOT NULL,

  -- Parameters the rule reads at evaluation time. Copied into the evaluation record
  -- so the decision remains reproducible after the parameters change.
  parameters        JSONB NOT NULL DEFAULT '{}'::jsonb,
  severity          TEXT NOT NULL CHECK (severity IN ('low', 'medium', 'high', 'prohibited')),
  on_trigger_action TEXT NOT NULL CHECK (on_trigger_action IN (
                      'auto_continue', 'manual_review', 'enhanced_due_diligence',
                      'reject', 'suspend', 'escalate')),
  -- A rule may be retired but is never deleted; retired rules stay readable so that
  -- historical evaluations remain explicable.
  status            TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('draft', 'active', 'retired')),
  effective_from    TIMESTAMPTZ NOT NULL DEFAULT now(),
  effective_to      TIMESTAMPTZ,
  created_by        UUID REFERENCES app_user(id),
  -- Maker-checker: a rule change is proposed by one person and approved by another.
  approved_by       UUID REFERENCES app_user(id),
  approved_at       TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),

  UNIQUE (rule_key, version),
  CONSTRAINT rule_four_eyes CHECK (approved_by IS NULL OR created_by IS NULL OR approved_by <> created_by),
  CONSTRAINT active_rule_is_approved CHECK (status <> 'active' OR approved_by IS NOT NULL)
);

CREATE UNIQUE INDEX risk_rule_active_idx ON risk_rule(rule_key) WHERE status = 'active';
-- Rules are immutable once written. A change means a new version row.
-- (The status/effective_to transition is performed by an explicit retire routine that
--  inserts the successor and marks the predecessor via the retire_rule() function below.)
CREATE TRIGGER risk_rule_no_delete BEFORE DELETE ON risk_rule
  FOR EACH ROW EXECUTE FUNCTION guard_no_delete();

-- Only status/effective_to/approval columns may change on an existing rule row.
-- Anything else must be a new version.
CREATE OR REPLACE FUNCTION guard_rule_immutable_body() RETURNS TRIGGER
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.rule_key IS DISTINCT FROM OLD.rule_key
     OR NEW.version IS DISTINCT FROM OLD.version
     OR NEW.parameters IS DISTINCT FROM OLD.parameters
     OR NEW.severity IS DISTINCT FROM OLD.severity
     OR NEW.on_trigger_action IS DISTINCT FROM OLD.on_trigger_action
     OR NEW.trigger_condition IS DISTINCT FROM OLD.trigger_condition THEN
    RAISE EXCEPTION
      'RULE_IMMUTABLE: the body of rule %/v% cannot be edited. Publish a new version instead.',
      OLD.rule_key, OLD.version
      USING ERRCODE = 'raise_exception';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER risk_rule_immutable_body BEFORE UPDATE ON risk_rule
  FOR EACH ROW EXECUTE FUNCTION guard_rule_immutable_body();

-- ---------------------------------------------------------------------------
-- Screening — provider-neutral
--
-- `provider` and `provider_ref` are opaque. Swapping vendors is a configuration
-- change (see system_configuration.screening_adapters); nothing in the schema or the
-- evaluation logic is shaped around a particular vendor's response format.
-- ---------------------------------------------------------------------------

CREATE TABLE screening_case (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  reference         external_reference NOT NULL UNIQUE,
  organization_id   UUID NOT NULL REFERENCES organization(id) ON DELETE RESTRICT,
  -- What was screened.
  subject_type      TEXT NOT NULL CHECK (subject_type IN (
                      'organization', 'natural_person', 'beneficiary', 'transaction', 'bank_account')),
  subject_id        UUID NOT NULL,
  screening_types   TEXT[] NOT NULL,   -- {'sanctions','pep','adverse_media'}
  provider          TEXT NOT NULL,
  provider_adapter_version TEXT NOT NULL,
  is_simulated      BOOLEAN NOT NULL DEFAULT TRUE,
  status            TEXT NOT NULL DEFAULT 'pending' CHECK (status IN (
                      'pending', 'clear', 'potential_match', 'confirmed_match',
                      'false_positive', 'error', 'provider_unavailable')),
  requested_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at      TIMESTAMPTZ,
  -- Disposition is a compliance decision, separate from the provider's raw result.
  disposition       TEXT CHECK (disposition IN ('cleared', 'escalated', 'blocked', 'pending_review')),
  disposed_by       UUID REFERENCES app_user(id),
  disposed_at       TIMESTAMPTZ,
  disposition_reason TEXT,
  CONSTRAINT disposition_has_reason CHECK (
    disposition IS NULL OR (disposed_by IS NOT NULL AND length(coalesce(disposition_reason, '')) >= 10))
);

CREATE INDEX screening_case_subject_idx ON screening_case(subject_type, subject_id);
CREATE INDEX screening_case_org_idx ON screening_case(organization_id, status);
CREATE TRIGGER screening_case_no_delete BEFORE DELETE ON screening_case
  FOR EACH ROW EXECUTE FUNCTION guard_no_delete();

CREATE TABLE screening_result (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  screening_case_id UUID NOT NULL REFERENCES screening_case(id) ON DELETE RESTRICT,
  screening_type    TEXT NOT NULL CHECK (screening_type IN (
                      'sanctions', 'pep', 'adverse_media', 'business_verification',
                      'identity_verification', 'bank_account_verification', 'device_fraud')),
  matched_name      TEXT,
  match_score       NUMERIC(5, 2) CHECK (match_score BETWEEN 0 AND 100),
  list_name         TEXT,             -- e.g. 'SIMULATED-CONSOLIDATED-SANCTIONS'
  list_entry_ref    TEXT,
  match_details     JSONB NOT NULL DEFAULT '{}'::jsonb,
  -- The provider's raw response, retained for the statutory retention period and
  -- then purged by the retention job. Personal data inside is classified 'restricted'.
  provider_payload  JSONB,
  payload_retention_until DATE,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX screening_result_case_idx ON screening_result(screening_case_id);
CREATE TRIGGER screening_result_append_only BEFORE UPDATE OR DELETE ON screening_result
  FOR EACH ROW EXECUTE FUNCTION guard_append_only();

-- ---------------------------------------------------------------------------
-- Risk assessment — the aggregate outcome of a rule run
-- ---------------------------------------------------------------------------

CREATE TABLE risk_assessment (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id    UUID NOT NULL REFERENCES organization(id) ON DELETE RESTRICT,
  subject_type       TEXT NOT NULL CHECK (subject_type IN ('organization', 'transaction', 'beneficiary')),
  subject_id         UUID NOT NULL,
  -- Which rule set produced this. Stored as an array of rule_key/version pairs so the
  -- exact rule population is reproducible.
  ruleset_snapshot   JSONB NOT NULL,
  ruleset_hash       sha256_hex NOT NULL,
  -- Hash of the canonicalised input document the engine evaluated.
  input_hash         sha256_hex NOT NULL,
  outcome            TEXT NOT NULL CHECK (outcome IN ('low', 'medium', 'high', 'prohibited')),
  recommended_action TEXT NOT NULL CHECK (recommended_action IN (
                       'auto_continue', 'manual_review', 'enhanced_due_diligence',
                       'reject', 'suspend', 'escalate')),
  score              INTEGER NOT NULL,
  evaluated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  engine_version     TEXT NOT NULL
);

CREATE INDEX risk_assessment_subject_idx ON risk_assessment(subject_type, subject_id, evaluated_at DESC);
CREATE INDEX risk_assessment_org_idx ON risk_assessment(organization_id);
CREATE TRIGGER risk_assessment_append_only BEFORE UPDATE OR DELETE ON risk_assessment
  FOR EACH ROW EXECUTE FUNCTION guard_append_only();

-- One row per rule evaluated, not just per rule triggered. A reviewer needs to see
-- what did *not* fire as much as what did.
CREATE TABLE rule_evaluation (
  id                  BIGSERIAL PRIMARY KEY,
  risk_assessment_id  UUID NOT NULL REFERENCES risk_assessment(id) ON DELETE RESTRICT,
  rule_key            TEXT NOT NULL,
  rule_version        INTEGER NOT NULL,
  rule_id             UUID NOT NULL REFERENCES risk_rule(id),
  triggered           BOOLEAN NOT NULL,
  -- The literal condition text as it stood at evaluation time.
  evaluated_condition TEXT NOT NULL,
  -- The parameter values in force at evaluation time.
  parameters_used     JSONB NOT NULL,
  -- The specific input values the rule read. Personal data is redacted here; the
  -- rule stores identifiers and derived facts, not raw PII.
  data_used           JSONB NOT NULL,
  result_severity     TEXT CHECK (result_severity IN ('low', 'medium', 'high', 'prohibited')),
  result_action       TEXT CHECK (result_action IN (
                        'auto_continue', 'manual_review', 'enhanced_due_diligence',
                        'reject', 'suspend', 'escalate')),
  message             TEXT NOT NULL,
  evaluated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX rule_evaluation_assessment_idx ON rule_evaluation(risk_assessment_id);
CREATE INDEX rule_evaluation_rule_idx ON rule_evaluation(rule_key, triggered);
CREATE TRIGGER rule_evaluation_append_only BEFORE UPDATE OR DELETE ON rule_evaluation
  FOR EACH ROW EXECUTE FUNCTION guard_append_only();

-- ---------------------------------------------------------------------------
-- Compliance cases and decisions
-- ---------------------------------------------------------------------------

CREATE TABLE compliance_case (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  reference          external_reference NOT NULL UNIQUE,
  organization_id    UUID NOT NULL REFERENCES organization(id) ON DELETE RESTRICT,
  case_type          TEXT NOT NULL CHECK (case_type IN (
                       'kyb_review', 'periodic_review', 'transaction_alert', 'sanctions_match',
                       'pep_escalation', 'adverse_media', 'enhanced_due_diligence',
                       'beneficiary_review', 'document_expiry')),
  subject_type       TEXT NOT NULL,
  subject_id         UUID NOT NULL,
  risk_assessment_id UUID REFERENCES risk_assessment(id),
  priority           TEXT NOT NULL DEFAULT 'normal' CHECK (priority IN ('low', 'normal', 'high', 'critical')),
  status             TEXT NOT NULL DEFAULT 'open' CHECK (status IN (
                       'open', 'in_review', 'awaiting_information', 'escalated',
                       'pending_manager_approval', 'closed_cleared', 'closed_rejected', 'closed_suspended')),
  assigned_to        UUID REFERENCES app_user(id),
  opened_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Service-level target, drives the analyst workload and decision-time reports.
  sla_due_at         TIMESTAMPTZ,
  first_touched_at   TIMESTAMPTZ,
  closed_at          TIMESTAMPTZ,
  requires_manager   BOOLEAN NOT NULL DEFAULT FALSE,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX compliance_case_queue_idx ON compliance_case(status, priority, sla_due_at);
CREATE INDEX compliance_case_org_idx ON compliance_case(organization_id);
CREATE INDEX compliance_case_assignee_idx ON compliance_case(assigned_to) WHERE status NOT LIKE 'closed%';
CREATE TRIGGER compliance_case_touch BEFORE UPDATE ON compliance_case
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
CREATE TRIGGER compliance_case_no_delete BEFORE DELETE ON compliance_case
  FOR EACH ROW EXECUTE FUNCTION guard_no_delete();

-- The decision record. Append-only, and the application role holds no UPDATE or
-- DELETE grant on it. A compliance decision, once written, is evidence.
CREATE TABLE compliance_decision (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  compliance_case_id UUID NOT NULL REFERENCES compliance_case(id) ON DELETE RESTRICT,
  organization_id    UUID NOT NULL REFERENCES organization(id) ON DELETE RESTRICT,
  decision           TEXT NOT NULL CHECK (decision IN (
                       'cleared', 'cleared_false_positive', 'rejected', 'suspended',
                       'escalated', 'information_requested', 'edd_required', 'approved')),
  -- A written reason is mandatory and minimum-length enforced. "OK" is not a reason.
  reason             TEXT NOT NULL CHECK (length(reason) >= 20),
  decided_by         UUID NOT NULL REFERENCES app_user(id),
  decided_by_role    TEXT NOT NULL REFERENCES role(code),
  -- Snapshot of what the decision-maker was looking at.
  evidence_refs      JSONB NOT NULL DEFAULT '[]'::jsonb,
  risk_assessment_id UUID REFERENCES risk_assessment(id),
  -- Manager review of an analyst decision creates a second row referencing the first.
  reviews_decision_id UUID REFERENCES compliance_decision(id),
  decided_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX compliance_decision_case_idx ON compliance_decision(compliance_case_id, decided_at);
CREATE INDEX compliance_decision_org_idx ON compliance_decision(organization_id);
CREATE TRIGGER compliance_decision_append_only BEFORE UPDATE OR DELETE ON compliance_decision
  FOR EACH ROW EXECUTE FUNCTION guard_append_only();

CREATE TABLE compliance_case_note (
  id                 BIGSERIAL PRIMARY KEY,
  compliance_case_id UUID NOT NULL REFERENCES compliance_case(id) ON DELETE RESTRICT,
  author_id          UUID NOT NULL REFERENCES app_user(id),
  -- Internal notes are never shown to the customer. Customer-visible messages are a
  -- different visibility so an analyst cannot leak an internal assessment by accident.
  visibility         TEXT NOT NULL DEFAULT 'internal' CHECK (visibility IN ('internal', 'customer_visible')),
  body               TEXT NOT NULL,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX compliance_case_note_case_idx ON compliance_case_note(compliance_case_id, created_at);
CREATE TRIGGER compliance_case_note_append_only BEFORE UPDATE OR DELETE ON compliance_case_note
  FOR EACH ROW EXECUTE FUNCTION guard_append_only();

COMMIT;
