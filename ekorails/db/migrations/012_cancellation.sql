-- 012_cancellation.sql
--
-- Adds the notification kind raised when a customer withdraws a payment they had been
-- asked to fund.
--
-- The state machine has always had two cancellation edges — `cancel_draft` and
-- `cancel_before_funding` — but neither was reachable through the API, so neither ever
-- raised a notification and the missing enum value went unnoticed. Withdrawing after an
-- obligation has been recognised matters to treasury: they are expecting funding that is
-- now not coming, and the obligation posted for it has been reversed.
--
-- The event type is an enumerated CHECK rather than free text so that a typo in an event
-- name fails at the database rather than producing a notification nobody has written a
-- template for. Extending it is therefore a migration, which is the intended cost.

BEGIN;

ALTER TABLE notification DROP CONSTRAINT IF EXISTS notification_event_type_check;

ALTER TABLE notification ADD CONSTRAINT notification_event_type_check
  CHECK (event_type IN (
    'onboarding_submitted', 'additional_information_required',
    'organization_approved', 'organization_rejected',
    'transaction_awaiting_approval', 'transaction_cancelled',
    'compliance_review_required',
    'quote_issued', 'quote_expiring', 'funding_confirmed',
    'settlement_submitted', 'settlement_completed', 'settlement_failed',
    'reconciliation_exception', 'security_alert', 'credential_changed'));

COMMIT;
