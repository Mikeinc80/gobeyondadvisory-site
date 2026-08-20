-- 010_configuration.sql — system configuration, feature flags, fee schedules,
-- approval matrices, retention policy, and the Founder Learning Center's own tables.

BEGIN;

-- ---------------------------------------------------------------------------
-- System configuration
--
-- Versioned and maker-checker controlled. Critically: changing a configuration value
-- NEVER rewrites a historical result. Every engine that reads configuration copies the
-- values it used into its own immutable output record (see risk_assessment.ruleset_snapshot,
-- rule_evaluation.parameters_used, fx_quote's explicit fee columns).
-- ---------------------------------------------------------------------------

CREATE TABLE system_configuration (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  config_key        TEXT NOT NULL,
  version           INTEGER NOT NULL,
  is_current        BOOLEAN NOT NULL DEFAULT TRUE,
  value             JSONB NOT NULL,
  value_type        TEXT NOT NULL,
  description       TEXT NOT NULL,
  -- TRUE where the value is an INSERT_APPROVED_* placeholder awaiting the CBN filing
  -- or a founder decision. The UI renders these as unresolved rather than as fact.
  is_placeholder    BOOLEAN NOT NULL DEFAULT FALSE,
  founder_decision_ref TEXT,
  -- Sensitive configuration requires maker-checker before it takes effect.
  requires_approval BOOLEAN NOT NULL DEFAULT TRUE,
  status            TEXT NOT NULL DEFAULT 'pending_approval' CHECK (status IN (
                      'pending_approval', 'active', 'rejected', 'superseded')),
  proposed_by       UUID REFERENCES app_user(id),
  proposed_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  approved_by       UUID REFERENCES app_user(id),
  approved_at       TIMESTAMPTZ,
  change_reason     TEXT,
  effective_from    TIMESTAMPTZ,

  UNIQUE (config_key, version),
  CONSTRAINT config_four_eyes CHECK (
    NOT requires_approval OR approved_by IS NULL OR proposed_by IS NULL OR approved_by <> proposed_by),
  CONSTRAINT active_config_approved CHECK (
    status <> 'active' OR NOT requires_approval OR approved_by IS NOT NULL)
);

CREATE UNIQUE INDEX system_configuration_current_idx
  ON system_configuration(config_key) WHERE is_current AND status = 'active';
CREATE TRIGGER system_configuration_no_delete BEFORE DELETE ON system_configuration
  FOR EACH ROW EXECUTE FUNCTION guard_no_delete();

-- Configuration values are immutable once written; a change means a new version.
CREATE OR REPLACE FUNCTION guard_config_immutable_value() RETURNS TRIGGER
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.config_key IS DISTINCT FROM OLD.config_key
     OR NEW.version IS DISTINCT FROM OLD.version
     OR NEW.value IS DISTINCT FROM OLD.value THEN
    RAISE EXCEPTION
      'CONFIG_IMMUTABLE: %/v% cannot be edited in place. Propose a new version.',
      OLD.config_key, OLD.version USING ERRCODE = 'raise_exception';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER system_configuration_immutable BEFORE UPDATE ON system_configuration
  FOR EACH ROW EXECUTE FUNCTION guard_config_immutable_value();

-- ---------------------------------------------------------------------------
-- Feature flags
-- ---------------------------------------------------------------------------

CREATE TABLE feature_flag (
  key               TEXT PRIMARY KEY,
  description       TEXT NOT NULL,
  enabled           BOOLEAN NOT NULL DEFAULT FALSE,
  -- Release gates for PRODUCTION money movement. Every one defaults false, none is
  -- settable through the API or the UI, and the process refuses to boot in
  -- PRODUCTION with any of them false. See src/core/env.ts.
  is_release_gate   BOOLEAN NOT NULL DEFAULT FALSE,
  -- Flags that may never be toggled at runtime by anyone, in any environment.
  is_immutable      BOOLEAN NOT NULL DEFAULT FALSE,
  changed_by        UUID REFERENCES app_user(id),
  changed_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  change_reason     TEXT
);

CREATE OR REPLACE FUNCTION guard_immutable_flag() RETURNS TRIGGER
LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.is_immutable AND NEW.enabled IS DISTINCT FROM OLD.enabled THEN
    RAISE EXCEPTION
      'FLAG_IMMUTABLE: feature flag "%" cannot be toggled at runtime. It is set by deployment configuration and code review.',
      OLD.key USING ERRCODE = 'raise_exception';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER feature_flag_guard BEFORE UPDATE ON feature_flag
  FOR EACH ROW EXECUTE FUNCTION guard_immutable_flag();

-- ---------------------------------------------------------------------------
-- Fee schedule
-- ---------------------------------------------------------------------------

CREATE TABLE fee_schedule (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code              TEXT NOT NULL,
  version           INTEGER NOT NULL,
  corridor_id       UUID REFERENCES corridor(id),
  fee_type          TEXT NOT NULL CHECK (fee_type IN ('ekorails', 'partner', 'regulatory_levy')),
  -- Fixed component plus a basis-point component, both fixed-precision.
  fixed_amount      money_amount NOT NULL DEFAULT 0 CHECK (fixed_amount >= 0),
  fixed_currency    currency_code,
  rate_bps          NUMERIC(10, 4) NOT NULL DEFAULT 0 CHECK (rate_bps >= 0),
  minimum_amount    money_amount,
  maximum_amount    money_amount,
  status            TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('draft', 'active', 'retired')),
  effective_from    TIMESTAMPTZ NOT NULL DEFAULT now(),
  effective_to      TIMESTAMPTZ,
  approved_by       UUID REFERENCES app_user(id),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (code, version),
  CONSTRAINT fee_bounds_ordered CHECK (
    minimum_amount IS NULL OR maximum_amount IS NULL OR minimum_amount <= maximum_amount)
);

-- ---------------------------------------------------------------------------
-- Approval matrix — who must approve what, at which value threshold
-- ---------------------------------------------------------------------------

CREATE TABLE approval_matrix (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  action_key         TEXT NOT NULL,
  version            INTEGER NOT NULL,
  threshold_amount   money_amount,
  threshold_currency currency_code,
  -- Roles that may approve. A user must hold one of these AND must not be the maker.
  approver_roles     TEXT[] NOT NULL,
  approvals_required INTEGER NOT NULL DEFAULT 1 CHECK (approvals_required >= 1),
  requires_step_up   BOOLEAN NOT NULL DEFAULT FALSE,
  status             TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('draft', 'active', 'retired')),
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (action_key, version)
);

-- ---------------------------------------------------------------------------
-- Required-document matrix — configurable per corridor and organisation type
-- ---------------------------------------------------------------------------

CREATE TABLE required_document_rule (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  applies_to       TEXT NOT NULL CHECK (applies_to IN ('organization', 'beneficiary', 'transaction')),
  corridor_id      UUID REFERENCES corridor(id),
  document_type    TEXT NOT NULL,
  is_mandatory     BOOLEAN NOT NULL DEFAULT TRUE,
  -- Some documents expire and must be refreshed on a cadence.
  validity_months  INTEGER,
  condition        JSONB NOT NULL DEFAULT '{}'::jsonb,
  status           TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'retired')),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- Retention policy
-- ---------------------------------------------------------------------------

CREATE TABLE retention_policy (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  data_category     TEXT NOT NULL UNIQUE,
  description       TEXT NOT NULL,
  retention_months  INTEGER NOT NULL CHECK (retention_months > 0),
  legal_basis       TEXT NOT NULL,
  -- Records that AML/financial law requires be kept cannot be erased on request.
  erasure_permitted BOOLEAN NOT NULL DEFAULT FALSE,
  disposal_method   TEXT NOT NULL CHECK (disposal_method IN ('delete', 'anonymise', 'archive')),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- Rolling velocity counters
--
-- Materialised deliberately: the velocity rules must evaluate in constant time and
-- must not be affected by an unindexed table scan under load. Recomputable from the
-- transaction table at any time by the reconciliation job, which cross-checks them.
-- ---------------------------------------------------------------------------

CREATE TABLE velocity_counter (
  organization_id  UUID NOT NULL REFERENCES organization(id) ON DELETE RESTRICT,
  window_kind      TEXT NOT NULL CHECK (window_kind IN ('daily', 'monthly', 'pilot_total')),
  window_start     DATE NOT NULL,
  currency         currency_code NOT NULL,
  transaction_count INTEGER NOT NULL DEFAULT 0,
  total_amount     money_amount NOT NULL DEFAULT 0,
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, window_kind, window_start, currency)
);

-- ---------------------------------------------------------------------------
-- Founder Learning Center
-- ---------------------------------------------------------------------------

CREATE TABLE learning_module (
  key                TEXT PRIMARY KEY,
  ordinal            INTEGER NOT NULL,
  title              TEXT NOT NULL,
  what_it_does       TEXT NOT NULL,
  why_it_exists      TEXT NOT NULL,
  who_uses_it        TEXT NOT NULL,
  regulatory_significance TEXT NOT NULL,
  main_operational_risk   TEXT NOT NULL,
  what_if_it_fails   TEXT NOT NULL,
  -- Honest build status per the brief's completion definitions.
  completion_stage   TEXT NOT NULL CHECK (completion_stage IN (
                       'designed', 'frontend_built', 'backend_built', 'integrated',
                       'tested', 'security_reviewed', 'founder_accepted', 'pilot_ready')),
  simulated_parts    TEXT NOT NULL,
  known_limitations  TEXT NOT NULL
);

CREATE TABLE learning_glossary (
  term         TEXT PRIMARY KEY,
  short_definition TEXT NOT NULL,
  plain_english    TEXT NOT NULL,
  why_it_matters   TEXT NOT NULL,
  common_misunderstanding TEXT
);

CREATE TABLE learning_assessment_question (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  module_key     TEXT NOT NULL REFERENCES learning_module(key),
  ordinal        INTEGER NOT NULL,
  question       TEXT NOT NULL,
  options        JSONB NOT NULL,
  correct_index  INTEGER NOT NULL,
  explanation    TEXT NOT NULL,
  UNIQUE (module_key, ordinal)
);

-- Assessment results are recorded but never gate access to the system.
CREATE TABLE learning_assessment_attempt (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID NOT NULL REFERENCES app_user(id),
  module_key    TEXT NOT NULL REFERENCES learning_module(key),
  answers       JSONB NOT NULL,
  score         INTEGER NOT NULL,
  total         INTEGER NOT NULL,
  attempted_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- Decision log — every material product decision, including the open ones
-- ---------------------------------------------------------------------------

CREATE TABLE decision_log (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  decision_ref       TEXT NOT NULL UNIQUE,
  title              TEXT NOT NULL,
  decision_date      DATE,
  status             TEXT NOT NULL DEFAULT 'awaiting_approval' CHECK (status IN (
                       'awaiting_approval', 'approved', 'rejected', 'superseded', 'implemented')),
  context            TEXT NOT NULL,
  options_considered JSONB NOT NULL,
  recommended_option TEXT NOT NULL,
  reason_selected    TEXT,
  main_risk          TEXT NOT NULL,
  regulatory_impact  TEXT NOT NULL,
  cost_impact        TEXT NOT NULL,
  reversibility      TEXT NOT NULL CHECK (reversibility IN ('easily_reversible', 'costly_to_reverse', 'effectively_irreversible')),
  approver           TEXT,
  approved_at        TIMESTAMPTZ,
  blocks             TEXT NOT NULL,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TRIGGER decision_log_no_delete BEFORE DELETE ON decision_log
  FOR EACH ROW EXECUTE FUNCTION guard_no_delete();

-- ---------------------------------------------------------------------------
-- Build journal — what was built, what remains simulated, what is still open
-- ---------------------------------------------------------------------------

CREATE TABLE build_journal_entry (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  milestone         TEXT NOT NULL,
  entry_date        DATE NOT NULL,
  what_was_built    TEXT NOT NULL,
  what_changed      TEXT NOT NULL,
  how_to_test       TEXT NOT NULL,
  still_simulated   TEXT NOT NULL,
  known_limitations TEXT NOT NULL,
  open_decisions    TEXT NOT NULL,
  new_risks         TEXT NOT NULL,
  questions_for_founder TEXT NOT NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- Risk register
-- ---------------------------------------------------------------------------

CREATE TABLE risk_register_entry (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  risk_ref          TEXT NOT NULL UNIQUE,
  category          TEXT NOT NULL CHECK (category IN (
                      'regulatory', 'licensing', 'custody', 'settlement', 'liquidity', 'fx',
                      'fraud', 'cyber', 'data_protection', 'partner_dependency',
                      'accounting', 'operational', 'reputational', 'concentration')),
  title             TEXT NOT NULL,
  description       TEXT NOT NULL,
  inherent_likelihood TEXT NOT NULL CHECK (inherent_likelihood IN ('rare', 'unlikely', 'possible', 'likely', 'almost_certain')),
  inherent_impact     TEXT NOT NULL CHECK (inherent_impact IN ('minor', 'moderate', 'major', 'severe', 'critical')),
  existing_controls TEXT NOT NULL,
  -- Honest column: is the control implemented and tested, or only written down?
  control_status    TEXT NOT NULL CHECK (control_status IN (
                      'not_implemented', 'documented_only', 'implemented_untested',
                      'implemented_tested', 'implemented_and_independently_reviewed')),
  residual_likelihood TEXT NOT NULL CHECK (residual_likelihood IN ('rare', 'unlikely', 'possible', 'likely', 'almost_certain')),
  residual_impact     TEXT NOT NULL CHECK (residual_impact IN ('minor', 'moderate', 'major', 'severe', 'critical')),
  owner             TEXT NOT NULL,
  treatment         TEXT NOT NULL CHECK (treatment IN ('accept', 'mitigate', 'transfer', 'avoid')),
  further_action    TEXT NOT NULL,
  blocks_pilot      BOOLEAN NOT NULL DEFAULT FALSE,
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMIT;
