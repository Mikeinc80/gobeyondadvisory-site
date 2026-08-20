-- 002_identity.sql — users, roles, permissions, sessions, MFA, break-glass access.

BEGIN;

-- ---------------------------------------------------------------------------
-- Roles and permissions
--
-- Permissions are data, not code constants, so that an auditor can read the
-- effective matrix straight out of the database and diff it against
-- docs/08-role-permission-matrix.md.
-- ---------------------------------------------------------------------------

CREATE TABLE role (
  code            TEXT PRIMARY KEY,
  name            TEXT NOT NULL,
  description     TEXT NOT NULL,
  -- 'business'   — acts inside exactly one customer organisation
  -- 'backoffice' — EKORails staff, may act across organisations
  -- 'external'   — auditor / regulator, read-only across organisations
  -- 'platform'   — administration of the system itself
  realm           TEXT NOT NULL CHECK (realm IN ('business', 'backoffice', 'external', 'platform')),
  -- Roles requiring step-up MFA at each privileged action, not just at login.
  requires_step_up BOOLEAN NOT NULL DEFAULT FALSE,
  -- Break-glass roles must be time-boxed and separately approved.
  is_break_glass  BOOLEAN NOT NULL DEFAULT FALSE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE permission (
  code         TEXT PRIMARY KEY,
  description  TEXT NOT NULL,
  -- Grouping used by the admin UI and by the auditor's permission report.
  domain       TEXT NOT NULL,
  -- Permissions that let a user change money, compliance outcomes or access control.
  is_sensitive BOOLEAN NOT NULL DEFAULT FALSE
);

CREATE TABLE role_permission (
  role_code        TEXT NOT NULL REFERENCES role(code) ON DELETE RESTRICT,
  permission_code  TEXT NOT NULL REFERENCES permission(code) ON DELETE RESTRICT,
  PRIMARY KEY (role_code, permission_code)
);

-- ---------------------------------------------------------------------------
-- Organisations are declared here (minimal shape) because users reference them.
-- The full KYB profile lives in 003_organization.sql.
-- ---------------------------------------------------------------------------

CREATE TABLE organization (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Short code shown in the UI and in exports. Not a legal identifier.
  display_code        TEXT NOT NULL UNIQUE CHECK (display_code ~ '^ORG-[A-Z0-9]{4,12}$'),
  legal_name          TEXT NOT NULL,
  trading_name        TEXT,
  -- 'customer' — an onboarded business. 'internal' — EKORails itself, which owns
  -- back-office users and the platform's own ledger accounts.
  kind                TEXT NOT NULL DEFAULT 'customer' CHECK (kind IN ('customer', 'internal')),
  onboarding_status   TEXT NOT NULL DEFAULT 'draft' CHECK (onboarding_status IN (
                        'draft', 'submitted', 'automated_checks_running', 'analyst_review',
                        'additional_information_required', 'manager_review', 'approved',
                        'rejected', 'suspended', 'expired', 'periodic_review_due')),
  risk_rating         TEXT CHECK (risk_rating IN ('low', 'medium', 'high', 'prohibited')),
  suspended_at        TIMESTAMPTZ,
  suspension_reason   TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TRIGGER organization_touch BEFORE UPDATE ON organization
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
CREATE TRIGGER organization_no_delete BEFORE DELETE ON organization
  FOR EACH ROW EXECUTE FUNCTION guard_no_delete();

-- ---------------------------------------------------------------------------
-- Users
--
-- Credential material: password_hash is scrypt(N=2^15, r=8, p=1) with a per-user
-- salt. The hash column is never selected by any read path other than the
-- authentication service, and never leaves the API process.
-- ---------------------------------------------------------------------------

CREATE TABLE app_user (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id       UUID REFERENCES organization(id) ON DELETE RESTRICT,
  email                 TEXT NOT NULL,
  email_normalised      TEXT NOT NULL UNIQUE,
  full_name             TEXT NOT NULL,
  -- Stored so that notifications can address a person without exposing the email
  -- address in message subjects or push payloads.
  display_name          TEXT NOT NULL,
  password_hash         TEXT,
  password_algo         TEXT NOT NULL DEFAULT 'scrypt-n32768-r8-p1',
  password_updated_at   TIMESTAMPTZ,
  -- Password reuse prevention keeps hashes of the last N passwords.
  password_history      JSONB NOT NULL DEFAULT '[]'::jsonb,
  must_change_password  BOOLEAN NOT NULL DEFAULT FALSE,

  mfa_enrolled          BOOLEAN NOT NULL DEFAULT FALSE,
  mfa_secret_encrypted  TEXT,
  mfa_recovery_codes    JSONB NOT NULL DEFAULT '[]'::jsonb,
  mfa_last_used_step    BIGINT,          -- replay guard: a TOTP step is single-use

  status                TEXT NOT NULL DEFAULT 'active' CHECK (status IN (
                          'invited', 'active', 'locked', 'suspended', 'disabled')),
  failed_login_count    INTEGER NOT NULL DEFAULT 0,
  locked_until          TIMESTAMPTZ,
  last_login_at         TIMESTAMPTZ,
  last_login_ip_hash    sha256_hex,      -- hashed: raw IP is personal data
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- A business user must belong to an organisation. Back-office, external and
  -- platform users belong to the internal organisation.
  CONSTRAINT user_has_org CHECK (organization_id IS NOT NULL)
);

CREATE INDEX app_user_org_idx ON app_user(organization_id);
CREATE TRIGGER app_user_touch BEFORE UPDATE ON app_user
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
CREATE TRIGGER app_user_no_delete BEFORE DELETE ON app_user
  FOR EACH ROW EXECUTE FUNCTION guard_no_delete();

CREATE TABLE user_role (
  user_id      UUID NOT NULL REFERENCES app_user(id) ON DELETE RESTRICT,
  role_code    TEXT NOT NULL REFERENCES role(code) ON DELETE RESTRICT,
  granted_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  granted_by   UUID REFERENCES app_user(id),
  -- Break-glass and elevated roles expire. NULL means a standing grant.
  expires_at   TIMESTAMPTZ,
  reason       TEXT,
  PRIMARY KEY (user_id, role_code)
);

CREATE INDEX user_role_expiry_idx ON user_role(expires_at) WHERE expires_at IS NOT NULL;

-- ---------------------------------------------------------------------------
-- Sessions
--
-- The session token is a 32-byte random value. Only its SHA-256 is stored, so a
-- database compromise does not yield usable sessions. The CSRF token is a second
-- independent random value delivered to the client and echoed in a header
-- (double-submit), never inferable from the session token.
-- ---------------------------------------------------------------------------

CREATE TABLE user_session (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id            UUID NOT NULL REFERENCES app_user(id) ON DELETE RESTRICT,
  token_hash         sha256_hex NOT NULL UNIQUE,
  csrf_token_hash    sha256_hex NOT NULL,
  -- Set once the user has completed the second factor. Requests presenting a
  -- session with mfa_satisfied = false may only reach the MFA endpoints.
  mfa_satisfied      BOOLEAN NOT NULL DEFAULT FALSE,
  -- Step-up authentication for sensitive actions is time-boxed independently of
  -- the session lifetime.
  step_up_until      TIMESTAMPTZ,
  user_agent_hash    sha256_hex,
  ip_hash            sha256_hex,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  absolute_expiry    TIMESTAMPTZ NOT NULL,
  idle_expiry        TIMESTAMPTZ NOT NULL,
  revoked_at         TIMESTAMPTZ,
  revoked_reason     TEXT
);

CREATE INDEX user_session_user_idx ON user_session(user_id);
CREATE INDEX user_session_live_idx ON user_session(absolute_expiry) WHERE revoked_at IS NULL;

-- ---------------------------------------------------------------------------
-- Login attempts — feeds lockout, anomaly detection and the security report.
-- Append-only: a failed-login history that can be edited is not evidence.
-- ---------------------------------------------------------------------------

CREATE TABLE login_attempt (
  id             BIGSERIAL PRIMARY KEY,
  email_hash     sha256_hex NOT NULL,   -- hashed: enumeration-resistant and privacy-preserving
  user_id        UUID REFERENCES app_user(id),
  succeeded      BOOLEAN NOT NULL,
  failure_reason TEXT,
  ip_hash        sha256_hex,
  user_agent_hash sha256_hex,
  occurred_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX login_attempt_email_time_idx ON login_attempt(email_hash, occurred_at DESC);
CREATE TRIGGER login_attempt_append_only BEFORE UPDATE OR DELETE ON login_attempt
  FOR EACH ROW EXECUTE FUNCTION guard_append_only();

-- ---------------------------------------------------------------------------
-- Break-glass (Super Administrator) access
--
-- Emergency access is never standing. A request must be raised with a written
-- reason, approved by a different person, and it expires. Every one of these
-- columns is a control an auditor will ask to see evidence for.
-- ---------------------------------------------------------------------------

CREATE TABLE break_glass_request (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  requested_by    UUID NOT NULL REFERENCES app_user(id),
  reason          TEXT NOT NULL CHECK (length(reason) >= 40),
  requested_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  requested_minutes INTEGER NOT NULL CHECK (requested_minutes BETWEEN 5 AND 240),
  status          TEXT NOT NULL DEFAULT 'pending' CHECK (status IN (
                    'pending', 'approved', 'rejected', 'expired', 'revoked')),
  approved_by     UUID REFERENCES app_user(id),
  approved_at     TIMESTAMPTZ,
  decision_note   TEXT,
  activated_at    TIMESTAMPTZ,
  expires_at      TIMESTAMPTZ,
  revoked_at      TIMESTAMPTZ,
  -- Four-eyes: the approver must not be the requester.
  CONSTRAINT break_glass_four_eyes CHECK (approved_by IS NULL OR approved_by <> requested_by)
);

CREATE TRIGGER break_glass_no_delete BEFORE DELETE ON break_glass_request
  FOR EACH ROW EXECUTE FUNCTION guard_no_delete();

COMMIT;
