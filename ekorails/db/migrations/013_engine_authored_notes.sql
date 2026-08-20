-- 013_engine_authored_notes.sql
--
-- Lets the compliance engine and the reconciliation engine author a case note without
-- impersonating a user.
--
-- The defect this fixes: both engines wrote their opening note with
--
--     author_id = (SELECT id FROM app_user WHERE email_normalised = 'system@ekorails.invalid')
--
-- Every table carrying customer data has row-level security with FORCE, and app_user is
-- one of them. When the engine runs inside a request from a BUSINESS user, that subselect
-- is evaluated in that user's organisation scope. The platform service account belongs to
-- EKORails, not to the customer's organisation, so the subselect matched nothing, the
-- author came back NULL, and the NOT NULL constraint rejected the insert.
--
-- The effect was that the ordinary path — a customer's approver authorises a payment,
-- which runs the compliance engine, which opens a case — failed with a 500 every time. It
-- was invisible in the seeded data because the seeder runs in system scope, where the
-- subselect resolves, so the demonstration database was full of compliance cases that no
-- customer could actually have caused to be opened.
--
-- Two things are wrong there and both are fixed:
--
--   1. A note written by software is not a note written by a person, and recording it as
--      one is a small lie in an evidence table. `authored_by` now says which it was, and
--      the CHECK makes the two mutually exclusive: a human note carries a user, an engine
--      note carries none. Every note still has an accountable author.
--
--   2. Nothing needs to resolve the service account any more, which is the point at which
--      the RLS scope mattered. Migration 014 then disables the account outright.

BEGIN;

-- Compliance case notes ------------------------------------------------------

ALTER TABLE compliance_case_note ADD COLUMN authored_by TEXT NOT NULL DEFAULT 'user'
  CHECK (authored_by IN ('user', 'compliance_engine'));

ALTER TABLE compliance_case_note ALTER COLUMN author_id DROP NOT NULL;

-- Reclassify the notes the engine already wrote through the service account, so the
-- column tells the truth about history as well as about what comes next.
UPDATE compliance_case_note n
   SET authored_by = 'compliance_engine', author_id = NULL
  FROM app_user u
 WHERE u.id = n.author_id AND u.email_normalised = 'system@ekorails.invalid';

ALTER TABLE compliance_case_note ADD CONSTRAINT compliance_case_note_author_check
  CHECK (
    (authored_by = 'user' AND author_id IS NOT NULL)
    OR (authored_by <> 'user' AND author_id IS NULL)
  );

-- Exception case notes -------------------------------------------------------

ALTER TABLE exception_case_note ADD COLUMN authored_by TEXT NOT NULL DEFAULT 'user'
  CHECK (authored_by IN ('user', 'reconciliation_engine'));

ALTER TABLE exception_case_note ALTER COLUMN author_id DROP NOT NULL;

UPDATE exception_case_note n
   SET authored_by = 'reconciliation_engine', author_id = NULL
  FROM app_user u
 WHERE u.id = n.author_id AND u.email_normalised = 'system@ekorails.invalid';

ALTER TABLE exception_case_note ADD CONSTRAINT exception_case_note_author_check
  CHECK (
    (authored_by = 'user' AND author_id IS NOT NULL)
    OR (authored_by <> 'user' AND author_id IS NULL)
  );

COMMIT;
