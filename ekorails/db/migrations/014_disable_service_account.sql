-- 014_disable_service_account.sql
--
-- Takes the platform service account out of use.
--
-- `system@ekorails.invalid` was seeded as an ACTIVE user with a password hash and without
-- a second factor, so that the engines could name it as the author of the notes they
-- write. It was, in other words, a loginable account with the demonstration passphrase and
-- no MFA — which is a weakness whether or not anybody intended it to be used that way. The
-- seed passphrase is published in the seeder's own output.
--
-- Migration 013 removed the only reason it existed. This disables it: the account keeps
-- its identity so that historical foreign keys still resolve and old records still read
-- correctly, but it holds no credential and cannot authenticate. Authentication refuses
-- any account whose status is not 'active', so this closes the path rather than merely
-- making it inconvenient.
--
-- The right long-term answer is that software actors are not users at all. That is now the
-- model for case notes; anywhere else a system actor appears it is recorded as an actor
-- TYPE on the record itself, never as a row in app_user.

BEGIN;

UPDATE app_user
   SET status = 'disabled',
       -- Not a hash of anything. scrypt verification of this value cannot succeed, so
       -- there is no passphrase that authenticates this account even if it were re-enabled
       -- without a deliberate credential reset.
       password_hash = 'disabled:no-credential-issued',
       mfa_enrolled = FALSE,
       mfa_secret_encrypted = NULL
 WHERE email_normalised = 'system@ekorails.invalid';

COMMIT;
