-- 001_foundation.sql
-- EKORails settlement orchestration platform — foundational types, guards and helpers.
--
-- Design notes for reviewers:
--   * Money is NEVER float. Amounts are NUMERIC(24,6); FX rates are NUMERIC(24,12).
--     Amount, currency, rate, fee and tax are stored as separate structured columns,
--     never packed into a single string.
--   * Immutable tables are protected by BEFORE UPDATE OR DELETE triggers that raise, and
--     additionally by withheld grants on the application role (see 011_security.sql).
--     Both layers must be defeated to mutate an audit or ledger record.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ---------------------------------------------------------------------------
-- Domains
-- ---------------------------------------------------------------------------

-- Fixed-precision money. 6 dp accommodates minor units for every ISO-4217 currency
-- in the pilot scope and leaves headroom for fee apportionment without rounding drift.
CREATE DOMAIN money_amount AS NUMERIC(24, 6);

-- FX rates carry more precision than amounts so that a round trip through a rate
-- does not silently lose value at the sixth decimal place.
CREATE DOMAIN fx_rate AS NUMERIC(24, 12);

CREATE DOMAIN currency_code AS CHAR(3)
  CHECK (VALUE ~ '^[A-Z]{3}$');

CREATE DOMAIN country_code AS CHAR(2)
  CHECK (VALUE ~ '^[A-Z]{2}$');

-- Reference strings shown to customers and partners. Deliberately narrow.
CREATE DOMAIN external_reference AS TEXT
  CHECK (VALUE ~ '^[A-Z0-9][A-Z0-9-]{4,63}$');

CREATE DOMAIN sha256_hex AS CHAR(64)
  CHECK (VALUE ~ '^[0-9a-f]{64}$');

-- ---------------------------------------------------------------------------
-- Environment guard
--
-- The environment mode is process configuration, never data. This table exists
-- only to record which mode the schema was last booted under, so that a reviewer
-- inspecting a database dump can tell what produced the rows. Writing to it does
-- not change behaviour anywhere in the application.
-- ---------------------------------------------------------------------------

CREATE TABLE environment_stamp (
  id               SMALLINT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  mode             TEXT NOT NULL CHECK (mode IN ('DEMO', 'SANDBOX', 'CONTROLLED_PILOT', 'PRODUCTION')),
  live_funds       BOOLEAN NOT NULL DEFAULT FALSE,
  first_booted_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_booted_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT no_live_funds_in_this_build CHECK (live_funds = FALSE)
);

COMMENT ON CONSTRAINT no_live_funds_in_this_build ON environment_stamp IS
  'Belt-and-braces: this build cannot record itself as having moved live funds. '
  'Removing this constraint is a deliberate, reviewable schema change.';

-- ---------------------------------------------------------------------------
-- Immutability guards
-- ---------------------------------------------------------------------------

-- Applied to append-only tables. Raises on any UPDATE or DELETE, including by the
-- table owner. Combined with FORCE ROW LEVEL SECURITY and withheld UPDATE/DELETE
-- grants, an application-level administrator has no route to mutate these rows.
CREATE OR REPLACE FUNCTION guard_append_only() RETURNS TRIGGER
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION
    'APPEND_ONLY_VIOLATION: table % is append-only; % is not permitted. '
    'Correct an erroneous record by appending a compensating record, never by mutating history.',
    TG_TABLE_NAME, TG_OP
    USING ERRCODE = 'raise_exception';
END;
$$;

-- Applied to tables that may be updated but whose rows must never be deleted
-- (retention-bound records). Deletion is refused; soft-deletion columns exist instead.
CREATE OR REPLACE FUNCTION guard_no_delete() RETURNS TRIGGER
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION
    'RETENTION_VIOLATION: rows in % are retention-bound and cannot be deleted. '
    'Use the anonymisation workflow where erasure is legally permitted.',
    TG_TABLE_NAME
    USING ERRCODE = 'raise_exception';
END;
$$;

CREATE OR REPLACE FUNCTION touch_updated_at() RETURNS TRIGGER
LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

-- ---------------------------------------------------------------------------
-- Request context
--
-- The API opens every request transaction by setting these GUCs. Row-level
-- security policies read them. They are set with set_config(..., true) so they are
-- transaction-scoped and cannot leak between pooled connections.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION ctx_org_id() RETURNS UUID
LANGUAGE plpgsql STABLE AS $$
DECLARE v TEXT;
BEGIN
  v := current_setting('ekorails.org_id', true);
  IF v IS NULL OR v = '' THEN RETURN NULL; END IF;
  RETURN v::uuid;
END;
$$;

CREATE OR REPLACE FUNCTION ctx_user_id() RETURNS UUID
LANGUAGE plpgsql STABLE AS $$
DECLARE v TEXT;
BEGIN
  v := current_setting('ekorails.user_id', true);
  IF v IS NULL OR v = '' THEN RETURN NULL; END IF;
  RETURN v::uuid;
END;
$$;

-- 'org'    — the caller may see only their own organisation's rows.
-- 'global' — the caller holds a back-office role and may read across organisations.
-- 'system' — internal jobs (seeding, reconciliation runs, scheduled work).
CREATE OR REPLACE FUNCTION ctx_scope() RETURNS TEXT
LANGUAGE plpgsql STABLE AS $$
DECLARE v TEXT;
BEGIN
  v := current_setting('ekorails.scope', true);
  IF v IS NULL OR v = '' THEN RETURN 'none'; END IF;
  RETURN v;
END;
$$;

-- ---------------------------------------------------------------------------
-- Reference sequences for human-facing identifiers
-- ---------------------------------------------------------------------------

CREATE SEQUENCE ref_transaction_seq  START 100001;
CREATE SEQUENCE ref_case_seq         START 100001;
CREATE SEQUENCE ref_quote_seq        START 100001;
CREATE SEQUENCE ref_journal_seq      START 100001;
CREATE SEQUENCE ref_recon_seq        START 100001;
CREATE SEQUENCE ref_incident_seq     START 100001;
CREATE SEQUENCE ref_screening_seq    START 100001;

CREATE TABLE schema_migration (
  version     TEXT PRIMARY KEY,
  applied_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  checksum    sha256_hex NOT NULL
);

COMMIT;
