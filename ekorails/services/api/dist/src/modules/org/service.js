/**
 * Organisation onboarding (KYB), beneficiaries, documents and screening.
 *
 * Points worth a reviewer's attention:
 *
 *  - Identification numbers and account identifiers are encrypted at rest and are
 *    accompanied by a keyed fingerprint. The fingerprint is what supports duplicate and
 *    reuse detection, so the compliance engine never needs the plaintext.
 *  - A beneficiary carries a `material_fingerprint` over the fields that matter. Change
 *    any of them and approval is invalidated automatically — there is no way to edit a
 *    beneficiary's bank details and keep its approved status.
 *  - AI-proposed document fields live in their own table with status `proposed`, are
 *    never read by the compliance engine, and require an explicit human confirmation
 *    recorded against a named user.
 */
import { one, maybeOne, many } from '../../db/pool.js';
import { encryptField, fingerprint, canonicalHash, sha256Hex, randomHex } from '../../core/crypto.js';
import { nextReference } from '../../core/ids.js';
import { recordAudit, diffRecords } from '../../audit/audit.js';
import { invalid, precondition, notFound, forbidden } from '../../core/errors.js';
import { evaluate } from '../compliance/engine.js';
import { screeningAdapter, partnerByRole } from '../partners/adapters.js';
import { queueNotification } from '../notification/notify.js';
import { randomUUID } from 'node:crypto';
const REQUIRED_PROFILE_FIELDS = [
    ['legalBusinessName', 'Legal business name'],
    ['registrationNumber', 'Registration number'],
    ['jurisdiction', 'Jurisdiction'],
    ['dateOfIncorporation', 'Date of incorporation'],
    ['businessActivity', 'Business activity'],
    ['industryCode', 'Industry'],
    ['sourceOfFunds', 'Source of funds'],
    ['purposeOfTransactions', 'Purpose of transactions'],
];
export async function upsertKybProfile(db, input) {
    const missing = REQUIRED_PROFILE_FIELDS
        .filter(([key]) => {
        const value = input.profile[key];
        return value === undefined || value === null || String(value).trim().length === 0;
    })
        .map(([, label]) => label);
    if (missing.length > 0) {
        throw invalid('KYB_INCOMPLETE', 'Some required information is missing.', { missing });
    }
    const current = await maybeOne(db, 'SELECT id, version FROM organization_profile WHERE organization_id = $1 AND is_current', [input.organizationId]);
    const org = await one(db, 'SELECT onboarding_status FROM organization WHERE id = $1', [input.organizationId]);
    // Once submitted, the profile is versioned rather than edited, so the analyst's view
    // of what they approved stays intact.
    const mustVersion = current !== null && org.onboarding_status !== 'draft';
    if (mustVersion) {
        await db.query('UPDATE organization_profile SET is_current = false WHERE id = $1', [current.id]);
    }
    const version = mustVersion ? current.version + 1 : (current?.version ?? 1);
    const p = input.profile;
    const row = mustVersion || !current
        ? await one(db, `INSERT INTO organization_profile (
           organization_id, version, is_current, legal_business_name, trading_name,
           registration_number, jurisdiction, date_of_incorporation, registered_address,
           operating_address, business_activity, industry_code, website,
           tax_identification_number, regulatory_licence, expected_corridors,
           expected_monthly_volume, expected_monthly_currency, expected_transaction_size,
           expected_txn_currency, source_of_funds, purpose_of_transactions
         ) VALUES ($1,$2,true,$3,$4,$5,$6,$7,$8::jsonb,$9::jsonb,$10,$11,$12,$13,$14::jsonb,
                   $15::jsonb,$16,$17,$18,$19,$20,$21)
         RETURNING id`, [
            input.organizationId, version, p.legalBusinessName, p.tradingName ?? null,
            p.registrationNumber, p.jurisdiction.toUpperCase(), p.dateOfIncorporation,
            JSON.stringify(p.registeredAddress), JSON.stringify(p.operatingAddress),
            p.businessActivity, p.industryCode, p.website ?? null,
            p.taxIdentificationNumber ?? null,
            p.regulatoryLicence ? JSON.stringify(p.regulatoryLicence) : null,
            JSON.stringify(p.expectedCorridors),
            p.expectedMonthlyVolume ?? null, p.expectedMonthlyCurrency ?? null,
            p.expectedTransactionSize ?? null, p.expectedTxnCurrency ?? null,
            p.sourceOfFunds, p.purposeOfTransactions,
        ])
        : await one(db, `UPDATE organization_profile SET
           legal_business_name = $2, trading_name = $3, registration_number = $4,
           jurisdiction = $5, date_of_incorporation = $6, registered_address = $7::jsonb,
           operating_address = $8::jsonb, business_activity = $9, industry_code = $10,
           website = $11, tax_identification_number = $12, regulatory_licence = $13::jsonb,
           expected_corridors = $14::jsonb, expected_monthly_volume = $15,
           expected_monthly_currency = $16, expected_transaction_size = $17,
           expected_txn_currency = $18, source_of_funds = $19, purpose_of_transactions = $20
         WHERE id = $1 RETURNING id`, [
            current.id, p.legalBusinessName, p.tradingName ?? null, p.registrationNumber,
            p.jurisdiction.toUpperCase(), p.dateOfIncorporation,
            JSON.stringify(p.registeredAddress), JSON.stringify(p.operatingAddress),
            p.businessActivity, p.industryCode, p.website ?? null,
            p.taxIdentificationNumber ?? null,
            p.regulatoryLicence ? JSON.stringify(p.regulatoryLicence) : null,
            JSON.stringify(p.expectedCorridors),
            p.expectedMonthlyVolume ?? null, p.expectedMonthlyCurrency ?? null,
            p.expectedTransactionSize ?? null, p.expectedTxnCurrency ?? null,
            p.sourceOfFunds, p.purposeOfTransactions,
        ]);
    await recordAudit(db, {
        category: current ? 'data_update' : 'data_create',
        action: 'kyb.profile.save',
        outcome: 'success',
        actorUserId: input.userId,
        organizationId: input.organizationId,
        entityType: 'organization_profile',
        entityId: row.id,
        newValues: { version, legal_business_name: p.legalBusinessName, jurisdiction: p.jurisdiction },
        metadata: { versioned: mustVersion },
    });
    return { profileId: row.id, version };
}
export async function addPerson(db, input) {
    const p = input.person;
    if (p.fullName.trim().length < 3) {
        throw invalid('NAME_REQUIRED', 'A full name is required.');
    }
    for (const cap of p.capacities) {
        if (cap.capacity === 'ultimate_beneficial_owner' && !cap.ownershipPercent) {
            throw invalid('UBO_OWNERSHIP_REQUIRED', 'An ultimate beneficial owner must have a stated ownership percentage.');
        }
    }
    const person = await one(db, `INSERT INTO natural_person (
       organization_id, profile_id, full_name, date_of_birth, nationality,
       country_of_residence, residential_address, id_document_type,
       id_number_encrypted, id_number_last4, id_number_fingerprint, id_expires_on,
       is_pep, pep_declaration, pep_category
     ) VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9,$10,$11,$12,$13,$14,$15)
     RETURNING id`, [
        input.organizationId, input.profileId, p.fullName.trim(),
        p.dateOfBirth ?? null, p.nationality?.toUpperCase() ?? null,
        p.countryOfResidence?.toUpperCase() ?? null,
        p.residentialAddress ? JSON.stringify(p.residentialAddress) : null,
        p.idDocumentType ?? null,
        p.idNumber ? encryptField(p.idNumber) : null,
        p.idNumber ? p.idNumber.slice(-4) : null,
        p.idNumber ? fingerprint(p.idNumber, 'identity_document') : null,
        p.idExpiresOn ?? null, p.isPep, p.pepDeclaration ?? null, p.pepCategory ?? null,
    ]);
    for (const cap of p.capacities) {
        await db.query(`INSERT INTO person_capacity (
         person_id, organization_id, capacity, ownership_percent, ownership_is_direct,
         control_basis, appointed_on
       ) VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT (person_id, capacity) DO NOTHING`, [
            person.id, input.organizationId, cap.capacity, cap.ownershipPercent ?? null,
            cap.ownershipIsDirect ?? null, cap.controlBasis ?? null, cap.appointedOn ?? null,
        ]);
    }
    await recordAudit(db, {
        category: 'data_create', action: 'kyb.person.add', outcome: 'success',
        actorUserId: input.userId, organizationId: input.organizationId,
        entityType: 'natural_person', entityId: person.id,
        // Note what is recorded: the name and capacities, never the identification number.
        newValues: {
            full_name: p.fullName, capacities: p.capacities.map((c) => c.capacity), is_pep: p.isPep,
        },
    });
    return { personId: person.id };
}
/** Checks the beneficial-ownership register sums to something plausible. */
export async function ownershipCoverage(db, organizationId) {
    const row = await one(db, `SELECT sum(ownership_percent)::text AS total, count(*)::text AS n
       FROM person_capacity
      WHERE organization_id = $1 AND capacity = 'ultimate_beneficial_owner' AND resigned_on IS NULL`, [organizationId]);
    const total = row.total ?? '0';
    const n = Number(row.n);
    const totalNum = Number(total);
    return {
        totalPercent: total,
        uboCount: n,
        // Under 100% is normal — holdings below the disclosure threshold are not registered.
        // Over 100% is always an error.
        complete: n > 0 && totalNum <= 100,
        note: n === 0
            ? 'No beneficial owners have been registered. A company with no identified UBO cannot be approved.'
            : totalNum > 100
                ? `Registered ownership totals ${total}%, which exceeds 100%. The register is inconsistent.`
                : `${n} beneficial owner(s) registered, totalling ${total}%. Holdings below the disclosure ` +
                    `threshold are not required to be listed, so a total under 100% is expected.`,
    };
}
export async function submitForKybReview(db, organizationId, userId) {
    const org = await one(db, 'SELECT onboarding_status, legal_name FROM organization WHERE id = $1', [organizationId]);
    if (!['draft', 'additional_information_required'].includes(org.onboarding_status)) {
        throw precondition('ALREADY_SUBMITTED', `This organisation is "${org.onboarding_status}" and cannot be submitted again.`);
    }
    const profile = await maybeOne(db, 'SELECT id FROM organization_profile WHERE organization_id = $1 AND is_current', [organizationId]);
    if (!profile)
        throw precondition('NO_PROFILE', 'Complete the KYB profile before submitting.');
    const coverage = await ownershipCoverage(db, organizationId);
    if (coverage.uboCount === 0) {
        throw precondition('NO_BENEFICIAL_OWNER', 'At least one ultimate beneficial owner must be registered before submission.');
    }
    await db.query("UPDATE organization SET onboarding_status = 'automated_checks_running' WHERE id = $1", [organizationId]);
    await db.query('UPDATE organization_profile SET submitted_at = now(), submitted_by = $2 WHERE id = $1', [profile.id, userId]);
    // Screen the company and every registered person.
    const screeningCases = [];
    screeningCases.push((await runScreening(db, {
        organizationId, subjectType: 'organization', subjectId: organizationId,
        name: org.legal_name, country: null,
        screeningTypes: ['sanctions', 'pep', 'adverse_media'],
    })).reference);
    const people = await many(db, 'SELECT id, full_name, nationality FROM natural_person WHERE organization_id = $1', [organizationId]);
    for (const person of people) {
        screeningCases.push((await runScreening(db, {
            organizationId, subjectType: 'natural_person', subjectId: person.id,
            name: person.full_name, country: person.nationality,
            screeningTypes: ['sanctions', 'pep', 'adverse_media'],
        })).reference);
    }
    // Assess and open the analyst case.
    const assessment = await evaluate(db, await buildOrganizationInput(db, organizationId), { type: 'organization', id: organizationId, organizationId });
    await db.query("UPDATE organization SET onboarding_status = 'analyst_review', risk_rating = $2 WHERE id = $1", [organizationId, assessment.outcome]);
    await queueNotification(db, {
        organizationId, recipientRole: 'compliance_analyst', channel: 'in_app',
        eventType: 'onboarding_submitted',
        subject: `KYB review: ${org.legal_name}`,
        body: `A new KYB submission is ready for review. Risk outcome: ${assessment.outcome}.`,
        actionUrl: `/compliance/kyb/${organizationId}`,
    });
    await recordAudit(db, {
        category: 'data_update', action: 'kyb.submit', outcome: 'success',
        actorUserId: userId, organizationId,
        entityType: 'organization', entityId: organizationId,
        oldValues: { onboarding_status: org.onboarding_status },
        newValues: { onboarding_status: 'analyst_review' },
        metadata: { screening_cases: screeningCases, risk_outcome: assessment.outcome },
    });
    return { status: 'analyst_review', screeningCases };
}
/**
 * KYB decision. `manager_review` and `approved` are separate steps: an analyst
 * recommends, a manager approves, and a high-risk case cannot be approved by an analyst.
 */
export async function decideKyb(db, input) {
    if (input.reason.trim().length < 20) {
        throw invalid('REASON_TOO_SHORT', 'A KYB decision requires a written reason of at least 20 characters.');
    }
    const org = await one(db, 'SELECT onboarding_status, risk_rating, legal_name FROM organization WHERE id = $1', [input.organizationId]);
    // High-risk approval is reserved to a manager. Encoded here as well as in the role
    // permissions, because it is the specific control an examiner will test.
    if (input.decision === 'approve' && org.risk_rating === 'high' && !input.isManager) {
        await recordAudit(db, {
            category: 'authorisation', action: 'kyb.approve', outcome: 'denied',
            actorUserId: input.userId, actorRole: input.role, organizationId: input.organizationId,
            metadata: { denial_reason: 'high_risk_requires_manager', risk_rating: org.risk_rating },
        });
        throw forbidden('MANAGER_APPROVAL_REQUIRED', 'A high-risk customer can only be approved by a Compliance Manager.', 'analyst attempted high-risk approval');
    }
    if (input.decision === 'approve' && org.risk_rating === 'prohibited') {
        throw forbidden('PROHIBITED_RISK', 'This customer is assessed as prohibited and cannot be approved.');
    }
    const NEXT = {
        approve: 'approved',
        reject: 'rejected',
        request_information: 'additional_information_required',
        escalate: 'manager_review',
        suspend: 'suspended',
    };
    const next = NEXT[input.decision];
    await db.query(`UPDATE organization
        SET onboarding_status = $2,
            suspended_at = CASE WHEN $2 = 'suspended' THEN now() ELSE suspended_at END,
            suspension_reason = CASE WHEN $2 = 'suspended' THEN $3 ELSE suspension_reason END
      WHERE id = $1`, [input.organizationId, next, input.reason]);
    // Record the decision against a compliance case so it lands in the append-only table.
    const kybCase = await maybeOne(db, `SELECT id FROM compliance_case
      WHERE organization_id = $1 AND case_type IN ('kyb_review','periodic_review')
        AND status NOT LIKE 'closed%' ORDER BY opened_at DESC LIMIT 1`, [input.organizationId]);
    if (kybCase) {
        await db.query(`INSERT INTO compliance_decision (
         compliance_case_id, organization_id, decision, reason, decided_by, decided_by_role
       ) VALUES ($1,$2,$3,$4,$5,$6)`, [
            kybCase.id, input.organizationId,
            input.decision === 'approve' ? 'approved'
                : input.decision === 'reject' ? 'rejected'
                    : input.decision === 'suspend' ? 'suspended'
                        : input.decision === 'escalate' ? 'escalated' : 'information_requested',
            input.reason, input.userId, input.role,
        ]);
        await db.query(`UPDATE compliance_case
          SET status = $2, first_touched_at = COALESCE(first_touched_at, now()),
              closed_at = CASE WHEN $2 LIKE 'closed%' THEN now() ELSE NULL END
        WHERE id = $1`, [
            kybCase.id,
            input.decision === 'approve' ? 'closed_cleared'
                : input.decision === 'reject' ? 'closed_rejected'
                    : input.decision === 'suspend' ? 'closed_suspended'
                        : input.decision === 'escalate' ? 'pending_manager_approval' : 'awaiting_information',
        ]);
    }
    await queueNotification(db, {
        organizationId: input.organizationId,
        recipientRole: 'business_initiator',
        channel: 'in_app',
        eventType: input.decision === 'approve' ? 'organization_approved'
            : input.decision === 'reject' ? 'organization_rejected'
                : 'additional_information_required',
        subject: `Onboarding update for ${org.legal_name}`,
        body: `Your onboarding status is now "${next.replace(/_/g, ' ')}". Sign in for the detail.`,
        actionUrl: '/onboarding',
    });
    await recordAudit(db, {
        category: 'compliance_decision', action: `kyb.${input.decision}`, outcome: 'success',
        actorUserId: input.userId, actorRole: input.role, organizationId: input.organizationId,
        entityType: 'organization', entityId: input.organizationId,
        oldValues: { onboarding_status: org.onboarding_status },
        newValues: { onboarding_status: next },
        reason: input.reason,
    });
    return { status: next };
}
async function buildOrganizationInput(db, organizationId) {
    const org = await one(db, `SELECT o.id, o.display_code, o.onboarding_status, o.risk_rating, o.suspended_at,
            p.jurisdiction, p.industry_code, p.expected_monthly_volume, p.expected_monthly_currency,
            p.expected_transaction_size, p.expected_txn_currency, p.source_of_funds,
            p.created_at AS profile_created_at
       FROM organization o
       LEFT JOIN organization_profile p ON p.organization_id = o.id AND p.is_current
      WHERE o.id = $1`, [organizationId]);
    const corridor = await one(db, `SELECT code, origin_country, destination_country, origin_currency, destination_currency,
            is_placeholder, status, per_transaction_limit::text, daily_limit::text,
            monthly_limit::text, pilot_aggregate_cap::text, limit_currency
       FROM corridor ORDER BY created_at LIMIT 1`);
    const screening = await gatherOrgScreening(db, organizationId);
    return {
        subjectType: 'organization',
        evaluatedAt: new Date().toISOString(),
        organization: {
            id: org.id, displayCode: org.display_code, onboardingStatus: org.onboarding_status,
            riskRating: org.risk_rating, suspended: org.suspended_at !== null,
            jurisdiction: org.jurisdiction, industryCode: org.industry_code,
            expectedMonthlyVolume: org.expected_monthly_volume,
            expectedMonthlyCurrency: org.expected_monthly_currency,
            expectedTransactionSize: org.expected_transaction_size,
            expectedTxnCurrency: org.expected_txn_currency,
            sourceOfFundsDeclared: (org.source_of_funds ?? '').trim().length > 0,
            profileAgeDays: org.profile_created_at
                ? Math.floor((Date.now() - org.profile_created_at.getTime()) / 86_400_000) : null,
        },
        corridor: {
            code: corridor['code'],
            originCountry: corridor['origin_country'],
            destinationCountry: corridor['destination_country'],
            originCurrency: corridor['origin_currency'],
            destinationCurrency: corridor['destination_currency'],
            isPlaceholder: corridor['is_placeholder'] === true,
            status: corridor['status'],
            perTransactionLimit: corridor['per_transaction_limit'],
            dailyLimit: corridor['daily_limit'],
            monthlyLimit: corridor['monthly_limit'],
            pilotAggregateCap: corridor['pilot_aggregate_cap'],
            limitCurrency: corridor['limit_currency'],
        },
        velocity: {
            dailyCount: 0, dailyAmount: '0.000000', monthlyCount: 0, monthlyAmount: '0.000000',
            pilotTotalAmount: '0.000000', currency: corridor['origin_currency'] ?? 'XXX',
            recentAmounts: [],
        },
        screening,
        device: {
            ipHash: null, distinctIpCount24h: 0, newIpForOrganisation: false,
            failedLogins24h: 0, knownFraudSignal: false,
        },
    };
}
async function gatherOrgScreening(db, organizationId) {
    const rows = await many(db, `SELECT r.screening_type, c.status, r.match_score::text, r.matched_name, r.match_details
       FROM screening_case c JOIN screening_result r ON r.screening_case_id = c.id
      WHERE c.organization_id = $1 AND c.status <> 'pending'`, [organizationId]);
    const pick = (t) => rows.filter((r) => r.screening_type === t);
    const worst = (list) => {
        const order = ['clear', 'false_positive', 'error', 'provider_unavailable', 'potential_match', 'confirmed_match'];
        return list.length === 0 ? 'not_screened'
            : list.reduce((w, c) => (order.indexOf(c.status) > order.indexOf(w) ? c.status : w), 'clear');
    };
    const sanctions = pick('sanctions');
    const pep = pick('pep');
    const media = pick('adverse_media');
    const scores = sanctions.map((s) => (s.match_score ? Number(s.match_score) : null))
        .filter((s) => s !== null);
    return {
        sanctions: {
            status: worst(sanctions),
            highestScore: scores.length ? Math.max(...scores) : null,
            matchedNames: sanctions.map((s) => s.matched_name).filter((n) => n !== null),
        },
        pep: {
            status: worst(pep),
            isPep: pep.some((p) => p.status === 'potential_match' || p.status === 'confirmed_match'),
            categories: pep.map((p) => p.match_details?.['category'])
                .filter((c) => typeof c === 'string'),
        },
        adverseMedia: {
            status: worst(media),
            flagged: media.some((m) => m.status === 'potential_match' || m.status === 'confirmed_match'),
            topics: media.flatMap((m) => m.match_details?.['topics'] ?? []),
        },
    };
}
// ---------------------------------------------------------------------------
// Screening
// ---------------------------------------------------------------------------
export async function runScreening(db, input) {
    const provider = await partnerByRole(db, 'screening_provider');
    if (!provider) {
        throw precondition('NO_SCREENING_PROVIDER', 'No screening provider is configured. Screening cannot be skipped, so onboarding is blocked.');
    }
    const reference = await nextReference(db, 'screening');
    const caseRow = await one(db, `INSERT INTO screening_case (
       reference, organization_id, subject_type, subject_id, screening_types,
       provider, provider_adapter_version, is_simulated, status
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,true,'pending')
     RETURNING id`, [
        reference, input.organizationId, input.subjectType, input.subjectId,
        input.screeningTypes, provider.adapter_key, '1.0.0',
    ]);
    const ctx = {
        db, partnerId: provider.id, organizationId: input.organizationId,
        correlationId: randomUUID(),
    };
    const outcome = await screeningAdapter(provider.adapter_key).screen(ctx, {
        subjectType: input.subjectType,
        subjectId: input.subjectId,
        name: input.name,
        country: input.country,
        dateOfBirth: input.dateOfBirth ?? null,
        screeningTypes: input.screeningTypes,
    });
    for (const hit of outcome.hits) {
        await db.query(`INSERT INTO screening_result (
         screening_case_id, screening_type, matched_name, match_score, list_name,
         list_entry_ref, match_details, provider_payload, payload_retention_until
       ) VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8::jsonb, CURRENT_DATE + INTERVAL '7 years')`, [
            caseRow.id, hit.screeningType, hit.matchedName, hit.matchScore, hit.listName,
            hit.listEntryRef, JSON.stringify(hit.details),
            JSON.stringify({ provider: outcome.provider, simulated: true }),
        ]);
    }
    // A "clear" result is still a result and is still recorded: proving that a screen
    // happened and found nothing is as important as recording a hit.
    if (outcome.hits.length === 0) {
        await db.query(`INSERT INTO screening_result (
         screening_case_id, screening_type, list_name, match_details, payload_retention_until
       )
       SELECT $1, unnest($2::text[]), 'SIMULATED-NO-MATCH',
              '{"note":"No match returned by the simulated provider."}'::jsonb,
              CURRENT_DATE + INTERVAL '7 years'`, [caseRow.id, input.screeningTypes]);
    }
    await db.query('UPDATE screening_case SET status = $2, completed_at = now() WHERE id = $1', [caseRow.id, outcome.status]);
    await recordAudit(db, {
        category: 'integration', action: 'screening.run', outcome: 'success',
        organizationId: input.organizationId, actorType: 'system',
        entityType: input.subjectType, entityId: input.subjectId,
        metadata: {
            reference, provider: outcome.provider, status: outcome.status,
            hit_count: outcome.hits.length, simulated: true,
            types: input.screeningTypes,
        },
    });
    return {
        caseId: caseRow.id, reference, status: outcome.status, hitCount: outcome.hits.length,
    };
}
/** An analyst disposes of a screening match. A written reason is mandatory. */
export async function disposeScreening(db, input) {
    if (input.reason.trim().length < 10) {
        throw invalid('REASON_TOO_SHORT', 'Disposing of a screening match requires a written reason. "False positive" alone is not a reason; ' +
            'say why.');
    }
    const row = await one(db, 'SELECT organization_id, reference FROM screening_case WHERE id = $1', [input.screeningCaseId]);
    await db.query(`UPDATE screening_case
        SET disposition = $2, disposed_by = $3, disposed_at = now(), disposition_reason = $4,
            status = CASE WHEN $2 = 'cleared' THEN 'false_positive' ELSE status END
      WHERE id = $1`, [input.screeningCaseId, input.disposition, input.userId, input.reason]);
    await recordAudit(db, {
        category: 'compliance_decision', action: `screening.${input.disposition}`, outcome: 'success',
        actorUserId: input.userId, actorRole: input.role, organizationId: row.organization_id,
        entityType: 'screening_case', entityId: input.screeningCaseId,
        reason: input.reason, metadata: { reference: row.reference },
    });
}
/** The fields whose change invalidates an approval. */
function materialFingerprint(input, accountFingerprint) {
    return fingerprint(canonicalHash({
        legal_name: input.legalName.trim().toUpperCase(),
        registration_number: (input.registrationNumber ?? '').trim().toUpperCase(),
        country: input.country.toUpperCase(),
        account: accountFingerprint,
        institution: input.bank.institutionName.trim().toUpperCase(),
        swift: (input.bank.swiftBic ?? '').toUpperCase(),
        currency: input.bank.currency,
    }), 'beneficiary_material');
}
export async function createBeneficiary(db, input) {
    const b = input.beneficiary;
    if (b.legalName.trim().length < 2)
        throw invalid('NAME_REQUIRED', 'A beneficiary legal name is required.');
    if (b.relationshipToSender.trim().length < 3) {
        throw invalid('RELATIONSHIP_REQUIRED', 'State the relationship between your business and the beneficiary.');
    }
    if (b.paymentPurpose.trim().length < 5) {
        throw invalid('PURPOSE_REQUIRED', 'State the purpose of payments to this beneficiary.');
    }
    const accountFingerprint = fingerprint(`${b.bank.identifierScheme}:${b.bank.identifier.replace(/\s+/g, '').toUpperCase()}`, 'bank_account');
    const account = await one(db, `INSERT INTO bank_account (
       organization_id, ownership, account_holder_name, institution_name, institution_country,
       swift_bic, identifier_scheme, identifier_encrypted, identifier_last4,
       identifier_fingerprint, currency
     ) VALUES ($1,'beneficiary',$2,$3,$4,$5,$6,$7,$8,$9,$10)
     RETURNING id`, [
        input.organizationId, b.bank.accountHolderName, b.bank.institutionName,
        b.bank.institutionCountry.toUpperCase(), b.bank.swiftBic?.toUpperCase() ?? null,
        b.bank.identifierScheme, encryptField(b.bank.identifier),
        b.bank.identifier.slice(-4), accountFingerprint, b.bank.currency.toUpperCase(),
    ]);
    const displayCode = `BEN-${randomHex(3).toUpperCase()}`;
    const beneficiary = await one(db, `INSERT INTO beneficiary (
       organization_id, display_code, legal_name, registration_number, country, address,
       bank_account_id, payment_purpose, relationship_to_sender, supporting_contract_id,
       status, material_fingerprint, created_by
     ) VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7,$8,$9,$10,'pending_review',$11,$12)
     RETURNING id`, [
        input.organizationId, displayCode, b.legalName.trim(), b.registrationNumber ?? null,
        b.country.toUpperCase(), JSON.stringify(b.address), account.id,
        b.paymentPurpose, b.relationshipToSender, b.supportingContractId ?? null,
        materialFingerprint(b, accountFingerprint), input.userId,
    ]);
    const screening = await runScreening(db, {
        organizationId: input.organizationId,
        subjectType: 'beneficiary',
        subjectId: beneficiary.id,
        name: b.legalName,
        country: b.country,
        screeningTypes: ['sanctions', 'adverse_media'],
    });
    await queueNotification(db, {
        organizationId: input.organizationId, recipientRole: 'compliance_analyst', channel: 'in_app',
        eventType: 'compliance_review_required',
        subject: `Beneficiary review: ${b.legalName}`,
        body: `A new beneficiary needs review before first use. Screening: ${screening.status}.`,
        actionUrl: `/compliance/beneficiaries/${beneficiary.id}`,
    });
    await recordAudit(db, {
        category: 'data_create', action: 'beneficiary.create', outcome: 'success',
        actorUserId: input.userId, organizationId: input.organizationId,
        entityType: 'beneficiary', entityId: beneficiary.id,
        // The account number is not here. Only the last four digits and the institution.
        newValues: {
            display_code: displayCode, legal_name: b.legalName, country: b.country,
            institution: b.bank.institutionName, account_last4: b.bank.identifier.slice(-4),
            currency: b.bank.currency,
        },
    });
    return { beneficiaryId: beneficiary.id, displayCode, screeningReference: screening.reference };
}
export async function reviewBeneficiary(db, input) {
    if (input.reason.trim().length < 10) {
        throw invalid('REASON_TOO_SHORT', 'A beneficiary decision requires a written reason.');
    }
    const ben = await one(db, 'SELECT organization_id, legal_name, status FROM beneficiary WHERE id = $1', [input.beneficiaryId]);
    const NEXT = {
        approve: 'approved', reject: 'rejected', request_information: 'additional_information_required',
    };
    const next = NEXT[input.decision];
    await db.query(`UPDATE beneficiary
        SET status = $2,
            approved_at = CASE WHEN $2 = 'approved' THEN now() ELSE approved_at END,
            approved_by = CASE WHEN $2 = 'approved' THEN $3 ELSE approved_by END,
            requires_rereview = CASE WHEN $2 = 'approved' THEN false ELSE requires_rereview END,
            rereview_reason = CASE WHEN $2 = 'approved' THEN NULL ELSE rereview_reason END
      WHERE id = $1`, [input.beneficiaryId, next, input.userId]);
    await recordAudit(db, {
        category: 'compliance_decision', action: `beneficiary.${input.decision}`, outcome: 'success',
        actorUserId: input.userId, actorRole: input.role, organizationId: ben.organization_id,
        entityType: 'beneficiary', entityId: input.beneficiaryId,
        oldValues: { status: ben.status }, newValues: { status: next }, reason: input.reason,
    });
    return { status: next };
}
/**
 * Editing a beneficiary. If any material field changes the approval is invalidated
 * automatically — there is no code path that edits bank details and keeps the approved
 * status, which is exactly the path a business-email-compromise attacker wants.
 */
export async function updateBeneficiary(db, input) {
    const before = await one(db, `SELECT b.organization_id, b.legal_name, b.registration_number, b.country,
            b.payment_purpose, b.relationship_to_sender, b.material_fingerprint, b.status,
            a.identifier_fingerprint AS account_fingerprint, a.institution_name,
            a.swift_bic, a.currency
       FROM beneficiary b JOIN bank_account a ON a.id = b.bank_account_id
      WHERE b.id = $1`, [input.beneficiaryId]);
    const merged = {
        legalName: input.changes.legalName ?? before.legal_name,
        registrationNumber: input.changes.registrationNumber ?? before.registration_number,
        country: input.changes.country ?? before.country,
        address: input.changes.address ?? {},
        paymentPurpose: input.changes.paymentPurpose ?? before.payment_purpose,
        relationshipToSender: input.changes.relationshipToSender ?? before.relationship_to_sender,
        bank: input.changes.bank ?? {
            accountHolderName: '', institutionName: before.institution_name,
            institutionCountry: before.country, swiftBic: before.swift_bic,
            identifierScheme: 'other', identifier: '', currency: before.currency,
        },
    };
    const newAccountFingerprint = input.changes.bank
        ? fingerprint(`${input.changes.bank.identifierScheme}:${input.changes.bank.identifier.replace(/\s+/g, '').toUpperCase()}`, 'bank_account')
        : before.account_fingerprint;
    const newFingerprint = materialFingerprint(merged, newAccountFingerprint);
    const materialChanged = newFingerprint !== before.material_fingerprint;
    await db.query(`UPDATE beneficiary
        SET legal_name = $2, registration_number = $3, country = $4,
            payment_purpose = $5, relationship_to_sender = $6,
            material_fingerprint = $7,
            requires_rereview = CASE WHEN $8 THEN true ELSE requires_rereview END,
            rereview_reason = CASE WHEN $8
              THEN 'Material details changed after approval and must be re-verified.'
              ELSE rereview_reason END,
            status = CASE WHEN $8 AND status = 'approved' THEN 'pending_review' ELSE status END
      WHERE id = $1`, [
        input.beneficiaryId, merged.legalName, merged.registrationNumber, merged.country.toUpperCase(),
        merged.paymentPurpose, merged.relationshipToSender, newFingerprint, materialChanged,
    ]);
    const after = await one(db, 'SELECT status, requires_rereview FROM beneficiary WHERE id = $1', [input.beneficiaryId]);
    const diff = diffRecords({ legal_name: before.legal_name, country: before.country, status: before.status }, { legal_name: merged.legalName, country: merged.country.toUpperCase(), status: after.status });
    await recordAudit(db, {
        category: 'data_update', action: 'beneficiary.update', outcome: 'success',
        actorUserId: input.userId, organizationId: before.organization_id,
        entityType: 'beneficiary', entityId: input.beneficiaryId,
        oldValues: diff.old, newValues: diff.new,
        metadata: {
            material_change: materialChanged,
            approval_invalidated: materialChanged && before.status === 'approved',
            changed_fields: diff.changedFields,
        },
    });
    if (materialChanged) {
        await queueNotification(db, {
            organizationId: before.organization_id, recipientRole: 'compliance_analyst',
            channel: 'in_app', eventType: 'compliance_review_required',
            subject: `Beneficiary changed and needs re-review: ${merged.legalName}`,
            body: 'Material beneficiary details were changed after approval. Re-review is required before next use.',
            actionUrl: `/compliance/beneficiaries/${input.beneficiaryId}`,
        });
    }
    return { status: after.status, requiresRereview: after.requires_rereview };
}
export async function listBeneficiaries(db, organizationId) {
    return many(db, `SELECT b.id, b.display_code, b.legal_name, b.registration_number, b.country, b.status,
            b.requires_rereview, b.rereview_reason, b.payment_purpose, b.relationship_to_sender,
            b.approved_at, b.first_used_at, b.created_at,
            a.institution_name, a.institution_country, a.swift_bic, a.currency,
            a.identifier_last4, a.verification_status AS account_verification
       FROM beneficiary b JOIN bank_account a ON a.id = b.bank_account_id
      WHERE b.organization_id = $1
      ORDER BY b.created_at DESC`, [organizationId]);
}
// ---------------------------------------------------------------------------
// Documents
// ---------------------------------------------------------------------------
const ALLOWED_MIME_TYPES = new Set([
    'application/pdf', 'image/png', 'image/jpeg', 'image/tiff',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
]);
const MAX_DOCUMENT_BYTES = 25 * 1024 * 1024;
/**
 * Content-based malware screening stand-in.
 *
 * This is NOT antivirus and does not claim to be. It checks the declared type against
 * the file's magic bytes, refuses active content, and flags the EICAR test string. A real
 * deployment routes the object through a scanning service before the document leaves
 * `pending`; that integration is a named gap in the pilot readiness report.
 */
export function screenDocumentContent(bytes, declaredMime) {
    const EICAR = 'X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*';
    const head = bytes.subarray(0, 4096).toString('latin1');
    if (head.includes(EICAR)) {
        return { status: 'infected', scanner: 'ekorails-basic-v1', detail: 'EICAR test signature detected.' };
    }
    const magic = [
        ['application/pdf', (b) => b.subarray(0, 5).toString('latin1') === '%PDF-'],
        ['image/png', (b) => b.subarray(0, 8).toString('hex') === '89504e470d0a1a0a'],
        ['image/jpeg', (b) => b.subarray(0, 3).toString('hex') === 'ffd8ff'],
    ];
    const check = magic.find(([mime]) => mime === declaredMime);
    if (check && !check[1](bytes)) {
        return {
            status: 'error', scanner: 'ekorails-basic-v1',
            detail: `File content does not match the declared type ${declaredMime}. Refused.`,
        };
    }
    // Active content inside a PDF is the most common document-borne attack.
    if (declaredMime === 'application/pdf') {
        for (const marker of ['/JavaScript', '/JS', '/Launch', '/EmbeddedFile', '/OpenAction']) {
            if (bytes.toString('latin1').includes(marker)) {
                return {
                    status: 'infected', scanner: 'ekorails-basic-v1',
                    detail: `PDF contains active content marker ${marker}. Refused.`,
                };
            }
        }
    }
    return {
        status: 'clean', scanner: 'ekorails-basic-v1',
        detail: 'Basic structural checks passed. This is not a substitute for a full antivirus scan, which is a ' +
            'named gap in the pilot readiness report.',
    };
}
export async function uploadDocument(db, input) {
    if (!ALLOWED_MIME_TYPES.has(input.mimeType)) {
        throw invalid('UNSUPPORTED_FILE_TYPE', `Files of type "${input.mimeType}" are not accepted.`, { accepted: [...ALLOWED_MIME_TYPES] });
    }
    if (input.bytes.length === 0)
        throw invalid('EMPTY_FILE', 'The file is empty.');
    if (input.bytes.length > MAX_DOCUMENT_BYTES) {
        throw invalid('FILE_TOO_LARGE', `Files must be ${MAX_DOCUMENT_BYTES / 1024 / 1024} MB or smaller.`);
    }
    const scan = screenDocumentContent(input.bytes, input.mimeType);
    const contentSha256 = sha256Hex(input.bytes);
    const storageKey = `org/${input.organizationId}/doc/${randomHex(16)}`;
    const version = input.supersedesId
        ? (await one(db, 'SELECT version + 1 AS v FROM document WHERE id = $1', [input.supersedesId])).v
        : 1;
    if (input.supersedesId) {
        await db.query('UPDATE document SET is_current = false WHERE id = $1', [input.supersedesId]);
    }
    const doc = await one(db, `INSERT INTO document (
       organization_id, document_type, version, supersedes_id, is_current,
       original_filename, mime_type, byte_size, content_sha256, storage_key,
       encryption_key_id, malware_scan_status, malware_scan_at, malware_scanner,
       issued_on, expires_on, classification, uploaded_by,
       retention_until
     ) VALUES ($1,$2,$3,$4,true,$5,$6,$7,$8,$9,'k1',$10,now(),$11,$12,$13,$14,$15,
               CURRENT_DATE + INTERVAL '7 years')
     RETURNING id`, [
        input.organizationId, input.documentType, version, input.supersedesId ?? null,
        input.originalFilename, input.mimeType, input.bytes.length, contentSha256, storageKey,
        scan.status, scan.scanner, input.issuedOn ?? null, input.expiresOn ?? null,
        input.classification ?? 'confidential', input.userId,
    ]);
    await recordAudit(db, {
        category: 'data_create', action: 'document.upload', outcome: scan.status === 'infected' ? 'failure' : 'success',
        actorUserId: input.userId, organizationId: input.organizationId,
        entityType: 'document', entityId: doc.id,
        newValues: {
            document_type: input.documentType, filename: input.originalFilename,
            mime_type: input.mimeType, byte_size: input.bytes.length,
            content_sha256: contentSha256, scan_status: scan.status,
        },
    });
    if (scan.status === 'infected') {
        throw precondition('DOCUMENT_REJECTED', `The file was rejected: ${scan.detail}`, { document_id: doc.id, scan_status: scan.status });
    }
    return { documentId: doc.id, contentSha256, scanStatus: scan.status, scanDetail: scan.detail };
}
/**
 * Records an AI-proposed extraction. Nothing reads this until a human confirms it —
 * see the `extraction_confirmation_is_human` database constraint.
 */
export async function proposeExtraction(db, input) {
    const row = await one(db, `INSERT INTO document_extraction (
       document_id, organization_id, extractor, extractor_version,
       proposed_fields, field_confidence, status
     ) VALUES ($1,$2,$3,$4,$5::jsonb,$6::jsonb,'proposed')
     RETURNING id`, [
        input.documentId, input.organizationId, input.extractor, input.extractorVersion,
        JSON.stringify(input.proposedFields), JSON.stringify(input.fieldConfidence),
    ]);
    return { extractionId: row.id };
}
export async function confirmExtraction(db, input) {
    const before = await one(db, 'SELECT organization_id, proposed_fields FROM document_extraction WHERE id = $1', [input.extractionId]);
    await db.query(`UPDATE document_extraction
        SET status = $2, confirmed_fields = $3::jsonb, confirmed_by = $4, confirmed_at = now()
      WHERE id = $1`, [
        input.extractionId, input.corrected ? 'corrected' : 'confirmed',
        JSON.stringify(input.confirmedFields), input.userId,
    ]);
    await recordAudit(db, {
        category: 'data_update', action: 'document.extraction.confirm', outcome: 'success',
        actorUserId: input.userId, organizationId: before.organization_id,
        entityType: 'document_extraction', entityId: input.extractionId,
        oldValues: { proposed: before.proposed_fields },
        newValues: { confirmed: input.confirmedFields },
        metadata: {
            corrected: input.corrected,
            note: 'AI-proposed fields are advisory only and take effect solely on human confirmation.',
        },
    });
}
export async function listDocuments(db, organizationId) {
    return many(db, `SELECT d.id, d.document_type, d.version, d.is_current, d.original_filename, d.mime_type,
            d.byte_size, d.content_sha256, d.malware_scan_status, d.issued_on, d.expires_on,
            d.classification, d.retention_until, d.legal_hold, d.created_at,
            u.display_name AS uploaded_by_name,
            (d.expires_on IS NOT NULL AND d.expires_on <= CURRENT_DATE) AS expired,
            (d.expires_on IS NOT NULL AND d.expires_on <= CURRENT_DATE + INTERVAL '30 days'
             AND d.expires_on > CURRENT_DATE) AS expiring_soon
       FROM document d LEFT JOIN app_user u ON u.id = d.uploaded_by
      WHERE d.organization_id = $1
      ORDER BY d.created_at DESC`, [organizationId]);
}
/** Documents approaching or past expiry, across all organisations. Compliance queue. */
export async function expiringDocuments(db, withinDays = 30) {
    return many(db, `SELECT d.id, d.document_type, d.original_filename, d.expires_on,
            o.legal_name AS organization_name, o.display_code AS organization_code,
            (d.expires_on <= CURRENT_DATE) AS already_expired,
            (d.expires_on - CURRENT_DATE) AS days_remaining
       FROM document d JOIN organization o ON o.id = d.organization_id
      WHERE d.is_current AND d.expires_on IS NOT NULL
        AND d.expires_on <= CURRENT_DATE + ($1 || ' days')::interval
      ORDER BY d.expires_on`, [String(withinDays)]);
}
/** Mints a short-lived signed download URL and audits the mint. */
export async function mintDocumentUrl(db, input) {
    const doc = await maybeOne(db, 'SELECT storage_key, organization_id, classification FROM document WHERE id = $1', [input.documentId]);
    if (!doc) {
        await db.query(`INSERT INTO document_access (document_id, user_id, action, reason, session_id)
       SELECT $1, $2, 'denied', 'document not found or not visible in scope', $3
        WHERE EXISTS (SELECT 1 FROM app_user WHERE id = $2)`, [input.documentId, input.userId, input.sessionId]).catch(() => { });
        throw notFound('DOCUMENT_NOT_FOUND', 'Document not found.');
    }
    const ttl = Math.min(input.ttlSeconds ?? 300, 900);
    const expiresAtMs = Date.now() + ttl * 1000;
    const { signStorageUrl } = await import('../../core/crypto.js');
    const url = signStorageUrl(doc.storage_key, expiresAtMs);
    await db.query(`INSERT INTO document_access (document_id, user_id, action, reason, session_id)
     VALUES ($1,$2,'url_minted',$3,$4)`, [input.documentId, input.userId, input.reason ?? null, input.sessionId]);
    await recordAudit(db, {
        category: 'document_access', action: 'document.url_minted', outcome: 'success',
        actorUserId: input.userId, organizationId: doc.organization_id, sessionId: input.sessionId,
        entityType: 'document', entityId: input.documentId,
        reason: input.reason ?? null,
        metadata: { classification: doc.classification, ttl_seconds: ttl },
    });
    return { url, expiresAt: new Date(expiresAtMs).toISOString() };
}
//# sourceMappingURL=service.js.map