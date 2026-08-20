/**
 * API routes.
 *
 * Every route declares its own authentication requirement, permissions and rate limit,
 * and every one runs inside `withContext`, which sets the row-level-security GUCs from
 * the authenticated principal. There is no route in this file that can read across
 * organisations without a back-office role, because the database will not return the rows.
 */

import { Router, field, isNonEmptyString, isUuid, isDecimalString, isCurrency, isObject, isArray, isBoolean, oneOf, serialiseCookie, type RequestContext } from './router.js';
import { withContext, withReadOnlyContext, type SecurityContext } from '../db/pool.js';
import { one, many, maybeOne } from '../db/pool.js';
import * as auth from '../auth/service.js';
import { ROLES, PERMISSIONS, SEPARATION_RULES, maskingProfileForRoles, type Permission } from '../auth/rbac.js';
import { environment, environmentSummary, RELEASE_GATES } from '../core/env.js';
import { forbidden, invalid, notFound, precondition, unauthenticated } from '../core/errors.js';
import { Decimal, RATE_SCALE } from '../core/money.js';
import * as txnService from '../modules/transaction/service.js';
import * as orgService from '../modules/org/service.js';
import * as settlement from '../modules/settlement/service.js';
import { describeStateMachine, TRANSITIONS } from '../modules/settlement/machine.js';
import * as ledger from '../modules/ledger/ledger.js';
import * as fx from '../modules/fx/quotes.js';
import * as recon from '../modules/recon/reconcile.js';
import * as exceptions from '../modules/recon/exceptions.js';
import * as notify from '../modules/notification/notify.js';
import { explainAssessment, recordDecision } from '../modules/compliance/engine.js';
import { RULES } from '../modules/compliance/rules.js';
import { verifyAuditChain, buildAuditExportManifest, recordAudit } from '../audit/audit.js';
import { registeredAdapters } from '../modules/partners/adapters.js';
import * as reports from '../modules/reporting/reports.js';
import * as learning from '../modules/learning/content.js';
import { toCsv, toXlsx, toPdf } from '../modules/reporting/export.js';

/** Builds the database security context from the authenticated principal. */
function contextFor(ctx: RequestContext): SecurityContext {
  const user = ctx.user;
  if (!user) return { scope: 'none', requestId: ctx.requestId, correlationId: ctx.correlationId };
  return {
    scope: user.scope,
    organizationId: user.scope === 'org' ? user.organizationId : null,
    userId: user.userId,
    requestId: ctx.requestId,
    correlationId: ctx.correlationId,
  };
}

function requireUser(ctx: RequestContext) {
  if (!ctx.user) throw forbidden('SESSION_REQUIRED', 'Sign in to continue.');
  return ctx.user;
}

function approvalActor(ctx: RequestContext): txnService.ApprovalActor {
  const user = requireUser(ctx);
  return {
    userId: user.userId,
    role: user.roles[0] ?? 'business_initiator',
    permissions: user.permissions,
    sessionId: user.sessionId,
    stepUpValid: user.stepUpValidUntil !== null && user.stepUpValidUntil.getTime() > Date.now(),
  };
}

/** Organisation the caller may act on: their own, or one they name if back-office. */
function targetOrganization(ctx: RequestContext, explicit?: string | null): string {
  const user = requireUser(ctx);
  if (user.scope === 'org') return user.organizationId;
  if (!explicit) throw invalid('ORGANIZATION_REQUIRED', 'Specify the organisation.');
  return explicit;
}

export function buildRouter(): Router {
  const router = new Router();

  // -------------------------------------------------------------------------
  // System and regulatory boundary
  // -------------------------------------------------------------------------

  router.register({
    method: 'GET', pattern: '/api/system/environment', auth: 'none',
    summary: 'Environment mode, banner and release-gate status.',
    tags: ['system'],
    handler: async () => environmentSummary(),
  });

  router.register({
    method: 'GET', pattern: '/api/system/regulatory-boundary', auth: 'none',
    summary: 'The complete list of what EKORails does and does not claim to be.',
    tags: ['system'],
    handler: async () => ({
      entity: 'EKORails LTD',
      what_this_software_is:
        'A compliance-first orchestration layer for business-to-business cross-border trade ' +
        'settlement. It coordinates approvals, screening, quotation, instruction and reconciliation.',
      ekorails_is_not: [
        'a bank',
        'a deposit-taking institution',
        'a licensed payment provider',
        'a custodian of customer funds',
        'a cryptocurrency exchange',
        'a consumer investment platform',
        'an admitted participant in the CBN Regulatory Sandbox',
      ],
      how_this_is_enforced: [
        'Settlement defaults to simulation and live funds require nine process-level release gates, none of which can be set from the user interface.',
        'The chart of accounts contains no customer stored-value account, so the ledger has nowhere to record holding customer money.',
        'Funding is recorded as arriving at the partner institution, never at EKORails.',
        'A claims lint runs in CI over all user-facing text and fails the build on unsupported language.',
      ],
      who_does_what: [
        { activity: 'Customer onboarding and KYB decisioning', performed_by: 'EKORails', licensed: false },
        { activity: 'Sanctions, PEP and adverse-media screening', performed_by: 'Third-party screening provider (SIMULATED in this build)', licensed: false },
        { activity: 'Holding customer funds', performed_by: 'Licensed partner institution', licensed: true },
        { activity: 'Foreign exchange execution', performed_by: 'Licensed liquidity provider (SIMULATED in this build)', licensed: true },
        { activity: 'Payment execution and settlement', performed_by: 'Licensed settlement institution (SIMULATED in this build)', licensed: true },
        { activity: 'Crediting the beneficiary', performed_by: 'Destination bank (SIMULATED in this build)', licensed: true },
        { activity: 'Orchestration, ledger, reconciliation and reporting', performed_by: 'EKORails', licensed: false },
      ],
      unresolved_facts: {
        note:
          'The CBN Regulatory Sandbox application was not available to this build. No regulatory or ' +
          'commercial fact has been invented. Values below are placeholders awaiting the filing.',
        see: 'docs/00-source-of-truth-review.md and docs/09-founder-decisions.md',
      },
      release_gates: RELEASE_GATES.map((g) => ({
        key: g.key, description: g.description, evidence_required: g.evidence,
        met: process.env[g.key] === 'true',
      })),
    }),
  });

  router.register({
    method: 'GET', pattern: '/api/system/health', auth: 'none',
    summary: 'Liveness and dependency health.',
    tags: ['system'],
    handler: async () => {
      const dbOk = await withReadOnlyContext({ scope: 'system' }, async (db) => {
        await db.query('SELECT 1');
        return true;
      }).catch(() => false);
      return {
        status: dbOk ? 'ok' : 'degraded',
        database: dbOk ? 'ok' : 'unreachable',
        environment: environment().mode,
        live_funds_enabled: environment().liveFundsEnabled,
      };
    },
  });

  // -------------------------------------------------------------------------
  // Authentication
  // -------------------------------------------------------------------------

  router.register({
    method: 'POST', pattern: '/api/auth/login', auth: 'none',
    summary: 'Password authentication. Returns a pre-MFA session.',
    tags: ['auth'],
    // Tight limit: this is the endpoint an attacker brute-forces.
    rateLimit: { windowMs: 60_000, max: 10 },
    handler: async (ctx) => {
      const email = field(ctx.body, 'email', isNonEmptyString, 'an email address')!;
      const password = field(ctx.body, 'password', isNonEmptyString, 'a password')!;

      const result = await withContext({ scope: 'system' }, (db) =>
        auth.login(db, { email, password, ipHash: ctx.ipHash, userAgentHash: ctx.userAgentHash }),
      );

      // The refusal is raised only after the transaction has COMMITTED. Throwing inside it
      // would roll back the login-attempt record, the failure counter and the audit event,
      // leaving an attacker unlimited attempts and no trace.
      if (!result.ok) {
        ctx.log.warn('login refused', { reason: result.reason });
        throw unauthenticated('INVALID_CREDENTIALS', 'Email or password is incorrect.', result.reason);
      }

      ctx.setCookies.push(
        serialiseCookie('ekorails_session', result.sessionToken, {
          maxAgeSeconds: auth.SESSION_ABSOLUTE_LIFETIME_MS / 1000,
        }),
        // Readable by the client so it can echo it in the header. That is the point of a
        // double-submit token: it is not a secret from the client, only from other origins.
        serialiseCookie('ekorails_csrf', result.csrfToken, {
          maxAgeSeconds: auth.SESSION_ABSOLUTE_LIFETIME_MS / 1000, httpOnly: false,
        }),
      );

      return {
        mfa_required: result.mfaRequired,
        mfa_enrolled: result.mfaEnrolled,
        csrf_token: result.csrfToken,
      };
    },
  });

  router.register({
    method: 'POST', pattern: '/api/auth/mfa/verify', auth: 'session_pre_mfa',
    summary: 'Completes the second authentication factor.',
    tags: ['auth'],
    rateLimit: { windowMs: 60_000, max: 10 },
    handler: async (ctx) => {
      const code = field(ctx.body, 'code', isNonEmptyString, 'a 6-digit code')!;
      await withContext({ scope: 'system' }, (db) =>
        auth.verifyMfa(db, ctx.sessionToken!, code, ctx.ipHash),
      );
      return { mfa_satisfied: true };
    },
  });

  router.register({
    method: 'POST', pattern: '/api/auth/mfa/enrol', auth: 'session_pre_mfa',
    summary: 'Starts MFA enrolment and returns the provisioning URI.',
    tags: ['auth'],
    handler: async (ctx) => {
      const user = requireUser(ctx);
      return withContext(contextFor(ctx), (db) =>
        auth.beginMfaEnrolment(db, user.userId, user.email),
      );
    },
  });

  router.register({
    method: 'POST', pattern: '/api/auth/mfa/confirm', auth: 'session_pre_mfa',
    summary: 'Confirms MFA enrolment with a code from the authenticator.',
    tags: ['auth'],
    handler: async (ctx) => {
      const user = requireUser(ctx);
      const code = field(ctx.body, 'code', isNonEmptyString, 'a 6-digit code')!;
      await withContext(contextFor(ctx), (db) =>
        auth.completeMfaEnrolment(db, user.userId, user.organizationId, code),
      );
      return { mfa_enrolled: true };
    },
  });

  router.register({
    method: 'POST', pattern: '/api/auth/step-up', auth: 'session',
    summary: 'Re-asserts the second factor for a sensitive action.',
    tags: ['auth'],
    rateLimit: { windowMs: 60_000, max: 10 },
    handler: async (ctx) => {
      const user = requireUser(ctx);
      const code = field(ctx.body, 'code', isNonEmptyString, 'a 6-digit code')!;
      await withContext(contextFor(ctx), (db) => auth.stepUp(db, user, code));
      return { step_up_valid_for_seconds: auth.STEP_UP_LIFETIME_MS / 1000 };
    },
  });

  router.register({
    method: 'POST', pattern: '/api/auth/logout', auth: 'session_pre_mfa',
    summary: 'Ends the session.',
    tags: ['auth'],
    handler: async (ctx) => {
      const user = requireUser(ctx);
      await withContext(contextFor(ctx), (db) =>
        auth.logout(db, user.sessionId, user.userId, user.organizationId),
      );
      ctx.setCookies.push(
        serialiseCookie('ekorails_session', '', { maxAgeSeconds: 0 }),
        serialiseCookie('ekorails_csrf', '', { maxAgeSeconds: 0, httpOnly: false }),
      );
      return { signed_out: true };
    },
  });

  router.register({
    method: 'POST', pattern: '/api/auth/password', auth: 'session',
    summary: 'Changes the password and revokes other sessions.',
    tags: ['auth'],
    rateLimit: { windowMs: 300_000, max: 5 },
    handler: async (ctx) => {
      const user = requireUser(ctx);
      const current = field(ctx.body, 'current_password', isNonEmptyString, 'your current password')!;
      const next = field(ctx.body, 'new_password', isNonEmptyString, 'a new password')!;
      await withContext(contextFor(ctx), (db) => auth.changePassword(db, user, current, next));
      return { changed: true, other_sessions_revoked: true };
    },
  });

  router.register({
    method: 'GET', pattern: '/api/me', auth: 'session_pre_mfa',
    summary: 'The authenticated principal, roles, permissions and masking profile.',
    tags: ['auth'],
    handler: async (ctx) => {
      const user = requireUser(ctx);
      const org = await withReadOnlyContext(contextFor(ctx), (db) =>
        one<{ legal_name: string; display_code: string; onboarding_status: string; suspended_at: Date | null }>(
          db,
          'SELECT legal_name, display_code, onboarding_status, suspended_at FROM organization WHERE id = $1',
          [user.organizationId],
        ),
      );
      return {
        user_id: user.userId,
        email: user.email,
        full_name: user.fullName,
        display_name: user.displayName,
        roles: user.roles,
        role_details: user.roles.map((r) => {
          const def = ROLES[r as keyof typeof ROLES];
          return def
            ? { code: def.code, name: def.name, realm: def.realm, cannot: def.explicitDenials }
            : { code: r, name: r, realm: 'unknown', cannot: [] };
        }),
        permissions: [...user.permissions],
        scope: user.scope,
        masking_profile: maskingProfileForRoles(user.roles),
        mfa_satisfied: user.mfaSatisfied,
        step_up_valid: user.stepUpValidUntil !== null && user.stepUpValidUntil.getTime() > Date.now(),
        organization: {
          id: user.organizationId,
          legal_name: org.legal_name,
          display_code: org.display_code,
          onboarding_status: org.onboarding_status,
          suspended: org.suspended_at !== null,
        },
      };
    },
  });

  // -------------------------------------------------------------------------
  // Onboarding
  // -------------------------------------------------------------------------

  router.register({
    method: 'GET', pattern: '/api/onboarding', auth: 'session',
    permissions: ['org.profile.read'],
    summary: 'The organisation onboarding state, profile, people and documents.',
    tags: ['onboarding'],
    handler: async (ctx) => {
      const user = requireUser(ctx);
      const orgId = targetOrganization(ctx, ctx.query.get('organization_id'));
      return withReadOnlyContext(contextFor(ctx), async (db) => {
        const org = await one<Record<string, unknown>>(
          db,
          `SELECT id, display_code, legal_name, trading_name, onboarding_status, risk_rating,
                  suspended_at, suspension_reason, created_at
             FROM organization WHERE id = $1`,
          [orgId],
        );
        const profile = await maybeOne<Record<string, unknown>>(
          db,
          `SELECT id, version, legal_business_name, trading_name, registration_number, jurisdiction,
                  date_of_incorporation, registered_address, operating_address, business_activity,
                  industry_code, website, tax_identification_number, regulatory_licence,
                  expected_corridors, expected_monthly_volume::text AS expected_monthly_volume,
                  expected_monthly_currency, expected_transaction_size::text AS expected_transaction_size,
                  expected_txn_currency, source_of_funds, purpose_of_transactions, submitted_at
             FROM organization_profile WHERE organization_id = $1 AND is_current`,
          [orgId],
        );
        const people = await many<Record<string, unknown>>(
          db,
          `SELECT p.id, p.full_name, p.nationality, p.country_of_residence, p.is_pep,
                  p.pep_category, p.verification_status, p.id_number_last4, p.id_expires_on,
                  (SELECT json_agg(json_build_object(
                     'capacity', c.capacity,
                     'ownership_percent', c.ownership_percent::text,
                     'ownership_is_direct', c.ownership_is_direct,
                     'control_basis', c.control_basis))
                     FROM person_capacity c WHERE c.person_id = p.id) AS capacities
             FROM natural_person p WHERE p.organization_id = $1 ORDER BY p.full_name`,
          [orgId],
        );
        const documents = await orgService.listDocuments(db, orgId);
        const coverage = await orgService.ownershipCoverage(db, orgId);
        return {
          organization: org, profile, people, documents, ownership_coverage: coverage,
          workflow_statuses: [
            'draft', 'submitted', 'automated_checks_running', 'analyst_review',
            'additional_information_required', 'manager_review', 'approved',
            'rejected', 'suspended', 'expired', 'periodic_review_due',
          ],
        };
      });
    },
  });

  router.register({
    method: 'PUT', pattern: '/api/onboarding/profile', auth: 'session',
    permissions: ['org.profile.write'],
    summary: 'Creates or updates the KYB profile.',
    tags: ['onboarding'],
    handler: async (ctx) => {
      const user = requireUser(ctx);
      const body = (ctx.body ?? {}) as Record<string, unknown>;
      return withContext(contextFor(ctx), (db) =>
        orgService.upsertKybProfile(db, {
          organizationId: user.organizationId,
          userId: user.userId,
          profile: {
            legalBusinessName: field(body, 'legal_business_name', isNonEmptyString, 'the legal business name')!,
            tradingName: (body['trading_name'] as string) ?? null,
            registrationNumber: field(body, 'registration_number', isNonEmptyString, 'the registration number')!,
            jurisdiction: field(body, 'jurisdiction', isNonEmptyString, 'a 2-letter country code')!,
            dateOfIncorporation: field(body, 'date_of_incorporation', isNonEmptyString, 'a date')!,
            registeredAddress: field(body, 'registered_address', isObject, 'an address object')!,
            operatingAddress: field(body, 'operating_address', isObject, 'an address object')!,
            businessActivity: field(body, 'business_activity', isNonEmptyString, 'a description')!,
            industryCode: field(body, 'industry_code', isNonEmptyString, 'an industry')!,
            website: (body['website'] as string) ?? null,
            taxIdentificationNumber: (body['tax_identification_number'] as string) ?? null,
            regulatoryLicence: (body['regulatory_licence'] as Record<string, unknown>) ?? null,
            expectedCorridors: (body['expected_corridors'] as string[]) ?? [],
            expectedMonthlyVolume: (body['expected_monthly_volume'] as string) ?? null,
            expectedMonthlyCurrency: (body['expected_monthly_currency'] as string) ?? null,
            expectedTransactionSize: (body['expected_transaction_size'] as string) ?? null,
            expectedTxnCurrency: (body['expected_txn_currency'] as string) ?? null,
            sourceOfFunds: field(body, 'source_of_funds', isNonEmptyString, 'a description')!,
            purposeOfTransactions: field(body, 'purpose_of_transactions', isNonEmptyString, 'a description')!,
          },
        }),
      );
    },
  });

  router.register({
    method: 'POST', pattern: '/api/onboarding/people', auth: 'session',
    permissions: ['org.profile.write'], successStatus: 201,
    summary: 'Adds a director, signatory or beneficial owner.',
    tags: ['onboarding'],
    handler: async (ctx) => {
      const user = requireUser(ctx);
      const body = (ctx.body ?? {}) as Record<string, unknown>;
      return withContext(contextFor(ctx), async (db) => {
        const profile = await one<{ id: string }>(
          db, 'SELECT id FROM organization_profile WHERE organization_id = $1 AND is_current',
          [user.organizationId],
        );
        return orgService.addPerson(db, {
          organizationId: user.organizationId, profileId: profile.id, userId: user.userId,
          person: {
            fullName: field(body, 'full_name', isNonEmptyString, 'a full name')!,
            dateOfBirth: (body['date_of_birth'] as string) ?? null,
            nationality: (body['nationality'] as string) ?? null,
            countryOfResidence: (body['country_of_residence'] as string) ?? null,
            residentialAddress: (body['residential_address'] as Record<string, unknown>) ?? null,
            idDocumentType: (body['id_document_type'] as string) ?? null,
            idNumber: (body['id_number'] as string) ?? null,
            idExpiresOn: (body['id_expires_on'] as string) ?? null,
            isPep: body['is_pep'] === true,
            pepDeclaration: (body['pep_declaration'] as string) ?? null,
            pepCategory: (body['pep_category'] as string) ?? null,
            capacities: field(body, 'capacities', isArray, 'a list of capacities') as never,
          },
        });
      });
    },
  });

  router.register({
    method: 'POST', pattern: '/api/onboarding/submit', auth: 'session',
    permissions: ['org.kyb.submit'],
    summary: 'Submits KYB for compliance review and runs screening.',
    tags: ['onboarding'],
    handler: async (ctx) => {
      const user = requireUser(ctx);
      return withContext(contextFor(ctx), (db) =>
        orgService.submitForKybReview(db, user.organizationId, user.userId),
      );
    },
  });

  // -------------------------------------------------------------------------
  // Documents
  // -------------------------------------------------------------------------

  router.register({
    method: 'POST', pattern: '/api/documents', auth: 'session',
    permissions: ['document.upload'], successStatus: 201,
    summary: 'Uploads a document. Body is the raw file; metadata is in query parameters.',
    tags: ['documents'],
    handler: async (ctx) => {
      const user = requireUser(ctx);
      const bytes = Buffer.isBuffer(ctx.body)
        ? ctx.body
        : Buffer.from(String((ctx.body as Record<string, unknown>)?.['content_base64'] ?? ''), 'base64');
      const documentType = ctx.query.get('document_type')
        ?? (ctx.body as Record<string, unknown>)?.['document_type'] as string;
      const filename = ctx.query.get('filename')
        ?? (ctx.body as Record<string, unknown>)?.['filename'] as string;
      const mimeType = ctx.query.get('mime_type')
        ?? (ctx.body as Record<string, unknown>)?.['mime_type'] as string;
      if (!documentType || !filename || !mimeType) {
        throw invalid('METADATA_REQUIRED', 'document_type, filename and mime_type are required.');
      }
      return withContext(contextFor(ctx), (db) =>
        orgService.uploadDocument(db, {
          organizationId: user.organizationId, documentType, originalFilename: filename,
          mimeType, bytes, userId: user.userId,
          issuedOn: ctx.query.get('issued_on'), expiresOn: ctx.query.get('expires_on'),
        }),
      );
    },
  });

  router.register({
    method: 'GET', pattern: '/api/documents', auth: 'session',
    permissions: ['document.read', 'document.read.any'],
    summary: 'Lists documents for an organisation.',
    tags: ['documents'],
    handler: async (ctx) => {
      const orgId = targetOrganization(ctx, ctx.query.get('organization_id'));
      return withReadOnlyContext(contextFor(ctx), (db) => orgService.listDocuments(db, orgId));
    },
  });

  router.register({
    method: 'POST', pattern: '/api/documents/:id/download-url', auth: 'session',
    permissions: ['document.read', 'document.read.any'],
    summary: 'Mints a short-lived signed download URL. Every mint is audited.',
    tags: ['documents'],
    handler: async (ctx) => {
      const user = requireUser(ctx);
      const reason = (ctx.body as Record<string, unknown>)?.['reason'] as string | undefined;
      // An external (auditor/regulator) role must state a reason for accessing a customer
      // document. That reason is written to the access log and the audit trail.
      if (user.scope === 'global' && maskingProfileForRoles(user.roles) === 'masked' && !reason) {
        throw precondition(
          'ACCESS_REASON_REQUIRED',
          'Accessing a customer document in this role requires a stated reason, which is recorded.',
        );
      }
      return withContext(contextFor(ctx), (db) =>
        orgService.mintDocumentUrl(db, {
          documentId: ctx.params['id']!, userId: user.userId,
          sessionId: user.sessionId, reason: reason ?? null,
        }),
      );
    },
  });

  router.register({
    method: 'POST', pattern: '/api/documents/:id/extraction', auth: 'session',
    permissions: ['document.upload'], successStatus: 201,
    summary: 'Records AI-proposed fields for a document. Advisory only.',
    tags: ['documents'],
    handler: async (ctx) => {
      const user = requireUser(ctx);
      const body = (ctx.body ?? {}) as Record<string, unknown>;
      const result = await withContext(contextFor(ctx), (db) =>
        orgService.proposeExtraction(db, {
          documentId: ctx.params['id']!, organizationId: user.organizationId,
          extractor: (body['extractor'] as string) ?? 'ekorails-extract-stub',
          extractorVersion: (body['extractor_version'] as string) ?? '0.1.0',
          proposedFields: field(body, 'proposed_fields', isObject, 'an object')!,
          fieldConfidence: (body['field_confidence'] as Record<string, number>) ?? {},
        }),
      );
      return {
        ...result,
        status: 'proposed',
        notice:
          'These fields are a proposal. They are not used by the compliance engine and have no effect ' +
          'until a person confirms them.',
      };
    },
  });

  router.register({
    method: 'POST', pattern: '/api/extractions/:id/confirm', auth: 'session',
    permissions: ['document.extraction.confirm'],
    summary: 'A person confirms or corrects AI-proposed document fields.',
    tags: ['documents'],
    handler: async (ctx) => {
      const user = requireUser(ctx);
      const body = (ctx.body ?? {}) as Record<string, unknown>;
      await withContext(contextFor(ctx), (db) =>
        orgService.confirmExtraction(db, {
          extractionId: ctx.params['id']!,
          confirmedFields: field(body, 'confirmed_fields', isObject, 'an object')!,
          corrected: body['corrected'] === true,
          userId: user.userId,
        }),
      );
      return { confirmed: true, confirmed_by: user.userId };
    },
  });

  // -------------------------------------------------------------------------
  // Beneficiaries
  // -------------------------------------------------------------------------

  router.register({
    method: 'GET', pattern: '/api/beneficiaries', auth: 'session',
    permissions: ['beneficiary.read', 'beneficiary.review'],
    summary: 'Lists beneficiaries.',
    tags: ['beneficiaries'],
    handler: async (ctx) => {
      const orgId = targetOrganization(ctx, ctx.query.get('organization_id'));
      return withReadOnlyContext(contextFor(ctx), (db) => orgService.listBeneficiaries(db, orgId));
    },
  });

  router.register({
    method: 'POST', pattern: '/api/beneficiaries', auth: 'session',
    permissions: ['beneficiary.write'], successStatus: 201,
    summary: 'Adds a beneficiary. Screening runs immediately; review is required before first use.',
    tags: ['beneficiaries'],
    handler: async (ctx) => {
      const user = requireUser(ctx);
      const body = (ctx.body ?? {}) as Record<string, unknown>;
      const bank = field(body, 'bank', isObject, 'a bank object')!;
      return withContext(contextFor(ctx), (db) =>
        orgService.createBeneficiary(db, {
          organizationId: user.organizationId, userId: user.userId,
          beneficiary: {
            legalName: field(body, 'legal_name', isNonEmptyString, 'the legal name')!,
            registrationNumber: (body['registration_number'] as string) ?? null,
            country: field(body, 'country', isNonEmptyString, 'a 2-letter country code')!,
            address: field(body, 'address', isObject, 'an address object')!,
            paymentPurpose: field(body, 'payment_purpose', isNonEmptyString, 'a purpose')!,
            relationshipToSender: field(body, 'relationship_to_sender', isNonEmptyString, 'a relationship')!,
            supportingContractId: (body['supporting_contract_id'] as string) ?? null,
            bank: {
              accountHolderName: field(bank, 'account_holder_name', isNonEmptyString, 'the account holder name')!,
              institutionName: field(bank, 'institution_name', isNonEmptyString, 'the institution name')!,
              institutionCountry: field(bank, 'institution_country', isNonEmptyString, 'a country code')!,
              swiftBic: (bank['swift_bic'] as string) ?? null,
              identifierScheme: field(bank, 'identifier_scheme',
                oneOf('iban', 'nuban', 'account_number', 'sort_code_account', 'other'),
                'a supported identifier scheme')!,
              identifier: field(bank, 'identifier', isNonEmptyString, 'the account identifier')!,
              currency: field(bank, 'currency', isCurrency, 'a 3-letter currency code')!,
            },
          },
        }),
      );
    },
  });

  router.register({
    method: 'PATCH', pattern: '/api/beneficiaries/:id', auth: 'session',
    permissions: ['beneficiary.write'],
    summary: 'Updates a beneficiary. A material change invalidates approval automatically.',
    tags: ['beneficiaries'],
    handler: async (ctx) => {
      const user = requireUser(ctx);
      return withContext(contextFor(ctx), (db) =>
        orgService.updateBeneficiary(db, {
          beneficiaryId: ctx.params['id']!,
          changes: (ctx.body ?? {}) as never,
          userId: user.userId,
        }),
      );
    },
  });

  router.register({
    method: 'POST', pattern: '/api/beneficiaries/:id/review', auth: 'session',
    permissions: ['beneficiary.review'],
    summary: 'Compliance approves, rejects or queries a beneficiary.',
    tags: ['compliance'],
    handler: async (ctx) => {
      const user = requireUser(ctx);
      const body = (ctx.body ?? {}) as Record<string, unknown>;
      return withContext(contextFor(ctx), (db) =>
        orgService.reviewBeneficiary(db, {
          beneficiaryId: ctx.params['id']!,
          decision: field(body, 'decision', oneOf('approve', 'reject', 'request_information'), 'a decision')!,
          reason: field(body, 'reason', isNonEmptyString, 'a written reason')!,
          userId: user.userId, role: user.roles[0] ?? 'compliance_analyst',
        }),
      );
    },
  });

  // -------------------------------------------------------------------------
  // Transactions
  // -------------------------------------------------------------------------

  router.register({
    method: 'GET', pattern: '/api/transactions', auth: 'session',
    permissions: ['txn.read', 'txn.read.any'],
    summary: 'Lists transactions visible to the caller.',
    tags: ['transactions'],
    handler: async (ctx) => {
      const user = requireUser(ctx);
      return withReadOnlyContext(contextFor(ctx), (db) =>
        txnService.listTransactions(db, {
          organizationId: user.scope === 'org' ? user.organizationId : ctx.query.get('organization_id'),
          state: ctx.query.get('state'),
          from: ctx.query.get('from'),
          to: ctx.query.get('to'),
          limit: Number(ctx.query.get('limit') ?? 50),
          offset: Number(ctx.query.get('offset') ?? 0),
        }),
      );
    },
  });

  router.register({
    method: 'GET', pattern: '/api/transactions/requiring-action', auth: 'session',
    permissions: ['txn.read'],
    summary: 'Transactions waiting on this user.',
    tags: ['transactions'],
    handler: async (ctx) => {
      const user = requireUser(ctx);
      return withReadOnlyContext(contextFor(ctx), (db) =>
        txnService.requiringAction(db, user.organizationId, user.userId, user.permissions),
      );
    },
  });

  router.register({
    method: 'POST', pattern: '/api/transactions', auth: 'session',
    permissions: ['txn.initiate'], successStatus: 201,
    summary: 'Creates a draft transaction.',
    tags: ['transactions'],
    handler: async (ctx) => {
      const user = requireUser(ctx);
      const body = (ctx.body ?? {}) as Record<string, unknown>;
      return withContext(contextFor(ctx), (db) =>
        txnService.createTransaction(db, {
          organizationId: user.organizationId,
          beneficiaryId: field(body, 'beneficiary_id', isUuid, 'a beneficiary id')!,
          corridorId: field(body, 'corridor_id', isUuid, 'a corridor id')!,
          sendAmount: field(body, 'send_amount', isDecimalString, 'a decimal amount as a string')!,
          sendCurrency: field(body, 'send_currency', isCurrency, 'a 3-letter currency code')!,
          receiveCurrency: field(body, 'receive_currency', isCurrency, 'a 3-letter currency code')!,
          purpose: field(body, 'purpose', isNonEmptyString, 'the purpose of the payment')!,
          sourceOfFunds: field(body, 'source_of_funds', isNonEmptyString, 'a source-of-funds narrative')!,
          requestedSettlementDate: (body['requested_settlement_date'] as string) ?? null,
          invoiceNumber: (body['invoice_number'] as string) ?? null,
          documentLinks: (body['documents'] as Array<{ documentId: string; role: string }>) ?? [],
          initiatedBy: user.userId,
          idempotencyKey: (ctx.headers['idempotency-key'] as string) ?? (body['idempotency_key'] as string) ?? null,
        }),
      );
    },
  });

  router.register({
    method: 'GET', pattern: '/api/transactions/:id', auth: 'session',
    permissions: ['txn.read', 'txn.read.any'],
    summary: 'The full lifecycle view of one transaction.',
    tags: ['transactions'],
    handler: async (ctx) =>
      withReadOnlyContext(contextFor(ctx), async (db) => {
        const result = await settlement.timeline(db, ctx.params['id']!);
        // Not found, and not "forbidden": confirming that a record exists in another
        // organisation is itself a disclosure.
        if (!result) throw notFound('TRANSACTION_NOT_FOUND', 'Transaction not found.');
        return result;
      }),
  });

  router.register({
    method: 'POST', pattern: '/api/transactions/:id/submit', auth: 'session',
    permissions: ['txn.initiate'],
    summary: 'Submits a draft for dual authorisation.',
    tags: ['transactions'],
    handler: async (ctx) =>
      withContext(contextFor(ctx), (db) =>
        txnService.submitForApproval(db, ctx.params['id']!, approvalActor(ctx)),
      ),
  });

  router.register({
    method: 'POST', pattern: '/api/transactions/:id/approve', auth: 'session',
    permissions: ['txn.approve'],
    summary: 'The second business authorisation. Refuses self-approval.',
    tags: ['transactions'],
    handler: async (ctx) => {
      const body = (ctx.body ?? {}) as Record<string, unknown>;
      return withContext(contextFor(ctx), (db) =>
        txnService.businessApprove(db, {
          transactionId: ctx.params['id']!,
          actor: approvalActor(ctx),
          approve: body['approve'] !== false,
          reason: (body['reason'] as string) ?? 'Authorised.',
        }),
      );
    },
  });

  router.register({
    method: 'POST', pattern: '/api/transactions/:id/compliance-decision', auth: 'session',
    permissions: ['compliance.alert.clear'],
    summary: 'Compliance clears, declines, queries or suspends a transaction.',
    tags: ['compliance'],
    handler: async (ctx) => {
      const body = (ctx.body ?? {}) as Record<string, unknown>;
      return withContext(contextFor(ctx), (db) =>
        txnService.complianceDecide(db, {
          transactionId: ctx.params['id']!,
          actor: approvalActor(ctx),
          decision: field(body, 'decision',
            oneOf('approve', 'reject', 'request_information', 'suspend'), 'a decision')!,
          reason: field(body, 'reason', isNonEmptyString, 'a written reason of at least 20 characters')!,
        }),
      );
    },
  });

  // -------------------------------------------------------------------------
  // FX
  // -------------------------------------------------------------------------

  router.register({
    method: 'POST', pattern: '/api/transactions/:id/quote', auth: 'session',
    permissions: ['fx.quote.issue'], successStatus: 201,
    summary: 'Treasury issues an FX quote against a compliance-approved transaction.',
    tags: ['fx'],
    handler: async (ctx) => {
      const user = requireUser(ctx);
      const body = (ctx.body ?? {}) as Record<string, unknown>;
      return withContext(contextFor(ctx), async (db) => {
        const txn = await one<{
          id: string; organization_id: string; corridor_id: string; state: string;
          send_amount: string; send_currency: string; receive_currency: string;
        }>(
          db,
          `SELECT id, organization_id, corridor_id, state, send_amount::text, send_currency, receive_currency
             FROM transaction WHERE id = $1`,
          [ctx.params['id']!],
        );
        if (txn.state !== 'compliance_approved') {
          throw precondition(
            'NOT_COMPLIANCE_APPROVED',
            `A quote can only be issued once compliance has approved. This transaction is "${txn.state}".`,
          );
        }

        const providerRate = Decimal.fromString(
          field(body, 'provider_rate', isNonEmptyString, 'a rate as a decimal string')!, RATE_SCALE,
        );
        const referenceRate = Decimal.fromString(
          (body['reference_rate'] as string) ?? providerRate.toString(), RATE_SCALE,
        );

        const quote = await fx.issueQuote(db, {
          organizationId: txn.organization_id,
          corridorId: txn.corridor_id,
          sendAmount: Decimal.fromString(txn.send_amount),
          sendCurrency: txn.send_currency,
          receiveCurrency: txn.receive_currency,
          referenceRate,
          referenceRateSource: (body['reference_rate_source'] as string)
            ?? 'Manually entered by an authorised treasury operator',
          referenceRateAt: new Date(),
          providerRate,
          quoteSource: (body['quote_source'] as fx.QuoteSource) ?? 'manual_treasury_entry',
          quoteSourceDetail: (body['quote_source_detail'] as string) ?? null,
          // Always simulated in this build. The API does not accept `is_simulated: false`.
          isSimulated: true,
          validitySeconds: Number(body['validity_seconds'] ?? fx.DEFAULT_QUOTE_VALIDITY_SECONDS),
          issuedBy: user.userId,
          fees: fx.defaultFeeSchedule(txn.send_currency),
        });

        await db.query('UPDATE transaction SET fx_quote_id = $2 WHERE id = $1', [txn.id, quote.quoteId]);
        await db.query(
          'UPDATE transaction SET expected_receive_amount = $2 WHERE id = $1',
          [txn.id, quote.expectedReceivable],
        );

        const { transition } = await import('../modules/settlement/machine.js');
        await transition(db, {
          transactionId: txn.id, event: 'quote_issue', actorType: 'user',
          actorUserId: user.userId, actorRole: user.roles[0] ?? 'treasury_operator',
          actorPermissions: user.permissions, stepUpValid: true,
          reason: `Quote ${quote.reference} issued at ${quote.providerRate} (simulated rate).`,
          evidence: { quote_reference: quote.reference, simulated: true },
        });

        return quote;
      });
    },
  });

  router.register({
    method: 'POST', pattern: '/api/quotes/:id/accept', auth: 'session',
    permissions: ['fx.quote.accept'],
    summary: 'The customer accepts a quote. Posts the obligation-recognition journal.',
    tags: ['fx'],
    handler: async (ctx) => {
      const user = requireUser(ctx);
      const actor = approvalActor(ctx);
      if (!actor.stepUpValid) {
        throw forbidden(
          'STEP_UP_REQUIRED',
          'Confirm your identity with your authenticator before accepting a quote.',
          'quote_accept requires step-up',
        );
      }
      return withContext(contextFor(ctx), async (db) => {
        const accepted = await fx.acceptQuote(db, {
          quoteId: ctx.params['id']!, acceptedBy: user.userId, organizationId: user.organizationId,
        });
        const txn = await one<{ id: string }>(
          db, 'SELECT id FROM transaction WHERE fx_quote_id = $1', [ctx.params['id']!],
        );
        const result = await settlement.acceptQuoteAndRecogniseObligation(db, txn.id, {
          type: 'user', userId: user.userId, role: user.roles[0] ?? 'business_approver',
          permissions: user.permissions as never, stepUpValid: true,
        });
        const funded = await settlement.requestFunding(db, txn.id, {
          type: 'user', userId: user.userId, role: user.roles[0] ?? 'business_approver',
          permissions: user.permissions as never, stepUpValid: true,
        });
        return {
          quote: accepted,
          state: funded.to,
          obligation_journal: result.journalReference,
        };
      });
    },
  });

  // -------------------------------------------------------------------------
  // Treasury and settlement
  // -------------------------------------------------------------------------

  router.register({
    method: 'POST', pattern: '/api/transactions/:id/funding/confirm', auth: 'session',
    permissions: ['treasury.funding.review'],
    summary: 'Confirms funding at the origin partner (simulated).',
    tags: ['treasury'],
    handler: async (ctx) => {
      const user = requireUser(ctx);
      return withContext(contextFor(ctx), (db) =>
        settlement.confirmFunding(db, ctx.params['id']!, {
          type: 'user', userId: user.userId, role: user.roles[0] ?? 'treasury_operator',
          permissions: user.permissions as never, stepUpValid: true,
        }),
      );
    },
  });

  router.register({
    method: 'POST', pattern: '/api/transactions/:id/settlement/prepare', auth: 'session',
    permissions: ['treasury.settlement.route'],
    summary: 'Converts the obligation and positions liquidity.',
    tags: ['treasury'],
    handler: async (ctx) => {
      const user = requireUser(ctx);
      return withContext(contextFor(ctx), (db) =>
        settlement.prepareSettlement(db, ctx.params['id']!, {
          type: 'user', userId: user.userId, role: user.roles[0] ?? 'treasury_operator',
          permissions: user.permissions as never, stepUpValid: true,
        }),
      );
    },
  });

  router.register({
    method: 'POST', pattern: '/api/transactions/:id/settlement/submit', auth: 'session',
    permissions: ['treasury.settlement.route'],
    summary: 'Submits the settlement instruction to the partner (simulated).',
    tags: ['treasury'],
    handler: async (ctx) => {
      const user = requireUser(ctx);
      const actor = approvalActor(ctx);
      if (!actor.stepUpValid) {
        throw forbidden(
          'STEP_UP_REQUIRED',
          'Confirm your identity with your authenticator before releasing a settlement.',
          'submit_to_partner requires step-up',
        );
      }
      return withContext(contextFor(ctx), (db) =>
        settlement.submitSettlement(db, ctx.params['id']!, {
          type: 'user', userId: user.userId, role: user.roles[0] ?? 'treasury_operator',
          permissions: user.permissions as never, stepUpValid: true,
        }),
      );
    },
  });

  router.register({
    method: 'POST', pattern: '/api/transactions/:id/complete', auth: 'session',
    permissions: ['recon.run'],
    summary: 'Settles partner fees and completes a reconciled transaction.',
    tags: ['treasury'],
    handler: async (ctx) => {
      const user = requireUser(ctx);
      return withContext(contextFor(ctx), (db) =>
        settlement.complete(db, ctx.params['id']!, {
          type: 'user', userId: user.userId, role: user.roles[0] ?? 'finance_analyst',
          permissions: user.permissions as never, stepUpValid: true,
        }),
      );
    },
  });

  // -------------------------------------------------------------------------
  // Compliance console
  // -------------------------------------------------------------------------

  router.register({
    method: 'GET', pattern: '/api/compliance/cases', auth: 'session',
    permissions: ['compliance.case.read'],
    summary: 'The compliance queue.',
    tags: ['compliance'],
    handler: async (ctx) =>
      withReadOnlyContext(contextFor(ctx), (db) =>
        many<Record<string, unknown>>(
          db,
          `SELECT c.reference, c.case_type, c.status, c.priority, c.opened_at, c.sla_due_at,
                  c.requires_manager, c.subject_type, c.subject_id,
                  (c.sla_due_at < now() AND c.status NOT LIKE 'closed%') AS breached_sla,
                  o.legal_name AS organization_name, o.display_code AS organization_code,
                  u.display_name AS assigned_to_name,
                  r.outcome AS risk_outcome, r.recommended_action, r.id AS risk_assessment_id,
                  t.reference AS transaction_reference
             FROM compliance_case c
             JOIN organization o ON o.id = c.organization_id
             LEFT JOIN app_user u ON u.id = c.assigned_to
             LEFT JOIN risk_assessment r ON r.id = c.risk_assessment_id
             LEFT JOIN transaction t ON t.id = c.subject_id AND c.subject_type = 'transaction'
            WHERE ($1::text IS NULL OR c.status = $1)
            ORDER BY
              CASE c.priority WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'normal' THEN 2 ELSE 3 END,
              c.sla_due_at NULLS LAST
            LIMIT 200`,
          [ctx.query.get('status')],
        ),
      ),
  });

  router.register({
    method: 'GET', pattern: '/api/compliance/cases/:reference', auth: 'session',
    permissions: ['compliance.case.read'],
    summary: 'One compliance case with its assessment, notes and decisions.',
    tags: ['compliance'],
    handler: async (ctx) =>
      withReadOnlyContext(contextFor(ctx), async (db) => {
        const c = await maybeOne<Record<string, unknown>>(
          db,
          `SELECT c.*, o.legal_name AS organization_name, o.display_code AS organization_code
             FROM compliance_case c JOIN organization o ON o.id = c.organization_id
            WHERE c.reference = $1`,
          [ctx.params['reference']!],
        );
        if (!c) throw notFound('CASE_NOT_FOUND', 'Case not found.');
        const assessment = c['risk_assessment_id']
          ? await explainAssessment(db, c['risk_assessment_id'] as string) : null;
        const notes = await many<Record<string, unknown>>(
          db,
          `SELECT n.body, n.visibility, n.created_at, u.display_name AS author_name
             FROM compliance_case_note n LEFT JOIN app_user u ON u.id = n.author_id
            WHERE n.compliance_case_id = $1 ORDER BY n.created_at`,
          [c['id']],
        );
        const decisions = await many<Record<string, unknown>>(
          db,
          `SELECT d.decision, d.reason, d.decided_by_role, d.decided_at, u.display_name AS decided_by_name
             FROM compliance_decision d LEFT JOIN app_user u ON u.id = d.decided_by
            WHERE d.compliance_case_id = $1 ORDER BY d.decided_at`,
          [c['id']],
        );
        const screening = await many<Record<string, unknown>>(
          db,
          `SELECT sc.reference, sc.subject_type, sc.status, sc.disposition, sc.disposition_reason,
                  sc.provider, sc.is_simulated, sc.requested_at,
                  (SELECT json_agg(json_build_object(
                     'type', r.screening_type, 'matched_name', r.matched_name,
                     'score', r.match_score::text, 'list', r.list_name,
                     'entry', r.list_entry_ref, 'details', r.match_details))
                     FROM screening_result r WHERE r.screening_case_id = sc.id) AS results
             FROM screening_case sc
            WHERE sc.subject_id = $1 OR sc.organization_id = $2
            ORDER BY sc.requested_at DESC LIMIT 20`,
          [c['subject_id'], c['organization_id']],
        );
        return { case: c, assessment, notes, decisions, screening };
      }),
  });

  router.register({
    method: 'POST', pattern: '/api/compliance/cases/:reference/decision', auth: 'session',
    permissions: ['compliance.alert.clear', 'compliance.highrisk.approve'],
    summary: 'Records a compliance decision with a mandatory written reason.',
    tags: ['compliance'],
    handler: async (ctx) => {
      const user = requireUser(ctx);
      const body = (ctx.body ?? {}) as Record<string, unknown>;
      const decision = field(body, 'decision', isNonEmptyString, 'a decision')!;
      const reason = field(body, 'reason', isNonEmptyString, 'a written reason')!;

      return withContext(contextFor(ctx), async (db) => {
        const c = await one<{
          id: string; organization_id: string; risk_assessment_id: string | null;
          requires_manager: boolean; status: string;
        }>(
          db,
          `SELECT id, organization_id, risk_assessment_id, requires_manager, status
             FROM compliance_case WHERE reference = $1`,
          [ctx.params['reference']!],
        );

        const isManager = user.permissions.has('compliance.highrisk.approve');
        if (c.requires_manager && !isManager && ['cleared', 'approved'].includes(decision)) {
          await recordAudit(db, {
            category: 'authorisation', action: 'compliance.decision', outcome: 'denied',
            actorUserId: user.userId, actorRole: user.roles[0] ?? null,
            organizationId: c.organization_id, entityType: 'compliance_case', entityId: c.id,
            metadata: { denial_reason: 'manager_approval_required' },
          });
          throw forbidden(
            'MANAGER_APPROVAL_REQUIRED',
            'This case is flagged for manager approval and cannot be cleared by an analyst.',
          );
        }

        // A manager cannot review their own earlier decision on the same case.
        const priorByMe = await maybeOne<{ id: string }>(
          db,
          `SELECT id FROM compliance_decision
            WHERE compliance_case_id = $1 AND decided_by = $2 ORDER BY decided_at LIMIT 1`,
          [c.id, user.userId],
        );
        if (decision === 'approved' && priorByMe && c.requires_manager) {
          const rule = SEPARATION_RULES.find((r) => r.code === 'SOD_COMPLIANCE_SELF_REVIEW')!;
          throw forbidden('SEGREGATION_OF_DUTIES', rule.description, rule.code);
        }

        const decisionId = await recordDecision(db, {
          complianceCaseId: c.id,
          organizationId: c.organization_id,
          decision,
          reason,
          decidedBy: user.userId,
          decidedByRole: user.roles[0] ?? 'compliance_analyst',
          riskAssessmentId: c.risk_assessment_id,
          evidenceRefs: (body['evidence_refs'] as unknown[]) ?? [],
        });

        const nextStatus =
          decision === 'cleared' || decision === 'cleared_false_positive' || decision === 'approved'
            ? 'closed_cleared'
            : decision === 'rejected' ? 'closed_rejected'
            : decision === 'suspended' ? 'closed_suspended'
            : decision === 'escalated' ? 'escalated'
            : decision === 'information_requested' ? 'awaiting_information'
            : 'in_review';

        await db.query(
          `UPDATE compliance_case
              SET status = $2, first_touched_at = COALESCE(first_touched_at, now()),
                  assigned_to = COALESCE(assigned_to, $3),
                  closed_at = CASE WHEN $2 LIKE 'closed%' THEN now() ELSE NULL END
            WHERE id = $1`,
          [c.id, nextStatus, user.userId],
        );

        return { decision_id: decisionId, case_status: nextStatus };
      });
    },
  });

  router.register({
    method: 'POST', pattern: '/api/compliance/screening/:id/dispose', auth: 'session',
    permissions: ['compliance.screening.review'],
    summary: 'Dispose of a screening match as cleared, escalated or blocked.',
    tags: ['compliance'],
    handler: async (ctx) => {
      const user = requireUser(ctx);
      const body = (ctx.body ?? {}) as Record<string, unknown>;
      await withContext(contextFor(ctx), (db) =>
        orgService.disposeScreening(db, {
          screeningCaseId: ctx.params['id']!,
          disposition: field(body, 'disposition',
            oneOf('cleared', 'escalated', 'blocked', 'pending_review'), 'a disposition')!,
          reason: field(body, 'reason', isNonEmptyString, 'a written reason')!,
          userId: user.userId, role: user.roles[0] ?? 'compliance_analyst',
        }),
      );
      return { disposed: true };
    },
  });

  router.register({
    method: 'POST', pattern: '/api/compliance/kyb/:organizationId/decision', auth: 'session',
    permissions: ['compliance.kyb.review'],
    summary: 'KYB decision. High-risk approval requires a Compliance Manager.',
    tags: ['compliance'],
    handler: async (ctx) => {
      const user = requireUser(ctx);
      const body = (ctx.body ?? {}) as Record<string, unknown>;
      return withContext(contextFor(ctx), (db) =>
        orgService.decideKyb(db, {
          organizationId: ctx.params['organizationId']!,
          decision: field(body, 'decision',
            oneOf('approve', 'reject', 'request_information', 'escalate', 'suspend'), 'a decision')!,
          reason: field(body, 'reason', isNonEmptyString, 'a written reason of at least 20 characters')!,
          userId: user.userId,
          role: user.roles[0] ?? 'compliance_analyst',
          isManager: user.permissions.has('compliance.highrisk.approve'),
        }),
      );
    },
  });

  router.register({
    method: 'GET', pattern: '/api/compliance/rules', auth: 'session',
    permissions: ['compliance.case.read', 'controls.read', 'learning.read'],
    summary: 'The compliance rule library, with plain-English explanations.',
    tags: ['compliance'],
    handler: async (ctx) =>
      withReadOnlyContext(contextFor(ctx), async (db) => {
        const active = await many<Record<string, unknown>>(
          db,
          `SELECT rule_key, version, name, category, severity, on_trigger_action, parameters,
                  risk_addressed, trigger_condition, required_evidence, automated_action,
                  human_decision, false_positive_risk, policy_basis, status, effective_from
             FROM risk_rule WHERE status = 'active' ORDER BY category, rule_key`,
        );
        const triggerCounts = await many<{ rule_key: string; n: string }>(
          db,
          `SELECT rule_key, count(*)::text AS n FROM rule_evaluation
            WHERE triggered GROUP BY rule_key`,
        );
        const counts = new Map(triggerCounts.map((r) => [r.rule_key, Number(r.n)]));
        return {
          rules: active.map((r) => ({ ...r, times_triggered: counts.get(r['rule_key'] as string) ?? 0 })),
          catalogue_size: RULES.length,
          note:
            'Rules are immutable once published. A change creates a new version; historical evaluations ' +
            'keep the rule text and parameters that were actually in force.',
        };
      }),
  });

  router.register({
    method: 'GET', pattern: '/api/compliance/expiring-documents', auth: 'session',
    permissions: ['compliance.case.read'],
    summary: 'Documents expiring or expired across all organisations.',
    tags: ['compliance'],
    handler: async (ctx) =>
      withReadOnlyContext(contextFor(ctx), (db) =>
        orgService.expiringDocuments(db, Number(ctx.query.get('within_days') ?? 30)),
      ),
  });

  // -------------------------------------------------------------------------
  // Ledger and finance
  // -------------------------------------------------------------------------

  router.register({
    method: 'GET', pattern: '/api/ledger/accounts', auth: 'session',
    permissions: ['ledger.read'],
    summary: 'Ledger accounts with balances derived from journal entries.',
    tags: ['ledger'],
    handler: async (ctx) =>
      withReadOnlyContext(contextFor(ctx), (db) =>
        ledger.accountBalances(db, {
          currency: ctx.query.get('currency') ?? undefined,
          organizationId: ctx.query.get('organization_id') ?? undefined,
          category: ctx.query.get('category') ?? undefined,
        }),
      ),
  });

  router.register({
    method: 'GET', pattern: '/api/ledger/trial-balance', auth: 'session',
    permissions: ['ledger.read'],
    summary: 'The trial balance. Must net to zero in every currency.',
    tags: ['ledger'],
    handler: async (ctx) =>
      withReadOnlyContext(contextFor(ctx), async (db) => ({
        trial_balance: await ledger.trialBalance(db),
        integrity: await ledger.verifyLedgerIntegrity(db),
        note: 'All balances in this environment are SIMULATED. No real funds correspond to them.',
      })),
  });

  router.register({
    method: 'GET', pattern: '/api/ledger/transactions/:id', auth: 'session',
    permissions: ['ledger.read', 'txn.read'],
    summary: 'The journals for one transaction, with plain-English explanations.',
    tags: ['ledger'],
    handler: async (ctx) =>
      withReadOnlyContext(contextFor(ctx), (db) =>
        ledger.journalsForTransaction(db, ctx.params['id']!),
      ),
  });

  router.register({
    method: 'POST', pattern: '/api/ledger/journals/:id/reverse', auth: 'session',
    permissions: ['ledger.post.adjustment'],
    summary: 'Reverses a journal by posting its mirror image.',
    tags: ['ledger'],
    handler: async (ctx) => {
      const user = requireUser(ctx);
      const reason = field(ctx.body, 'reason', isNonEmptyString, 'a written reason')!;
      return withContext(contextFor(ctx), (db) =>
        ledger.reverse(db, { journalId: ctx.params['id']!, reason, postedBy: user.userId }),
      );
    },
  });

  // -------------------------------------------------------------------------
  // Reconciliation
  // -------------------------------------------------------------------------

  router.register({
    method: 'POST', pattern: '/api/reconciliation/run', auth: 'session',
    permissions: ['recon.run'],
    summary: 'Runs the daily reconciliation suite.',
    tags: ['reconciliation'],
    rateLimit: { windowMs: 60_000, max: 10 },
    handler: async (ctx) => {
      const user = requireUser(ctx);
      const dateParam = ctx.query.get('business_date') ?? (ctx.body as Record<string, unknown>)?.['business_date'];
      const businessDate = dateParam ? new Date(String(dateParam)) : new Date();
      return withContext(contextFor(ctx), (db) =>
        recon.runDailyReconciliation(db, businessDate, user.userId),
      );
    },
  });

  router.register({
    method: 'GET', pattern: '/api/reconciliation/runs', auth: 'session',
    permissions: ['recon.run', 'ledger.read', 'audit.read'],
    summary: 'Recent reconciliation runs.',
    tags: ['reconciliation'],
    handler: async (ctx) =>
      withReadOnlyContext(contextFor(ctx), (db) => recon.listRuns(db)),
  });

  router.register({
    method: 'GET', pattern: '/api/reconciliation/runs/:reference', auth: 'session',
    permissions: ['recon.run', 'ledger.read', 'audit.read'],
    summary: 'One reconciliation run with every compared item.',
    tags: ['reconciliation'],
    handler: async (ctx) =>
      withReadOnlyContext(contextFor(ctx), async (db) => {
        const run = await recon.getRun(db, ctx.params['reference']!);
        if (!run) throw notFound('RUN_NOT_FOUND', 'Reconciliation run not found.');
        return run;
      }),
  });

  router.register({
    method: 'GET', pattern: '/api/exceptions', auth: 'session',
    permissions: ['treasury.exception.read', 'recon.break.investigate', 'audit.read'],
    summary: 'Open exception cases (breaks).',
    tags: ['reconciliation'],
    handler: async (ctx) =>
      withReadOnlyContext(contextFor(ctx), (db) =>
        exceptions.listExceptions(db, {
          status: ctx.query.get('status') ?? undefined,
          priority: ctx.query.get('priority') ?? undefined,
          openOnly: ctx.query.get('open_only') === 'true',
        }),
      ),
  });

  router.register({
    method: 'GET', pattern: '/api/exceptions/:reference', auth: 'session',
    permissions: ['treasury.exception.read', 'recon.break.investigate', 'audit.read'],
    summary: 'One exception case with its investigation notes.',
    tags: ['reconciliation'],
    handler: async (ctx) =>
      withReadOnlyContext(contextFor(ctx), async (db) => {
        const exc = await exceptions.getException(db, ctx.params['reference']!);
        if (!exc) throw notFound('EXCEPTION_NOT_FOUND', 'Exception not found.');
        return exc;
      }),
  });

  router.register({
    method: 'POST', pattern: '/api/exceptions/:reference/note', auth: 'session',
    permissions: ['recon.break.investigate'],
    summary: 'Adds an investigation note.',
    tags: ['reconciliation'],
    handler: async (ctx) => {
      const user = requireUser(ctx);
      const body = field(ctx.body, 'body', isNonEmptyString, 'a note')!;
      return withContext(contextFor(ctx), async (db) => {
        const exc = await one<{ id: string }>(
          db, 'SELECT id FROM exception_case WHERE reference = $1', [ctx.params['reference']!],
        );
        await exceptions.addExceptionNote(db, {
          exceptionId: exc.id, authorId: user.userId, body,
          evidenceRefs: ((ctx.body as Record<string, unknown>)['evidence_refs'] as unknown[]) ?? [],
        });
        return { added: true };
      });
    },
  });

  router.register({
    method: 'POST', pattern: '/api/exceptions/:reference/resolve', auth: 'session',
    permissions: ['recon.break.investigate'],
    summary: 'Proposes a resolution. Above the four-eyes threshold this awaits approval.',
    tags: ['reconciliation'],
    handler: async (ctx) => {
      const user = requireUser(ctx);
      const resolution = field(ctx.body, 'resolution', isNonEmptyString, 'a written resolution')!;
      return withContext(contextFor(ctx), async (db) => {
        const exc = await one<{ id: string }>(
          db, 'SELECT id FROM exception_case WHERE reference = $1', [ctx.params['reference']!],
        );
        return exceptions.proposeResolution(db, {
          exceptionId: exc.id, resolution, resolvedBy: user.userId,
        });
      });
    },
  });

  router.register({
    method: 'POST', pattern: '/api/exceptions/:reference/approve', auth: 'session',
    permissions: ['recon.break.approve'],
    summary: 'Approves a proposed resolution. Refuses self-approval.',
    tags: ['reconciliation'],
    handler: async (ctx) => {
      const user = requireUser(ctx);
      return withContext(contextFor(ctx), async (db) => {
        const exc = await one<{ id: string }>(
          db, 'SELECT id FROM exception_case WHERE reference = $1', [ctx.params['reference']!],
        );
        await exceptions.approveResolution(db, exc.id, user.userId);
        return { approved: true };
      });
    },
  });

  // -------------------------------------------------------------------------
  // Reporting
  // -------------------------------------------------------------------------

  for (const definition of reports.REPORT_DEFINITIONS) {
    router.register({
      method: 'GET', pattern: `/api/reports/${definition.key}`, auth: 'session',
      permissions: [definition.permission],
      summary: definition.title,
      tags: ['reporting'],
      handler: async (ctx) => {
        const user = requireUser(ctx);
        const format = (ctx.query.get('format') ?? 'json').toLowerCase();
        const filters = {
          from: ctx.query.get('from'),
          to: ctx.query.get('to'),
          organizationId: user.scope === 'org' ? user.organizationId : ctx.query.get('organization_id'),
          corridor: ctx.query.get('corridor'),
          currency: ctx.query.get('currency'),
        };
        const result = await withReadOnlyContext(contextFor(ctx), (db) =>
          reports.run(db, definition.key, filters, maskingProfileForRoles(user.roles)),
        );

        if (format === 'json') return result;

        const rendered =
          format === 'csv' ? { body: toCsv(result.columns, result.rows), contentType: 'text/csv; charset=utf-8', ext: 'csv' }
          : format === 'xlsx' ? { body: toXlsx(definition.title, result.columns, result.rows), contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', ext: 'xlsx' }
          : format === 'pdf' ? { body: toPdf(definition.title, result), contentType: 'application/pdf', ext: 'pdf' }
          : null;
        if (!rendered) throw invalid('UNSUPPORTED_FORMAT', 'Supported formats: json, csv, xlsx, pdf.');

        await withContext(contextFor(ctx), (db) =>
          reports.recordExport(db, {
            reportKey: definition.key, family: definition.family, title: definition.title,
            parameters: filters as Record<string, unknown>, format,
            rowCount: result.rows.length, content: rendered.body,
            maskingProfile: maskingProfileForRoles(user.roles),
            generatedBy: user.userId, generatedByRole: user.roles[0] ?? null,
          }),
        );

        ctx.responseHeaders['content-type'] = rendered.contentType;
        ctx.responseHeaders['content-disposition'] =
          `attachment; filename="${definition.key}-${new Date().toISOString().slice(0, 10)}.${rendered.ext}"`;
        return rendered.body;
      },
    });
  }

  router.register({
    method: 'GET', pattern: '/api/reports', auth: 'session',
    permissions: ['report.own.read', 'report.operational.read', 'report.compliance.read',
      'report.financial.read', 'report.pilot.read'],
    summary: 'The catalogue of available reports.',
    tags: ['reporting'],
    handler: async (ctx) => {
      const user = requireUser(ctx);
      return reports.REPORT_DEFINITIONS
        .filter((d) => user.permissions.has(d.permission as Permission))
        .map((d) => ({
          key: d.key, title: d.title, family: d.family, description: d.description,
          formats: ['json', 'csv', 'xlsx', 'pdf'], filters: d.filters,
        }));
    },
  });

  // -------------------------------------------------------------------------
  // Audit
  // -------------------------------------------------------------------------

  router.register({
    method: 'GET', pattern: '/api/audit/events', auth: 'session',
    permissions: ['audit.read'],
    summary: 'Searches the append-only audit trail.',
    tags: ['audit'],
    handler: async (ctx) =>
      withReadOnlyContext(contextFor(ctx), (db) =>
        many<Record<string, unknown>>(
          db,
          `SELECT a.seq::text AS seq, a.id, a.occurred_at, a.category, a.action, a.outcome,
                  a.actor_role, a.actor_type, a.entity_type, a.entity_id, a.reason,
                  a.old_values, a.new_values, a.metadata, a.prev_hash, a.entry_hash,
                  u.display_name AS actor_name, o.display_code AS organization_code,
                  t.reference AS transaction_reference
             FROM audit_event a
             LEFT JOIN app_user u ON u.id = a.actor_user_id
             LEFT JOIN organization o ON o.id = a.organization_id
             LEFT JOIN transaction t ON t.id = a.transaction_id
            WHERE ($1::text IS NULL OR a.category = $1)
              AND ($2::text IS NULL OR a.action ILIKE '%' || $2 || '%')
              AND ($3::uuid IS NULL OR a.transaction_id = $3)
              AND ($4::timestamptz IS NULL OR a.occurred_at >= $4)
              AND ($5::timestamptz IS NULL OR a.occurred_at < $5)
            ORDER BY a.seq DESC LIMIT $6`,
          [
            ctx.query.get('category'), ctx.query.get('action'),
            ctx.query.get('transaction_id'), ctx.query.get('from'), ctx.query.get('to'),
            Math.min(Number(ctx.query.get('limit') ?? 100), 1000),
          ],
        ),
      ),
  });

  router.register({
    method: 'GET', pattern: '/api/audit/verify', auth: 'session',
    permissions: ['audit.read'],
    summary: 'Verifies the audit hash chain using the database\'s own verification function.',
    tags: ['audit'],
    handler: async (ctx) =>
      withReadOnlyContext(contextFor(ctx), async (db) => {
        const result = await verifyAuditChain(db, 0);
        return {
          ...result,
          method:
            'Each entry stores the hash of its predecessor and a hash over its own contents. ' +
            'Verification recomputes both in SQL, so it does not depend on the application being honest.',
        };
      }),
  });

  router.register({
    method: 'GET', pattern: '/api/audit/export', auth: 'session',
    permissions: ['audit.export'],
    summary: 'Exports an audit range with a manifest proving contiguity and integrity.',
    tags: ['audit'],
    handler: async (ctx) => {
      const user = requireUser(ctx);
      return withReadOnlyContext(contextFor(ctx), async (db) => {
        const rows = await many<Record<string, unknown>>(
          db,
          `SELECT seq::text AS seq, id, occurred_at, category, action, outcome, actor_role,
                  actor_type, entity_type, entity_id, reason, metadata, prev_hash, entry_hash
             FROM audit_event
            WHERE ($1::bigint IS NULL OR seq >= $1) AND ($2::bigint IS NULL OR seq <= $2)
            ORDER BY seq LIMIT 10000`,
          [ctx.query.get('from_seq'), ctx.query.get('to_seq')],
        );
        const manifest = await buildAuditExportManifest(db, rows);
        return { manifest, events: rows, exported_by_role: user.roles[0] ?? null };
      });
    },
  });

  // -------------------------------------------------------------------------
  // Notifications and cases
  // -------------------------------------------------------------------------

  router.register({
    method: 'GET', pattern: '/api/notifications', auth: 'session',
    summary: 'The in-app notification inbox.',
    tags: ['notifications'],
    handler: async (ctx) => {
      const user = requireUser(ctx);
      return withReadOnlyContext(contextFor(ctx), (db) =>
        notify.inboxFor(db, user.userId, user.roles),
      );
    },
  });

  router.register({
    method: 'POST', pattern: '/api/notifications/:id/read', auth: 'session',
    summary: 'Marks a notification read.',
    tags: ['notifications'],
    handler: async (ctx) => {
      const user = requireUser(ctx);
      await withContext(contextFor(ctx), (db) => notify.markRead(db, ctx.params['id']!, user.userId));
      return { read: true };
    },
  });

  router.register({
    method: 'GET', pattern: '/api/support-cases', auth: 'session',
    summary: 'Support and complaint cases.',
    tags: ['cases'],
    handler: async (ctx) =>
      withReadOnlyContext(contextFor(ctx), (db) =>
        many<Record<string, unknown>>(
          db,
          `SELECT s.reference, s.category, s.subject, s.priority, s.status, s.opened_at,
                  s.sla_resolution_due, s.first_response_at, s.resolved_at,
                  o.legal_name AS organization_name, u.display_name AS owner_name,
                  t.reference AS transaction_reference,
                  (s.sla_resolution_due < now() AND s.status NOT IN ('resolved','closed')) AS breached_sla
             FROM support_case s
             LEFT JOIN organization o ON o.id = s.organization_id
             LEFT JOIN app_user u ON u.id = s.owner_id
             LEFT JOIN transaction t ON t.id = s.transaction_id
            ORDER BY s.opened_at DESC LIMIT 200`,
        ),
      ),
  });

  router.register({
    method: 'POST', pattern: '/api/support-cases', auth: 'session',
    permissions: ['case.support.raise', 'case.support.manage'], successStatus: 201,
    summary: 'Raises a support case or complaint.',
    tags: ['cases'],
    handler: async (ctx) => {
      const user = requireUser(ctx);
      const body = (ctx.body ?? {}) as Record<string, unknown>;
      return withContext(contextFor(ctx), async (db) => {
        const { nextReference } = await import('../core/ids.js');
        const reference = await nextReference(db, 'support_case');
        const category = field(body, 'category', isNonEmptyString, 'a category')!;
        const priority = (body['priority'] as string) ?? 'normal';
        const slaHours = priority === 'critical' ? 4 : priority === 'high' ? 24 : 72;
        const row = await one<{ id: string }>(
          db,
          `INSERT INTO support_case (
             reference, organization_id, category, subject, description, priority,
             raised_by, transaction_id, sla_first_response_due, sla_resolution_due
           ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8, now() + interval '4 hours',
                     now() + ($9 || ' hours')::interval)
           RETURNING id`,
          [
            reference, user.organizationId, category,
            field(body, 'subject', isNonEmptyString, 'a subject')!,
            field(body, 'description', isNonEmptyString, 'a description')!,
            priority, user.userId, (body['transaction_id'] as string) ?? null, String(slaHours),
          ],
        );
        if (category === 'complaint') {
          await db.query(
            `INSERT INTO complaint (support_case_id, organization_id, complaint_type)
             VALUES ($1,$2,$3)`,
            [row.id, user.organizationId, (body['complaint_type'] as string) ?? 'service'],
          );
        }
        await recordAudit(db, {
          category: 'data_create', action: 'support_case.create', outcome: 'success',
          actorUserId: user.userId, organizationId: user.organizationId,
          entityType: 'support_case', entityId: row.id,
          newValues: { reference, category, priority },
        });
        return { id: row.id, reference };
      });
    },
  });

  // -------------------------------------------------------------------------
  // Administration
  // -------------------------------------------------------------------------

  router.register({
    method: 'GET', pattern: '/api/admin/roles', auth: 'session',
    permissions: ['admin.roles.manage', 'controls.read', 'audit.read'],
    summary: 'The role and permission matrix as data.',
    tags: ['admin'],
    handler: async () => ({
      roles: Object.values(ROLES).map((r) => ({
        code: r.code, name: r.name, description: r.description, realm: r.realm,
        requires_step_up: r.requiresStepUp, is_break_glass: r.isBreakGlass,
        permissions: r.permissions, cannot: r.explicitDenials,
      })),
      permissions: Object.entries(PERMISSIONS).map(([code, p]) => ({
        code, domain: p.domain, sensitive: p.sensitive, description: p.description,
      })),
      separation_of_duties: SEPARATION_RULES.map((r) => ({
        code: r.code, action: r.action, description: r.description,
      })),
    }),
  });

  router.register({
    method: 'GET', pattern: '/api/admin/configuration', auth: 'session',
    permissions: ['admin.config.propose', 'controls.read', 'audit.read'],
    summary: 'System configuration, including unresolved placeholders.',
    tags: ['admin'],
    handler: async (ctx) =>
      withReadOnlyContext(contextFor(ctx), async (db) => {
        const config = await many<Record<string, unknown>>(
          db,
          `SELECT config_key, version, value, value_type, description, is_placeholder,
                  founder_decision_ref, status, effective_from
             FROM system_configuration WHERE is_current ORDER BY config_key`,
        );
        const flags = await many<Record<string, unknown>>(
          db, 'SELECT key, description, enabled, is_release_gate, is_immutable FROM feature_flag ORDER BY key',
        );
        const corridors = await many<Record<string, unknown>>(
          db,
          `SELECT code, origin_country, destination_country, origin_currency, destination_currency,
                  is_placeholder, status, per_transaction_limit::text AS per_transaction_limit,
                  daily_limit::text AS daily_limit, monthly_limit::text AS monthly_limit,
                  pilot_aggregate_cap::text AS pilot_aggregate_cap, limit_currency, notes
             FROM corridor ORDER BY code`,
        );
        return {
          configuration: config,
          feature_flags: flags,
          corridors,
          adapters: registeredAdapters(),
          unresolved_placeholders: config.filter((c) => c['is_placeholder'] === true).length,
          note:
            'Configuration values are immutable once written. A change is a new version under ' +
            'maker-checker, and it never rewrites a historical result: every engine copies the values ' +
            'it used into its own output record.',
        };
      }),
  });

  router.register({
    method: 'POST', pattern: '/api/admin/simulation', auth: 'session',
    permissions: ['admin.simulation.control'], successStatus: 201,
    summary: 'Directs a partner simulator to produce a specific outcome.',
    tags: ['admin'],
    handler: async (ctx) => {
      const user = requireUser(ctx);
      const body = (ctx.body ?? {}) as Record<string, unknown>;
      const scenario = field(body, 'scenario', isNonEmptyString, 'a scenario name')!;
      return withContext(contextFor(ctx), async (db) => {
        const row = await one<{ id: string }>(
          db,
          `INSERT INTO simulation_directive (
             partner_id, transaction_id, operation, scenario, parameters, remaining_uses, created_by
           ) VALUES ($1,$2,$3,$4,$5::jsonb,$6,$7)
           RETURNING id`,
          [
            (body['partner_id'] as string) ?? null,
            (body['transaction_id'] as string) ?? null,
            (body['operation'] as string) ?? null,
            scenario,
            JSON.stringify(body['parameters'] ?? {}),
            body['remaining_uses'] ?? 1,
            user.userId,
          ],
        );
        await recordAudit(db, {
          category: 'configuration_change', action: 'simulation.directive.create', outcome: 'success',
          actorUserId: user.userId, entityType: 'simulation_directive', entityId: row.id,
          newValues: { scenario, transaction_id: body['transaction_id'] ?? null },
        });
        return { id: row.id, scenario };
      });
    },
  });

  router.register({
    method: 'GET', pattern: '/api/admin/partners', auth: 'session',
    permissions: ['admin.integration.manage', 'controls.read', 'treasury.liquidity.read', 'audit.read'],
    summary: 'Partner registry: role, what they would do live, and what is simulated.',
    tags: ['admin'],
    handler: async (ctx) =>
      withReadOnlyContext(contextFor(ctx), (db) =>
        many<Record<string, unknown>>(
          db,
          `SELECT p.code, p.display_name, p.partner_role, p.live_responsibility, p.licensed_activity,
                  p.jurisdiction, p.is_simulated, p.contract_reference, p.adapter_key,
                  p.adapter_version, p.status, p.last_health_check_at,
                  (SELECT count(*)::text FROM integration_event ie WHERE ie.partner_id = p.id) AS event_count,
                  (SELECT count(*)::text FROM integration_event ie
                    WHERE ie.partner_id = p.id AND ie.outcome NOT IN ('success','duplicate_ignored')) AS failure_count,
                  (SELECT round(avg(ie.latency_ms))::text FROM integration_event ie
                    WHERE ie.partner_id = p.id AND ie.latency_ms IS NOT NULL) AS avg_latency_ms
             FROM partner p ORDER BY p.partner_role, p.code`,
        ),
      ),
  });

  // -------------------------------------------------------------------------
  // Founder Learning Center
  // -------------------------------------------------------------------------

  router.register({
    method: 'GET', pattern: '/api/learning/product-map', auth: 'session',
    permissions: ['learning.read'],
    summary: 'Every module in plain English, with its honest build status.',
    tags: ['learning'],
    handler: async (ctx) =>
      withReadOnlyContext(contextFor(ctx), (db) => learning.productMap(db)),
  });

  router.register({
    method: 'GET', pattern: '/api/learning/glossary', auth: 'session',
    permissions: ['learning.read'],
    summary: 'Settlement and compliance terms explained plainly.',
    tags: ['learning'],
    handler: async (ctx) =>
      withReadOnlyContext(contextFor(ctx), (db) => learning.glossary(db)),
  });

  router.register({
    method: 'GET', pattern: '/api/learning/architecture', auth: 'session',
    permissions: ['learning.read'],
    summary: 'The architecture map with a plain-English note per component.',
    tags: ['learning'],
    handler: async () => learning.architecture(),
  });

  router.register({
    method: 'GET', pattern: '/api/learning/state-machine', auth: 'session',
    permissions: ['learning.read', 'controls.read'],
    summary: 'The complete settlement state machine.',
    tags: ['learning'],
    handler: async () => ({
      states: describeStateMachine(),
      transition_count: TRANSITIONS.length,
      note:
        '"Settled" means the partner reported the payment as made. It does not mean settlement ' +
        'finality, which is a legal property conferred by a settlement system operator and which ' +
        'nothing in this build can produce.',
    }),
  });

  router.register({
    method: 'GET', pattern: '/api/learning/decisions', auth: 'session',
    permissions: ['learning.read'],
    summary: 'The decision log, including every open founder decision.',
    tags: ['learning'],
    handler: async (ctx) =>
      withReadOnlyContext(contextFor(ctx), (db) => learning.decisionLog(db)),
  });

  router.register({
    method: 'POST', pattern: '/api/learning/decisions/:ref/approve', auth: 'session',
    permissions: ['learning.decision.approve'],
    summary: 'Records founder approval of a decision.',
    tags: ['learning'],
    handler: async (ctx) => {
      const user = requireUser(ctx);
      const reason = field(ctx.body, 'reason_selected', isNonEmptyString, 'a written reason')!;
      return withContext(contextFor(ctx), (db) =>
        learning.approveDecision(db, ctx.params['ref']!, user.fullName, reason, user.userId),
      );
    },
  });

  router.register({
    method: 'GET', pattern: '/api/learning/build-journal', auth: 'session',
    permissions: ['learning.read'],
    summary: 'What was built, what remains simulated, and what is still open.',
    tags: ['learning'],
    handler: async (ctx) =>
      withReadOnlyContext(contextFor(ctx), (db) =>
        many<Record<string, unknown>>(
          db, 'SELECT * FROM build_journal_entry ORDER BY entry_date DESC, milestone',
        ),
      ),
  });

  router.register({
    method: 'GET', pattern: '/api/learning/risk-register', auth: 'session',
    permissions: ['learning.read', 'controls.read'],
    summary: 'The risk register, with honest control-implementation status.',
    tags: ['learning'],
    handler: async (ctx) =>
      withReadOnlyContext(contextFor(ctx), (db) =>
        many<Record<string, unknown>>(
          db,
          `SELECT risk_ref, category, title, description, inherent_likelihood, inherent_impact,
                  existing_controls, control_status, residual_likelihood, residual_impact,
                  owner, treatment, further_action, blocks_pilot
             FROM risk_register_entry ORDER BY blocks_pilot DESC, risk_ref`,
        ),
      ),
  });

  router.register({
    method: 'GET', pattern: '/api/learning/walkthrough/:transactionId', auth: 'session',
    permissions: ['learning.read'],
    summary: 'A guided walkthrough of one transaction across every actor and system.',
    tags: ['learning'],
    handler: async (ctx) =>
      withReadOnlyContext(contextFor(ctx), (db) =>
        learning.walkthrough(db, ctx.params['transactionId']!),
      ),
  });

  router.register({
    method: 'GET', pattern: '/api/learning/assessments/:moduleKey', auth: 'session',
    permissions: ['learning.read'],
    summary: 'Five short questions confirming understanding of a module.',
    tags: ['learning'],
    handler: async (ctx) =>
      withReadOnlyContext(contextFor(ctx), (db) =>
        learning.assessment(db, ctx.params['moduleKey']!),
      ),
  });

  router.register({
    method: 'POST', pattern: '/api/learning/assessments/:moduleKey', auth: 'session',
    permissions: ['learning.read'],
    summary: 'Submits assessment answers. Never gates access to the system.',
    tags: ['learning'],
    handler: async (ctx) => {
      const user = requireUser(ctx);
      const answers = field(ctx.body, 'answers', isArray, 'a list of chosen option indexes')!;
      return withContext(contextFor(ctx), (db) =>
        learning.submitAssessment(db, ctx.params['moduleKey']!, user.userId, answers as number[]),
      );
    },
  });

  // -------------------------------------------------------------------------
  // Regulator view
  // -------------------------------------------------------------------------

  router.register({
    method: 'GET', pattern: '/api/regulator/overview', auth: 'session',
    permissions: ['controls.read'],
    summary: 'The read-only regulator view: scope, activity, controls, incidents, availability.',
    tags: ['regulator'],
    handler: async (ctx) =>
      withReadOnlyContext(contextFor(ctx), (db) => reports.regulatorOverview(db)),
  });

  // -------------------------------------------------------------------------
  // OpenAPI
  // -------------------------------------------------------------------------

  router.register({
    method: 'GET', pattern: '/api/openapi.json', auth: 'none',
    summary: 'The OpenAPI description of this API.',
    tags: ['system'],
    handler: async () => buildOpenApi(router),
  });

  return router;
}

/** Generates an OpenAPI 3.1 document from the registered routes. */
export function buildOpenApi(router: Router): Record<string, unknown> {
  const paths: Record<string, Record<string, unknown>> = {};
  for (const route of router.all()) {
    const openApiPath = route.pattern.replace(/:([A-Za-z0-9_]+)/g, '{$1}');
    paths[openApiPath] ??= {};
    const params = [...route.pattern.matchAll(/:([A-Za-z0-9_]+)/g)].map((m) => ({
      name: m[1], in: 'path', required: true, schema: { type: 'string' },
    }));
    paths[openApiPath]![route.method.toLowerCase()] = {
      summary: route.summary,
      tags: route.tags,
      parameters: params,
      security: route.auth === 'none' ? [] : [{ sessionCookie: [] }],
      'x-required-permissions': route.permissions ?? [],
      'x-rate-limit': route.rateLimit ?? { windowMs: 60000, max: 120 },
      responses: {
        [String(route.successStatus ?? 200)]: {
          description: 'Success. The envelope carries data plus a meta block with the environment banner.',
        },
        '401': { description: 'Authentication required or MFA incomplete.' },
        '403': { description: 'Permission denied, CSRF failure, or a separation-of-duties refusal.' },
        '404': { description: 'Not found. Also returned for records outside the caller\'s organisation.' },
        '422': { description: 'An integrity guard refused the operation.' },
        '429': { description: 'Rate limited.' },
      },
    };
  }

  return {
    openapi: '3.1.0',
    info: {
      title: 'EKORails Settlement Orchestration API',
      version: '0.1.0',
      description:
        'B2B cross-border trade settlement orchestration. This deployment settles through simulators ' +
        'only and moves no real money. EKORails is not a bank, a deposit-taking institution, a licensed ' +
        'payment provider or a custodian of customer funds. See /api/system/regulatory-boundary.',
    },
    servers: [{ url: '/', description: 'This deployment' }],
    components: {
      securitySchemes: {
        sessionCookie: {
          type: 'apiKey', in: 'cookie', name: 'ekorails_session',
          description:
            'Opaque session token. State-changing requests must also present the CSRF token from the ' +
            'ekorails_csrf cookie in the X-CSRF-Token header.',
        },
      },
    },
    paths,
  };
}
