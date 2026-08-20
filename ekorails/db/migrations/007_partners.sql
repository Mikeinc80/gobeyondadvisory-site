-- 007_partners.sql — partner registry, integration events, idempotency and webhooks.
--
-- Every partner in this build is a simulator. The registry records what a partner
-- *would* do in a live deployment alongside what the simulator actually does, so a
-- reviewer can see the gap rather than having to infer it.

BEGIN;

CREATE TABLE partner (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code               TEXT NOT NULL UNIQUE,
  -- Deliberately generic. No real institution is named anywhere in this build; the
  -- filing has not been supplied and naming a partner would assert a commercial fact.
  display_name       TEXT NOT NULL,
  partner_role       TEXT NOT NULL CHECK (partner_role IN (
                       'origin_bank', 'fx_liquidity_provider', 'settlement_institution',
                       'destination_bank', 'identity_provider', 'screening_provider',
                       'bank_account_verification', 'device_fraud_intelligence')),
  -- What the partner is responsible for in a live deployment. Drives the
  -- "who does what" panel in the Founder Learning Center and the regulator view.
  live_responsibility TEXT NOT NULL,
  -- Which activities require the partner to hold a licence. EKORails performs none of these.
  licensed_activity  TEXT NOT NULL,
  jurisdiction       TEXT,
  -- TRUE for every partner in this build. A false value requires a signed contract
  -- reference, which no simulator can produce.
  is_simulated       BOOLEAN NOT NULL DEFAULT TRUE,
  contract_reference TEXT,
  adapter_key        TEXT NOT NULL,   -- resolves to a class in modules/partners/adapters
  adapter_version    TEXT NOT NULL,
  status             TEXT NOT NULL DEFAULT 'available' CHECK (status IN (
                       'available', 'degraded', 'unavailable', 'disabled')),
  -- Health signal shown on the operations dashboard.
  last_health_check_at TIMESTAMPTZ,
  last_health_status   TEXT,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT live_partner_needs_contract CHECK (is_simulated OR contract_reference IS NOT NULL)
);

CREATE TRIGGER partner_touch BEFORE UPDATE ON partner
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

-- Simulated nostro / operating positions held with each partner.
CREATE TABLE partner_account (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  partner_id        UUID NOT NULL REFERENCES partner(id) ON DELETE RESTRICT,
  account_label     TEXT NOT NULL,
  currency          currency_code NOT NULL,
  purpose           TEXT NOT NULL CHECK (purpose IN ('funding', 'settlement', 'fees', 'returns')),
  ledger_account_id UUID REFERENCES ledger_account(id),
  is_simulated      BOOLEAN NOT NULL DEFAULT TRUE,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (partner_id, account_label, currency)
);

ALTER TABLE settlement_instruction
  ADD CONSTRAINT settlement_partner_fk FOREIGN KEY (partner_id) REFERENCES partner(id);
ALTER TABLE funding_instruction
  ADD CONSTRAINT funding_partner_fk FOREIGN KEY (receiving_partner_id) REFERENCES partner(id);
ALTER TABLE ledger_account
  ADD CONSTRAINT ledger_partner_fk FOREIGN KEY (partner_id) REFERENCES partner(id);

-- ---------------------------------------------------------------------------
-- Idempotency
--
-- Two separate concerns, deliberately separated:
--   inbound_idempotency  — a caller (customer API or partner webhook) repeats a request.
--   outbound_idempotency — we must not instruct the same payment twice, even if our own
--                          process crashes and retries.
-- ---------------------------------------------------------------------------

CREATE TABLE inbound_idempotency (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  scope            TEXT NOT NULL,          -- e.g. 'txn.create', 'partner.callback'
  -- Namespaced so an organisation cannot collide with, or probe, another's keys.
  namespace        TEXT NOT NULL,
  idempotency_key  TEXT NOT NULL,
  -- Hash of the canonicalised request body. A repeat with the same key but a
  -- different body is a conflict, not a replay, and is rejected with 409.
  request_hash     sha256_hex NOT NULL,
  response_status  INTEGER,
  response_body    JSONB,
  state            TEXT NOT NULL DEFAULT 'in_progress' CHECK (state IN ('in_progress', 'completed', 'failed')),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at     TIMESTAMPTZ,
  expires_at       TIMESTAMPTZ NOT NULL,
  UNIQUE (scope, namespace, idempotency_key)
);

CREATE INDEX inbound_idempotency_expiry_idx ON inbound_idempotency(expires_at);

CREATE TABLE outbound_idempotency (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  partner_id       UUID NOT NULL REFERENCES partner(id),
  operation        TEXT NOT NULL,
  idempotency_key  TEXT NOT NULL,
  transaction_id   UUID REFERENCES transaction(id),
  state            TEXT NOT NULL DEFAULT 'in_flight' CHECK (state IN (
                     'in_flight', 'succeeded', 'failed', 'unknown')),
  attempt_count    INTEGER NOT NULL DEFAULT 1,
  first_sent_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_sent_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at      TIMESTAMPTZ,
  UNIQUE (partner_id, operation, idempotency_key)
);

-- 'unknown' is the dangerous state: we sent an instruction and never learned the
-- outcome. It must never be silently retried; it becomes a settlement exception.
COMMENT ON COLUMN outbound_idempotency.state IS
  'in_flight -> succeeded|failed|unknown. An ''unknown'' outcome raises a settlement '
  'exception for human resolution and is never auto-retried, because a blind retry is '
  'how a duplicate payment happens.';

-- ---------------------------------------------------------------------------
-- Integration events — the complete request/response log for every partner call
--
-- Append-only. Payloads are redacted before storage by the redaction layer
-- (src/core/redact.ts); credentials and full account identifiers never reach this table.
-- ---------------------------------------------------------------------------

CREATE TABLE integration_event (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  partner_id         UUID REFERENCES partner(id),
  direction          TEXT NOT NULL CHECK (direction IN ('outbound', 'inbound')),
  operation          TEXT NOT NULL,
  transaction_id     UUID REFERENCES transaction(id),
  organization_id    UUID REFERENCES organization(id),
  correlation_id     UUID NOT NULL,
  idempotency_key    TEXT,
  request_payload    JSONB,
  response_payload   JSONB,
  http_status        INTEGER,
  outcome            TEXT NOT NULL CHECK (outcome IN (
                       'success', 'client_error', 'server_error', 'timeout',
                       'duplicate_ignored', 'rejected', 'simulated_failure')),
  latency_ms         INTEGER,
  simulation_scenario TEXT,   -- which simulator scenario produced this, if any
  occurred_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX integration_event_txn_idx ON integration_event(transaction_id, occurred_at);
CREATE INDEX integration_event_partner_idx ON integration_event(partner_id, occurred_at DESC);
CREATE INDEX integration_event_correlation_idx ON integration_event(correlation_id);
CREATE TRIGGER integration_event_append_only BEFORE UPDATE OR DELETE ON integration_event
  FOR EACH ROW EXECUTE FUNCTION guard_append_only();

-- ---------------------------------------------------------------------------
-- Simulation control
--
-- Lets an operator or a test force a specific partner behaviour. Scenarios are
-- consumed in order and are scoped to a partner and optionally a transaction.
-- ---------------------------------------------------------------------------

CREATE TABLE simulation_directive (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  partner_id       UUID REFERENCES partner(id),
  transaction_id   UUID REFERENCES transaction(id),
  operation        TEXT,
  scenario         TEXT NOT NULL CHECK (scenario IN (
                     'success', 'delayed_funding', 'compliance_failure', 'insufficient_liquidity',
                     'invalid_beneficiary', 'partner_timeout', 'duplicate_response',
                     'failed_settlement', 'partial_settlement', 'returned_payment',
                     'reconciliation_mismatch')),
  parameters       JSONB NOT NULL DEFAULT '{}'::jsonb,
  -- How many times this directive applies before it is exhausted. NULL = until revoked.
  remaining_uses   INTEGER,
  created_by       UUID REFERENCES app_user(id),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  revoked_at       TIMESTAMPTZ,
  CONSTRAINT directive_uses_positive CHECK (remaining_uses IS NULL OR remaining_uses > 0)
);

CREATE INDEX simulation_directive_lookup_idx
  ON simulation_directive(partner_id, transaction_id) WHERE revoked_at IS NULL;

-- ---------------------------------------------------------------------------
-- Outbound webhooks to customers
-- ---------------------------------------------------------------------------

CREATE TABLE webhook_endpoint (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  UUID NOT NULL REFERENCES organization(id) ON DELETE RESTRICT,
  url              TEXT NOT NULL,
  -- The signing secret is stored encrypted; the plaintext is shown once at creation.
  secret_encrypted TEXT NOT NULL,
  subscribed_events TEXT[] NOT NULL,
  status           TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'paused', 'disabled')),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE webhook_delivery (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  endpoint_id      UUID NOT NULL REFERENCES webhook_endpoint(id) ON DELETE RESTRICT,
  event_type       TEXT NOT NULL,
  payload          JSONB NOT NULL,
  signature        TEXT NOT NULL,
  attempt_count    INTEGER NOT NULL DEFAULT 0,
  status           TEXT NOT NULL DEFAULT 'queued' CHECK (status IN (
                     'queued', 'delivering', 'delivered', 'failed', 'dead_letter')),
  last_error       TEXT,
  next_attempt_at  TIMESTAMPTZ,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  delivered_at     TIMESTAMPTZ
);

CREATE INDEX webhook_delivery_queue_idx ON webhook_delivery(status, next_attempt_at);

-- ---------------------------------------------------------------------------
-- Background job queue with retry and dead-letter handling
-- ---------------------------------------------------------------------------

CREATE TABLE job (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  queue            TEXT NOT NULL,
  job_type         TEXT NOT NULL,
  payload          JSONB NOT NULL,
  -- Jobs that must not run twice carry a key; the unique index enforces it.
  dedupe_key       TEXT,
  priority         INTEGER NOT NULL DEFAULT 100,
  status           TEXT NOT NULL DEFAULT 'queued' CHECK (status IN (
                     'queued', 'running', 'succeeded', 'failed', 'dead_letter', 'cancelled')),
  attempt_count    INTEGER NOT NULL DEFAULT 0,
  max_attempts     INTEGER NOT NULL DEFAULT 5,
  last_error       TEXT,
  run_after        TIMESTAMPTZ NOT NULL DEFAULT now(),
  locked_at        TIMESTAMPTZ,
  locked_by        TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at      TIMESTAMPTZ
);

CREATE UNIQUE INDEX job_dedupe_idx ON job(queue, dedupe_key)
  WHERE dedupe_key IS NOT NULL AND status IN ('queued', 'running');
CREATE INDEX job_poll_idx ON job(queue, status, run_after, priority);

COMMIT;
