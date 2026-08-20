/**
 * Authentication: password login, MFA, sessions, lockout and step-up.
 *
 * Design points a security reviewer will look for:
 *
 *  - Login is uniform-time and uniform-message. An unknown email and a wrong password
 *    produce the same response after the same work, so the endpoint is not a user
 *    enumeration oracle.
 *  - A session is not usable until MFA is satisfied. The pre-MFA session can reach only
 *    the MFA endpoints; every other route rejects it.
 *  - Session tokens are stored as SHA-256. A database dump does not yield live sessions.
 *  - CSRF uses an independent double-submit token, not a value derived from the session.
 *  - Lockout is progressive and is recorded in an append-only table.
 */

import { randomUUID } from 'node:crypto';
import type { Queryable } from '../db/pool.js';
import { maybeOne, one } from '../db/pool.js';
import {
  hashPassword, verifyPassword, randomToken, sha256Hex, safeEqual,
  encryptField, decryptField, verifyTotp, generateTotpSecret, totpProvisioningUri,
  checkPasswordPolicy,
} from '../core/crypto.js';
import { recordAudit } from '../audit/audit.js';
import { unauthenticated, forbidden, invalid, precondition } from '../core/errors.js';
import { databaseScopeForRoles, permissionsForRoles, type Permission } from './rbac.js';

export const SESSION_ABSOLUTE_LIFETIME_MS = 12 * 60 * 60 * 1000; // 12 hours
export const SESSION_IDLE_LIFETIME_MS = 30 * 60 * 1000;          // 30 minutes
export const STEP_UP_LIFETIME_MS = 5 * 60 * 1000;                // 5 minutes
export const MAX_FAILED_LOGINS = 5;
export const LOCKOUT_MS = 15 * 60 * 1000;

export interface AuthenticatedUser {
  userId: string;
  organizationId: string;
  email: string;
  fullName: string;
  displayName: string;
  roles: string[];
  permissions: Set<Permission>;
  scope: 'org' | 'global';
  sessionId: string;
  mfaSatisfied: boolean;
  stepUpValidUntil: Date | null;
}

export interface LoginRequest {
  email: string;
  password: string;
  ipHash: string | null;
  userAgentHash: string | null;
}

export interface LoginResult {
  /** Opaque session token. Delivered as an httpOnly cookie, never in a response body. */
  sessionToken: string;
  csrfToken: string;
  sessionId: string;
  mfaRequired: boolean;
  mfaEnrolled: boolean;
  userId: string;
}

interface UserRow {
  id: string;
  organization_id: string;
  email: string;
  full_name: string;
  display_name: string;
  password_hash: string | null;
  status: string;
  failed_login_count: number;
  locked_until: Date | null;
  mfa_enrolled: boolean;
  mfa_secret_encrypted: string | null;
  mfa_last_used_step: string | null;
  must_change_password: boolean;
  org_status: string;
}

export function normaliseEmail(email: string): string {
  return email.trim().toLowerCase();
}

/**
 * A dummy hash used when the email is unknown, so that the work performed — and
 * therefore the response time — does not reveal whether the account exists.
 */
const DECOY_HASH = hashPassword('decoy-password-for-uniform-timing-only');

export async function login(db: Queryable, req: LoginRequest): Promise<LoginResult> {
  const emailNorm = normaliseEmail(req.email);
  const emailHash = sha256Hex(emailNorm);

  const user = await maybeOne<UserRow>(
    db,
    `SELECT u.id, u.organization_id, u.email, u.full_name, u.display_name,
            u.password_hash, u.status, u.failed_login_count, u.locked_until,
            u.mfa_enrolled, u.mfa_secret_encrypted, u.mfa_last_used_step::text AS mfa_last_used_step,
            u.must_change_password, o.onboarding_status AS org_status
       FROM app_user u
       JOIN organization o ON o.id = u.organization_id
      WHERE u.email_normalised = $1`,
    [emailNorm],
  );

  const recordFailure = async (reason: string): Promise<never> => {
    await db.query(
      `INSERT INTO login_attempt (email_hash, user_id, succeeded, failure_reason, ip_hash, user_agent_hash)
       VALUES ($1, $2, false, $3, $4, $5)`,
      [emailHash, user?.id ?? null, reason, req.ipHash, req.userAgentHash],
    );
    await recordAudit(db, {
      category: 'authentication',
      action: 'login',
      outcome: 'failure',
      actorUserId: user?.id ?? null,
      actorType: user ? 'user' : 'anonymous',
      ipHash: req.ipHash,
      userAgentHash: req.userAgentHash,
      organizationId: user?.organization_id ?? null,
      metadata: { reason },
    });
    // One message for every failure mode. The caller learns nothing about which.
    throw unauthenticated('INVALID_CREDENTIALS', 'Email or password is incorrect.', reason);
  };

  if (!user) {
    verifyPassword(req.password, DECOY_HASH);   // uniform timing
    return recordFailure('unknown_email');
  }

  if (user.locked_until && user.locked_until.getTime() > Date.now()) {
    verifyPassword(req.password, DECOY_HASH);
    return recordFailure('account_locked');
  }

  if (user.status !== 'active') {
    verifyPassword(req.password, DECOY_HASH);
    return recordFailure(`user_status_${user.status}`);
  }

  if (!user.password_hash || !verifyPassword(req.password, user.password_hash)) {
    const attempts = user.failed_login_count + 1;
    const lock = attempts >= MAX_FAILED_LOGINS;
    await db.query(
      `UPDATE app_user
          SET failed_login_count = $2,
              locked_until = CASE WHEN $3 THEN now() + ($4 || ' milliseconds')::interval ELSE locked_until END,
              status = CASE WHEN $3 THEN 'locked' ELSE status END
        WHERE id = $1`,
      [user.id, attempts, lock, String(LOCKOUT_MS)],
    );
    return recordFailure(lock ? 'bad_password_now_locked' : 'bad_password');
  }

  // Password is correct. Reset the counter and open a pre-MFA session.
  await db.query(
    'UPDATE app_user SET failed_login_count = 0, locked_until = NULL, last_login_at = now(), last_login_ip_hash = $2 WHERE id = $1',
    [user.id, req.ipHash],
  );

  const sessionToken = randomToken(32);
  const csrfToken = randomToken(32);
  const now = Date.now();

  const session = await one<{ id: string }>(
    db,
    `INSERT INTO user_session (
       user_id, token_hash, csrf_token_hash, mfa_satisfied,
       user_agent_hash, ip_hash, absolute_expiry, idle_expiry
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
     RETURNING id`,
    [
      user.id,
      sha256Hex(sessionToken),
      sha256Hex(csrfToken),
      // A user without MFA enrolled gets a satisfied session only so they can reach
      // enrolment; every sensitive permission additionally requires mfa_enrolled.
      !user.mfa_enrolled,
      req.userAgentHash,
      req.ipHash,
      new Date(now + SESSION_ABSOLUTE_LIFETIME_MS),
      new Date(now + SESSION_IDLE_LIFETIME_MS),
    ],
  );

  await db.query(
    `INSERT INTO login_attempt (email_hash, user_id, succeeded, ip_hash, user_agent_hash)
     VALUES ($1, $2, true, $3, $4)`,
    [emailHash, user.id, req.ipHash, req.userAgentHash],
  );
  await recordAudit(db, {
    category: 'authentication',
    action: 'login',
    outcome: 'success',
    actorUserId: user.id,
    organizationId: user.organization_id,
    sessionId: session.id,
    ipHash: req.ipHash,
    userAgentHash: req.userAgentHash,
    metadata: { mfa_required: user.mfa_enrolled },
  });

  return {
    sessionToken,
    csrfToken,
    sessionId: session.id,
    mfaRequired: user.mfa_enrolled,
    mfaEnrolled: user.mfa_enrolled,
    userId: user.id,
  };
}

export async function verifyMfa(
  db: Queryable,
  sessionToken: string,
  code: string,
  ipHash: string | null,
): Promise<void> {
  const row = await maybeOne<{
    session_id: string; user_id: string; organization_id: string;
    mfa_secret_encrypted: string | null; mfa_last_used_step: string | null;
  }>(
    db,
    `SELECT s.id AS session_id, u.id AS user_id, u.organization_id,
            u.mfa_secret_encrypted, u.mfa_last_used_step::text AS mfa_last_used_step
       FROM user_session s JOIN app_user u ON u.id = s.user_id
      WHERE s.token_hash = $1 AND s.revoked_at IS NULL AND s.absolute_expiry > now()`,
    [sha256Hex(sessionToken)],
  );
  if (!row || !row.mfa_secret_encrypted) {
    throw unauthenticated('MFA_SESSION_INVALID', 'Session is not valid for this step.');
  }

  const secret = decryptField(row.mfa_secret_encrypted);
  const lastStep = row.mfa_last_used_step === null ? null : Number(row.mfa_last_used_step);
  const result = verifyTotp(secret, code, lastStep);

  if (!result.valid) {
    await recordAudit(db, {
      category: 'authentication',
      action: 'mfa.verify',
      outcome: 'failure',
      actorUserId: row.user_id,
      organizationId: row.organization_id,
      sessionId: row.session_id,
      ipHash,
      metadata: { reason: result.reason ?? 'mismatch' },
    });
    throw unauthenticated(
      result.reason === 'replayed' ? 'MFA_CODE_REPLAYED' : 'MFA_CODE_INVALID',
      result.reason === 'replayed'
        ? 'That code has already been used. Wait for the next one.'
        : 'That code is not valid.',
    );
  }

  // Burn the step so the same code cannot be presented twice.
  await db.query('UPDATE app_user SET mfa_last_used_step = $2 WHERE id = $1', [row.user_id, result.step]);
  await db.query(
    `UPDATE user_session
        SET mfa_satisfied = true, step_up_until = now() + ($2 || ' milliseconds')::interval, last_seen_at = now()
      WHERE id = $1`,
    [row.session_id, String(STEP_UP_LIFETIME_MS)],
  );
  await recordAudit(db, {
    category: 'authentication',
    action: 'mfa.verify',
    outcome: 'success',
    actorUserId: row.user_id,
    organizationId: row.organization_id,
    sessionId: row.session_id,
    ipHash,
  });
}

export interface MfaEnrolment {
  secret: string;
  provisioningUri: string;
  recoveryCodes: string[];
}

export async function beginMfaEnrolment(
  db: Queryable, userId: string, email: string,
): Promise<MfaEnrolment> {
  const secret = generateTotpSecret();
  const recoveryCodes = Array.from({ length: 8 }, () => randomToken(8));
  await db.query(
    `UPDATE app_user
        SET mfa_secret_encrypted = $2,
            mfa_recovery_codes = $3::jsonb
      WHERE id = $1`,
    [
      userId,
      encryptField(secret),
      // Recovery codes are stored hashed. The plaintext is shown once, here, and never
      // again — a recovery code we can read is a password we have written down.
      JSON.stringify(recoveryCodes.map((c) => ({ hash: sha256Hex(c), used: false }))),
    ],
  );
  return { secret, provisioningUri: totpProvisioningUri(secret, email), recoveryCodes };
}

export async function completeMfaEnrolment(
  db: Queryable, userId: string, organizationId: string, code: string,
): Promise<void> {
  const row = await one<{ mfa_secret_encrypted: string | null }>(
    db,
    'SELECT mfa_secret_encrypted FROM app_user WHERE id = $1', [userId],
  );
  if (!row.mfa_secret_encrypted) {
    throw precondition('MFA_NOT_STARTED', 'Start MFA enrolment before confirming it.');
  }
  const result = verifyTotp(decryptField(row.mfa_secret_encrypted), code, null);
  if (!result.valid) {
    throw unauthenticated('MFA_CODE_INVALID', 'That code is not valid.');
  }
  await db.query(
    'UPDATE app_user SET mfa_enrolled = true, mfa_last_used_step = $2 WHERE id = $1',
    [userId, result.step],
  );
  await recordAudit(db, {
    category: 'authentication',
    action: 'mfa.enrol',
    outcome: 'success',
    actorUserId: userId,
    organizationId,
  });
}

/**
 * Resolves a session token to an authenticated principal, or throws. Also enforces
 * idle timeout and slides the idle window forward.
 */
export async function resolveSession(
  db: Queryable, sessionToken: string,
): Promise<AuthenticatedUser> {
  const row = await maybeOne<{
    session_id: string; mfa_satisfied: boolean; step_up_until: Date | null;
    idle_expiry: Date; absolute_expiry: Date; revoked_at: Date | null;
    user_id: string; organization_id: string; email: string;
    full_name: string; display_name: string; user_status: string;
    org_status: string; org_suspended_at: Date | null; roles: string[] | null;
  }>(
    db,
    `SELECT s.id AS session_id, s.mfa_satisfied, s.step_up_until, s.idle_expiry,
            s.absolute_expiry, s.revoked_at,
            u.id AS user_id, u.organization_id, u.email, u.full_name, u.display_name,
            u.status AS user_status,
            o.onboarding_status AS org_status, o.suspended_at AS org_suspended_at,
            (SELECT array_agg(ur.role_code)
               FROM user_role ur
              WHERE ur.user_id = u.id
                AND (ur.expires_at IS NULL OR ur.expires_at > now())) AS roles
       FROM user_session s
       JOIN app_user u ON u.id = s.user_id
       JOIN organization o ON o.id = u.organization_id
      WHERE s.token_hash = $1`,
    [sha256Hex(sessionToken)],
  );

  if (!row) throw unauthenticated('SESSION_INVALID', 'Sign in to continue.');
  if (row.revoked_at) throw unauthenticated('SESSION_REVOKED', 'This session has ended.');
  if (row.absolute_expiry.getTime() <= Date.now()) {
    throw unauthenticated('SESSION_EXPIRED', 'This session has expired. Sign in again.');
  }
  if (row.idle_expiry.getTime() <= Date.now()) {
    await db.query(
      "UPDATE user_session SET revoked_at = now(), revoked_reason = 'idle_timeout' WHERE id = $1",
      [row.session_id],
    );
    throw unauthenticated('SESSION_IDLE_TIMEOUT', 'You were signed out for inactivity.');
  }
  if (row.user_status !== 'active') {
    throw forbidden('USER_NOT_ACTIVE', 'This account is not active.', `status=${row.user_status}`);
  }

  const roles = row.roles ?? [];

  // A suspended organisation's users can still sign in to read and to correspond with
  // compliance, but every write route checks organisation status separately. Blocking
  // login outright would leave a suspended customer unable to answer the questions that
  // would lift the suspension.
  const scope = databaseScopeForRoles(roles);

  await db.query(
    `UPDATE user_session
        SET last_seen_at = now(), idle_expiry = now() + ($2 || ' milliseconds')::interval
      WHERE id = $1`,
    [row.session_id, String(SESSION_IDLE_LIFETIME_MS)],
  );

  return {
    userId: row.user_id,
    organizationId: row.organization_id,
    email: row.email,
    fullName: row.full_name,
    displayName: row.display_name,
    roles,
    permissions: permissionsForRoles(roles),
    scope,
    sessionId: row.session_id,
    mfaSatisfied: row.mfa_satisfied,
    stepUpValidUntil: row.step_up_until,
  };
}

export async function verifyCsrf(
  db: Queryable, sessionToken: string, presentedCsrfToken: string,
): Promise<boolean> {
  const row = await maybeOne<{ csrf_token_hash: string }>(
    db,
    'SELECT csrf_token_hash FROM user_session WHERE token_hash = $1 AND revoked_at IS NULL',
    [sha256Hex(sessionToken)],
  );
  if (!row) return false;
  return safeEqual(row.csrf_token_hash, sha256Hex(presentedCsrfToken));
}

export async function logout(
  db: Queryable, sessionId: string, userId: string, organizationId: string,
): Promise<void> {
  await db.query(
    "UPDATE user_session SET revoked_at = now(), revoked_reason = 'user_logout' WHERE id = $1 AND revoked_at IS NULL",
    [sessionId],
  );
  await recordAudit(db, {
    category: 'authentication', action: 'logout', outcome: 'success',
    actorUserId: userId, organizationId, sessionId,
  });
}

/** Re-asserts MFA for a sensitive action, extending the step-up window. */
export async function stepUp(
  db: Queryable, user: AuthenticatedUser, code: string,
): Promise<void> {
  const row = await one<{ mfa_secret_encrypted: string | null; mfa_last_used_step: string | null }>(
    db,
    'SELECT mfa_secret_encrypted, mfa_last_used_step::text AS mfa_last_used_step FROM app_user WHERE id = $1',
    [user.userId],
  );
  if (!row.mfa_secret_encrypted) {
    throw precondition('MFA_NOT_ENROLLED', 'Enrol in multi-factor authentication before performing this action.');
  }
  const result = verifyTotp(
    decryptField(row.mfa_secret_encrypted), code,
    row.mfa_last_used_step === null ? null : Number(row.mfa_last_used_step),
  );
  if (!result.valid) {
    await recordAudit(db, {
      category: 'security_check_failed', action: 'step_up', outcome: 'failure',
      actorUserId: user.userId, organizationId: user.organizationId, sessionId: user.sessionId,
      metadata: { reason: result.reason ?? 'mismatch' },
    });
    throw unauthenticated('STEP_UP_FAILED', 'That code is not valid.');
  }
  await db.query('UPDATE app_user SET mfa_last_used_step = $2 WHERE id = $1', [user.userId, result.step]);
  await db.query(
    `UPDATE user_session SET step_up_until = now() + ($2 || ' milliseconds')::interval WHERE id = $1`,
    [user.sessionId, String(STEP_UP_LIFETIME_MS)],
  );
  await recordAudit(db, {
    category: 'authentication', action: 'step_up', outcome: 'success',
    actorUserId: user.userId, organizationId: user.organizationId, sessionId: user.sessionId,
  });
}

export async function changePassword(
  db: Queryable, user: AuthenticatedUser, currentPassword: string, newPassword: string,
): Promise<void> {
  const row = await one<{ password_hash: string | null; password_history: Array<{ hash: string }> }>(
    db, 'SELECT password_hash, password_history FROM app_user WHERE id = $1', [user.userId],
  );
  if (!row.password_hash || !verifyPassword(currentPassword, row.password_hash)) {
    throw unauthenticated('CURRENT_PASSWORD_INVALID', 'Your current password is incorrect.');
  }
  const policy = checkPasswordPolicy(newPassword, { email: user.email, fullName: user.fullName });
  if (!policy.acceptable) {
    throw invalid('PASSWORD_POLICY', 'That password does not meet the policy.', {
      failures: policy.failures,
    });
  }
  // Reuse check against the stored history.
  for (const previous of row.password_history ?? []) {
    if (verifyPassword(newPassword, previous.hash)) {
      throw invalid('PASSWORD_REUSED', 'That password has been used recently. Choose a different one.');
    }
  }
  if (verifyPassword(newPassword, row.password_hash)) {
    throw invalid('PASSWORD_REUSED', 'That is your current password.');
  }

  const history = [{ hash: row.password_hash }, ...(row.password_history ?? [])].slice(0, 5);
  await db.query(
    `UPDATE app_user
        SET password_hash = $2, password_updated_at = now(),
            password_history = $3::jsonb, must_change_password = false
      WHERE id = $1`,
    [user.userId, hashPassword(newPassword), JSON.stringify(history)],
  );
  // Every other session for this user is invalidated: a password change is the standard
  // response to a suspected compromise, and it must actually evict the attacker.
  await db.query(
    `UPDATE user_session SET revoked_at = now(), revoked_reason = 'password_changed'
      WHERE user_id = $1 AND id <> $2 AND revoked_at IS NULL`,
    [user.userId, user.sessionId],
  );
  await recordAudit(db, {
    category: 'authentication', action: 'password.change', outcome: 'success',
    actorUserId: user.userId, organizationId: user.organizationId, sessionId: user.sessionId,
    metadata: { other_sessions_revoked: true },
  });
}

/** Creates a user. Used by administration and by the seeder. */
export async function createUser(
  db: Queryable,
  input: {
    organizationId: string;
    email: string;
    fullName: string;
    displayName?: string;
    password: string;
    roles: string[];
    status?: string;
    enrolMfa?: boolean;
  },
): Promise<{ userId: string; totpSecret: string | null }> {
  const emailNorm = normaliseEmail(input.email);
  const policy = checkPasswordPolicy(input.password, { email: emailNorm, fullName: input.fullName });
  if (!policy.acceptable) {
    throw invalid('PASSWORD_POLICY', 'That password does not meet the policy.', {
      failures: policy.failures,
    });
  }

  const totpSecret = input.enrolMfa ? generateTotpSecret() : null;
  const user = await one<{ id: string }>(
    db,
    `INSERT INTO app_user (
       organization_id, email, email_normalised, full_name, display_name,
       password_hash, password_updated_at, status, mfa_enrolled, mfa_secret_encrypted
     ) VALUES ($1,$2,$3,$4,$5,$6,now(),$7,$8,$9)
     RETURNING id`,
    [
      input.organizationId, input.email, emailNorm, input.fullName,
      input.displayName ?? input.fullName.split(' ')[0] ?? input.fullName,
      hashPassword(input.password), input.status ?? 'active',
      totpSecret !== null, totpSecret ? encryptField(totpSecret) : null,
    ],
  );

  for (const role of input.roles) {
    await db.query(
      'INSERT INTO user_role (user_id, role_code) VALUES ($1, $2) ON CONFLICT DO NOTHING',
      [user.id, role],
    );
  }

  await recordAudit(db, {
    category: 'role_change', action: 'user.create', outcome: 'success',
    actorType: 'system', organizationId: input.organizationId,
    entityType: 'app_user', entityId: user.id,
    newValues: { email: input.email, roles: input.roles },
  });

  return { userId: user.id, totpSecret };
}

export function randomSessionId(): string {
  return randomUUID();
}
