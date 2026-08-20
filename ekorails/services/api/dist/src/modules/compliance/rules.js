/**
 * The compliance rule catalogue.
 *
 * Each rule is a pure function of a canonicalised input document plus its own recorded
 * parameters. Purity is the point: a decision made in March must be reproducible in
 * November, and it can only be if the rule read nothing that has since changed. Anything
 * the rule needs is gathered into the input document first, hashed, and stored with the
 * result.
 *
 * Every rule also carries the plain-English fields the Founder Learning Center's
 * Compliance Rule Library renders: what risk it addresses, when it fires, what evidence
 * it needs, what happens automatically, what a human must decide, how it can be wrong,
 * and what policy it rests on.
 *
 * On policy basis: where the CBN filing has not been supplied, `policyBasis` states the
 * generally-accepted control the rule implements and marks the specific Nigerian
 * threshold as unconfirmed. No rule cites a regulation the filing has not given us.
 */
import { Decimal } from '../../core/money.js';
const dec = (v) => (v === null ? null : Decimal.fromString(v));
const notTriggered = (message, dataUsed = {}) => ({ triggered: false, message, dataUsed });
/**
 * Jurisdictions and industries treated as higher risk. Deliberately generic and
 * configurable: the specific Nigerian list depends on the CBN filing and on the
 * destination market's own regime, neither of which has been supplied. The engine
 * reads these from rule parameters, so replacing them is a rule version, not a code change.
 */
const DEFAULT_HIGH_RISK_JURISDICTIONS = [];
const DEFAULT_HIGH_RISK_INDUSTRIES = [
    'gambling', 'virtual_asset_service_provider', 'precious_metals_and_stones',
    'arms_and_defence', 'money_service_business', 'unregulated_charity',
];
export const RULES = [
    // -------------------------------------------------------------------------
    // Customer and beneficiary status
    // -------------------------------------------------------------------------
    {
        key: 'CUSTOMER_NOT_APPROVED',
        version: 1,
        name: 'Customer is not an approved business',
        category: 'customer_status',
        appliesTo: ['transaction'],
        severity: 'prohibited',
        onTrigger: 'reject',
        parameters: { approvedStatuses: ['approved'] },
        riskAddressed: 'Moving value for a business whose identity, ownership and legitimacy have not been ' +
            'established. This is the foundational AML failure — everything downstream assumes it did not happen.',
        triggerCondition: 'The originating organisation is in any onboarding status other than Approved.',
        requiredEvidence: 'The organisation record and its KYB decision history.',
        automatedAction: 'The transaction is rejected before any quote is issued or funding requested.',
        humanDecision: 'None at this stage. The customer must complete onboarding; a compliance analyst then approves ' +
            'the organisation, not the individual transaction.',
        falsePositiveRisk: 'Low. The only realistic false positive is a race where approval completes between the check ' +
            'and the submission, which the customer resolves by resubmitting.',
        policyBasis: 'Customer due diligence before establishing a business relationship. Nigerian threshold and ' +
            'documentary specifics UNCONFIRMED pending the CBN filing.',
        evaluate: (input, params) => {
            const approved = params['approvedStatuses'] ?? ['approved'];
            const status = input.organization.onboardingStatus;
            const ok = approved.includes(status);
            return {
                triggered: !ok,
                message: ok
                    ? `Organisation is ${status}.`
                    : `Organisation onboarding status is "${status}", which does not permit transacting.`,
                dataUsed: { onboarding_status: status, approved_statuses: approved },
            };
        },
    },
    {
        key: 'CUSTOMER_SUSPENDED',
        version: 1,
        name: 'Customer organisation is suspended',
        category: 'customer_status',
        appliesTo: ['transaction', 'organization'],
        severity: 'prohibited',
        onTrigger: 'reject',
        parameters: {},
        riskAddressed: 'A suspension is a live compliance or risk decision. Allowing a suspended customer to transact ' +
            'would make the suspension decorative.',
        triggerCondition: 'The organisation has a suspension timestamp set.',
        requiredEvidence: 'The suspension record, its reason and the deciding user.',
        automatedAction: 'The transaction is rejected and the attempt is recorded against the suspension case.',
        humanDecision: 'A Compliance Manager must lift the suspension before the customer can transact.',
        falsePositiveRisk: 'None. The state is explicit.',
        policyBasis: 'Internal risk-control policy; ability to restrict a relationship pending investigation.',
        evaluate: (input) => ({
            triggered: input.organization.suspended,
            message: input.organization.suspended
                ? 'Organisation is suspended and cannot initiate transactions.'
                : 'Organisation is not suspended.',
            dataUsed: { suspended: input.organization.suspended },
        }),
    },
    {
        key: 'BENEFICIARY_NOT_APPROVED',
        version: 1,
        name: 'Beneficiary has not been approved',
        category: 'beneficiary_status',
        appliesTo: ['transaction', 'beneficiary'],
        severity: 'high',
        onTrigger: 'reject',
        parameters: {},
        riskAddressed: 'Paying an unverified beneficiary. Beneficiary substitution is one of the most common ' +
            'business-email-compromise outcomes, and it is invisible unless the beneficiary is separately approved.',
        triggerCondition: 'The beneficiary is in any status other than Approved, or is flagged for re-review.',
        requiredEvidence: 'Beneficiary record, screening result, supporting contract and verification status.',
        automatedAction: 'The transaction cannot leave compliance review.',
        humanDecision: 'A Compliance Analyst reviews and approves the beneficiary before first use.',
        falsePositiveRisk: 'Moderate operationally: a beneficiary whose details were edited legitimately is forced back ' +
            'through review. That friction is deliberate.',
        policyBasis: 'Beneficiary verification prior to first payment. Standard payment-fraud control.',
        evaluate: (input) => {
            const b = input.beneficiary;
            if (!b)
                return notTriggered('No beneficiary in scope.');
            const bad = b.status !== 'approved' || b.requiresRereview;
            return {
                triggered: bad,
                message: bad
                    ? `Beneficiary status is "${b.status}"${b.requiresRereview ? ' and is flagged for re-review after a material change' : ''}.`
                    : 'Beneficiary is approved and unchanged since approval.',
                dataUsed: { status: b.status, requires_rereview: b.requiresRereview },
            };
        },
    },
    // -------------------------------------------------------------------------
    // Authorisation
    // -------------------------------------------------------------------------
    {
        key: 'INITIATOR_NOT_AUTHORISED',
        version: 1,
        name: 'Initiating user is not authorised to transact',
        category: 'authorisation',
        appliesTo: ['transaction'],
        severity: 'high',
        onTrigger: 'reject',
        parameters: {},
        riskAddressed: 'An account with read access initiating payments. Privilege creep inside a customer ' +
            'organisation is a common insider-fraud route.',
        triggerCondition: 'The initiating user does not hold the transaction-initiation permission.',
        requiredEvidence: 'The user role grants in force at initiation.',
        automatedAction: 'The transaction is refused at the API boundary and never reaches draft.',
        humanDecision: 'The customer administrator grants the appropriate role, which is itself audited.',
        falsePositiveRisk: 'None. The permission set is explicit.',
        policyBasis: 'Segregation of duties and least privilege.',
        evaluate: (input) => {
            const t = input.transaction;
            if (!t)
                return notTriggered('No transaction in scope.');
            return {
                triggered: !t.initiatorHoldsInitiatePermission,
                message: t.initiatorHoldsInitiatePermission
                    ? 'Initiator holds transaction-initiation authority.'
                    : 'Initiating user does not hold transaction-initiation authority.',
                dataUsed: { initiator_user_id: t.initiatedByUserId, holds_permission: t.initiatorHoldsInitiatePermission },
            };
        },
    },
    // -------------------------------------------------------------------------
    // Limits and velocity
    // -------------------------------------------------------------------------
    {
        key: 'LIMIT_NOT_CONFIGURED',
        version: 1,
        name: 'No approved transaction limit is configured for this corridor',
        category: 'limits',
        appliesTo: ['transaction'],
        severity: 'high',
        onTrigger: 'manual_review',
        parameters: {},
        riskAddressed: 'Transacting outside a limit framework. A pilot without enforced limits is a pilot whose ' +
            'exposure is unbounded, which is precisely what a sandbox regime exists to prevent.',
        triggerCondition: 'The corridor has no per-transaction, daily or monthly limit set.',
        requiredEvidence: 'The corridor configuration and the source of its limits.',
        automatedAction: 'A missing limit is treated as a block, never as "unlimited". The transaction is held for ' +
            'manual review and cannot auto-clear.',
        humanDecision: 'A Compliance Manager must either configure the approved limit from the filing or decline the transaction.',
        falsePositiveRisk: 'None — but note this rule fires on EVERY transaction until the CBN filing supplies the limits. ' +
            'That is the intended behaviour, not a defect.',
        policyBasis: 'Regulatory sandbox conditions ordinarily cap exposure per transaction, per customer and in ' +
            'aggregate. The specific caps are UNCONFIRMED pending the filing (see founder decision FD-003).',
        evaluate: (input) => {
            const c = input.corridor;
            const missing = [
                c.perTransactionLimit === null ? 'per_transaction' : null,
                c.dailyLimit === null ? 'daily' : null,
                c.monthlyLimit === null ? 'monthly' : null,
            ].filter((x) => x !== null);
            return {
                triggered: missing.length > 0,
                message: missing.length > 0
                    ? `Corridor ${c.code} has no configured ${missing.join(', ')} limit. Treated as a block, not as unlimited.`
                    : 'All corridor limits are configured.',
                dataUsed: { corridor: c.code, missing_limits: missing },
            };
        },
    },
    {
        key: 'TXN_ABOVE_SINGLE_LIMIT',
        version: 1,
        name: 'Transaction exceeds the per-transaction limit',
        category: 'limits',
        appliesTo: ['transaction'],
        severity: 'prohibited',
        onTrigger: 'reject',
        parameters: {},
        riskAddressed: 'A single transaction breaching the exposure cap agreed for the pilot. A breach is a reportable ' +
            'event, not merely an internal exception.',
        triggerCondition: 'Send amount exceeds the corridor per-transaction limit, in the limit currency.',
        requiredEvidence: 'Transaction amount, corridor limit and the limit currency.',
        automatedAction: 'Rejected. A pilot limit breach is not a reviewable judgement call.',
        humanDecision: 'None automatically. A limit increase requires a configuration change under maker-checker and, ' +
            'where the limit came from the filing, regulatory agreement.',
        falsePositiveRisk: 'Low, but note that a limit expressed in a currency other than the send currency requires a ' +
            'conversion; this rule refuses rather than guesses when the currencies differ.',
        policyBasis: 'Pilot transaction cap. Value UNCONFIRMED pending the CBN filing (FD-003).',
        evaluate: (input) => {
            const t = input.transaction;
            const c = input.corridor;
            if (!t)
                return notTriggered('No transaction in scope.');
            const limit = dec(c.perTransactionLimit);
            if (limit === null)
                return notTriggered('No per-transaction limit configured; handled by LIMIT_NOT_CONFIGURED.');
            if (c.limitCurrency !== t.sendCurrency) {
                return {
                    triggered: true,
                    severity: 'high',
                    action: 'manual_review',
                    message: `Limit is denominated in ${c.limitCurrency} but the transaction is in ${t.sendCurrency}. ` +
                        'The engine will not convert a control threshold at an unrecorded rate; manual review required.',
                    dataUsed: { limit_currency: c.limitCurrency, send_currency: t.sendCurrency },
                };
            }
            const amount = Decimal.fromString(t.sendAmount);
            const over = amount.greaterThan(limit);
            return {
                triggered: over,
                message: over
                    ? `Send amount ${amount.toString()} ${t.sendCurrency} exceeds the per-transaction limit of ${limit.toString()} ${c.limitCurrency}.`
                    : `Send amount is within the per-transaction limit.`,
                dataUsed: {
                    send_amount: amount.toString(), limit: limit.toString(), currency: c.limitCurrency,
                },
            };
        },
    },
    {
        key: 'VELOCITY_DAILY_LIMIT',
        version: 1,
        name: 'Daily aggregate limit would be exceeded',
        category: 'velocity',
        appliesTo: ['transaction'],
        severity: 'high',
        onTrigger: 'reject',
        parameters: {},
        riskAddressed: 'Splitting a large exposure across several transactions in one day to stay under the single-transaction cap.',
        triggerCondition: 'Today\'s settled and in-flight total plus this transaction exceeds the daily limit.',
        requiredEvidence: 'The velocity counter for the day and the corridor daily limit.',
        automatedAction: 'Rejected.',
        humanDecision: 'A Compliance Manager may authorise an exception only where the filing permits one.',
        falsePositiveRisk: 'Moderate: a customer with genuine same-day volume hits this legitimately. The remedy is a ' +
            'documented limit review, not an override.',
        policyBasis: 'Aggregate daily cap. Value UNCONFIRMED pending the CBN filing (FD-003).',
        evaluate: (input) => {
            const t = input.transaction;
            const limit = dec(input.corridor.dailyLimit);
            if (!t || limit === null)
                return notTriggered('No daily limit configured or no transaction in scope.');
            if (input.corridor.limitCurrency !== input.velocity.currency) {
                return notTriggered('Velocity currency differs from limit currency; handled by TXN_ABOVE_SINGLE_LIMIT.');
            }
            const projected = Decimal.fromString(input.velocity.dailyAmount).add(Decimal.fromString(t.sendAmount));
            const over = projected.greaterThan(limit);
            return {
                triggered: over,
                message: over
                    ? `Daily total would reach ${projected.toString()} ${input.velocity.currency} against a limit of ${limit.toString()}.`
                    : `Daily total would reach ${projected.toString()}, within the limit of ${limit.toString()}.`,
                dataUsed: {
                    already_today: input.velocity.dailyAmount, this_transaction: t.sendAmount,
                    projected: projected.toString(), limit: limit.toString(),
                },
            };
        },
    },
    {
        key: 'VELOCITY_MONTHLY_LIMIT',
        version: 1,
        name: 'Monthly aggregate limit would be exceeded',
        category: 'velocity',
        appliesTo: ['transaction'],
        severity: 'high',
        onTrigger: 'reject',
        parameters: {},
        riskAddressed: 'Exceeding the agreed monthly exposure for a single customer.',
        triggerCondition: 'Month-to-date total plus this transaction exceeds the monthly limit.',
        requiredEvidence: 'The monthly velocity counter and the corridor monthly limit.',
        automatedAction: 'Rejected.',
        humanDecision: 'Limit review under maker-checker.',
        falsePositiveRisk: 'Moderate, for the same reason as the daily rule.',
        policyBasis: 'Aggregate monthly cap. Value UNCONFIRMED pending the CBN filing (FD-003).',
        evaluate: (input) => {
            const t = input.transaction;
            const limit = dec(input.corridor.monthlyLimit);
            if (!t || limit === null)
                return notTriggered('No monthly limit configured or no transaction in scope.');
            if (input.corridor.limitCurrency !== input.velocity.currency) {
                return notTriggered('Velocity currency differs from limit currency.');
            }
            const projected = Decimal.fromString(input.velocity.monthlyAmount).add(Decimal.fromString(t.sendAmount));
            const over = projected.greaterThan(limit);
            return {
                triggered: over,
                message: over
                    ? `Month-to-date total would reach ${projected.toString()} against a limit of ${limit.toString()}.`
                    : `Month-to-date total would reach ${projected.toString()}, within the limit.`,
                dataUsed: {
                    month_to_date: input.velocity.monthlyAmount, projected: projected.toString(), limit: limit.toString(),
                },
            };
        },
    },
    {
        key: 'STRUCTURING_INDICATOR',
        version: 1,
        name: 'Possible structuring',
        category: 'behavioural',
        appliesTo: ['transaction'],
        severity: 'high',
        onTrigger: 'escalate',
        parameters: { windowHours: 24, minimumCount: 3, proximityFractionOfLimit: 0.9 },
        riskAddressed: 'Deliberately breaking a payment into pieces that each sit just under a reporting or approval ' +
            'threshold. Structuring is an offence in its own right in most AML regimes, independently of the ' +
            'underlying funds.',
        triggerCondition: 'Three or more transactions in 24 hours each between 90% and 100% of the per-transaction limit.',
        requiredEvidence: 'The transaction amounts in the window and the limit in force at the time.',
        automatedAction: 'Escalated to a Compliance Manager. Not auto-rejected, because the pattern needs judgement.',
        humanDecision: 'A manager assesses whether the pattern has a commercial explanation and, if not, whether a ' +
            'suspicious activity report is required.',
        falsePositiveRisk: 'Real. A business with a genuine invoice run near the cap looks identical to structuring. That is ' +
            'why the rule escalates for judgement rather than rejecting.',
        policyBasis: 'Structuring / smurfing detection. Reporting obligation and threshold UNCONFIRMED pending the filing.',
        evaluate: (input, params) => {
            const t = input.transaction;
            const limit = dec(input.corridor.perTransactionLimit);
            if (!t || limit === null)
                return notTriggered('Structuring detection requires a configured limit.');
            const fraction = Number(params['proximityFractionOfLimit'] ?? 0.9);
            const minCount = Number(params['minimumCount'] ?? 3);
            // Threshold = limit * fraction, computed in fixed precision.
            const threshold = limit.multiply(Decimal.fromString(fraction.toFixed(6)), 'half_even', limit.scale);
            const candidates = [t.sendAmount, ...input.velocity.recentAmounts]
                .map((a) => Decimal.fromString(a))
                .filter((a) => a.greaterThanOrEqual(threshold) && a.lessThanOrEqual(limit));
            const triggered = candidates.length >= minCount;
            return {
                triggered,
                message: triggered
                    ? `${candidates.length} transactions in the trailing ${params['windowHours']}h sit between ${threshold.toString()} and the limit ${limit.toString()}.`
                    : `${candidates.length} transaction(s) near the limit in the window; below the threshold of ${minCount}.`,
                dataUsed: {
                    near_limit_count: candidates.length, threshold: threshold.toString(),
                    limit: limit.toString(), minimum_count: minCount,
                },
            };
        },
    },
    // -------------------------------------------------------------------------
    // Corridor and currency
    // -------------------------------------------------------------------------
    {
        key: 'CORRIDOR_PLACEHOLDER_UNCONFIRMED',
        version: 1,
        name: 'Corridor is an unconfirmed placeholder',
        category: 'corridor',
        appliesTo: ['transaction', 'organization'],
        severity: 'medium',
        onTrigger: 'manual_review',
        parameters: {},
        riskAddressed: 'Transacting on a corridor that has not been confirmed by the regulatory filing. Until the ' +
            'approved corridor is known, no transaction on it can be said to be in scope of the pilot.',
        triggerCondition: 'The corridor record is still carrying INSERT_APPROVED_* placeholder values.',
        requiredEvidence: 'The corridor configuration and founder decision FD-002.',
        automatedAction: 'The transaction cannot auto-clear compliance. It is held for a named analyst to review and approve.',
        humanDecision: 'An analyst approves the individual transaction, accepting that the corridor is provisional.',
        falsePositiveRisk: 'None. This rule fires on every transaction until FD-002 is approved and the corridor is confirmed. ' +
            'That is the intended posture, and it means NO transaction in this build auto-clears compliance.',
        policyBasis: 'Sandbox scope is defined by the approved corridor. Corridor UNCONFIRMED pending the CBN filing (FD-002).',
        evaluate: (input) => ({
            triggered: input.corridor.isPlaceholder,
            message: input.corridor.isPlaceholder
                ? `Corridor ${input.corridor.code} holds placeholder values (${input.corridor.originCountry} to ${input.corridor.destinationCountry}). Awaiting founder decision FD-002.`
                : 'Corridor is confirmed.',
            dataUsed: {
                corridor: input.corridor.code, is_placeholder: input.corridor.isPlaceholder,
                origin: input.corridor.originCountry, destination: input.corridor.destinationCountry,
            },
        }),
    },
    {
        key: 'CORRIDOR_DISABLED',
        version: 1,
        name: 'Corridor is disabled',
        category: 'corridor',
        appliesTo: ['transaction'],
        severity: 'prohibited',
        onTrigger: 'reject',
        parameters: {},
        riskAddressed: 'Transacting on a corridor that has been switched off for risk, regulatory or partner reasons.',
        triggerCondition: 'The corridor status is not "enabled".',
        requiredEvidence: 'The corridor configuration and the change record that disabled it.',
        automatedAction: 'Rejected.',
        humanDecision: 'Re-enabling a corridor is a maker-checker configuration change.',
        falsePositiveRisk: 'None.',
        policyBasis: 'Operational risk control.',
        evaluate: (input) => ({
            triggered: input.corridor.status !== 'enabled',
            message: input.corridor.status !== 'enabled'
                ? `Corridor ${input.corridor.code} is ${input.corridor.status}.`
                : 'Corridor is enabled.',
            dataUsed: { corridor: input.corridor.code, status: input.corridor.status },
        }),
    },
    {
        key: 'CURRENCY_NOT_PERMITTED',
        version: 1,
        name: 'Currency pair is outside the corridor definition',
        category: 'currency',
        appliesTo: ['transaction'],
        severity: 'prohibited',
        onTrigger: 'reject',
        parameters: {},
        riskAddressed: 'Settling a currency pair the pilot was not approved for, and for which no liquidity or partner ' +
            'arrangement exists.',
        triggerCondition: 'Send or receive currency does not match the corridor definition.',
        requiredEvidence: 'The transaction currencies and the corridor definition.',
        automatedAction: 'Rejected.',
        humanDecision: 'None. A new currency pair is a new corridor.',
        falsePositiveRisk: 'None.',
        policyBasis: 'Approved corridor scope. Currencies UNCONFIRMED pending the filing (FD-002).',
        evaluate: (input) => {
            const t = input.transaction;
            if (!t)
                return notTriggered('No transaction in scope.');
            const c = input.corridor;
            const mismatch = t.sendCurrency !== c.originCurrency || t.receiveCurrency !== c.destinationCurrency;
            return {
                triggered: mismatch,
                message: mismatch
                    ? `Transaction is ${t.sendCurrency} to ${t.receiveCurrency}; corridor ${c.code} permits ${c.originCurrency} to ${c.destinationCurrency}.`
                    : 'Currency pair matches the corridor.',
                dataUsed: {
                    send: t.sendCurrency, receive: t.receiveCurrency,
                    corridor_origin: c.originCurrency, corridor_destination: c.destinationCurrency,
                },
            };
        },
    },
    // -------------------------------------------------------------------------
    // Screening
    // -------------------------------------------------------------------------
    {
        key: 'SANCTIONS_MATCH',
        version: 1,
        name: 'Sanctions screening produced a match',
        category: 'sanctions',
        appliesTo: ['transaction', 'organization', 'beneficiary'],
        severity: 'prohibited',
        onTrigger: 'suspend',
        parameters: { confirmedMatchThreshold: 95, potentialMatchThreshold: 80 },
        riskAddressed: 'Providing a service to a sanctioned party. This is a strict-liability exposure in most regimes ' +
            'and the single most serious control failure this system can have.',
        triggerCondition: 'The screening provider returns a potential or confirmed match against any screened party.',
        requiredEvidence: 'The screening case, the provider response, the matched list entry and the analyst disposition.',
        automatedAction: 'The transaction is suspended immediately — not merely queued — and cannot proceed to funding or settlement.',
        humanDecision: 'A Compliance Analyst must dispose of the match as a true match or a false positive, with a written ' +
            'reason. A true match is escalated to a Compliance Manager for reporting.',
        falsePositiveRisk: 'High and unavoidable. Name-based screening produces many false positives, especially for common ' +
            'names and transliterations. The control is designed around that: it suspends rather than rejects, ' +
            'so a false positive is a delay rather than a lost customer.',
        policyBasis: 'Sanctions screening obligation. Applicable lists and the reporting route are UNCONFIRMED pending the ' +
            'filing; the MVP screens against a clearly labelled SIMULATED list only.',
        evaluate: (input, params) => {
            const s = input.screening.sanctions;
            const potential = Number(params['potentialMatchThreshold'] ?? 80);
            const hit = s.status === 'potential_match' || s.status === 'confirmed_match'
                || (s.highestScore !== null && s.highestScore >= potential);
            return {
                triggered: hit,
                severity: s.status === 'confirmed_match' ? 'prohibited' : 'high',
                action: s.status === 'confirmed_match' ? 'reject' : 'suspend',
                message: hit
                    ? `Sanctions screening returned ${s.status}${s.highestScore !== null ? ` at score ${s.highestScore}` : ''}${s.matchedNames.length ? ` against ${s.matchedNames.join(', ')}` : ''}.`
                    : `Sanctions screening returned ${s.status}.`,
                dataUsed: {
                    status: s.status, highest_score: s.highestScore,
                    matched_names: s.matchedNames, threshold: potential,
                },
            };
        },
    },
    {
        key: 'PEP_EXPOSURE',
        version: 1,
        name: 'Politically exposed person identified',
        category: 'pep',
        appliesTo: ['transaction', 'organization', 'beneficiary'],
        severity: 'high',
        onTrigger: 'enhanced_due_diligence',
        parameters: {},
        riskAddressed: 'Elevated corruption and proceeds-of-crime risk where a controller of the business, or the ' +
            'beneficiary, holds or held prominent public function.',
        triggerCondition: 'PEP screening or a self-declaration identifies a PEP among the screened parties.',
        requiredEvidence: 'The PEP screening result, the declaration, and source-of-wealth evidence.',
        automatedAction: 'The case is routed to enhanced due diligence and cannot be cleared by an analyst alone.',
        humanDecision: 'A Compliance Manager approves or declines the relationship after enhanced due diligence, ' +
            'including source of wealth.',
        falsePositiveRisk: 'Moderate. PEP lists include family members and close associates, and name matching is imprecise. ' +
            'A PEP relationship is not prohibited — it requires senior approval and closer monitoring.',
        policyBasis: 'Enhanced due diligence for politically exposed persons. Nigerian definition and senior-approval ' +
            'requirement UNCONFIRMED pending the filing.',
        evaluate: (input) => {
            const p = input.screening.pep;
            return {
                triggered: p.isPep || p.status === 'potential_match' || p.status === 'confirmed_match',
                message: p.isPep || p.status !== 'clear'
                    ? `PEP exposure identified (${p.status}${p.categories.length ? `; categories: ${p.categories.join(', ')}` : ''}). Enhanced due diligence and manager approval required.`
                    : 'No PEP exposure identified.',
                dataUsed: { status: p.status, is_pep: p.isPep, categories: p.categories },
            };
        },
    },
    {
        key: 'ADVERSE_MEDIA_FLAG',
        version: 1,
        name: 'Adverse media flag',
        category: 'adverse_media',
        appliesTo: ['transaction', 'organization', 'beneficiary'],
        severity: 'medium',
        onTrigger: 'manual_review',
        parameters: {},
        riskAddressed: 'Publicly reported financial crime, fraud or regulatory action involving the customer or ' +
            'beneficiary that no list would capture.',
        triggerCondition: 'Adverse-media screening returns a flag.',
        requiredEvidence: 'The screening result and the analyst\'s assessment of the underlying reporting.',
        automatedAction: 'Held for manual review.',
        humanDecision: 'An analyst assesses relevance, recency and credibility, and records a reasoned disposition.',
        falsePositiveRisk: 'High. Adverse media matching frequently surfaces unrelated individuals of the same name, or ' +
            'reporting that is stale or unfounded. It is an input to judgement, never a decision.',
        policyBasis: 'Ongoing due diligence and reputational risk assessment.',
        evaluate: (input) => {
            const a = input.screening.adverseMedia;
            return {
                triggered: a.flagged,
                message: a.flagged
                    ? `Adverse media flagged${a.topics.length ? ` on: ${a.topics.join(', ')}` : ''}.`
                    : 'No adverse media flagged.',
                dataUsed: { status: a.status, flagged: a.flagged, topics: a.topics },
            };
        },
    },
    {
        key: 'HIGH_RISK_JURISDICTION',
        version: 1,
        name: 'High-risk jurisdiction involved',
        category: 'jurisdiction',
        appliesTo: ['transaction', 'organization', 'beneficiary'],
        severity: 'high',
        onTrigger: 'enhanced_due_diligence',
        parameters: { jurisdictions: DEFAULT_HIGH_RISK_JURISDICTIONS },
        riskAddressed: 'Exposure to jurisdictions subject to call-for-action or increased-monitoring designations, or ' +
            'to a destination-market restriction.',
        triggerCondition: 'The customer jurisdiction, beneficiary country or beneficiary bank country appears in the ' +
            'configured high-risk list.',
        requiredEvidence: 'Jurisdiction fields and the list version in force at evaluation.',
        automatedAction: 'Routed to enhanced due diligence.',
        humanDecision: 'A Compliance Manager decides whether the relationship may proceed and on what terms.',
        falsePositiveRisk: 'Low mechanically. The real risk is the opposite: an out-of-date list produces false NEGATIVES, ' +
            'which is why the list is a versioned rule parameter with an explicit review cadence.',
        policyBasis: 'Enhanced measures for higher-risk jurisdictions. THE LIST IS DELIBERATELY EMPTY IN THIS BUILD: ' +
            'naming jurisdictions would assert a regulatory fact the filing has not supplied (FD-005).',
        evaluate: (input, params) => {
            const list = (params['jurisdictions'] ?? []).map((s) => s.toUpperCase());
            const candidates = [
                input.organization.jurisdiction,
                input.beneficiary?.country ?? null,
                input.beneficiary?.bankAccountCountry ?? null,
                input.corridor.destinationCountry,
            ].filter((x) => typeof x === 'string');
            const hits = candidates.filter((c) => list.includes(c.toUpperCase()));
            return {
                triggered: hits.length > 0,
                message: hits.length > 0
                    ? `High-risk jurisdiction(s) involved: ${hits.join(', ')}.`
                    : list.length === 0
                        ? 'No high-risk jurisdiction list is configured. This rule cannot fire until FD-005 supplies one.'
                        : 'No high-risk jurisdiction involved.',
                dataUsed: { checked: candidates, list_size: list.length, hits },
            };
        },
    },
    {
        key: 'HIGH_RISK_INDUSTRY',
        version: 1,
        name: 'High-risk industry',
        category: 'industry',
        appliesTo: ['transaction', 'organization'],
        severity: 'medium',
        onTrigger: 'enhanced_due_diligence',
        parameters: { industries: DEFAULT_HIGH_RISK_INDUSTRIES },
        riskAddressed: 'Sectors with elevated inherent money-laundering or sanctions-evasion risk.',
        triggerCondition: 'The customer\'s declared industry code appears in the configured list.',
        requiredEvidence: 'The KYB profile industry field and supporting business-activity evidence.',
        automatedAction: 'Routed to enhanced due diligence.',
        humanDecision: 'A manager decides on acceptance and on any additional monitoring.',
        falsePositiveRisk: 'Moderate. Self-declared industry codes are coarse and customers frequently pick the nearest ' +
            'match rather than the accurate one.',
        policyBasis: 'Business-wide risk assessment; sector risk. Sector list is an internal control, not a citation.',
        evaluate: (input, params) => {
            const list = (params['industries'] ?? []).map((s) => s.toLowerCase());
            const industry = (input.organization.industryCode ?? '').toLowerCase();
            const hit = industry !== '' && list.includes(industry);
            return {
                triggered: hit,
                message: hit
                    ? `Declared industry "${industry}" is on the higher-risk list.`
                    : `Declared industry "${industry || 'not stated'}" is not on the higher-risk list.`,
                dataUsed: { industry, list_size: list.length },
            };
        },
    },
    // -------------------------------------------------------------------------
    // Behavioural and profile consistency
    // -------------------------------------------------------------------------
    {
        key: 'AMOUNT_INCONSISTENT_WITH_PROFILE',
        version: 1,
        name: 'Amount inconsistent with the declared business profile',
        category: 'behavioural',
        appliesTo: ['transaction'],
        severity: 'medium',
        onTrigger: 'manual_review',
        parameters: { multipleOfDeclaredSize: 3 },
        riskAddressed: 'A business transacting far outside what it told us to expect. The gap is either a KYB failure ' +
            '(the profile was wrong) or a red flag (the account is being used for something else).',
        triggerCondition: 'Send amount exceeds the declared expected transaction size by the configured multiple.',
        requiredEvidence: 'The declared expected size from the KYB profile and the transaction amount.',
        automatedAction: 'Held for manual review.',
        humanDecision: 'An analyst either updates the customer profile with evidence, or treats the divergence as an alert.',
        falsePositiveRisk: 'High for growing businesses, and for customers who guessed when completing onboarding. This is a ' +
            'prompt to re-baseline the profile as often as it is a genuine alert.',
        policyBasis: 'Transaction monitoring against expected customer activity.',
        evaluate: (input, params) => {
            const t = input.transaction;
            const expected = dec(input.organization.expectedTransactionSize);
            if (!t || expected === null || expected.isZero()) {
                return notTriggered('No declared expected transaction size to compare against.');
            }
            if (input.organization.expectedTxnCurrency !== t.sendCurrency) {
                return notTriggered(`Declared size is in ${input.organization.expectedTxnCurrency}; transaction is in ${t.sendCurrency}. Not comparable without a recorded rate.`);
            }
            const multiple = Number(params['multipleOfDeclaredSize'] ?? 3);
            const threshold = expected.multiply(Decimal.fromString(multiple.toFixed(6)), 'half_even', expected.scale);
            const amount = Decimal.fromString(t.sendAmount);
            const over = amount.greaterThan(threshold);
            return {
                triggered: over,
                message: over
                    ? `Amount ${amount.toString()} is more than ${multiple}x the declared expected size of ${expected.toString()}.`
                    : `Amount is consistent with the declared expected size.`,
                dataUsed: {
                    amount: amount.toString(), declared_expected: expected.toString(),
                    multiple, threshold: threshold.toString(),
                },
            };
        },
    },
    {
        key: 'UNUSUAL_AMOUNT_FOR_CUSTOMER',
        version: 1,
        name: 'Unusual amount relative to this customer\'s own history',
        category: 'behavioural',
        appliesTo: ['transaction'],
        severity: 'low',
        onTrigger: 'manual_review',
        parameters: { multipleOfRecentMaximum: 5, minimumHistoryCount: 3 },
        riskAddressed: 'A sudden step change in a customer\'s transaction size, which can indicate account takeover or ' +
            'a change in the underlying business that due diligence has not caught up with.',
        triggerCondition: 'The amount exceeds the customer\'s largest recent transaction by the configured multiple, once ' +
            'there is enough history to make the comparison meaningful.',
        requiredEvidence: 'The customer\'s recent transaction amounts.',
        automatedAction: 'Held for manual review.',
        humanDecision: 'An analyst checks the supporting trade documents against the amount.',
        falsePositiveRisk: 'High for new customers and for lumpy trade flows. Suppressed below the minimum history count for ' +
            'exactly that reason.',
        policyBasis: 'Behavioural transaction monitoring.',
        evaluate: (input, params) => {
            const t = input.transaction;
            const history = input.velocity.recentAmounts.map((a) => Decimal.fromString(a));
            const minCount = Number(params['minimumHistoryCount'] ?? 3);
            if (!t || history.length < minCount) {
                return notTriggered(`Insufficient history (${history.length} of ${minCount} required) to judge what is unusual.`);
            }
            const max = history.reduce((a, b) => (a.greaterThan(b) ? a : b));
            const multiple = Number(params['multipleOfRecentMaximum'] ?? 5);
            const threshold = max.multiply(Decimal.fromString(multiple.toFixed(6)), 'half_even', max.scale);
            const amount = Decimal.fromString(t.sendAmount);
            const over = amount.greaterThan(threshold);
            return {
                triggered: over,
                message: over
                    ? `Amount ${amount.toString()} exceeds ${multiple}x the customer's recent maximum of ${max.toString()}.`
                    : 'Amount is in line with the customer\'s recent activity.',
                dataUsed: {
                    amount: amount.toString(), recent_maximum: max.toString(),
                    history_count: history.length, multiple,
                },
            };
        },
    },
    // -------------------------------------------------------------------------
    // Documentation
    // -------------------------------------------------------------------------
    {
        key: 'SOURCE_OF_FUNDS_INCOMPLETE',
        version: 1,
        name: 'Source-of-funds evidence is incomplete',
        category: 'documentation',
        appliesTo: ['transaction'],
        severity: 'high',
        onTrigger: 'manual_review',
        parameters: { minimumNarrativeLength: 20 },
        riskAddressed: 'Settling funds whose origin has not been evidenced. Without it there is no defence to a later ' +
            'allegation that the platform handled criminal property.',
        triggerCondition: 'No source-of-funds document is linked, or the narrative is missing or too short to be meaningful.',
        requiredEvidence: 'A source-of-funds document and a substantive written narrative.',
        automatedAction: 'The transaction cannot leave compliance review.',
        humanDecision: 'An analyst requests the evidence and re-reviews once supplied.',
        falsePositiveRisk: 'Low. The rule checks presence, not adequacy — adequacy is the analyst\'s judgement, which is why ' +
            'this holds for review rather than rejecting.',
        policyBasis: 'Source of funds evidence in customer due diligence. Documentary standard UNCONFIRMED pending the filing.',
        evaluate: (input, params) => {
            const t = input.transaction;
            if (!t)
                return notTriggered('No transaction in scope.');
            const minLen = Number(params['minimumNarrativeLength'] ?? 20);
            const narrativeOk = (t.sourceOfFundsText ?? '').trim().length >= minLen;
            const evidenceOk = t.hasSourceOfFundsEvidence;
            const bad = !narrativeOk || !evidenceOk;
            return {
                triggered: bad,
                message: bad
                    ? `Source of funds incomplete: ${!evidenceOk ? 'no supporting document linked' : ''}${!evidenceOk && !narrativeOk ? '; ' : ''}${!narrativeOk ? `narrative shorter than ${minLen} characters` : ''}.`
                    : 'Source of funds narrative and supporting evidence are both present.',
                dataUsed: {
                    narrative_length: (t.sourceOfFundsText ?? '').trim().length,
                    minimum_length: minLen, has_evidence_document: evidenceOk,
                },
            };
        },
    },
    {
        key: 'TRADE_DOCUMENTS_INCOMPLETE',
        version: 1,
        name: 'Trade documentation is incomplete',
        category: 'documentation',
        appliesTo: ['transaction'],
        severity: 'medium',
        onTrigger: 'manual_review',
        parameters: { requiredRoles: ['primary_invoice'] },
        riskAddressed: 'Paying against a trade transaction with no underlying commercial documentation. Trade-based money ' +
            'laundering depends on the absence, or the falsification, of exactly these documents.',
        triggerCondition: 'A required document role is not linked to the transaction.',
        requiredEvidence: 'The linked documents and their roles.',
        automatedAction: 'Held for manual review.',
        humanDecision: 'An analyst requests the missing document and checks it against the transaction details.',
        falsePositiveRisk: 'Low mechanically, but note the rule checks that a document EXISTS, not that it is genuine. ' +
            'Document authenticity is a human judgement this system does not automate and does not claim to.',
        policyBasis: 'Trade documentation requirements for trade-related payments. Specific set UNCONFIRMED (FD-005).',
        evaluate: (input, params) => {
            const t = input.transaction;
            if (!t)
                return notTriggered('No transaction in scope.');
            const required = params['requiredRoles'] ?? ['primary_invoice'];
            const missing = required.filter((r) => !t.linkedDocumentRoles.includes(r));
            return {
                triggered: missing.length > 0,
                message: missing.length > 0
                    ? `Missing required trade document(s): ${missing.join(', ')}.`
                    : 'All required trade documents are linked.',
                dataUsed: { required, linked: t.linkedDocumentRoles, missing },
            };
        },
    },
    {
        key: 'DUPLICATE_INVOICE',
        version: 1,
        name: 'Duplicate invoice',
        category: 'documentation',
        appliesTo: ['transaction'],
        severity: 'high',
        onTrigger: 'manual_review',
        parameters: {},
        riskAddressed: 'Paying the same invoice twice — through error, through internal fraud, or as a laundering ' +
            'technique that gives illegitimate funds a commercial-looking justification.',
        triggerCondition: 'Another transaction in the same organisation shares this invoice fingerprint ' +
            '(invoice number, beneficiary, amount and currency) and has not been cancelled or rejected.',
        requiredEvidence: 'The matching transaction references and their states.',
        automatedAction: 'Held for manual review. Never auto-rejected: legitimate re-issues and part-payments exist.',
        humanDecision: 'An analyst confirms with the customer whether this is a genuine second payment.',
        falsePositiveRisk: 'Moderate. Instalment payments against one invoice, and re-submissions after a failed attempt, both ' +
            'look like duplicates.',
        policyBasis: 'Trade-based money laundering red flag; double-payment operational control.',
        evaluate: (input) => {
            const t = input.transaction;
            if (!t)
                return notTriggered('No transaction in scope.');
            const live = t.duplicateInvoiceMatches.filter((m) => !['cancelled', 'rejected', 'expired'].includes(m.state));
            return {
                triggered: live.length > 0,
                message: live.length > 0
                    ? `Invoice ${t.invoiceNumber ?? '(unnumbered)'} matches ${live.length} existing transaction(s): ${live.map((m) => `${m.reference} (${m.state})`).join(', ')}.`
                    : 'No duplicate invoice detected.',
                dataUsed: {
                    invoice_number: t.invoiceNumber,
                    matches: live.map((m) => ({ reference: m.reference, state: m.state })),
                },
            };
        },
    },
    // -------------------------------------------------------------------------
    // Fraud, related parties and devices
    // -------------------------------------------------------------------------
    {
        key: 'REUSED_BANK_DETAILS',
        version: 1,
        name: 'Bank details reused across organisations',
        category: 'fraud',
        appliesTo: ['transaction', 'beneficiary'],
        severity: 'high',
        onTrigger: 'escalate',
        parameters: { escalateAtOrgCount: 1 },
        riskAddressed: 'One account collecting from several ostensibly unconnected customers — a classic mule and ' +
            'layering pattern, and also a signal of undisclosed common control.',
        triggerCondition: 'The beneficiary bank-account fingerprint appears under another organisation\'s beneficiary.',
        requiredEvidence: 'The account fingerprint match. Note the match is made on a keyed hash: the engine never ' +
            'decrypts an account number to perform this check.',
        automatedAction: 'Escalated to a Compliance Manager.',
        humanDecision: 'A manager investigates the relationship between the organisations.',
        falsePositiveRisk: 'Real. Group companies, shared agents and common suppliers legitimately share accounts. The rule ' +
            'escalates for investigation rather than blocking.',
        policyBasis: 'Layering and mule-account detection.',
        evaluate: (input, params) => {
            const b = input.beneficiary;
            if (!b)
                return notTriggered('No beneficiary in scope.');
            const threshold = Number(params['escalateAtOrgCount'] ?? 1);
            const hit = b.sharedAccountWithOtherOrgs >= threshold;
            return {
                triggered: hit,
                message: hit
                    ? `This beneficiary bank account is also registered by ${b.sharedAccountWithOtherOrgs} other organisation(s).`
                    : 'Beneficiary bank account is not shared with another organisation.',
                dataUsed: { shared_with_other_orgs: b.sharedAccountWithOtherOrgs, threshold },
            };
        },
    },
    {
        key: 'RAPID_BENEFICIARY_CHANGE',
        version: 1,
        name: 'Beneficiary added and used unusually quickly',
        category: 'fraud',
        appliesTo: ['transaction', 'beneficiary'],
        severity: 'medium',
        onTrigger: 'manual_review',
        parameters: { minimumAgeHours: 24, recentAdditionsThreshold: 3 },
        riskAddressed: 'Business email compromise and account takeover, where an attacker adds a new beneficiary and ' +
            'pays it immediately, before anyone notices.',
        triggerCondition: 'The beneficiary is younger than the configured cooling-off period, or the organisation has added ' +
            'an unusual number of beneficiaries in the last week.',
        requiredEvidence: 'Beneficiary creation timestamp and the organisation\'s recent beneficiary additions.',
        automatedAction: 'Held for manual review.',
        humanDecision: 'An analyst confirms the beneficiary through a channel other than the one that requested it.',
        falsePositiveRisk: 'High for genuinely new trading relationships and for a customer onboarding several suppliers at once. ' +
            'The cost of the false positive is a delay; the cost of the false negative is a lost payment.',
        policyBasis: 'Payment-fraud control; new-payee cooling-off.',
        evaluate: (input, params) => {
            const b = input.beneficiary;
            if (!b)
                return notTriggered('No beneficiary in scope.');
            const minAgeHours = Number(params['minimumAgeHours'] ?? 24);
            const ageHours = (Date.parse(input.evaluatedAt) - Date.parse(b.createdAt)) / 3_600_000;
            const tooNew = ageHours < minAgeHours;
            const threshold = Number(params['recentAdditionsThreshold'] ?? 3);
            const manyRecent = b.recentBeneficiaryAdditions >= threshold;
            return {
                triggered: tooNew || manyRecent,
                message: tooNew || manyRecent
                    ? `${tooNew ? `Beneficiary is ${ageHours.toFixed(1)}h old, inside the ${minAgeHours}h cooling-off period. ` : ''}${manyRecent ? `${b.recentBeneficiaryAdditions} beneficiaries added in the last 7 days.` : ''}`.trim()
                    : 'Beneficiary is established and additions are within normal range.',
                dataUsed: {
                    age_hours: Number(ageHours.toFixed(2)), minimum_age_hours: minAgeHours,
                    recent_additions: b.recentBeneficiaryAdditions, additions_threshold: threshold,
                },
            };
        },
    },
    {
        key: 'RELATED_PARTY_TRANSACTION',
        version: 1,
        name: 'Related-party transaction',
        category: 'related_party',
        appliesTo: ['transaction', 'beneficiary'],
        severity: 'medium',
        onTrigger: 'manual_review',
        parameters: {},
        riskAddressed: 'Payments between entities under common control, which can move value with no genuine ' +
            'underlying trade and are a standard round-tripping technique.',
        triggerCondition: 'The beneficiary shares a director or ultimate beneficial owner with the sending organisation, ' +
            'or the declared relationship indicates common control.',
        requiredEvidence: 'The ownership and control registers for both parties, and the declared relationship.',
        automatedAction: 'Held for manual review.',
        humanDecision: 'An analyst confirms the commercial rationale and that the trade documentation reflects a real transaction.',
        falsePositiveRisk: 'Low as a detection, but note that related-party payments are frequently entirely legitimate — ' +
            'intra-group settlement is normal. The rule flags for context, not suspicion.',
        policyBasis: 'Related-party and round-tripping controls.',
        evaluate: (input) => {
            const b = input.beneficiary;
            if (!b)
                return notTriggered('No beneficiary in scope.');
            const declared = (b.relationshipToSender ?? '').toLowerCase();
            const declaredRelated = ['group', 'affiliate', 'subsidiary', 'parent', 'related', 'intragroup', 'intra-group']
                .some((k) => declared.includes(k));
            const triggered = b.sharesControllerWithSender || declaredRelated;
            return {
                triggered,
                message: triggered
                    ? `Related party: ${b.sharesControllerWithSender ? 'shares a controller with the sender' : ''}${b.sharesControllerWithSender && declaredRelated ? '; ' : ''}${declaredRelated ? `declared relationship is "${b.relationshipToSender}"` : ''}.`
                    : 'No related-party indicator.',
                dataUsed: {
                    shares_controller: b.sharesControllerWithSender,
                    declared_relationship: b.relationshipToSender,
                },
            };
        },
    },
    {
        key: 'SUSPICIOUS_DEVICE_OR_IP',
        version: 1,
        name: 'Suspicious device or network activity',
        category: 'device',
        appliesTo: ['transaction'],
        severity: 'medium',
        onTrigger: 'manual_review',
        parameters: { distinctIpThreshold: 5, failedLoginThreshold: 3 },
        riskAddressed: 'Account takeover. A payment instructed from an unfamiliar network, shortly after failed sign-in ' +
            'attempts, is the signature of a compromised credential being exercised.',
        triggerCondition: 'The instructing session is on a network never seen for this organisation, or the organisation has ' +
            'an unusual number of distinct networks or recent failed sign-ins.',
        requiredEvidence: 'Hashed network identifiers and the login-attempt history. Raw IP addresses are never stored.',
        automatedAction: 'Held for manual review; a security alert is raised in parallel.',
        humanDecision: 'An analyst confirms the instruction with the customer through a known channel before release.',
        falsePositiveRisk: 'High. Travel, remote working and mobile networks all produce new addresses routinely. Treated as ' +
            'a contributing signal, never as a sole basis for a decision.',
        policyBasis: 'Fraud and account-takeover monitoring.',
        evaluate: (input, params) => {
            const d = input.device;
            const ipThreshold = Number(params['distinctIpThreshold'] ?? 5);
            const failThreshold = Number(params['failedLoginThreshold'] ?? 3);
            const reasons = [];
            if (d.newIpForOrganisation)
                reasons.push('instruction from a network not previously seen for this organisation');
            if (d.distinctIpCount24h >= ipThreshold)
                reasons.push(`${d.distinctIpCount24h} distinct networks in 24h`);
            if (d.failedLogins24h >= failThreshold)
                reasons.push(`${d.failedLogins24h} failed sign-ins in 24h`);
            if (d.knownFraudSignal)
                reasons.push('device intelligence provider returned a fraud signal');
            return {
                triggered: reasons.length > 0,
                message: reasons.length > 0 ? `Device or network signals: ${reasons.join('; ')}.` : 'No device or network signals.',
                dataUsed: {
                    new_ip: d.newIpForOrganisation, distinct_ip_24h: d.distinctIpCount24h,
                    failed_logins_24h: d.failedLogins24h, fraud_signal: d.knownFraudSignal,
                    ip_threshold: ipThreshold, failed_login_threshold: failThreshold,
                },
            };
        },
    },
];
export function ruleByKey(key) {
    return RULES.find((r) => r.key === key);
}
/** Severity ordering used to compute the aggregate outcome. */
export const SEVERITY_RANK = {
    low: 0, medium: 1, high: 2, prohibited: 3,
};
/** Action precedence. A single reject beats any number of auto-continues. */
export const ACTION_RANK = {
    auto_continue: 0,
    manual_review: 1,
    enhanced_due_diligence: 2,
    escalate: 3,
    suspend: 4,
    reject: 5,
};
//# sourceMappingURL=rules.js.map