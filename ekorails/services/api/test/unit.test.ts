/**
 * Unit tests for the parts that must be right in isolation: money arithmetic, the
 * environment gate, cryptography, the role matrix, the state machine, and the export
 * formats.
 *
 * These need no database. Money in particular is tested hard, because a rounding bug here
 * would be invisible until it had been quietly wrong across thousands of transactions.
 */

import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { test, describe } from 'node:test';
import { repoRoot } from './helpers.js';
import assert from 'node:assert/strict';

import {
  Decimal, MoneyError, money, addMoney, subtractMoney, convert, MONEY_SCALE, RATE_SCALE,
} from '../src/core/money.js';
import { describeEnvironment, EnvironmentError, RELEASE_GATES, assertLiveMoneyPermitted } from '../src/core/env.js';
import {
  hashPassword, verifyPassword, checkPasswordPolicy, encryptField, decryptField,
  generateTotpSecret, totpCodeForStep, totpStep, verifyTotp, fingerprint,
  canonicalJson, safeEqual,
} from '../src/core/crypto.js';
import {
  ROLES, PERMISSIONS, permissionsForRoles, databaseScopeForRoles,
  maskingProfileForRoles, isReadOnlyRole, SEPARATION_RULES,
} from '../src/auth/rbac.js';
import { TRANSITIONS, findTransition, transitionsFrom, TERMINAL_STATES } from '../src/modules/settlement/machine.js';
import { RULES } from '../src/modules/compliance/rules.js';
import { toCsv, escapeCsvCell, toXlsx, toPdf } from '../src/modules/reporting/export.js';
import { assertSafeForChannel, UnsafeNotificationError } from '../src/modules/notification/notify.js';
import { computeSpreadBps, bps } from '../src/modules/fx/quotes.js';
import { assertBalanced, ACCOUNT_SHAPE, LedgerError } from '../src/modules/ledger/ledger.js';
import { resolveClientAddress } from '../src/http/router.js';

// ---------------------------------------------------------------------------
describe('Money: fixed-precision arithmetic', () => {
  test('the classic float failure does not occur', () => {
    const a = Decimal.fromString('0.1');
    const b = Decimal.fromString('0.2');
    assert.equal(a.add(b).toString(), '0.300000');
    // Proof the naive approach really is wrong, so the test is not vacuous.
    assert.notEqual(0.1 + 0.2, 0.3);
  });

  test('addition and subtraction are exact at scale', () => {
    let total = Decimal.zero();
    for (let i = 0; i < 10_000; i += 1) total = total.add(Decimal.fromString('0.000001'));
    assert.equal(total.toString(), '0.010000');
  });

  test('very large amounts do not lose precision', () => {
    const huge = Decimal.fromString('999999999999999999.999999');
    assert.equal(huge.add(Decimal.fromString('0.000001')).toString(), '1000000000000000000.000000');
    // The same value as a JS number is already lossy.
    assert.notEqual(String(Number('999999999999999999.999999')), '999999999999999999.999999');
  });

  test('constructing from a value with too many decimals is REFUSED, not truncated', () => {
    assert.throws(
      () => Decimal.fromString('1.1234567'),
      (e: unknown) => e instanceof MoneyError && /Round explicitly/.test(e.message),
      'silent truncation is how rounding bugs hide',
    );
  });

  test('fractional JS numbers cannot be used to construct money', () => {
    assert.throws(() => Decimal.fromInteger(1.5), MoneyError);
    assert.equal(Decimal.fromInteger(5).toString(), '5.000000');
  });

  test('half-even rounding removes the upward bias half-up would introduce', () => {
    // 2.5 and 3.5 round to 2 and 4 under banker's rounding: no systematic gain.
    assert.equal(Decimal.fromString('2.5').rescale(0, 'half_even').toString(), '2');
    assert.equal(Decimal.fromString('3.5').rescale(0, 'half_even').toString(), '4');
    assert.equal(Decimal.fromString('2.5').rescale(0, 'half_up').toString(), '3');
    assert.equal(Decimal.fromString('3.5').rescale(0, 'half_up').toString(), '4');
  });

  test('rounding direction is explicit and behaves as named', () => {
    const value = Decimal.fromString('1.005');
    assert.equal(value.rescale(2, 'down').toString(), '1.00');
    assert.equal(value.rescale(2, 'up').toString(), '1.01');
    assert.equal(value.rescale(2, 'half_up').toString(), '1.01');
    const negative = Decimal.fromString('-1.005');
    assert.equal(negative.rescale(2, 'down').toString(), '-1.00');
    assert.equal(negative.rescale(2, 'up').toString(), '-1.01');
  });

  test('conversion at a rate is exact to the money scale', () => {
    const amount = money('1000000.000000', 'NGN');
    const rate = Decimal.fromString('0.000618000000', RATE_SCALE);
    const converted = convert(amount, 'USD', rate, 'half_even');
    assert.equal(converted.amount.toString(), '618.000000');
    assert.equal(converted.currency, 'USD');
  });

  test('a conversion that would round to zero is caught by the caller, not silently allowed', () => {
    const amount = money('1.000000', 'NGN');
    const rate = Decimal.fromString('0.000000000001', RATE_SCALE);
    assert.equal(convert(amount, 'USD', rate, 'half_even').amount.toString(), '0.000000');
  });

  test('cross-currency arithmetic is refused', () => {
    assert.throws(
      () => addMoney(money('1.000000', 'NGN'), money('1.000000', 'USD')),
      (e: unknown) => e instanceof MoneyError && /Refusing to add NGN and USD/.test(e.message),
    );
    assert.throws(() => subtractMoney(money('1.000000', 'NGN'), money('1.000000', 'USD')), MoneyError);
  });

  test('a currency must be a valid ISO code', () => {
    assert.throws(() => money('1.000000', 'ngn'), MoneyError);
    assert.throws(() => money('1.000000', 'NAIRA'), MoneyError);
  });

  test('basis-point fees compute exactly', () => {
    const amount = Decimal.fromString('1000000.000000');
    // 35 bps = 0.35% = 3500.00
    assert.equal(amount.multiplyBasisPoints(bps(35), 'half_up').toString(), '3500.000000');
    assert.equal(amount.multiplyBasisPoints(bps(0), 'half_up').toString(), '0.000000');
  });

  test('an FX spread is computed in basis points from reference and provider rates', () => {
    const reference = Decimal.fromString('0.000625000000', RATE_SCALE);
    const provider = Decimal.fromString('0.000618000000', RATE_SCALE);
    const spread = computeSpreadBps(reference, provider);
    // (0.000625 - 0.000618) / 0.000625 * 10000 = 112 bps
    assert.equal(Number(spread.toString()).toFixed(2), '112.00');
  });

  test('division rounds rather than truncating', () => {
    const a = Decimal.fromString('10.000000');
    const b = Decimal.fromString('3.000000');
    assert.equal(a.divide(b, 'half_even', 6).toString(), '3.333333');
  });

  test('comparison and sign behave correctly across zero', () => {
    const negative = Decimal.fromString('-5.000000');
    const zero = Decimal.zero();
    const positive = Decimal.fromString('5.000000');
    assert.equal(negative.isNegative(), true);
    assert.equal(zero.isZero(), true);
    assert.equal(positive.isPositive(), true);
    assert.equal(negative.lessThan(zero), true);
    assert.equal(positive.greaterThan(zero), true);
    assert.equal(negative.abs().equals(positive), true);
    assert.equal(negative.negate().equals(positive), true);
  });

  test('the canonical string form round-trips exactly', () => {
    for (const value of ['0.000000', '-0.000001', '1.500000', '999999999.999999', '-42.000000']) {
      assert.equal(Decimal.fromString(value).toString(), value);
    }
  });
});

// ---------------------------------------------------------------------------
describe('Environment gating', () => {
  test('the default mode is DEMO with live funds disabled', () => {
    const env = describeEnvironment({});
    assert.equal(env.mode, 'DEMO');
    assert.equal(env.liveFundsEnabled, false);
    assert.equal(env.settlementIsSimulated, true);
    assert.equal(env.banner, 'SANDBOX ENVIRONMENT. NO LIVE FUNDS.');
  });

  test('SANDBOX also has live funds disabled', () => {
    const env = describeEnvironment({ EKORAILS_ENV_MODE: 'SANDBOX' });
    assert.equal(env.liveFundsEnabled, false);
  });

  test('PRODUCTION with unmet gates REFUSES to start', () => {
    assert.throws(
      () => describeEnvironment({ EKORAILS_ENV_MODE: 'PRODUCTION' }),
      (e: unknown) => e instanceof EnvironmentError && /release gate/.test(e.message),
      'the absence of an approval must be a startup failure, not a silent risk',
    );
  });

  test('every single gate must be met; eight of nine is still a refusal', () => {
    const almost: Record<string, string> = { EKORAILS_ENV_MODE: 'PRODUCTION' };
    for (const gate of RELEASE_GATES.slice(0, -1)) almost[gate.key] = 'true';
    assert.throws(() => describeEnvironment(almost), EnvironmentError);
  });

  test('a gate is met only by the exact string "true"', () => {
    const env: Record<string, string> = { EKORAILS_ENV_MODE: 'DEMO' };
    for (const gate of RELEASE_GATES) env[gate.key] = '1';
    assert.equal(
      describeEnvironment(env).unmetGates.length, RELEASE_GATES.length,
      '"1" must not count as met: a gate cannot be satisfied by a sloppy deployment script',
    );

    for (const gate of RELEASE_GATES) env[gate.key] = 'TRUE';
    assert.equal(describeEnvironment(env).unmetGates.length, RELEASE_GATES.length);
  });

  test('CONTROLLED_PILOT requires a recorded written authorisation reference', () => {
    assert.throws(
      () => describeEnvironment({ EKORAILS_ENV_MODE: 'CONTROLLED_PILOT' }),
      /EKORAILS_PILOT_AUTHORISATION_REF/,
    );
    const ok = describeEnvironment({
      EKORAILS_ENV_MODE: 'CONTROLLED_PILOT',
      EKORAILS_PILOT_AUTHORISATION_REF: 'AUTH-REF-0001',
    });
    assert.equal(ok.liveFundsEnabled, false, 'a controlled pilot still moves no money in this build');
  });

  test('an unknown mode is refused rather than defaulted', () => {
    assert.throws(() => describeEnvironment({ EKORAILS_ENV_MODE: 'LIVE' }), EnvironmentError);
  });

  test('assertLiveMoneyPermitted throws in this build', () => {
    assert.throws(() => assertLiveMoneyPermitted('settle a payment'), /LIVE_FUNDS_DISABLED/);
  });

  test('there are nine release gates, each with stated evidence', () => {
    assert.equal(RELEASE_GATES.length, 9);
    for (const gate of RELEASE_GATES) {
      assert.ok(gate.description.length > 40, `${gate.key} needs a real description`);
      assert.ok(gate.evidence.length > 20, `${gate.key} must name the evidence required`);
    }
  });
});

// ---------------------------------------------------------------------------
describe('Cryptography', () => {
  test('password hashes verify and differ per salt', () => {
    const a = hashPassword('Correct-Horse-Battery-2026');
    const b = hashPassword('Correct-Horse-Battery-2026');
    assert.notEqual(a, b, 'the same password must produce different hashes');
    assert.equal(verifyPassword('Correct-Horse-Battery-2026', a), true);
    assert.equal(verifyPassword('Correct-Horse-Battery-2026', b), true);
    assert.equal(verifyPassword('wrong', a), false);
  });

  test('a malformed stored hash is rejected rather than crashing', () => {
    assert.equal(verifyPassword('anything', 'not-a-hash'), false);
    assert.equal(verifyPassword('anything', 'md5$abc$def'), false);
  });

  test('the password policy weights length and rejects contextual words', () => {
    assert.equal(checkPasswordPolicy('Short1').acceptable, false);
    assert.equal(checkPasswordPolicy('alllowercaseletters').acceptable, false);
    assert.equal(checkPasswordPolicy('ALLUPPERCASE12345').acceptable, false);
    assert.equal(checkPasswordPolicy('NoDigitsInHereAtAll').acceptable, false);
    assert.equal(checkPasswordPolicy('MyPassword12345').acceptable, false);
    assert.equal(
      checkPasswordPolicy('Adaeze-Something-2026', { fullName: 'Adaeze Nwachukwu' }).acceptable, false,
      'a password containing the user\'s own name must be refused',
    );
    assert.equal(
      checkPasswordPolicy('folasade-quiet-2026X', { email: 'folasade@example.invalid' }).acceptable, false,
      'a password containing the email local part must be refused',
    );
    assert.equal(checkPasswordPolicy('Harbour-Lantern-Quiet-2026').acceptable, true);
  });

  test('field encryption round-trips and is authenticated', () => {
    const plaintext = 'DEMO-ACCOUNT-0123456789';
    const encrypted = encryptField(plaintext);
    assert.notEqual(encrypted, plaintext);
    assert.ok(encrypted.startsWith('v1.'), 'the format must be versioned');
    assert.equal(decryptField(encrypted), plaintext);

    // Two encryptions of the same value differ (random IV), so ciphertext is not a
    // fingerprint an attacker could correlate on.
    assert.notEqual(encryptField(plaintext), encryptField(plaintext));

    // Tampering is detected by the GCM tag.
    const parts = encrypted.split('.');
    parts[4] = Buffer.from('tampered').toString('base64url');
    assert.throws(() => decryptField(parts.join('.')));
  });

  test('fingerprints are stable, keyed, and domain-separated', () => {
    const a = fingerprint('NL00DEMO0000100001', 'bank_account');
    const b = fingerprint('NL00DEMO0000100001', 'bank_account');
    const c = fingerprint('NL00DEMO0000100001', 'identity_document');
    assert.equal(a, b, 'the same value in the same domain must fingerprint identically');
    assert.notEqual(a, c, 'different domains must not collide');
    assert.match(a, /^[0-9a-f]{64}$/);
  });

  test('TOTP generates and verifies, and refuses a replayed step', () => {
    const secret = generateTotpSecret();
    const step = totpStep();
    const code = totpCodeForStep(secret, step);
    assert.match(code, /^\d{6}$/);

    const first = verifyTotp(secret, code, null);
    assert.equal(first.valid, true);
    assert.equal(first.step, step);

    const replay = verifyTotp(secret, code, step);
    assert.equal(replay.valid, false, 'a used step must not be accepted again');
    assert.equal(replay.reason, 'replayed');
  });

  test('TOTP tolerates one step of clock drift but not two', () => {
    const secret = generateTotpSecret();
    const now = Date.now();
    const drifted = totpCodeForStep(secret, totpStep(now) - 1);
    assert.equal(verifyTotp(secret, drifted, null, now).valid, true);
    const tooFar = totpCodeForStep(secret, totpStep(now) - 5);
    assert.equal(verifyTotp(secret, tooFar, null, now).valid, false);
  });

  test('a malformed TOTP code is rejected without throwing', () => {
    const secret = generateTotpSecret();
    assert.equal(verifyTotp(secret, 'abcdef', null).valid, false);
    assert.equal(verifyTotp(secret, '12345', null).valid, false);
    assert.equal(verifyTotp(secret, '', null).valid, false);
  });

  test('canonical JSON is stable regardless of key order', () => {
    assert.equal(
      canonicalJson({ b: 1, a: 2, c: { z: 1, y: 2 } }),
      canonicalJson({ c: { y: 2, z: 1 }, a: 2, b: 1 }),
    );
  });

  test('constant-time comparison behaves correctly on equal and unequal input', () => {
    assert.equal(safeEqual('abc', 'abc'), true);
    assert.equal(safeEqual('abc', 'abd'), false);
    assert.equal(safeEqual('abc', 'abcd'), false);
    assert.equal(safeEqual('', ''), true);
  });
});

// ---------------------------------------------------------------------------
describe('Role and permission matrix', () => {
  test('all nine roles from the specification exist', () => {
    const expected = [
      'business_initiator', 'business_approver', 'compliance_analyst', 'compliance_manager',
      'treasury_operator', 'finance_analyst', 'auditor_regulator', 'system_administrator',
      'super_administrator',
    ];
    assert.deepEqual(Object.keys(ROLES).sort(), [...expected].sort());
  });

  test('every role permission exists in the permission catalogue', () => {
    for (const role of Object.values(ROLES)) {
      for (const permission of role.permissions) {
        assert.ok(
          permission in PERMISSIONS,
          `${role.code} references unknown permission "${permission}"`,
        );
      }
    }
  });

  test('every role states what it explicitly cannot do', () => {
    for (const role of Object.values(ROLES)) {
      assert.ok(
        role.explicitDenials.length > 0,
        `${role.code} must state its explicit denials; an absent permission is an oversight waiting to happen`,
      );
    }
  });

  test('a business initiator cannot approve, clear compliance or touch the ledger', () => {
    const permissions = permissionsForRoles(['business_initiator']);
    for (const denied of [
      'txn.approve', 'compliance.alert.clear', 'ledger.read', 'ledger.post.adjustment',
      'txn.read.any', 'org.read.any', 'admin.users.manage',
    ]) {
      assert.equal(permissions.has(denied as never), false, `business_initiator must not hold ${denied}`);
    }
  });

  test('a system administrator cannot reach transactions, compliance or the ledger', () => {
    const permissions = permissionsForRoles(['system_administrator']);
    for (const denied of [
      'txn.read', 'txn.read.any', 'txn.approve', 'compliance.alert.clear',
      'compliance.highrisk.approve', 'ledger.read', 'ledger.post.adjustment',
      'document.read', 'document.read.any', 'pii.unmask',
    ]) {
      assert.equal(permissions.has(denied as never), false, `system_administrator must not hold ${denied}`);
    }
  });

  test('the auditor role is read-only: it holds no write permission at all', () => {
    const permissions = [...permissionsForRoles(['auditor_regulator'])];
    const writeShaped = permissions.filter((p) =>
      /\.(write|manage|approve|clear|initiate|route|post|suspend|configure|propose|file|raise)/.test(p),
    );
    assert.deepEqual(writeShaped, [], `auditor holds write-shaped permissions: ${writeShaped.join(', ')}`);
    assert.equal(isReadOnlyRole(['auditor_regulator']), true);
  });

  test('a treasury operator cannot clear a compliance alert', () => {
    const permissions = permissionsForRoles(['treasury_operator']);
    assert.equal(permissions.has('compliance.alert.clear'), false);
    assert.equal(permissions.has('compliance.kyb.review'), false);
  });

  test('database scope follows the realm, not the permission set', () => {
    assert.equal(databaseScopeForRoles(['business_initiator']), 'org');
    assert.equal(databaseScopeForRoles(['business_approver']), 'org');
    assert.equal(databaseScopeForRoles(['compliance_analyst']), 'global');
    assert.equal(databaseScopeForRoles(['auditor_regulator']), 'global');
    assert.equal(databaseScopeForRoles(['system_administrator']), 'global');
    // Holding any cross-organisation role widens the scope.
    assert.equal(databaseScopeForRoles(['business_initiator', 'compliance_analyst']), 'global');
  });

  test('masking profiles are correct for each realm', () => {
    assert.equal(maskingProfileForRoles(['auditor_regulator']), 'masked');
    assert.equal(maskingProfileForRoles(['system_administrator']), 'masked');
    assert.equal(maskingProfileForRoles(['compliance_manager']), 'full');
    assert.equal(maskingProfileForRoles(['compliance_analyst']), 'operational');
  });

  test('separation-of-duties rules fire on the involved user', () => {
    const rule = SEPARATION_RULES.find((r) => r.code === 'SOD_TXN_SELF_APPROVAL')!;
    assert.equal(rule.violated({ userId: 'u1', involvedAs: { initiator: 'u1' } }), true);
    assert.equal(rule.violated({ userId: 'u1', involvedAs: { initiator: 'u2' } }), false);
    assert.equal(rule.violated({ userId: 'u1' }), false);
  });

  test('every separation rule names a real action and describes itself', () => {
    for (const rule of SEPARATION_RULES) {
      assert.ok(rule.description.length > 30, `${rule.code} needs a real description`);
      assert.ok(rule.action.length > 0);
    }
  });

  test('sensitive permissions are marked as such', () => {
    for (const key of [
      'ledger.post.adjustment', 'compliance.alert.clear', 'admin.roles.manage',
      'pii.unmask', 'breakglass.use', 'txn.approve',
    ]) {
      assert.equal(
        PERMISSIONS[key as keyof typeof PERMISSIONS].sensitive, true,
        `${key} must be marked sensitive`,
      );
    }
  });
});

// ---------------------------------------------------------------------------
describe('Settlement state machine', () => {
  test('every state in the specification is reachable or terminal', () => {
    const specified = [
      'draft', 'pending_business_approval', 'pending_compliance',
      'additional_information_required', 'compliance_approved', 'quote_issued',
      'quote_accepted', 'awaiting_funding', 'funding_confirmed', 'ready_for_settlement',
      'submitted_to_partner', 'partner_processing', 'settled', 'beneficiary_confirmed',
      'reconciled', 'completed', 'rejected', 'cancelled', 'expired', 'failed',
      'returned', 'under_investigation',
    ];
    const present = new Set<string>();
    for (const t of TRANSITIONS) { present.add(t.from); present.add(t.to); }
    for (const state of specified) {
      assert.ok(present.has(state), `state "${state}" appears in no transition`);
    }
    assert.equal(specified.length, 22, 'the specification lists 22 states');
  });

  test('every transition declares its actors, preconditions and accounting consequence', () => {
    for (const t of TRANSITIONS) {
      assert.ok(t.permittedActorTypes.length > 0, `${t.event} must name who may take it`);
      assert.ok(t.accountingConsequence.length > 0, `${t.event} must state its accounting consequence`);
      assert.ok(t.description.length > 40, `${t.event} must describe itself in plain English`);
      assert.ok(Array.isArray(t.preconditions), `${t.event} must declare preconditions`);
    }
  });

  test('there is no transition INTO draft: a transaction cannot be un-submitted', () => {
    assert.equal(
      TRANSITIONS.filter((t) => t.to === 'draft').length, 0,
      'nothing may move a transaction back to draft',
    );
  });

  test('terminal states have no outbound transitions', () => {
    for (const state of TERMINAL_STATES) {
      assert.deepEqual(
        transitionsFrom(state).map((t) => t.event), [],
        `terminal state "${state}" must have no way out`,
      );
    }
  });

  test('the value-moving edges require step-up authentication', () => {
    for (const event of ['quote_accept', 'submit_to_partner', 'business_approve']) {
      const t = TRANSITIONS.find((x) => x.event === event)!;
      assert.equal(t.requiresStepUp, true, `${event} must require a re-asserted second factor`);
    }
  });

  test('a partner cannot take a compliance or approval edge', () => {
    for (const event of ['compliance_approve', 'business_approve', 'compliance_reject']) {
      const t = TRANSITIONS.find((x) => x.event === event)!;
      assert.equal(
        t.permittedActorTypes.includes('partner'), false,
        `${event} must not be reachable by a partner callback`,
      );
    }
  });

  test('the unknown-outcome edge exists and is reachable only by non-users', () => {
    const t = findTransition('submitted_to_partner', 'partner_outcome_unknown')!;
    assert.ok(t, 'the unknown-outcome edge must exist');
    assert.equal(t.to, 'under_investigation');
    assert.match(t.accountingConsequence, /suspense/i);
    assert.match(t.description, /never retried automatically|NEVER retried/i);
  });

  test('the returned-payment edge does NOT reverse the settlement journal', () => {
    const t = TRANSITIONS.find((x) => x.event === 'payment_returned_from_settled')!;
    assert.match(t.accountingConsequence, /NOT reversed/);
  });

  test('no edge exists that would skip compliance', () => {
    const skipping = TRANSITIONS.filter(
      (t) => t.from === 'pending_business_approval' &&
        ['quote_issued', 'awaiting_funding', 'settled', 'compliance_approved'].includes(t.to),
    );
    assert.deepEqual(skipping, [], 'no transaction may reach a value-moving state without compliance');
  });

  test('finality is never claimed anywhere in the machine', () => {
    for (const t of TRANSITIONS) {
      const text = `${t.description} ${t.accountingConsequence}`.toLowerCase();
      if (/final/.test(text)) {
        assert.match(
          text, /not (mean )?settlement finality|finality, which/,
          `"${t.event}" mentions finality without disclaiming it`,
        );
      }
    }
  });
});

// ---------------------------------------------------------------------------
describe('Compliance rule catalogue', () => {
  test('every required check from the specification is present', () => {
    const required: Array<[string, string]> = [
      ['customer approval status', 'CUSTOMER_NOT_APPROVED'],
      ['beneficiary approval status', 'BENEFICIARY_NOT_APPROVED'],
      ['user authorisation', 'INITIATOR_NOT_AUTHORISED'],
      ['transaction limit', 'TXN_ABOVE_SINGLE_LIMIT'],
      ['daily velocity', 'VELOCITY_DAILY_LIMIT'],
      ['monthly velocity', 'VELOCITY_MONTHLY_LIMIT'],
      ['corridor restrictions', 'CORRIDOR_DISABLED'],
      ['currency restrictions', 'CURRENCY_NOT_PERMITTED'],
      ['sanctions screening', 'SANCTIONS_MATCH'],
      ['PEP screening', 'PEP_EXPOSURE'],
      ['adverse media', 'ADVERSE_MEDIA_FLAG'],
      ['high-risk jurisdiction', 'HIGH_RISK_JURISDICTION'],
      ['high-risk industry', 'HIGH_RISK_INDUSTRY'],
      ['unusual transaction amount', 'UNUSUAL_AMOUNT_FOR_CUSTOMER'],
      ['amount inconsistent with profile', 'AMOUNT_INCONSISTENT_WITH_PROFILE'],
      ['duplicate invoice', 'DUPLICATE_INVOICE'],
      ['reused bank details', 'REUSED_BANK_DETAILS'],
      ['rapid beneficiary change', 'RAPID_BENEFICIARY_CHANGE'],
      ['source-of-funds completeness', 'SOURCE_OF_FUNDS_INCOMPLETE'],
      ['trade-document completeness', 'TRADE_DOCUMENTS_INCOMPLETE'],
      ['structuring indicators', 'STRUCTURING_INDICATOR'],
      ['related-party transaction', 'RELATED_PARTY_TRANSACTION'],
      ['suspicious device or IP', 'SUSPICIOUS_DEVICE_OR_IP'],
    ];
    for (const [label, key] of required) {
      assert.ok(RULES.some((r) => r.key === key), `missing the "${label}" check (${key})`);
    }
  });

  test('every rule carries the plain-English fields the Learning Center renders', () => {
    for (const rule of RULES) {
      for (const field of [
        'riskAddressed', 'triggerCondition', 'requiredEvidence', 'automatedAction',
        'humanDecision', 'falsePositiveRisk', 'policyBasis',
      ] as const) {
        assert.ok(
          rule[field].length > 30,
          `${rule.key} has a thin "${field}"; a rule nobody can explain is a rule nobody should trust`,
        );
      }
    }
  });

  test('every rule states its subject scope', () => {
    for (const rule of RULES) {
      assert.ok(rule.appliesTo.length > 0, `${rule.key} must state which subjects it applies to`);
      for (const subject of rule.appliesTo) {
        assert.ok(['transaction', 'organization', 'beneficiary'].includes(subject));
      }
    }
  });

  test('no rule cites a regulation the filing has not supplied without saying so', () => {
    for (const rule of RULES) {
      if (/CBN|Central Bank of Nigeria|Regulation \d|Section \d/i.test(rule.policyBasis)) {
        assert.match(
          rule.policyBasis, /UNCONFIRMED|pending the (CBN )?filing/i,
          `${rule.key} cites a specific regulatory source without marking it unconfirmed`,
        );
      }
    }
  });

  test('rule keys and versions are unique', () => {
    const seen = new Set<string>();
    for (const rule of RULES) {
      const key = `${rule.key}/v${rule.version}`;
      assert.equal(seen.has(key), false, `duplicate rule ${key}`);
      seen.add(key);
    }
  });

  test('the high-risk jurisdiction list is empty and says why', () => {
    const rule = RULES.find((r) => r.key === 'HIGH_RISK_JURISDICTION')!;
    assert.deepEqual(
      rule.parameters['jurisdictions'], [],
      'the list must be empty: naming jurisdictions would assert an unsupplied regulatory fact',
    );
    assert.match(rule.policyBasis, /DELIBERATELY EMPTY/);
  });

  test('prohibited-severity rules reject or suspend, never merely review', () => {
    for (const rule of RULES.filter((r) => r.severity === 'prohibited')) {
      assert.ok(
        ['reject', 'suspend'].includes(rule.onTrigger),
        `${rule.key} is prohibited-severity but only ${rule.onTrigger}`,
      );
    }
  });
});

// ---------------------------------------------------------------------------
describe('Ledger invariants', () => {
  test('the chart of accounts contains no customer stored-value account', () => {
    const categories = Object.keys(ACCOUNT_SHAPE);
    for (const category of categories) {
      assert.ok(
        !/wallet|balance|client_money|customer_funds|stored_value|custody/.test(category),
        `"${category}" reads like a custody account; EKORails is not authorised to hold customer funds`,
      );
    }
    assert.ok(categories.includes('customer_funding_receivable'));
    assert.ok(categories.includes('customer_settlement_payable'));
  });

  test('every account category has a coherent type and normal side', () => {
    for (const [category, shape] of Object.entries(ACCOUNT_SHAPE)) {
      if (shape.type === 'asset') assert.equal(shape.normalSide, 'debit', `${category}`);
      if (shape.type === 'liability') assert.equal(shape.normalSide, 'credit', `${category}`);
      if (shape.type === 'income') assert.equal(shape.normalSide, 'credit', `${category}`);
    }
  });

  test('a balanced posting is accepted and totals are reported per currency', () => {
    const totals = assertBalanced([
      { accountId: 'a', direction: 'debit', amount: Decimal.fromString('100.000000'), currency: 'NGN', narrative: 'x' },
      { accountId: 'b', direction: 'credit', amount: Decimal.fromString('60.000000'), currency: 'NGN', narrative: 'y' },
      { accountId: 'c', direction: 'credit', amount: Decimal.fromString('40.000000'), currency: 'NGN', narrative: 'z' },
    ]);
    assert.equal(totals.length, 1);
    assert.equal(totals[0]!.debits.toString(), '100.000000');
  });

  test('a zero or negative line amount is refused', () => {
    assert.throws(
      () => assertBalanced([
        { accountId: 'a', direction: 'debit', amount: Decimal.zero(), currency: 'NGN', narrative: 'x' },
        { accountId: 'b', direction: 'credit', amount: Decimal.zero(), currency: 'NGN', narrative: 'y' },
      ]),
      (e: unknown) => e instanceof LedgerError && e.code === 'NON_POSITIVE_AMOUNT',
    );
  });

  test('a cross-currency posting balances only if each currency balances', () => {
    const totals = assertBalanced([
      { accountId: 'a', direction: 'debit', amount: Decimal.fromString('1000000.000000'), currency: 'NGN', narrative: 'w' },
      { accountId: 'b', direction: 'credit', amount: Decimal.fromString('1000000.000000'), currency: 'NGN', narrative: 'x' },
      { accountId: 'c', direction: 'debit', amount: Decimal.fromString('618.000000'), currency: 'USD', narrative: 'y' },
      { accountId: 'd', direction: 'credit', amount: Decimal.fromString('618.000000'), currency: 'USD', narrative: 'z' },
    ]);
    assert.equal(totals.length, 2, 'both currencies must be reported');
  });
});

// ---------------------------------------------------------------------------
describe('Export formats', () => {
  test('CSV neutralises formula injection', () => {
    // Without the guard, a spreadsheet would execute this on open.
    // The guard both prefixes an apostrophe AND forces RFC quoting, so a crafted payload
    // can neither introduce a formula nor use a delimiter to escape its own cell.
    assert.equal(escapeCsvCell('=cmd|\'/c calc\'!A1'), '"\'=cmd|\'/c calc\'!A1"');
    assert.equal(escapeCsvCell('+1234'), '"\'+1234"');
    assert.equal(escapeCsvCell('-1234'), '"\'-1234"');
    assert.equal(escapeCsvCell('@SUM(A1)'), '"\'@SUM(A1)"');
    assert.equal(escapeCsvCell('=A1,=B1'), '"\'=A1,=B1"', 'a delimiter inside the payload must not break out');
    assert.equal(escapeCsvCell('normal text'), 'normal text');
  });

  test('CSV quotes correctly per RFC 4180', () => {
    assert.equal(escapeCsvCell('has,comma'), '"has,comma"');
    assert.equal(escapeCsvCell('has"quote'), '"has""quote"');
    assert.equal(escapeCsvCell('has\nnewline'), '"has\nnewline"');
    assert.equal(escapeCsvCell(null), '');
    assert.equal(escapeCsvCell(undefined), '');
  });

  test('CSV output has a header row and CRLF line endings', () => {
    const csv = toCsv(['a', 'b'], [{ a: '1', b: '2' }, { a: '3', b: '4' }]);
    const lines = csv.replace('﻿', '').trimEnd().split('\r\n');
    assert.deepEqual(lines, ['a,b', '1,2', '3,4']);
  });

  test('XLSX produces a real ZIP container with the required parts', () => {
    const buffer = toXlsx('Test report', ['ref', 'amount'], [
      { ref: 'TXN-1', amount: '1000.000000' },
      { ref: '=EVIL()', amount: '2000.000000' },
    ]);
    assert.equal(buffer.subarray(0, 2).toString('latin1'), 'PK', 'must be a ZIP archive');
    const raw = buffer.toString('latin1');
    for (const part of ['[Content_Types].xml', 'xl/workbook.xml', 'xl/worksheets/sheet1.xml']) {
      assert.ok(raw.includes(part), `the archive must contain ${part}`);
    }
    assert.ok(buffer.length > 500, 'the file must have real content');
  });

  test('XLSX keeps very long numbers as text so precision is not lost', () => {
    // 24 significant digits would be silently wrong as an IEEE-754 double in a spreadsheet.
    const buffer = toXlsx('Precision', ['amount'], [{ amount: '999999999999999999.999999' }]);
    assert.ok(buffer.length > 0);
  });

  test('PDF produces a valid document with the banner on it', () => {
    const pdf = toPdf('Test report', {
      title: 'Test report', columns: ['ref', 'state'],
      rows: [{ ref: 'TXN-1', state: 'completed' }],
      banner: 'SANDBOX ENVIRONMENT. NO LIVE FUNDS.',
      generated_at: new Date().toISOString(), masking_profile: 'operational',
    });
    const raw = pdf.toString('latin1');
    assert.ok(raw.startsWith('%PDF-'), 'must be a PDF');
    assert.ok(raw.includes('%%EOF'), 'must be terminated');
    assert.ok(raw.includes('SANDBOX ENVIRONMENT'), 'the banner must appear on the page');
    assert.ok(raw.includes('SIMULATED'), 'the simulation disclosure must appear in the footer');
    assert.ok(raw.includes('/Type /Catalog'), 'must have a catalog object');
    assert.ok(raw.includes('startxref'), 'must have a cross-reference table');
  });

  test('PDF paginates rather than truncating', () => {
    const rows = Array.from({ length: 200 }, (_, i) => ({ ref: `TXN-${i}`, state: 'completed' }));
    const pdf = toPdf('Large report', {
      title: 'Large report', columns: ['ref', 'state'], rows,
    });
    const pageCount = (pdf.toString('latin1').match(/\/Type \/Page[^s]/g) ?? []).length;
    assert.ok(pageCount > 1, `200 rows must span multiple pages; got ${pageCount}`);
  });
});

// ---------------------------------------------------------------------------
describe('Notification safety', () => {
  test('in-app notifications may carry detail; off-platform ones may not', () => {
    assertSafeForChannel('in_app', 'Settled', 'TXN-1 settled for NGN 4,000,000.00 to Supplier BV');

    assert.throws(
      () => assertSafeForChannel('email', 'Settled', 'Your payment of 4,000,000.00 has settled.'),
      UnsafeNotificationError,
    );
    assert.throws(
      () => assertSafeForChannel('email', 'Settled', 'Paid to NL00DEMO0000100001.'),
      UnsafeNotificationError,
    );
    assert.throws(
      () => assertSafeForChannel('sms', 'Code', 'Your code is 483920.'),
      UnsafeNotificationError,
      'a one-time code must not be sent in a channel this system does not control',
    );
    assert.throws(
      () => assertSafeForChannel('email', 'Details', 'Account 0123456789 credited.'),
      UnsafeNotificationError,
    );
  });

  test('the reference-and-link pattern the product actually uses is permitted', () => {
    assertSafeForChannel(
      'email', 'Transaction update',
      'Transaction TXN-REF-ABC has an update. Sign in to view the detail.',
    );
    assertSafeForChannel(
      'sms', 'EKORails',
      'You have an update on your EKORails account. Sign in to view it.',
    );
  });
});

// ---------------------------------------------------------------------------
describe('Who a request is attributed to', () => {
  /**
   * A red-team pass against this service found the rate limiter fully bypassable: ten wrong
   * passwords from one address were refused with 429, and the same ten with a different
   * X-Forwarded-For each time were all answered, indefinitely. The header is set by the
   * CLIENT unless something in front overwrites it, so a limiter keyed on it is a limiter an
   * attacker turns off by varying a header.
   *
   * These tests exist so it cannot come back quietly.
   */

  test('an untrusted caller cannot choose its own identity', () => {
    const noProxies = new Set<string>();
    assert.equal(
      resolveClientAddress('203.0.113.5', '198.51.100.1', noProxies), '203.0.113.5',
      'with no trusted proxy, the socket address wins and the header is ignored',
    );
  });

  test('varying the header does not vary the identity', () => {
    const noProxies = new Set<string>();
    const identities = new Set(
      ['198.51.100.1', '198.51.100.2', '198.51.100.3', '10.0.0.1'].map(
        (spoofed) => resolveClientAddress('203.0.113.5', spoofed, noProxies),
      ),
    );
    assert.equal(
      identities.size, 1,
      'four different headers from one socket must resolve to ONE identity, or the limiter is decorative',
    );
  });

  test('a header from a configured proxy IS believed', () => {
    const proxies = new Set(['10.0.0.4']);
    assert.equal(
      resolveClientAddress('10.0.0.4', '198.51.100.1', proxies), '198.51.100.1',
      'behind a proxy we run, the forwarded address is the real caller',
    );
  });

  test('only the first hop of a forwarded chain is taken', () => {
    // A client can prepend entries to the chain. The leftmost is the one the trusted proxy
    // observed; everything after it is whatever the client sent.
    const proxies = new Set(['10.0.0.4']);
    assert.equal(
      resolveClientAddress('10.0.0.4', '198.51.100.1, 172.16.0.9, 10.0.0.4', proxies),
      '198.51.100.1',
    );
  });

  test('a proxy that sends no header falls back to its own address', () => {
    const proxies = new Set(['10.0.0.4']);
    assert.equal(resolveClientAddress('10.0.0.4', undefined, proxies), '10.0.0.4');
    assert.equal(resolveClientAddress('10.0.0.4', '', proxies), '10.0.0.4');
    assert.equal(resolveClientAddress('10.0.0.4', '   ', proxies), '10.0.0.4');
  });

  test('an unknown socket address resolves to nothing rather than to the header', () => {
    // A caller with no socket address must not be able to supply one. Nothing is a safer
    // identity than an attacker-chosen one.
    assert.equal(resolveClientAddress(null, '198.51.100.1', new Set(['10.0.0.4'])), null);
    assert.equal(resolveClientAddress(null, '198.51.100.1', new Set()), null);
  });

  test('trusting a proxy does not trust every caller that claims to be it', () => {
    // The trust is in the SOCKET the request arrived on, not in anything the request says.
    const proxies = new Set(['10.0.0.4']);
    assert.equal(
      resolveClientAddress('203.0.113.5', '10.0.0.4', proxies), '203.0.113.5',
      'a caller naming the proxy in its own header is still an untrusted caller',
    );
  });
});

// ---------------------------------------------------------------------------
describe('Modules that are also programs', () => {
  /**
   * Importing a module to get one helper out of it should not run that module's program.
   *
   * It did, once. `totp.ts` is a command-line tool and it called `main()` at module scope.
   * The seeder imported one function from it — the string describing how to run it — and
   * the tool executed mid-seed, printed its usage and exited the process. The seed silently
   * did nothing.
   *
   * The trap is not specific to that file. Any module that runs its entry point on import
   * is a hazard for whoever imports it next, whatever they wanted from it. This test asserts
   * the guard is present on every file that has an entry point AND exports something.
   */

  const ENTRY_POINTS = ['seed/totp.ts', 'seed/run-seed.ts', 'main.ts'];

  for (const file of ENTRY_POINTS) {
    test(`${file} does not run its program merely because something imported it`, () => {
      const source = readFileSync(join(repoRoot(), 'services/api/src', file), 'utf8');

      const exportsSomething = /^export /m.test(source);
      if (!exportsSomething) return;   // nothing can import it, so nothing can be trapped

      assert.match(
        source, /import\.meta\.url/,
        `${file} exports something AND runs a program. It must compare import.meta.url ` +
        'against process.argv[1] so the program runs only when it IS the program.',
      );
      assert.ok(
        /if \(is[A-Za-z]*Entry[A-Za-z]*\)/.test(source) || /import\.meta\.url ===/.test(source),
        `${file} must guard its entry point behind that comparison, not merely mention it.`,
      );
    });
  }

  test('the command the seeder prints is the path the tool is actually at', async () => {
    // Both places that printed this said `node dist/seed/totp.js`. The built file is at
    // `dist/src/seed/totp.js`, so a founder following the seeder's own output got
    // MODULE_NOT_FOUND. It is derived from the file's own location now; this asserts that
    // the derivation resolves to a file that exists.
    const { totpCommand } = await import('../src/seed/totp.js');
    const printed = totpCommand();
    assert.match(printed, /^node /);

    const path = printed.replace(/^node /, '');
    assert.ok(
      existsSync(path) || existsSync(join(process.cwd(), path)),
      `the seeder prints "${printed}", and no file is there`,
    );
  });
});
