-- 008_reconciliation.sql — reconciliation runs, matching items, exceptions and breaks.

BEGIN;

-- Statements received from partners. In this build they are produced by the
-- simulators; the shape is what a real partner statement feed would carry.
CREATE TABLE partner_statement (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  partner_id        UUID NOT NULL REFERENCES partner(id) ON DELETE RESTRICT,
  statement_date    DATE NOT NULL,
  currency          currency_code NOT NULL,
  opening_balance   money_amount NOT NULL,
  closing_balance   money_amount NOT NULL,
  is_simulated      BOOLEAN NOT NULL DEFAULT TRUE,
  received_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  source_hash       sha256_hex NOT NULL,
  UNIQUE (partner_id, statement_date, currency)
);

CREATE TABLE partner_statement_line (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  statement_id        UUID NOT NULL REFERENCES partner_statement(id) ON DELETE RESTRICT,
  line_number         INTEGER NOT NULL,
  partner_reference   TEXT NOT NULL,
  -- The partner's own view of what happened. Deliberately its own columns rather than
  -- being merged into ours, so a mismatch is visible instead of being overwritten.
  value_date          DATE NOT NULL,
  direction           TEXT NOT NULL CHECK (direction IN ('debit', 'credit')),
  amount              money_amount NOT NULL CHECK (amount > 0),
  currency            currency_code NOT NULL,
  narrative           TEXT,
  our_reference       TEXT,          -- the transaction reference, when the partner echoes it
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (statement_id, line_number)
);

CREATE INDEX partner_statement_line_ref_idx ON partner_statement_line(our_reference);
CREATE TRIGGER partner_statement_line_append_only BEFORE UPDATE OR DELETE ON partner_statement_line
  FOR EACH ROW EXECUTE FUNCTION guard_append_only();

-- ---------------------------------------------------------------------------
-- Reconciliation runs
-- ---------------------------------------------------------------------------

CREATE TABLE reconciliation_run (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  reference          external_reference NOT NULL UNIQUE,
  run_type           TEXT NOT NULL CHECK (run_type IN (
                       'transaction_to_ledger', 'ledger_to_partner_statement', 'funding',
                       'settlement', 'fees', 'currency_position')),
  business_date      DATE NOT NULL,
  partner_id         UUID REFERENCES partner(id),
  currency           currency_code,
  status             TEXT NOT NULL DEFAULT 'running' CHECK (status IN (
                       'running', 'completed', 'completed_with_breaks', 'failed')),
  started_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at        TIMESTAMPTZ,
  started_by         UUID REFERENCES app_user(id),
  -- Summary counters, written once at completion.
  items_total        INTEGER NOT NULL DEFAULT 0,
  items_matched      INTEGER NOT NULL DEFAULT 0,
  items_broken       INTEGER NOT NULL DEFAULT 0,
  -- The net difference the run could not explain, per currency.
  unexplained_amount money_amount,
  notes              TEXT
);

CREATE INDEX reconciliation_run_date_idx ON reconciliation_run(business_date DESC, run_type);
CREATE TRIGGER reconciliation_run_no_delete BEFORE DELETE ON reconciliation_run
  FOR EACH ROW EXECUTE FUNCTION guard_no_delete();

CREATE TABLE reconciliation_item (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id                UUID NOT NULL REFERENCES reconciliation_run(id) ON DELETE RESTRICT,
  -- What was compared. Either side may be absent — that absence is itself a result.
  internal_ref          TEXT,
  internal_kind         TEXT CHECK (internal_kind IN ('transaction', 'journal', 'journal_entry', 'funding', 'settlement')),
  internal_id           UUID,
  internal_amount       money_amount,
  internal_currency     currency_code,
  internal_date         DATE,

  external_ref          TEXT,
  external_id           UUID,
  external_amount       money_amount,
  external_currency     currency_code,
  external_date         DATE,

  result                TEXT NOT NULL CHECK (result IN (
                          'matched', 'partially_matched', 'unmatched', 'duplicate',
                          'amount_difference', 'currency_difference', 'date_difference',
                          'missing_partner_record', 'missing_internal_record')),
  difference_amount     money_amount,
  difference_currency   currency_code,
  detail                TEXT NOT NULL,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX reconciliation_item_run_idx ON reconciliation_item(run_id, result);
CREATE TRIGGER reconciliation_item_append_only BEFORE UPDATE OR DELETE ON reconciliation_item
  FOR EACH ROW EXECUTE FUNCTION guard_append_only();

-- ---------------------------------------------------------------------------
-- Exception cases (breaks)
--
-- Every break gets an owner, a priority and a closing approval. A reconciliation
-- system without accountable ownership is a report, not a control.
-- ---------------------------------------------------------------------------

CREATE TABLE exception_case (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  reference            external_reference NOT NULL UNIQUE,
  exception_type       TEXT NOT NULL CHECK (exception_type IN (
                         'reconciliation_break', 'settlement_failure', 'funding_discrepancy',
                         'partner_timeout', 'duplicate_settlement_risk', 'unknown_partner_outcome',
                         'ledger_anomaly', 'currency_position_breach')),
  reconciliation_item_id UUID REFERENCES reconciliation_item(id),
  transaction_id       UUID REFERENCES transaction(id),
  organization_id      UUID REFERENCES organization(id),
  partner_id           UUID REFERENCES partner(id),
  currency             currency_code,
  amount               money_amount,

  priority             TEXT NOT NULL DEFAULT 'normal' CHECK (priority IN ('low', 'normal', 'high', 'critical')),
  owner_id             UUID REFERENCES app_user(id),
  status               TEXT NOT NULL DEFAULT 'open' CHECK (status IN (
                         'open', 'investigating', 'awaiting_partner', 'awaiting_customer',
                         'pending_approval', 'resolved', 'written_off', 'closed_no_action')),
  -- Resolution requires a second person's approval — a break cannot be closed by the
  -- person who investigated it where the amount exceeds the four-eyes threshold.
  resolution           TEXT,
  resolution_journal_id UUID REFERENCES journal(id),
  resolved_by          UUID REFERENCES app_user(id),
  resolved_at          TIMESTAMPTZ,
  approved_by          UUID REFERENCES app_user(id),
  approved_at          TIMESTAMPTZ,
  opened_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  sla_due_at           TIMESTAMPTZ,
  closed_at            TIMESTAMPTZ,
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT exception_four_eyes CHECK (approved_by IS NULL OR resolved_by IS NULL OR approved_by <> resolved_by),
  CONSTRAINT resolution_has_text CHECK (
    status NOT IN ('resolved', 'written_off') OR length(coalesce(resolution, '')) >= 20)
);

CREATE INDEX exception_case_queue_idx ON exception_case(status, priority, sla_due_at);
CREATE INDEX exception_case_txn_idx ON exception_case(transaction_id);
CREATE TRIGGER exception_case_touch BEFORE UPDATE ON exception_case
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
CREATE TRIGGER exception_case_no_delete BEFORE DELETE ON exception_case
  FOR EACH ROW EXECUTE FUNCTION guard_no_delete();

CREATE TABLE exception_case_note (
  id                BIGSERIAL PRIMARY KEY,
  exception_case_id UUID NOT NULL REFERENCES exception_case(id) ON DELETE RESTRICT,
  author_id         UUID NOT NULL REFERENCES app_user(id),
  body              TEXT NOT NULL,
  evidence_refs     JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TRIGGER exception_case_note_append_only BEFORE UPDATE OR DELETE ON exception_case_note
  FOR EACH ROW EXECUTE FUNCTION guard_append_only();

COMMIT;
