/**
 * Partner rails — provider-neutral interfaces and their simulators.
 *
 * Two rules shape this file.
 *
 * First, nothing here is vendor-specific. Every partner is reached through a narrow
 * interface (`SettlementAdapter`, `ScreeningAdapter`, and so on) and resolved by an
 * `adapter_key` stored in configuration. Replacing a provider is a configuration change
 * and a new adapter class, not a change to the settlement engine.
 *
 * Second, EVERY adapter in this build is a simulator, and each one says so in its own
 * result. `isSimulated` is not a flag the caller can forget to check: it is a required
 * field on every response type, it is written to the integration event, and it is
 * carried into the ledger and the UI.
 *
 * Idempotency is the safety property that matters most. A settlement instruction carries
 * a deterministic key derived from the transaction reference. If the same key arrives
 * twice the simulator returns the FIRST result and marks the event `duplicate_ignored` —
 * it does not pay twice. The one case that is never auto-retried is `unknown`: an
 * instruction we sent but whose outcome we never learned. That becomes a settlement
 * exception for a human, because a blind retry there is how a duplicate payment happens.
 */
import { maybeOne, one, many } from '../../db/pool.js';
import { Decimal } from '../../core/money.js';
import { randomHex, canonicalHash } from '../../core/crypto.js';
import { redact } from '../../core/redact.js';
import { environment } from '../../core/env.js';
/**
 * The failure modes a partner simulator can be asked to produce.
 *
 * Exported as a value, not only as a type, so the API can refuse a directive naming a
 * scenario no adapter implements. A directive that silently never fires is worse than a
 * rejected one: it looks like the system survived a failure it never actually saw.
 */
export const SIMULATION_SCENARIOS = [
    'success',
    'delayed_funding',
    'compliance_failure',
    'insufficient_liquidity',
    'invalid_beneficiary',
    'partner_timeout',
    'duplicate_response',
    'failed_settlement',
    'partial_settlement',
    'returned_payment',
    'reconciliation_mismatch',
];
// ---------------------------------------------------------------------------
// Simulation directives
// ---------------------------------------------------------------------------
/**
 * Resolves the scenario to apply. A directive scoped to this specific transaction wins
 * over a partner-wide one. Directives with a use count are consumed.
 */
export async function resolveScenario(ctx, operation) {
    const directive = await maybeOne(ctx.db, `SELECT id, scenario, parameters, remaining_uses
       FROM simulation_directive
      WHERE revoked_at IS NULL
        AND (partner_id = $1 OR partner_id IS NULL)
        AND (transaction_id = $2 OR transaction_id IS NULL)
        AND (operation = $3 OR operation IS NULL)
        AND (remaining_uses IS NULL OR remaining_uses > 0)
      ORDER BY (transaction_id IS NOT NULL) DESC, (operation IS NOT NULL) DESC, created_at DESC
      LIMIT 1`, [ctx.partnerId, ctx.transactionId ?? null, operation]);
    if (!directive)
        return { scenario: 'success', parameters: {}, directiveId: null };
    if (directive.remaining_uses !== null) {
        await ctx.db.query(`UPDATE simulation_directive
          SET remaining_uses = remaining_uses - 1,
              revoked_at = CASE WHEN remaining_uses - 1 <= 0 THEN now() ELSE NULL END
        WHERE id = $1`, [directive.id]);
    }
    return {
        scenario: directive.scenario,
        parameters: directive.parameters ?? {},
        directiveId: directive.id,
    };
}
// ---------------------------------------------------------------------------
// Integration event logging
// ---------------------------------------------------------------------------
export async function logIntegrationEvent(ctx, input) {
    await ctx.db.query(`INSERT INTO integration_event (
       partner_id, direction, operation, transaction_id, organization_id, correlation_id,
       idempotency_key, request_payload, response_payload, http_status, outcome,
       latency_ms, simulation_scenario
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9::jsonb,$10,$11,$12,$13)`, [
        ctx.partnerId, input.direction, input.operation, ctx.transactionId ?? null,
        ctx.organizationId ?? null, ctx.correlationId, input.idempotencyKey ?? null,
        // Redacted before storage. Account numbers and credentials never reach this table.
        input.request === undefined ? null : JSON.stringify(redact(input.request)),
        input.response === undefined ? null : JSON.stringify(redact(input.response)),
        input.httpStatus ?? null, input.outcome, input.latencyMs ?? null,
        input.scenario ?? null,
    ]);
}
// ---------------------------------------------------------------------------
// Idempotency
// ---------------------------------------------------------------------------
export class DuplicateInstructionError extends Error {
    existingState;
    code = 'DUPLICATE_INSTRUCTION';
    constructor(existingState, key) {
        super(`An instruction with idempotency key "${key}" is already ${existingState}. Refusing to send a ` +
            `second instruction: a duplicate settlement is unrecoverable in a way a delayed one is not.`);
        this.existingState = existingState;
        this.name = 'DuplicateInstructionError';
    }
}
/**
 * Claims an outbound idempotency key. Returns `first` when this caller owns the
 * instruction, or the existing record when someone got there first.
 */
export async function claimOutbound(db, input) {
    const existing = await maybeOne(db, `SELECT id, state FROM outbound_idempotency
      WHERE partner_id = $1 AND operation = $2 AND idempotency_key = $3`, [input.partnerId, input.operation, input.idempotencyKey]);
    if (existing) {
        await db.query('UPDATE outbound_idempotency SET attempt_count = attempt_count + 1, last_sent_at = now() WHERE id = $1', [existing.id]);
        return { first: false, state: existing.state, id: existing.id };
    }
    const created = await one(db, `INSERT INTO outbound_idempotency (partner_id, operation, idempotency_key, transaction_id)
     VALUES ($1,$2,$3,$4) RETURNING id`, [input.partnerId, input.operation, input.idempotencyKey, input.transactionId]);
    return { first: true, state: 'in_flight', id: created.id };
}
export async function resolveOutbound(db, id, state) {
    await db.query('UPDATE outbound_idempotency SET state = $2, resolved_at = now() WHERE id = $1', [id, state]);
}
// ---------------------------------------------------------------------------
// The settlement simulator
// ---------------------------------------------------------------------------
export class SimulatedSettlementAdapter {
    key = 'simulated_settlement_v1';
    version = '1.0.0';
    async submitSettlement(ctx, submission) {
        const started = Date.now();
        // Refuse to run at all if something has managed to enable live funds. Defence in
        // depth: this adapter is a simulator and must never be mistaken for a real rail.
        if (environment().liveFundsEnabled) {
            throw new Error('SIMULATOR_IN_LIVE_MODE: the simulated settlement adapter was invoked while live funds are ' +
                'enabled. This is a configuration fault; refusing to proceed.');
        }
        const claim = await claimOutbound(ctx.db, {
            partnerId: ctx.partnerId,
            operation: 'settlement.submit',
            idempotencyKey: submission.idempotencyKey,
            transactionId: ctx.transactionId ?? null,
        });
        if (!claim.first) {
            // A repeat of a key we already hold. Return the duplicate marker rather than
            // instructing a second payment.
            await logIntegrationEvent(ctx, {
                direction: 'outbound', operation: 'settlement.submit',
                idempotencyKey: submission.idempotencyKey,
                request: { reference: submission.transactionReference },
                response: { duplicate_of_state: claim.state },
                outcome: 'duplicate_ignored', latencyMs: Date.now() - started,
            });
            return {
                status: 'duplicate_ignored',
                partnerReference: null, settledAmount: null, settledCurrency: null,
                failureCode: 'DUPLICATE_IDEMPOTENCY_KEY',
                failureDetail: `Instruction ${submission.idempotencyKey} was already submitted and is ${claim.state}. ` +
                    `No second payment was instructed.`,
                isSimulated: true, scenario: 'duplicate_response', outcomeUnknown: claim.state === 'unknown',
                latencyMs: Date.now() - started,
            };
        }
        const { scenario, parameters } = await resolveScenario(ctx, 'settlement.submit');
        const partnerReference = `SIMPTR-${randomHex(6).toUpperCase()}`;
        let outcome;
        switch (scenario) {
            case 'partner_timeout': {
                // The dangerous case: we sent it and never heard back. Marked 'unknown', which
                // the settlement engine turns into an exception rather than a retry.
                await resolveOutbound(ctx.db, claim.id, 'unknown');
                outcome = {
                    status: 'timeout', partnerReference: null, settledAmount: null, settledCurrency: null,
                    failureCode: 'PARTNER_TIMEOUT',
                    failureDetail: 'The partner did not respond within the timeout. The instruction may or may not have been ' +
                        'received. This outcome is UNKNOWN and must be resolved by a human before any retry.',
                    isSimulated: true, scenario, outcomeUnknown: true, latencyMs: Date.now() - started,
                };
                break;
            }
            case 'insufficient_liquidity': {
                await resolveOutbound(ctx.db, claim.id, 'failed');
                outcome = {
                    status: 'rejected', partnerReference, settledAmount: null, settledCurrency: null,
                    failureCode: 'INSUFFICIENT_LIQUIDITY',
                    failureDetail: `The partner rejected the instruction for want of ${submission.currency} liquidity.`,
                    isSimulated: true, scenario, outcomeUnknown: false, latencyMs: Date.now() - started,
                };
                break;
            }
            case 'invalid_beneficiary': {
                await resolveOutbound(ctx.db, claim.id, 'failed');
                outcome = {
                    status: 'rejected', partnerReference, settledAmount: null, settledCurrency: null,
                    failureCode: 'BENEFICIARY_ACCOUNT_INVALID',
                    failureDetail: `The destination institution could not credit the account ending ${submission.beneficiaryAccountLast4}. ` +
                        `Account may be closed, dormant or miskeyed.`,
                    isSimulated: true, scenario, outcomeUnknown: false, latencyMs: Date.now() - started,
                };
                break;
            }
            case 'compliance_failure': {
                await resolveOutbound(ctx.db, claim.id, 'failed');
                outcome = {
                    status: 'rejected', partnerReference, settledAmount: null, settledCurrency: null,
                    failureCode: 'PARTNER_COMPLIANCE_REJECTION',
                    failureDetail: 'The partner institution declined the instruction following its own compliance review. ' +
                        'The partner is not obliged to say why, and typically will not.',
                    isSimulated: true, scenario, outcomeUnknown: false, latencyMs: Date.now() - started,
                };
                break;
            }
            case 'failed_settlement': {
                await resolveOutbound(ctx.db, claim.id, 'failed');
                outcome = {
                    status: 'failed', partnerReference, settledAmount: null, settledCurrency: null,
                    failureCode: 'SETTLEMENT_FAILED',
                    failureDetail: 'The partner accepted the instruction and then failed to settle it.',
                    isSimulated: true, scenario, outcomeUnknown: false, latencyMs: Date.now() - started,
                };
                break;
            }
            case 'partial_settlement': {
                const fraction = Number(parameters['fraction'] ?? 0.6);
                const settled = submission.amount.multiply(Decimal.fromString(fraction.toFixed(6)), 'down', submission.amount.scale);
                await resolveOutbound(ctx.db, claim.id, 'succeeded');
                outcome = {
                    status: 'partially_settled', partnerReference,
                    settledAmount: settled, settledCurrency: submission.currency,
                    failureCode: 'PARTIAL_SETTLEMENT',
                    failureDetail: `The partner settled ${settled.toString()} of ${submission.amount.toString()} ${submission.currency}. ` +
                        `The shortfall is not lost — it is unexplained, and goes to settlement suspense.`,
                    isSimulated: true, scenario, outcomeUnknown: false, latencyMs: Date.now() - started,
                };
                break;
            }
            case 'returned_payment': {
                await resolveOutbound(ctx.db, claim.id, 'succeeded');
                outcome = {
                    status: 'returned', partnerReference,
                    settledAmount: submission.amount, settledCurrency: submission.currency,
                    failureCode: 'PAYMENT_RETURNED',
                    failureDetail: 'The destination institution credited and then returned the funds. A return is a new event, ' +
                        'not a reversal of the original settlement.',
                    isSimulated: true, scenario, outcomeUnknown: false, latencyMs: Date.now() - started,
                };
                break;
            }
            case 'reconciliation_mismatch': {
                // Settles normally. The mismatch appears later, in the partner statement.
                await resolveOutbound(ctx.db, claim.id, 'succeeded');
                outcome = {
                    status: 'settled', partnerReference,
                    settledAmount: submission.amount, settledCurrency: submission.currency,
                    failureCode: null, failureDetail: null,
                    isSimulated: true, scenario, outcomeUnknown: false, latencyMs: Date.now() - started,
                };
                break;
            }
            case 'delayed_funding':
            case 'duplicate_response':
            case 'success':
            default: {
                await resolveOutbound(ctx.db, claim.id, 'succeeded');
                outcome = {
                    status: 'settled', partnerReference,
                    settledAmount: submission.amount, settledCurrency: submission.currency,
                    failureCode: null, failureDetail: null,
                    isSimulated: true, scenario: 'success', outcomeUnknown: false,
                    latencyMs: Date.now() - started,
                };
                break;
            }
        }
        await logIntegrationEvent(ctx, {
            direction: 'outbound',
            operation: 'settlement.submit',
            idempotencyKey: submission.idempotencyKey,
            request: {
                reference: submission.transactionReference,
                amount: submission.amount.toString(),
                currency: submission.currency,
                beneficiary_name: submission.beneficiaryName,
                // Only the display fragment ever leaves us in a log.
                beneficiary_account_last4: submission.beneficiaryAccountLast4,
                beneficiary_country: submission.beneficiaryCountry,
                purpose: submission.purpose,
            },
            response: {
                status: outcome.status, partner_reference: outcome.partnerReference,
                settled_amount: outcome.settledAmount?.toString() ?? null,
                failure_code: outcome.failureCode, simulated: true,
            },
            httpStatus: outcome.status === 'timeout' ? null : outcome.status === 'settled' ? 200 : 422,
            outcome: outcome.status === 'timeout' ? 'timeout'
                : outcome.status === 'settled' || outcome.status === 'partially_settled' ? 'success'
                    : scenario === 'success' ? 'success' : 'simulated_failure',
            latencyMs: outcome.latencyMs,
            scenario,
        });
        return outcome;
    }
    async confirmFunding(ctx, expected, currency, reference) {
        const { scenario, parameters } = await resolveScenario(ctx, 'funding.confirm');
        let result;
        if (scenario === 'delayed_funding') {
            result = {
                status: 'awaiting', receivedAmount: null, currency: null,
                partnerReference: null, isSimulated: true, scenario,
            };
        }
        else if (scenario === 'partial_settlement') {
            const fraction = Number(parameters['fraction'] ?? 0.5);
            result = {
                status: 'partially_received',
                receivedAmount: expected.multiply(Decimal.fromString(fraction.toFixed(6)), 'down', expected.scale),
                currency, partnerReference: `SIMFUND-${randomHex(5).toUpperCase()}`,
                isSimulated: true, scenario,
            };
        }
        else {
            result = {
                status: 'confirmed', receivedAmount: expected, currency,
                partnerReference: `SIMFUND-${randomHex(5).toUpperCase()}`,
                isSimulated: true, scenario: 'success',
            };
        }
        await logIntegrationEvent(ctx, {
            direction: 'inbound', operation: 'funding.confirm',
            request: { payment_reference: reference, expected: expected.toString(), currency },
            response: {
                status: result.status, received: result.receivedAmount?.toString() ?? null, simulated: true,
            },
            outcome: result.status === 'confirmed' ? 'success' : 'simulated_failure',
            scenario,
        });
        return result;
    }
    /**
     * Produces a statement from what the partner "believes" happened. Deliberately built
     * from the integration events rather than from our own ledger, so that reconciliation
     * genuinely compares two independently-derived views and can actually disagree.
     */
    async fetchStatement(ctx, date, currency) {
        const day = date.toISOString().slice(0, 10);
        const events = await many(ctx.db, `SELECT operation, response_payload, request_payload, occurred_at,
              simulation_scenario, transaction_id
         FROM integration_event
        WHERE partner_id = $1
          AND operation = 'settlement.submit'
          AND outcome IN ('success')
          AND occurred_at::date = $2::date
        ORDER BY occurred_at`, [ctx.partnerId, day]);
        const lines = [];
        let index = 0;
        for (const event of events) {
            const settled = event.response_payload?.['settled_amount'];
            const ref = event.request_payload?.['reference'];
            const eventCurrency = event.request_payload?.['currency'];
            if (typeof settled !== 'string' || eventCurrency !== currency)
                continue;
            let amount = Decimal.fromString(settled);
            let ourReference = typeof ref === 'string' ? ref : null;
            // The reconciliation_mismatch scenario is what makes reconciliation testable: the
            // partner's statement genuinely disagrees with our ledger.
            if (event.simulation_scenario === 'reconciliation_mismatch') {
                amount = amount.subtract(Decimal.fromString('0.500000'));
            }
            lines.push({
                partnerReference: String(event.response_payload?.['partner_reference'] ?? `SIMSTMT-${index}`),
                ourReference,
                valueDate: event.occurred_at,
                direction: 'debit',
                amount,
                currency,
                narrative: `Simulated partner statement line for ${ourReference ?? 'unreferenced'}`,
            });
            index += 1;
        }
        return lines;
    }
}
// ---------------------------------------------------------------------------
// The screening simulator
// ---------------------------------------------------------------------------
/**
 * A clearly labelled fictional watchlist. These names are invented for testing. They are
 * not, and must never be replaced with, real sanctions or PEP list entries — a test
 * fixture containing real designated persons is a data-protection and accuracy problem.
 */
const SIMULATED_SANCTIONS_LIST = [
    { name: 'ORION DELTA HOLDINGS LIMITED', ref: 'SIM-SDN-0001', programme: 'SIMULATED-PROGRAMME-A' },
    { name: 'VANTAGE MERIDIAN TRADING FZE', ref: 'SIM-SDN-0002', programme: 'SIMULATED-PROGRAMME-A' },
    { name: 'ADEBAYO OLUWASEUN OKONKWO', ref: 'SIM-SDN-0003', programme: 'SIMULATED-PROGRAMME-B' },
];
const SIMULATED_PEP_LIST = [
    { name: 'CHIAMAKA NWOSU-ADEYEMI', ref: 'SIM-PEP-0001', category: 'domestic', role: 'Simulated regional official' },
    { name: 'IBRAHIM MUSA DANJUMA', ref: 'SIM-PEP-0002', category: 'domestic', role: 'Simulated state board member' },
];
const SIMULATED_ADVERSE_MEDIA = [
    { name: 'HARBOUR POINT LOGISTICS LIMITED', ref: 'SIM-AM-0001', topics: ['simulated regulatory action'] },
];
/** Token-overlap similarity. Crude on purpose: real name matching is crude too. */
function similarity(a, b) {
    const norm = (s) => s.toUpperCase().replace(/[^A-Z0-9 ]/g, ' ').split(/\s+/).filter(Boolean);
    const ta = norm(a);
    const tb = norm(b);
    if (ta.length === 0 || tb.length === 0)
        return 0;
    const setB = new Set(tb);
    const overlap = ta.filter((t) => setB.has(t)).length;
    return Math.round((overlap / Math.max(ta.length, tb.length)) * 100);
}
export class SimulatedScreeningAdapter {
    key = 'simulated_screening_v1';
    version = '1.0.0';
    async screen(ctx, request) {
        const { scenario } = await resolveScenario(ctx, 'screening.screen');
        if (scenario === 'partner_timeout') {
            await logIntegrationEvent(ctx, {
                direction: 'outbound', operation: 'screening.screen',
                request: { subject_type: request.subjectType, types: request.screeningTypes },
                outcome: 'timeout', scenario,
            });
            return {
                status: 'provider_unavailable', hits: [],
                provider: this.key, adapterVersion: this.version, isSimulated: true,
            };
        }
        const hits = [];
        if (request.screeningTypes.includes('sanctions')) {
            for (const entry of SIMULATED_SANCTIONS_LIST) {
                const score = similarity(request.name, entry.name);
                if (score >= 60) {
                    hits.push({
                        screeningType: 'sanctions', matchedName: entry.name, matchScore: score,
                        listName: 'SIMULATED-CONSOLIDATED-SANCTIONS',
                        listEntryRef: entry.ref,
                        details: {
                            programme: entry.programme,
                            note: 'FICTIONAL TEST ENTRY. Not a real designated person or entity.',
                        },
                    });
                }
            }
        }
        if (request.screeningTypes.includes('pep')) {
            for (const entry of SIMULATED_PEP_LIST) {
                const score = similarity(request.name, entry.name);
                if (score >= 60) {
                    hits.push({
                        screeningType: 'pep', matchedName: entry.name, matchScore: score,
                        listName: 'SIMULATED-PEP-REGISTER', listEntryRef: entry.ref,
                        details: {
                            category: entry.category, role: entry.role,
                            note: 'FICTIONAL TEST ENTRY. Not a real politically exposed person.',
                        },
                    });
                }
            }
        }
        if (request.screeningTypes.includes('adverse_media')) {
            for (const entry of SIMULATED_ADVERSE_MEDIA) {
                const score = similarity(request.name, entry.name);
                if (score >= 70) {
                    hits.push({
                        screeningType: 'adverse_media', matchedName: entry.name, matchScore: score,
                        listName: 'SIMULATED-ADVERSE-MEDIA', listEntryRef: entry.ref,
                        details: {
                            topics: entry.topics,
                            note: 'FICTIONAL TEST ENTRY. Not real reporting about a real person or company.',
                        },
                    });
                }
            }
        }
        const best = hits.reduce((max, h) => Math.max(max, h.matchScore), 0);
        const status = hits.length === 0 ? 'clear' : best >= 95 ? 'confirmed_match' : 'potential_match';
        await logIntegrationEvent(ctx, {
            direction: 'outbound', operation: 'screening.screen',
            request: {
                subject_type: request.subjectType, subject_id: request.subjectId,
                types: request.screeningTypes, name_hash: canonicalHash({ n: request.name }),
            },
            response: { status, hit_count: hits.length, best_score: best, simulated: true },
            httpStatus: 200, outcome: 'success', scenario,
        });
        return { status, hits, provider: this.key, adapterVersion: this.version, isSimulated: true };
    }
}
// ---------------------------------------------------------------------------
// Adapter registry
// ---------------------------------------------------------------------------
const SETTLEMENT_ADAPTERS = new Map([
    ['simulated_settlement_v1', new SimulatedSettlementAdapter()],
]);
const SCREENING_ADAPTERS = new Map([
    ['simulated_screening_v1', new SimulatedScreeningAdapter()],
]);
export function settlementAdapter(key) {
    const adapter = SETTLEMENT_ADAPTERS.get(key);
    if (!adapter) {
        throw new Error(`UNKNOWN_SETTLEMENT_ADAPTER: "${key}" is not registered. Available: ` +
            `${[...SETTLEMENT_ADAPTERS.keys()].join(', ')}. A partner cannot be routed to an adapter that ` +
            `does not exist; this is a configuration fault.`);
    }
    return adapter;
}
export function screeningAdapter(key) {
    const adapter = SCREENING_ADAPTERS.get(key);
    if (!adapter) {
        throw new Error(`UNKNOWN_SCREENING_ADAPTER: "${key}" is not registered. Available: ` +
            `${[...SCREENING_ADAPTERS.keys()].join(', ')}.`);
    }
    return adapter;
}
export function registeredAdapters() {
    return {
        settlement: [...SETTLEMENT_ADAPTERS.keys()],
        screening: [...SCREENING_ADAPTERS.keys()],
    };
}
export async function partnerByRole(db, role) {
    return maybeOne(db, `SELECT id, code, display_name, adapter_key, status
       FROM partner WHERE partner_role = $1 AND status <> 'disabled'
      ORDER BY created_at LIMIT 1`, [role]);
}
//# sourceMappingURL=adapters.js.map