-- 003_onboarding.sql — KYB profile, directors, beneficial owners, beneficiaries, documents.

BEGIN;

-- ---------------------------------------------------------------------------
-- Organisation KYB profile
--
-- Held separately from `organization` because the profile is a versioned,
-- evidence-backed artefact reviewed by compliance, while `organization` is the
-- operational record other tables reference.
-- ---------------------------------------------------------------------------

CREATE TABLE organization_profile (
  id                        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id           UUID NOT NULL REFERENCES organization(id) ON DELETE RESTRICT,
  -- Profiles are versioned. A periodic review creates version N+1; version N stays
  -- readable so that a past compliance decision can be reproduced against the data
  -- that was actually in front of the analyst.
  version                   INTEGER NOT NULL,
  is_current                BOOLEAN NOT NULL DEFAULT TRUE,

  legal_business_name       TEXT NOT NULL,
  trading_name              TEXT,
  registration_number       TEXT NOT NULL,
  jurisdiction              country_code NOT NULL,
  date_of_incorporation     DATE NOT NULL,

  registered_address        JSONB NOT NULL,
  operating_address         JSONB NOT NULL,

  business_activity         TEXT NOT NULL,
  industry_code             TEXT NOT NULL,
  website                   TEXT,
  tax_identification_number TEXT,
  regulatory_licence        JSONB,      -- {authority, licence_number, type, valid_until} or NULL

  expected_corridors        JSONB NOT NULL DEFAULT '[]'::jsonb,
  expected_monthly_volume   money_amount,
  expected_monthly_currency currency_code,
  expected_transaction_size money_amount,
  expected_txn_currency     currency_code,
  source_of_funds           TEXT NOT NULL,
  purpose_of_transactions   TEXT NOT NULL,

  submitted_at              TIMESTAMPTZ,
  submitted_by              UUID REFERENCES app_user(id),
  created_at                TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                TIMESTAMPTZ NOT NULL DEFAULT now(),

  UNIQUE (organization_id, version),
  CONSTRAINT volume_has_currency CHECK (
    (expected_monthly_volume IS NULL) = (expected_monthly_currency IS NULL)),
  CONSTRAINT size_has_currency CHECK (
    (expected_transaction_size IS NULL) = (expected_txn_currency IS NULL))
);

-- Exactly one current profile per organisation.
CREATE UNIQUE INDEX organization_profile_current_idx
  ON organization_profile(organization_id) WHERE is_current;
CREATE TRIGGER organization_profile_touch BEFORE UPDATE ON organization_profile
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
CREATE TRIGGER organization_profile_no_delete BEFORE DELETE ON organization_profile
  FOR EACH ROW EXECUTE FUNCTION guard_no_delete();

-- ---------------------------------------------------------------------------
-- Directors, signatories, beneficial owners
--
-- Identification numbers are stored encrypted (envelope encryption, see
-- src/core/crypto.ts) with a separately stored last-4 fragment for display.
-- The full number never appears in a log, an export or an API response.
-- ---------------------------------------------------------------------------

CREATE TABLE natural_person (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id        UUID NOT NULL REFERENCES organization(id) ON DELETE RESTRICT,
  profile_id             UUID NOT NULL REFERENCES organization_profile(id) ON DELETE RESTRICT,
  full_name              TEXT NOT NULL,
  date_of_birth          DATE,
  nationality            country_code,
  country_of_residence   country_code,
  residential_address    JSONB,
  -- Identification: encrypted payload + non-reversible display fragment.
  id_document_type       TEXT,
  id_number_encrypted    TEXT,
  id_number_last4        CHAR(4),
  id_number_fingerprint  sha256_hex,  -- allows duplicate-person detection without decryption
  id_expires_on          DATE,

  is_pep                 BOOLEAN NOT NULL DEFAULT FALSE,
  pep_declaration        TEXT,
  pep_category           TEXT CHECK (pep_category IN (
                           'domestic', 'foreign', 'international_organisation', 'close_associate', 'family_member')),

  verification_status    TEXT NOT NULL DEFAULT 'not_started' CHECK (verification_status IN (
                           'not_started', 'pending', 'verified', 'failed', 'expired', 'manual_override')),
  created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX natural_person_org_idx ON natural_person(organization_id);
CREATE INDEX natural_person_fingerprint_idx ON natural_person(id_number_fingerprint)
  WHERE id_number_fingerprint IS NOT NULL;
CREATE TRIGGER natural_person_touch BEFORE UPDATE ON natural_person
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

CREATE TABLE person_capacity (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  person_id          UUID NOT NULL REFERENCES natural_person(id) ON DELETE RESTRICT,
  organization_id    UUID NOT NULL REFERENCES organization(id) ON DELETE RESTRICT,
  capacity           TEXT NOT NULL CHECK (capacity IN (
                       'director', 'authorised_signatory', 'ultimate_beneficial_owner',
                       'company_secretary', 'senior_manager')),
  appointed_on       DATE,
  resigned_on        DATE,
  -- Ownership percentage applies only to UBOs. Fixed precision — an ownership
  -- register that drifts by a rounding error is a register that fails an audit.
  ownership_percent  NUMERIC(7, 4) CHECK (ownership_percent > 0 AND ownership_percent <= 100),
  ownership_is_direct BOOLEAN,
  control_basis      TEXT,   -- e.g. 'shareholding', 'voting_rights', 'other_control'
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (person_id, capacity),
  CONSTRAINT ubo_has_ownership CHECK (
    capacity <> 'ultimate_beneficial_owner' OR ownership_percent IS NOT NULL)
);

CREATE INDEX person_capacity_org_idx ON person_capacity(organization_id);

-- ---------------------------------------------------------------------------
-- Bank accounts (organisation's own, and beneficiary accounts)
--
-- Account identifiers are encrypted at rest. `identifier_last4` supports the
-- operational need to recognise an account; `identifier_fingerprint` supports the
-- "reused bank details" compliance rule without ever decrypting.
-- ---------------------------------------------------------------------------

CREATE TABLE bank_account (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id          UUID NOT NULL REFERENCES organization(id) ON DELETE RESTRICT,
  ownership                TEXT NOT NULL CHECK (ownership IN ('own', 'beneficiary')),
  account_holder_name      TEXT NOT NULL,
  institution_name         TEXT NOT NULL,
  institution_country      country_code NOT NULL,
  swift_bic                TEXT CHECK (swift_bic IS NULL OR swift_bic ~ '^[A-Z]{6}[A-Z0-9]{2}([A-Z0-9]{3})?$'),
  identifier_scheme        TEXT NOT NULL CHECK (identifier_scheme IN ('iban', 'nuban', 'account_number', 'sort_code_account', 'other')),
  identifier_encrypted     TEXT NOT NULL,
  identifier_last4         CHAR(4) NOT NULL,
  identifier_fingerprint   sha256_hex NOT NULL,
  currency                 currency_code NOT NULL,
  verification_status      TEXT NOT NULL DEFAULT 'not_started' CHECK (verification_status IN (
                             'not_started', 'pending', 'verified', 'name_mismatch', 'failed', 'expired')),
  verification_evidence_id UUID,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX bank_account_org_idx ON bank_account(organization_id);
CREATE INDEX bank_account_fingerprint_idx ON bank_account(identifier_fingerprint);
CREATE TRIGGER bank_account_touch BEFORE UPDATE ON bank_account
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

-- ---------------------------------------------------------------------------
-- Beneficiaries
-- ---------------------------------------------------------------------------

CREATE TABLE beneficiary (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id        UUID NOT NULL REFERENCES organization(id) ON DELETE RESTRICT,
  display_code           TEXT NOT NULL,
  legal_name             TEXT NOT NULL,
  registration_number    TEXT,
  country                country_code NOT NULL,
  address                JSONB NOT NULL,
  bank_account_id        UUID NOT NULL REFERENCES bank_account(id) ON DELETE RESTRICT,
  payment_purpose        TEXT NOT NULL,
  relationship_to_sender TEXT NOT NULL,
  supporting_contract_id UUID,          -- FK added after `document` exists

  status                 TEXT NOT NULL DEFAULT 'draft' CHECK (status IN (
                           'draft', 'pending_review', 'additional_information_required',
                           'approved', 'rejected', 'suspended')),
  -- Set whenever a material field changes; forces re-review before next use.
  requires_rereview      BOOLEAN NOT NULL DEFAULT FALSE,
  rereview_reason        TEXT,
  -- Hash over the material fields. A change to any of them invalidates approval.
  material_fingerprint   sha256_hex NOT NULL,
  approved_at            TIMESTAMPTZ,
  approved_by            UUID REFERENCES app_user(id),
  first_used_at          TIMESTAMPTZ,
  created_by             UUID NOT NULL REFERENCES app_user(id),
  created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (organization_id, display_code)
);

CREATE INDEX beneficiary_org_status_idx ON beneficiary(organization_id, status);
CREATE TRIGGER beneficiary_touch BEFORE UPDATE ON beneficiary
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
CREATE TRIGGER beneficiary_no_delete BEFORE DELETE ON beneficiary
  FOR EACH ROW EXECUTE FUNCTION guard_no_delete();

-- ---------------------------------------------------------------------------
-- Documents
--
-- The blob itself lives in object storage. This table holds the metadata, the
-- integrity hash and the access-control anchor. `storage_key` is opaque; a signed,
-- short-lived URL is minted per download and every mint is audited.
-- ---------------------------------------------------------------------------

CREATE TABLE document (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id      UUID NOT NULL REFERENCES organization(id) ON DELETE RESTRICT,
  document_type        TEXT NOT NULL CHECK (document_type IN (
                         'certificate_of_incorporation', 'company_status_report', 'constitutional_document',
                         'tax_registration', 'proof_of_address', 'bank_confirmation',
                         'director_identification', 'beneficial_owner_identification', 'board_resolution',
                         'regulatory_licence', 'invoice', 'purchase_order', 'contract',
                         'bill_of_lading', 'customs_document', 'proof_of_delivery',
                         'source_of_funds_evidence', 'other')),
  version              INTEGER NOT NULL DEFAULT 1,
  supersedes_id        UUID REFERENCES document(id),
  is_current           BOOLEAN NOT NULL DEFAULT TRUE,

  original_filename    TEXT NOT NULL,
  mime_type            TEXT NOT NULL,
  byte_size            BIGINT NOT NULL CHECK (byte_size > 0),
  -- Integrity: SHA-256 of the plaintext bytes, computed before encryption.
  content_sha256       sha256_hex NOT NULL,
  storage_key          TEXT NOT NULL UNIQUE,
  encryption_key_id    TEXT NOT NULL,

  malware_scan_status  TEXT NOT NULL DEFAULT 'pending' CHECK (malware_scan_status IN (
                         'pending', 'clean', 'infected', 'error', 'skipped_unsupported_type')),
  malware_scan_at      TIMESTAMPTZ,
  malware_scanner      TEXT,

  issued_on            DATE,
  expires_on           DATE,
  expiry_notified_at   TIMESTAMPTZ,

  classification       TEXT NOT NULL DEFAULT 'confidential' CHECK (classification IN (
                         'public', 'internal', 'confidential', 'restricted')),
  retention_until      DATE,
  legal_hold           BOOLEAN NOT NULL DEFAULT FALSE,

  uploaded_by          UUID NOT NULL REFERENCES app_user(id),
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX document_org_type_idx ON document(organization_id, document_type);
CREATE INDEX document_expiry_idx ON document(expires_on) WHERE expires_on IS NOT NULL AND is_current;
CREATE INDEX document_hash_idx ON document(content_sha256);
CREATE TRIGGER document_touch BEFORE UPDATE ON document
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
CREATE TRIGGER document_no_delete BEFORE DELETE ON document
  FOR EACH ROW EXECUTE FUNCTION guard_no_delete();

ALTER TABLE beneficiary
  ADD CONSTRAINT beneficiary_contract_fk
  FOREIGN KEY (supporting_contract_id) REFERENCES document(id);

-- Every download or preview of a document is recorded. Append-only.
CREATE TABLE document_access (
  id             BIGSERIAL PRIMARY KEY,
  document_id    UUID NOT NULL REFERENCES document(id) ON DELETE RESTRICT,
  user_id        UUID NOT NULL REFERENCES app_user(id),
  action         TEXT NOT NULL CHECK (action IN ('metadata_read', 'url_minted', 'downloaded', 'denied')),
  reason         TEXT,
  session_id     UUID,
  occurred_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX document_access_doc_idx ON document_access(document_id, occurred_at DESC);
CREATE TRIGGER document_access_append_only BEFORE UPDATE OR DELETE ON document_access
  FOR EACH ROW EXECUTE FUNCTION guard_append_only();

-- ---------------------------------------------------------------------------
-- AI-assisted extraction
--
-- Deliberately a separate table with a `proposed` default. Nothing in the
-- compliance engine reads this table. A proposal reaches a transaction only via an
-- explicit human confirmation that records who confirmed it and when.
-- ---------------------------------------------------------------------------

CREATE TABLE document_extraction (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id        UUID NOT NULL REFERENCES document(id) ON DELETE RESTRICT,
  organization_id    UUID NOT NULL REFERENCES organization(id) ON DELETE RESTRICT,
  extractor          TEXT NOT NULL,
  extractor_version  TEXT NOT NULL,
  -- {invoice_number, parties, amount, currency, due_date, goods_or_services, bank_details}
  proposed_fields    JSONB NOT NULL,
  -- Per-field confidence, surfaced in the UI. Never used to auto-accept.
  field_confidence   JSONB NOT NULL DEFAULT '{}'::jsonb,
  status             TEXT NOT NULL DEFAULT 'proposed' CHECK (status IN (
                       'proposed', 'confirmed', 'corrected', 'rejected')),
  confirmed_fields   JSONB,
  confirmed_by       UUID REFERENCES app_user(id),
  confirmed_at       TIMESTAMPTZ,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT extraction_confirmation_is_human CHECK (
    (status IN ('proposed', 'rejected'))
    OR (confirmed_by IS NOT NULL AND confirmed_at IS NOT NULL AND confirmed_fields IS NOT NULL))
);

CREATE INDEX document_extraction_doc_idx ON document_extraction(document_id);

COMMIT;
