-- 005_transactions.sql — transactions, maker-checker approvals, FX quotes, funding,
-- settlement instructions and the settlement state machine.

BEGIN;

-- ---------------------------------------------------------------------------
-- Corridors — configuration, but referenced relationally so a transaction cannot
-- name a corridor that does not exist.
-- ---------------------------------------------------------------------------

CREATE TABLE corridor (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code                   TEXT NOT NULL UNIQUE,
  origin_country         TEXT NOT NULL,   -- may hold an INSERT_APPROVED_* placeholder
  destination_country    TEXT NOT NULL,
  origin_currency        TEXT NOT NULL,
  destination_currency   TEXT NOT NULL,
  -- TRUE while any of the four fields above is still a placeholder awaiting the filing.
  is_placeholder         BOOLEAN NOT NULL DEFAULT TRUE,
  status                 TEXT NOT NULL DEFAULT 'enabled' CHECK (status IN ('enabled', 'disabled')),
  -- Limits. NULL means "not yet set by the filing"; the limit engine treats NULL as
  -- a hard block, never as unlimited. See modules/compliance/limits.ts.
  per_transaction_limit  money_amount,
  daily_limit            money_amount,
  monthly_limit          money_amount,
  pilot_aggregate_cap    money_amount,
  limit_currency         currency_code,
  notes                  TEXT,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TRIGGER corridor_touch BEFORE UPDATE ON corridor
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

-- ---------------------------------------------------------------------------
-- FX quotes
--
-- Every component of the price is a separate structured column. A reviewer must be
-- able to see reference rate, provider rate, spread, each fee and each levy without
-- reverse-engineering a total.
-- ---------------------------------------------------------------------------

CREATE TABLE fx_quote (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  reference               external_reference NOT NULL UNIQUE,
  organization_id         UUID NOT NULL REFERENCES organization(id) ON DELETE RESTRICT,
  corridor_id             UUID NOT NULL REFERENCES corridor(id),

  send_currency           currency_code NOT NULL,
  receive_currency        currency_code NOT NULL,
  send_amount             money_amount NOT NULL CHECK (send_amount > 0),

  -- Rates. reference_rate is the mid-market observation; provider_rate is what the
  -- liquidity source actually offered. The difference is the spread, stored explicitly.
  reference_rate          fx_rate NOT NULL CHECK (reference_rate > 0),
  reference_rate_source   TEXT NOT NULL,
  reference_rate_at       TIMESTAMPTZ NOT NULL,
  provider_rate           fx_rate NOT NULL CHECK (provider_rate > 0),
  spread_bps              NUMERIC(10, 4) NOT NULL,

  -- Charges, each separate. Never netted into the rate.
  ekorails_fee            money_amount NOT NULL DEFAULT 0 CHECK (ekorails_fee >= 0),
  ekorails_fee_currency   currency_code NOT NULL,
  partner_fee             money_amount NOT NULL DEFAULT 0 CHECK (partner_fee >= 0),
  partner_fee_currency    currency_code NOT NULL,
  tax_or_levy             money_amount NOT NULL DEFAULT 0 CHECK (tax_or_levy >= 0),
  tax_or_levy_currency    currency_code NOT NULL,
  tax_basis               TEXT,

  total_payable           money_amount NOT NULL CHECK (total_payable > 0),
  total_payable_currency  currency_code NOT NULL,
  expected_receivable     money_amount NOT NULL CHECK (expected_receivable > 0),
  expected_receive_currency currency_code NOT NULL,

  -- Provenance. `quote_source` says exactly where the rate came from; `is_simulated`
  -- drives the mandatory "Simulated rate" label in the UI.
  quote_source            TEXT NOT NULL CHECK (quote_source IN (
                            'manual_treasury_entry', 'test_market_data_provider', 'mock_liquidity_provider')),
  quote_source_detail     TEXT,
  is_simulated            BOOLEAN NOT NULL DEFAULT TRUE,
  -- 'indicative' before acceptance. 'locked' ONLY where a partner has contractually
  -- locked the rate — which no simulator can do, so simulated quotes stay indicative.
  lock_status             TEXT NOT NULL DEFAULT 'indicative' CHECK (lock_status IN ('indicative', 'locked')),
  lock_evidence_ref       TEXT,

  issued_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at              TIMESTAMPTZ NOT NULL,
  status                  TEXT NOT NULL DEFAULT 'issued' CHECK (status IN (
                            'issued', 'accepted', 'expired', 'withdrawn', 'superseded')),
  accepted_at             TIMESTAMPTZ,
  accepted_by             UUID REFERENCES app_user(id),
  issued_by               UUID REFERENCES app_user(id),

  CONSTRAINT quote_expiry_after_issue CHECK (expires_at > issued_at),
  -- A simulated quote can never claim a contractual lock.
  CONSTRAINT simulated_quote_cannot_lock CHECK (NOT (is_simulated AND lock_status = 'locked')),
  CONSTRAINT locked_quote_has_evidence CHECK (lock_status <> 'locked' OR lock_evidence_ref IS NOT NULL)
);

CREATE INDEX fx_quote_org_idx ON fx_quote(organization_id, status);
CREATE INDEX fx_quote_expiry_idx ON fx_quote(expires_at) WHERE status = 'issued';
CREATE TRIGGER fx_quote_no_delete BEFORE DELETE ON fx_quote
  FOR EACH ROW EXECUTE FUNCTION guard_no_delete();

-- ---------------------------------------------------------------------------
-- Transactions
-- ---------------------------------------------------------------------------

CREATE TABLE transaction (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Immutable, human-readable, generated once at creation. Guarded below.
  reference               external_reference NOT NULL UNIQUE,
  organization_id         UUID NOT NULL REFERENCES organization(id) ON DELETE RESTRICT,
  beneficiary_id          UUID NOT NULL REFERENCES beneficiary(id) ON DELETE RESTRICT,
  corridor_id             UUID NOT NULL REFERENCES corridor(id),

  send_currency           currency_code NOT NULL,
  receive_currency        currency_code NOT NULL,
  send_amount             money_amount NOT NULL CHECK (send_amount > 0),
  expected_receive_amount money_amount CHECK (expected_receive_amount IS NULL OR expected_receive_amount > 0),
  -- Filled at settlement from the partner's report; may differ from expected.
  actual_receive_amount   money_amount,

  purpose                 TEXT NOT NULL,
  source_of_funds         TEXT NOT NULL,
  requested_settlement_date DATE,

  fx_quote_id             UUID REFERENCES fx_quote(id),

  -- Maker-checker anchors. `initiated_by` can never equal `approved_by` — enforced
  -- both here and in transaction_approval.
  initiated_by            UUID NOT NULL REFERENCES app_user(id),
  approved_by             UUID REFERENCES app_user(id),
  approved_at             TIMESTAMPTZ,

  state                   TEXT NOT NULL DEFAULT 'draft' CHECK (state IN (
                            'draft', 'pending_business_approval', 'pending_compliance',
                            'additional_information_required', 'compliance_approved',
                            'quote_issued', 'quote_accepted', 'awaiting_funding',
                            'funding_confirmed', 'ready_for_settlement', 'submitted_to_partner',
                            'partner_processing', 'settled', 'beneficiary_confirmed',
                            'reconciled', 'completed', 'rejected', 'cancelled', 'expired',
                            'failed', 'returned', 'under_investigation')),

  risk_rating             TEXT CHECK (risk_rating IN ('low', 'medium', 'high', 'prohibited')),
  latest_risk_assessment_id UUID REFERENCES risk_assessment(id),

  -- Duplicate-invoice detection. Fingerprint over (invoice number, beneficiary, amount, currency).
  invoice_number          TEXT,
  invoice_fingerprint     sha256_hex,

  -- Client-supplied idempotency key scoped to the organisation.
  idempotency_key         TEXT,

  created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at            TIMESTAMPTZ,

  CONSTRAINT maker_is_not_checker CHECK (approved_by IS NULL OR approved_by <> initiated_by),
  CONSTRAINT approval_is_timestamped CHECK ((approved_by IS NULL) = (approved_at IS NULL))
);

CREATE UNIQUE INDEX transaction_idempotency_idx
  ON transaction(organization_id, idempotency_key) WHERE idempotency_key IS NOT NULL;
CREATE INDEX transaction_org_state_idx ON transaction(organization_id, state);
CREATE INDEX transaction_state_idx ON transaction(state);
CREATE INDEX transaction_invoice_fp_idx ON transaction(invoice_fingerprint)
  WHERE invoice_fingerprint IS NOT NULL;
CREATE INDEX transaction_created_idx ON transaction(created_at DESC);

CREATE TRIGGER transaction_touch BEFORE UPDATE ON transaction
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
CREATE TRIGGER transaction_no_delete BEFORE DELETE ON transaction
  FOR EACH ROW EXECUTE FUNCTION guard_no_delete();

-- The reference, the organisation and the initiator are set once and never change.
-- Amounts may only change while the transaction is still a draft.
CREATE OR REPLACE FUNCTION guard_transaction_core() RETURNS TRIGGER
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.reference IS DISTINCT FROM OLD.reference THEN
    RAISE EXCEPTION 'IMMUTABLE_REFERENCE: transaction reference cannot be changed'
      USING ERRCODE = 'raise_exception';
  END IF;
  IF NEW.organization_id IS DISTINCT FROM OLD.organization_id THEN
    RAISE EXCEPTION 'IMMUTABLE_OWNER: a transaction cannot be moved between organisations'
      USING ERRCODE = 'raise_exception';
  END IF;
  IF NEW.initiated_by IS DISTINCT FROM OLD.initiated_by THEN
    RAISE EXCEPTION 'IMMUTABLE_INITIATOR: the initiating user cannot be rewritten'
      USING ERRCODE = 'raise_exception';
  END IF;
  IF OLD.state <> 'draft' AND (
       NEW.send_amount IS DISTINCT FROM OLD.send_amount
    OR NEW.send_currency IS DISTINCT FROM OLD.send_currency
    OR NEW.receive_currency IS DISTINCT FROM OLD.receive_currency
    OR NEW.beneficiary_id IS DISTINCT FROM OLD.beneficiary_id) THEN
    RAISE EXCEPTION
      'IMMUTABLE_ECONOMICS: amount, currencies and beneficiary are fixed once a transaction leaves draft (state=%). Cancel and re-create.',
      OLD.state USING ERRCODE = 'raise_exception';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER transaction_guard_core BEFORE UPDATE ON transaction
  FOR EACH ROW EXECUTE FUNCTION guard_transaction_core();

-- ---------------------------------------------------------------------------
-- Maker-checker approvals
-- ---------------------------------------------------------------------------

CREATE TABLE transaction_approval (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  transaction_id  UUID NOT NULL REFERENCES transaction(id) ON DELETE RESTRICT,
  organization_id UUID NOT NULL REFERENCES organization(id) ON DELETE RESTRICT,
  approval_type   TEXT NOT NULL CHECK (approval_type IN (
                    'business_dual_authorisation', 'compliance', 'treasury_quote_acceptance',
                    'settlement_release', 'high_value_override')),
  decision        TEXT NOT NULL CHECK (decision IN ('approved', 'rejected')),
  decided_by      UUID NOT NULL REFERENCES app_user(id),
  decided_by_role TEXT NOT NULL REFERENCES role(code),
  reason          TEXT,
  -- Step-up authentication evidence: which session, and whether MFA was re-asserted.
  session_id      UUID,
  step_up_verified BOOLEAN NOT NULL DEFAULT FALSE,
  decided_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (transaction_id, approval_type, decided_by)
);

CREATE INDEX transaction_approval_txn_idx ON transaction_approval(transaction_id);
CREATE TRIGGER transaction_approval_append_only BEFORE UPDATE OR DELETE ON transaction_approval
  FOR EACH ROW EXECUTE FUNCTION guard_append_only();

-- The database itself refuses a self-approval on the dual-authorisation step.
-- This is the control that test case 18 exercises.
CREATE OR REPLACE FUNCTION guard_no_self_approval() RETURNS TRIGGER
LANGUAGE plpgsql AS $$
DECLARE initiator UUID;
BEGIN
  IF NEW.approval_type = 'business_dual_authorisation' THEN
    SELECT initiated_by INTO initiator FROM transaction WHERE id = NEW.transaction_id;
    IF initiator = NEW.decided_by THEN
      RAISE EXCEPTION
        'SEGREGATION_OF_DUTIES: user % initiated this transaction and cannot provide its dual authorisation',
        NEW.decided_by USING ERRCODE = 'raise_exception';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER transaction_approval_no_self BEFORE INSERT ON transaction_approval
  FOR EACH ROW EXECUTE FUNCTION guard_no_self_approval();

-- ---------------------------------------------------------------------------
-- Transaction documents (link table with a stated evidentiary role)
-- ---------------------------------------------------------------------------

CREATE TABLE transaction_document (
  transaction_id  UUID NOT NULL REFERENCES transaction(id) ON DELETE RESTRICT,
  document_id     UUID NOT NULL REFERENCES document(id) ON DELETE RESTRICT,
  role            TEXT NOT NULL CHECK (role IN (
                    'primary_invoice', 'purchase_order', 'contract', 'bill_of_lading',
                    'customs_document', 'proof_of_delivery', 'source_of_funds', 'other')),
  linked_by       UUID NOT NULL REFERENCES app_user(id),
  linked_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (transaction_id, document_id, role)
);

-- ---------------------------------------------------------------------------
-- State machine transitions — the transaction's history, append-only
-- ---------------------------------------------------------------------------

CREATE TABLE transaction_transition (
  id                 BIGSERIAL PRIMARY KEY,
  transaction_id     UUID NOT NULL REFERENCES transaction(id) ON DELETE RESTRICT,
  organization_id    UUID NOT NULL REFERENCES organization(id) ON DELETE RESTRICT,
  from_state         TEXT,
  to_state           TEXT NOT NULL,
  -- Who caused it: a user, a partner callback, a scheduled job, or the engine itself.
  actor_type         TEXT NOT NULL CHECK (actor_type IN ('user', 'partner', 'job', 'engine')),
  actor_user_id      UUID REFERENCES app_user(id),
  actor_role         TEXT REFERENCES role(code),
  actor_partner_id   UUID,
  reason             TEXT NOT NULL,
  evidence           JSONB NOT NULL DEFAULT '{}'::jsonb,
  -- The journal this transition posted, if any. NULL where a transition has no
  -- accounting consequence — which is itself a documented fact, not an omission.
  journal_id         UUID,
  occurred_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX transaction_transition_txn_idx ON transaction_transition(transaction_id, occurred_at);
CREATE TRIGGER transaction_transition_append_only BEFORE UPDATE OR DELETE ON transaction_transition
  FOR EACH ROW EXECUTE FUNCTION guard_append_only();

-- ---------------------------------------------------------------------------
-- Funding and settlement instructions
-- ---------------------------------------------------------------------------

CREATE TABLE funding_instruction (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  transaction_id      UUID NOT NULL REFERENCES transaction(id) ON DELETE RESTRICT,
  organization_id     UUID NOT NULL REFERENCES organization(id) ON DELETE RESTRICT,
  -- The customer pays the licensed partner institution, not EKORails. This column
  -- names the receiving institution so no screen can imply EKORails holds the money.
  receiving_partner_id UUID,
  expected_amount     money_amount NOT NULL CHECK (expected_amount > 0),
  expected_currency   currency_code NOT NULL,
  received_amount     money_amount,
  received_currency   currency_code,
  payment_reference   TEXT NOT NULL,
  status              TEXT NOT NULL DEFAULT 'awaiting' CHECK (status IN (
                        'awaiting', 'partially_received', 'confirmed', 'over_funded',
                        'short_funded', 'failed', 'returned', 'cancelled')),
  is_simulated        BOOLEAN NOT NULL DEFAULT TRUE,
  confirmed_at        TIMESTAMPTZ,
  confirmed_by        UUID REFERENCES app_user(id),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT funding_received_pair CHECK ((received_amount IS NULL) = (received_currency IS NULL))
);

CREATE INDEX funding_instruction_txn_idx ON funding_instruction(transaction_id);
CREATE TRIGGER funding_instruction_touch BEFORE UPDATE ON funding_instruction
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

CREATE TABLE settlement_instruction (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  transaction_id        UUID NOT NULL REFERENCES transaction(id) ON DELETE RESTRICT,
  organization_id       UUID NOT NULL REFERENCES organization(id) ON DELETE RESTRICT,
  partner_id            UUID NOT NULL,
  -- Idempotency key sent to the partner. The same key must never produce two payments.
  idempotency_key       TEXT NOT NULL,
  instructed_amount     money_amount NOT NULL CHECK (instructed_amount > 0),
  instructed_currency   currency_code NOT NULL,
  settled_amount        money_amount,
  settled_currency      currency_code,
  partner_reference     TEXT,
  status                TEXT NOT NULL DEFAULT 'created' CHECK (status IN (
                          'created', 'submitted', 'accepted', 'processing', 'settled',
                          'partially_settled', 'rejected', 'failed', 'returned', 'timeout', 'cancelled')),
  failure_code          TEXT,
  failure_detail        TEXT,
  is_simulated          BOOLEAN NOT NULL DEFAULT TRUE,
  submitted_at          TIMESTAMPTZ,
  settled_at            TIMESTAMPTZ,
  released_by           UUID REFERENCES app_user(id),
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (partner_id, idempotency_key)
);

CREATE INDEX settlement_instruction_txn_idx ON settlement_instruction(transaction_id);
CREATE INDEX settlement_instruction_status_idx ON settlement_instruction(status);
CREATE TRIGGER settlement_instruction_touch BEFORE UPDATE ON settlement_instruction
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

COMMIT;
