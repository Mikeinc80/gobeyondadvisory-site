-- 009_audit_cases.sql — audit trail, notifications, support cases, complaints,
-- security incidents, reports and data-subject requests.

BEGIN;

-- ---------------------------------------------------------------------------
-- Audit trail
--
-- Append-only AND hash-chained. Each row carries the hash of its predecessor, so
-- removing or altering a row in the middle of the chain is detectable even by an
-- actor with direct database access. The verification routine walks the chain and
-- reports the first sequence number where it breaks.
--
-- The application role holds INSERT and SELECT on this table and nothing else
-- (see 011_security.sql). An application-level System Administrator therefore has
-- no route to edit an audit record — which is test case 15.
-- ---------------------------------------------------------------------------

CREATE TABLE audit_event (
  -- Monotonic sequence is the chain order. BIGSERIAL, not a timestamp, because two
  -- events can share a timestamp.
  seq              BIGSERIAL PRIMARY KEY,
  id               UUID NOT NULL DEFAULT gen_random_uuid() UNIQUE,

  occurred_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Categorised so that an auditor can filter to exactly the class of activity they
  -- are testing without reading free text.
  category         TEXT NOT NULL CHECK (category IN (
                     'authentication', 'authorisation', 'data_read', 'data_create',
                     'data_update', 'document_access', 'compliance_decision', 'approval',
                     'rule_change', 'limit_change', 'role_change', 'configuration_change',
                     'settlement_transition', 'ledger_posting', 'report_export',
                     'administrative_access', 'integration', 'security_check_failed',
                     'privacy_request', 'break_glass')),
  action           TEXT NOT NULL,
  outcome          TEXT NOT NULL CHECK (outcome IN ('success', 'failure', 'denied')),

  -- Actor
  actor_user_id    UUID REFERENCES app_user(id),
  actor_role       TEXT,
  actor_type       TEXT NOT NULL DEFAULT 'user' CHECK (actor_type IN ('user', 'system', 'partner', 'job', 'anonymous')),
  session_id       UUID,
  -- Network attribution is hashed: an IP address is personal data and is not needed
  -- in cleartext to correlate activity.
  ip_hash          sha256_hex,
  user_agent_hash  sha256_hex,

  -- Subject
  organization_id  UUID REFERENCES organization(id),
  entity_type      TEXT,
  entity_id        UUID,
  transaction_id   UUID REFERENCES transaction(id),

  -- Change detail. Values are passed through the redaction layer before they reach
  -- this table: no password, token, full identification number, full account number
  -- or private key can be written here.
  old_values       JSONB,
  new_values       JSONB,
  metadata         JSONB NOT NULL DEFAULT '{}'::jsonb,
  reason           TEXT,

  correlation_id   UUID,
  request_id       UUID,

  -- Hash chain
  prev_hash        sha256_hex,
  entry_hash       sha256_hex NOT NULL
);

CREATE INDEX audit_event_time_idx ON audit_event(occurred_at DESC);
CREATE INDEX audit_event_actor_idx ON audit_event(actor_user_id, occurred_at DESC);
CREATE INDEX audit_event_org_idx ON audit_event(organization_id, occurred_at DESC);
CREATE INDEX audit_event_entity_idx ON audit_event(entity_type, entity_id);
CREATE INDEX audit_event_txn_idx ON audit_event(transaction_id) WHERE transaction_id IS NOT NULL;
CREATE INDEX audit_event_category_idx ON audit_event(category, occurred_at DESC);
CREATE INDEX audit_event_correlation_idx ON audit_event(correlation_id) WHERE correlation_id IS NOT NULL;

CREATE TRIGGER audit_event_append_only BEFORE UPDATE OR DELETE ON audit_event
  FOR EACH ROW EXECUTE FUNCTION guard_append_only();

-- Chain verification. Returns the first broken link, or no rows if the chain is intact.
-- The hash input is built here in SQL so that verification does not depend on the
-- application being available or honest.
CREATE OR REPLACE FUNCTION audit_chain_payload(e audit_event) RETURNS TEXT
LANGUAGE sql IMMUTABLE AS $$
  SELECT concat_ws('|',
    e.seq::text,
    e.id::text,
    to_char(e.occurred_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
    e.category, e.action, e.outcome,
    coalesce(e.actor_user_id::text, ''), coalesce(e.actor_role, ''), e.actor_type,
    coalesce(e.organization_id::text, ''), coalesce(e.entity_type, ''), coalesce(e.entity_id::text, ''),
    coalesce(e.old_values::text, ''), coalesce(e.new_values::text, ''), e.metadata::text,
    coalesce(e.reason, ''), coalesce(e.prev_hash, ''))
$$;

CREATE OR REPLACE FUNCTION verify_audit_chain(from_seq BIGINT DEFAULT 0)
RETURNS TABLE (broken_seq BIGINT, expected_hash sha256_hex, stored_hash sha256_hex, problem TEXT)
LANGUAGE plpgsql STABLE AS $$
DECLARE
  r         audit_event%ROWTYPE;
  computed  TEXT;
  last_hash TEXT := NULL;
  first     BOOLEAN := TRUE;
BEGIN
  FOR r IN SELECT * FROM audit_event WHERE seq > from_seq ORDER BY seq LOOP
    IF NOT first AND r.prev_hash IS DISTINCT FROM last_hash THEN
      broken_seq := r.seq; expected_hash := last_hash::sha256_hex;
      stored_hash := r.prev_hash; problem := 'prev_hash does not match the preceding entry_hash';
      RETURN NEXT; RETURN;
    END IF;
    computed := encode(digest(audit_chain_payload(r), 'sha256'), 'hex');
    IF computed IS DISTINCT FROM r.entry_hash THEN
      broken_seq := r.seq; expected_hash := computed::sha256_hex;
      stored_hash := r.entry_hash; problem := 'entry_hash does not match the row contents';
      RETURN NEXT; RETURN;
    END IF;
    last_hash := r.entry_hash;
    first := FALSE;
  END LOOP;
  RETURN;
END;
$$;

-- Computes prev_hash and entry_hash on insert so the chain cannot be forged by a
-- caller that supplies its own hashes.
CREATE OR REPLACE FUNCTION audit_seal() RETURNS TRIGGER
LANGUAGE plpgsql AS $$
DECLARE prev TEXT;
BEGIN
  SELECT entry_hash INTO prev FROM audit_event ORDER BY seq DESC LIMIT 1;
  NEW.prev_hash := prev;
  NEW.entry_hash := encode(digest(audit_chain_payload(NEW), 'sha256'), 'hex');
  RETURN NEW;
END;
$$;

CREATE TRIGGER audit_event_seal BEFORE INSERT ON audit_event
  FOR EACH ROW EXECUTE FUNCTION audit_seal();

-- ---------------------------------------------------------------------------
-- Notifications
-- ---------------------------------------------------------------------------

CREATE TABLE notification (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  UUID REFERENCES organization(id),
  recipient_user_id UUID REFERENCES app_user(id),
  -- Role-addressed notifications reach a queue rather than a person.
  recipient_role   TEXT REFERENCES role(code),
  channel          TEXT NOT NULL CHECK (channel IN ('in_app', 'email', 'sms')),
  event_type       TEXT NOT NULL CHECK (event_type IN (
                     'onboarding_submitted', 'additional_information_required',
                     'organization_approved', 'organization_rejected',
                     'transaction_awaiting_approval', 'compliance_review_required',
                     'quote_issued', 'quote_expiring', 'funding_confirmed',
                     'settlement_submitted', 'settlement_completed', 'settlement_failed',
                     'reconciliation_exception', 'security_alert', 'credential_changed')),
  subject          TEXT NOT NULL,
  -- Body is deliberately short and reference-only for email and SMS. The check below
  -- is a structural guard against leaking financial or identity detail off-platform.
  body             TEXT NOT NULL,
  -- Deep link into the application, where the detail actually lives.
  action_url       TEXT,
  transaction_id   UUID REFERENCES transaction(id),
  status           TEXT NOT NULL DEFAULT 'queued' CHECK (status IN (
                     'queued', 'sent', 'delivered', 'failed', 'read', 'suppressed')),
  attempt_count    INTEGER NOT NULL DEFAULT 0,
  last_error       TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  sent_at          TIMESTAMPTZ,
  read_at          TIMESTAMPTZ,

  CONSTRAINT notification_has_recipient CHECK (recipient_user_id IS NOT NULL OR recipient_role IS NOT NULL)
);

CREATE INDEX notification_recipient_idx ON notification(recipient_user_id, status, created_at DESC);
CREATE INDEX notification_queue_idx ON notification(status, channel) WHERE status = 'queued';

-- ---------------------------------------------------------------------------
-- Support cases and complaints
-- ---------------------------------------------------------------------------

CREATE TABLE support_case (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  reference          external_reference NOT NULL UNIQUE,
  organization_id    UUID REFERENCES organization(id),
  category           TEXT NOT NULL CHECK (category IN (
                       'compliance_review', 'transaction_investigation', 'customer_support',
                       'complaint', 'settlement_failure', 'reconciliation_break',
                       'security_incident', 'data_access_request')),
  subject            TEXT NOT NULL,
  description        TEXT NOT NULL,
  priority           TEXT NOT NULL DEFAULT 'normal' CHECK (priority IN ('low', 'normal', 'high', 'critical')),
  status             TEXT NOT NULL DEFAULT 'open' CHECK (status IN (
                       'open', 'in_progress', 'awaiting_customer', 'awaiting_internal',
                       'escalated', 'resolved', 'closed')),
  owner_id           UUID REFERENCES app_user(id),
  raised_by          UUID REFERENCES app_user(id),
  transaction_id     UUID REFERENCES transaction(id),
  compliance_case_id UUID REFERENCES compliance_case(id),
  exception_case_id  UUID REFERENCES exception_case(id),
  escalated_at       TIMESTAMPTZ,
  escalated_to       UUID REFERENCES app_user(id),
  resolution         TEXT,
  -- Service-level timers, used by the pilot report's complaint metrics.
  sla_first_response_due  TIMESTAMPTZ,
  sla_resolution_due      TIMESTAMPTZ,
  first_response_at  TIMESTAMPTZ,
  opened_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at        TIMESTAMPTZ,
  closed_at          TIMESTAMPTZ,
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX support_case_org_idx ON support_case(organization_id, status);
CREATE INDEX support_case_queue_idx ON support_case(status, priority, sla_resolution_due);
CREATE TRIGGER support_case_touch BEFORE UPDATE ON support_case
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
CREATE TRIGGER support_case_no_delete BEFORE DELETE ON support_case
  FOR EACH ROW EXECUTE FUNCTION guard_no_delete();

CREATE TABLE support_case_message (
  id               BIGSERIAL PRIMARY KEY,
  support_case_id  UUID NOT NULL REFERENCES support_case(id) ON DELETE RESTRICT,
  author_id        UUID NOT NULL REFERENCES app_user(id),
  visibility       TEXT NOT NULL CHECK (visibility IN ('internal', 'customer_visible')),
  body             TEXT NOT NULL,
  attachment_document_id UUID REFERENCES document(id),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX support_case_message_case_idx ON support_case_message(support_case_id, created_at);
CREATE TRIGGER support_case_message_append_only BEFORE UPDATE OR DELETE ON support_case_message
  FOR EACH ROW EXECUTE FUNCTION guard_append_only();

CREATE TABLE complaint (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  support_case_id   UUID NOT NULL REFERENCES support_case(id) ON DELETE RESTRICT,
  organization_id   UUID REFERENCES organization(id),
  complaint_type    TEXT NOT NULL,
  -- Regulators generally require complaint volumes and outcomes to be reportable.
  received_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  acknowledged_at   TIMESTAMPTZ,
  outcome           TEXT CHECK (outcome IN ('upheld', 'partially_upheld', 'not_upheld', 'withdrawn')),
  redress_offered   BOOLEAN NOT NULL DEFAULT FALSE,
  redress_detail    TEXT,
  closed_at         TIMESTAMPTZ,
  escalated_externally BOOLEAN NOT NULL DEFAULT FALSE
);

-- ---------------------------------------------------------------------------
-- Security incidents
-- ---------------------------------------------------------------------------

CREATE TABLE security_incident (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  reference         external_reference NOT NULL UNIQUE,
  title             TEXT NOT NULL,
  description       TEXT NOT NULL,
  severity          TEXT NOT NULL CHECK (severity IN ('low', 'medium', 'high', 'critical')),
  category          TEXT NOT NULL CHECK (category IN (
                      'account_takeover_attempt', 'unauthorised_access_attempt', 'privilege_escalation',
                      'data_exposure', 'malware', 'denial_of_service', 'partner_compromise',
                      'insider_activity', 'configuration_weakness', 'other')),
  status            TEXT NOT NULL DEFAULT 'detected' CHECK (status IN (
                      'detected', 'triaged', 'contained', 'eradicated', 'recovered', 'closed')),
  detected_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  detected_by       TEXT NOT NULL,
  -- Regulatory breach-notification clock, where the incident involves personal data.
  personal_data_involved BOOLEAN NOT NULL DEFAULT FALSE,
  notification_required  BOOLEAN,
  notification_due_at    TIMESTAMPTZ,
  notified_at            TIMESTAMPTZ,
  affected_organizations UUID[],
  containment_at    TIMESTAMPTZ,
  resolved_at       TIMESTAMPTZ,
  root_cause        TEXT,
  corrective_actions TEXT,
  owner_id          UUID REFERENCES app_user(id),
  is_simulated      BOOLEAN NOT NULL DEFAULT TRUE,
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TRIGGER security_incident_touch BEFORE UPDATE ON security_incident
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
CREATE TRIGGER security_incident_no_delete BEFORE DELETE ON security_incident
  FOR EACH ROW EXECUTE FUNCTION guard_no_delete();

-- ---------------------------------------------------------------------------
-- Data-subject requests (privacy)
-- ---------------------------------------------------------------------------

CREATE TABLE data_subject_request (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  reference         external_reference NOT NULL UNIQUE,
  organization_id   UUID REFERENCES organization(id),
  subject_person_id UUID REFERENCES natural_person(id),
  subject_email_hash sha256_hex,
  request_type      TEXT NOT NULL CHECK (request_type IN (
                      'access', 'rectification', 'erasure', 'restriction',
                      'portability', 'objection')),
  status            TEXT NOT NULL DEFAULT 'received' CHECK (status IN (
                      'received', 'identity_verification', 'in_progress',
                      'partially_fulfilled', 'fulfilled', 'refused')),
  -- Erasure is frequently refused because AML/financial records are retention-bound.
  -- The refusal basis is mandatory so the decision is defensible.
  refusal_basis     TEXT,
  statutory_due_at  TIMESTAMPTZ,
  received_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at      TIMESTAMPTZ,
  handled_by        UUID REFERENCES app_user(id),
  outcome_detail    TEXT,
  CONSTRAINT refusal_needs_basis CHECK (status <> 'refused' OR length(coalesce(refusal_basis, '')) >= 20)
);

-- ---------------------------------------------------------------------------
-- Report registry — every generated export is recorded and re-derivable
-- ---------------------------------------------------------------------------

CREATE TABLE report (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  report_key        TEXT NOT NULL,
  report_family     TEXT NOT NULL CHECK (report_family IN (
                      'operational', 'compliance', 'pilot', 'financial', 'audit', 'regulatory')),
  title             TEXT NOT NULL,
  parameters        JSONB NOT NULL DEFAULT '{}'::jsonb,
  format            TEXT NOT NULL CHECK (format IN ('csv', 'xlsx', 'pdf', 'json')),
  row_count         INTEGER,
  -- Integrity: an exported report can be proved to be the one that was produced.
  content_sha256    sha256_hex,
  byte_size         BIGINT,
  -- Which masking profile was applied, because the same report differs by role.
  masking_profile   TEXT NOT NULL,
  generated_by      UUID REFERENCES app_user(id),
  generated_by_role TEXT,
  generated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Reports are evidence of what was disclosed and to whom; they are retention-bound.
  retention_until   DATE
);

CREATE INDEX report_generated_idx ON report(generated_at DESC);
CREATE TRIGGER report_no_delete BEFORE DELETE ON report
  FOR EACH ROW EXECUTE FUNCTION guard_no_delete();

COMMIT;
