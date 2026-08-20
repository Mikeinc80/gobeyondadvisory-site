/**
 * Test harness.
 *
 * Tests run against a REAL PostgreSQL database with the real migrations applied, not
 * against mocks. Most of the controls in this system are enforced by the database —
 * append-only triggers, the deferred journal-balance check, row-level security, withheld
 * grants — so a test that mocked the database would prove nothing about them.
 *
 * Each test file gets a clean database. The harness connects with deployment credentials
 * for setup and with APPLICATION credentials wherever a test asserts on a privilege or an
 * isolation boundary, because those two things are the point of the test.
 */

import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { existsSync } from 'node:fs';
import type { Queryable, SecurityContext } from '../src/db/pool.js';

const HERE = fileURLToPath(new URL('.', import.meta.url));

/**
 * Walks upward for the repository root. Resolved by searching rather than by a fixed
 * number of `..` segments, because the same file runs from `test/` when type-checked and
 * from `dist/test/` when executed, and those are different depths.
 */
function findRepoRoot(start: string): string {
  let dir = start;
  for (let i = 0; i < 8; i += 1) {
    if (existsSync(join(dir, 'scripts', 'db-reset.sh'))) return dir;
    dir = join(dir, '..');
  }
  throw new Error(`Could not locate the repository root from ${start}`);
}

const REPO_ROOT = findRepoRoot(HERE);

process.env['EKORAILS_ENV_MODE'] ??= 'DEMO';
process.env['EKORAILS_LOG_LEVEL'] ??= 'error';

const { Pool, types } = pg;
types.setTypeParser(1700, (v: string) => v);
types.setTypeParser(20, (v: string) => v);

export interface TestDb {
  /** Runs work as the schema owner. Setup and fixtures. */
  asOwner<T>(context: SecurityContext, fn: (db: Queryable) => Promise<T>): Promise<T>;
  /** Runs work as the restricted application role. Privilege and isolation assertions. */
  asApp<T>(context: SecurityContext, fn: (db: Queryable) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}

let resetCount = 0;

/**
 * Rebuilds the database from migrations. Slow but decisive: every test file starts from
 * a schema that is exactly what the migrations produce, so a test cannot pass because of
 * state another test left behind.
 */
export function resetDatabase(): void {
  execFileSync(join(REPO_ROOT, 'scripts', 'db-reset.sh'), {
    cwd: REPO_ROOT,
    env: { ...process.env, EKORAILS_ENV_MODE: 'TEST' },
    stdio: 'pipe',
  });
  resetCount += 1;
}

export function connect(): TestDb {
  const ownerPool = new Pool({
    host: process.env['EKORAILS_DB_HOST'] ?? '127.0.0.1',
    port: Number(process.env['EKORAILS_DB_PORT'] ?? 5432),
    database: process.env['EKORAILS_DB_NAME'] ?? 'ekorails',
    user: 'ekorails_owner', password: 'ekorails_owner_dev', max: 4,
  });
  const appPool = new Pool({
    host: process.env['EKORAILS_DB_HOST'] ?? '127.0.0.1',
    port: Number(process.env['EKORAILS_DB_PORT'] ?? 5432),
    database: process.env['EKORAILS_DB_NAME'] ?? 'ekorails',
    user: 'ekorails_app', password: 'ekorails_app_dev', max: 4,
  });

  const run = async <T>(
    pool: pg.Pool, context: SecurityContext, fn: (db: Queryable) => Promise<T>,
  ): Promise<T> => {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SELECT set_config($1,$2,true)', ['ekorails.scope', context.scope]);
      await client.query('SELECT set_config($1,$2,true)', ['ekorails.org_id', context.organizationId ?? '']);
      await client.query('SELECT set_config($1,$2,true)', ['ekorails.user_id', context.userId ?? '']);
      const result = await fn(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      try { await client.query('ROLLBACK'); } catch { /* discarded */ }
      throw error;
    } finally {
      client.release();
    }
  };

  return {
    asOwner: (context, fn) => run(ownerPool, context, fn),
    asApp: (context, fn) => run(appPool, context, fn),
    close: async () => { await ownerPool.end(); await appPool.end(); },
  };
}

export const SYSTEM: SecurityContext = { scope: 'system' };

/** Asserts a promise rejects, and that the message or code matches. Returns the error. */
export async function expectRejection(
  promise: Promise<unknown>, pattern: RegExp,
): Promise<Error> {
  try {
    await promise;
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    const code = (err as Error & { code?: string }).code ?? '';
    if (!pattern.test(err.message) && !pattern.test(code) && !pattern.test(err.name)) {
      throw new Error(
        `Rejected, but not in the expected way.\n  Expected to match: ${pattern}\n  ` +
        `Got: ${err.name} / ${code} / ${err.message}`,
      );
    }
    return err;
  }
  throw new Error(`Expected a rejection matching ${pattern}, but the promise resolved.`);
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

export interface Fixture {
  internalOrgId: string;
  orgAId: string;
  orgBId: string;
  users: {
    initiatorA: string;
    approverA: string;
    initiatorB: string;
    analyst: string;
    manager: string;
    treasury: string;
    finance: string;
    finance2: string;
    admin: string;
  };
  corridorId: string;
  partners: {
    originBank: string;
    settlementInstitution: string;
    destinationBank: string;
    screeningProvider: string;
  };
  beneficiaryA: string;
  beneficiaryB: string;
}

/**
 * Builds a minimal but complete two-organisation fixture by driving the real services.
 * Using the services rather than raw inserts means the fixture itself exercises the
 * onboarding, screening and approval paths.
 */
export async function buildFixture(db: TestDb): Promise<Fixture> {
  const { seedRolesAndPermissions, seedCorridor, seedPartners, seedRules } =
    await import('../src/seed/reference.js');
  const { createUser } = await import('../src/auth/service.js');
  const orgService = await import('../src/modules/org/service.js');

  return db.asOwner(SYSTEM, async (q) => {
    await seedRolesAndPermissions(q);
    const corridorId = await seedCorridor(q);
    const partners = await seedPartners(q);

    const internal = await q.query<{ id: string }>(
      `INSERT INTO organization (display_code, legal_name, kind, onboarding_status)
       VALUES ('ORG-EKORAILS','EKORails LTD','internal','approved') RETURNING id`,
    );
    const internalOrgId = internal.rows[0]!.id;

    const mk = async (email: string, name: string, roles: string[], orgId: string) =>
      (await createUser(q, {
        organizationId: orgId, email, fullName: name,
        password: 'Kx7-Harbour-Lantern-2026', roles, enrolMfa: false,
      })).userId;

    const analyst = await mk('analyst@ekorails.invalid', 'Test Analyst', ['compliance_analyst'], internalOrgId);
    const manager = await mk('manager@ekorails.invalid', 'Test Manager', ['compliance_manager'], internalOrgId);
    const treasury = await mk('treasury@ekorails.invalid', 'Test Treasury', ['treasury_operator'], internalOrgId);
    const finance = await mk('finance@ekorails.invalid', 'Test Finance', ['finance_analyst'], internalOrgId);
    const finance2 = await mk('finance2@ekorails.invalid', 'Second Finance', ['finance_analyst'], internalOrgId);
    const admin = await mk('admin@ekorails.invalid', 'Test Admin', ['system_administrator'], internalOrgId);

    await seedRules(q, manager, admin);

    const makeOrg = async (code: string, name: string) => {
      const row = await q.query<{ id: string }>(
        `INSERT INTO organization (display_code, legal_name, kind, onboarding_status)
         VALUES ($1,$2,'customer','draft') RETURNING id`,
        [code, name],
      );
      return row.rows[0]!.id;
    };

    const orgAId = await makeOrg('ORG-TESTAAA', 'Test Alpha Trading Limited');
    const orgBId = await makeOrg('ORG-TESTBBB', 'Test Bravo Exports Limited');

    const initiatorA = await mk('initiator.a@testalpha.invalid', 'Alpha Initiator', ['business_initiator'], orgAId);
    const approverA = await mk('approver.a@testalpha.invalid', 'Alpha Approver', ['business_approver'], orgAId);
    const initiatorB = await mk('initiator.b@testbravo.invalid', 'Bravo Initiator', ['business_initiator'], orgBId);

    const onboard = async (orgId: string, userId: string, name: string, industry: string) => {
      await orgService.upsertKybProfile(q, {
        organizationId: orgId, userId,
        profile: {
          legalBusinessName: name, tradingName: name, registrationNumber: `RC-DEMO-${orgId.slice(0, 6)}`,
          jurisdiction: 'NG', dateOfIncorporation: '2020-01-15',
          registeredAddress: { line1: '1 Demonstration Way', city: 'Lagos', country: 'NG' },
          operatingAddress: { line1: '1 Demonstration Way', city: 'Lagos', country: 'NG' },
          businessActivity: 'Fictional test trading activity.', industryCode: industry,
          website: null, taxIdentificationNumber: 'DEMO-TIN-000', regulatoryLicence: null,
          expectedCorridors: ['PILOT-CORRIDOR-1'],
          expectedMonthlyVolume: '200000000.000000', expectedMonthlyCurrency: 'NGN',
          expectedTransactionSize: '20000000.000000', expectedTxnCurrency: 'NGN',
          sourceOfFunds: 'Trading revenue from fictional export contracts, held in the operating account.',
          purposeOfTransactions: 'Settlement of fictional supplier invoices.',
        },
      });
      const profile = await q.query<{ id: string }>(
        'SELECT id FROM organization_profile WHERE organization_id = $1 AND is_current', [orgId],
      );
      await orgService.addPerson(q, {
        organizationId: orgId, profileId: profile.rows[0]!.id, userId,
        person: {
          fullName: `Owner Of ${name}`, dateOfBirth: '1980-01-01', nationality: 'NG',
          countryOfResidence: 'NG', residentialAddress: { city: 'Lagos', country: 'NG' },
          idDocumentType: 'national_identity_number', idNumber: `DEMO-ID-${orgId.slice(0, 8)}`,
          idExpiresOn: '2030-01-01', isPep: false,
          capacities: [
            { capacity: 'director' },
            { capacity: 'ultimate_beneficial_owner', ownershipPercent: '100.0000', ownershipIsDirect: true },
          ],
        },
      });
      await orgService.submitForKybReview(q, orgId, userId);
      await orgService.decideKyb(q, {
        organizationId: orgId, decision: 'approve',
        reason: 'Test fixture approval. Ownership register complete and screening dispositioned.',
        userId: manager, role: 'compliance_manager', isManager: true,
      });
    };

    await onboard(orgAId, initiatorA, 'Test Alpha Trading Limited', 'agricultural_commodities');
    await onboard(orgBId, initiatorB, 'Test Bravo Exports Limited', 'textiles_wholesale');

    const makeBeneficiary = async (orgId: string, userId: string, name: string, iban: string) => {
      const result = await orgService.createBeneficiary(q, {
        organizationId: orgId, userId,
        beneficiary: {
          legalName: name, registrationNumber: 'DEMO-REG-1', country: 'NL',
          address: { city: 'Rotterdam', country: 'NL' },
          paymentPurpose: 'Payment for fictional goods under a test supply agreement.',
          relationshipToSender: 'Overseas supplier under a test contract.',
          bank: {
            accountHolderName: name, institutionName: 'Demonstration Bank',
            institutionCountry: 'NL', swiftBic: 'DEMONL2AXXX',
            identifierScheme: 'iban', identifier: iban, currency: 'USD',
          },
        },
      });
      await orgService.reviewBeneficiary(q, {
        beneficiaryId: result.beneficiaryId, decision: 'approve',
        reason: 'Test fixture approval. Details verified against the supporting contract.',
        userId: analyst, role: 'compliance_analyst',
      });
      await q.query(
        "UPDATE beneficiary SET created_at = now() - interval '45 days' WHERE id = $1",
        [result.beneficiaryId],
      );
      return result.beneficiaryId;
    };

    const beneficiaryA = await makeBeneficiary(orgAId, initiatorA, 'Alpha Supplier BV', 'NL00DEMO0000900001');
    const beneficiaryB = await makeBeneficiary(orgBId, initiatorB, 'Bravo Supplier BV', 'NL00DEMO0000900002');

    // Opening liquidity so settlements can be demonstrated.
    const postings = await import('../src/modules/ledger/postings.js');
    const { Decimal } = await import('../src/core/money.js');
    await postings.postTestLiquidity(q, {
      partnerId: partners.originBank, category: 'partner_funding_account',
      currency: 'NGN', amount: Decimal.fromString('5000000000.000000'), postedBy: treasury,
    });
    await postings.postTestLiquidity(q, {
      partnerId: partners.settlementInstitution, category: 'partner_settlement_account',
      currency: 'USD', amount: Decimal.fromString('4000000.000000'), postedBy: treasury,
    });

    return {
      internalOrgId, orgAId, orgBId, corridorId,
      users: {
        initiatorA, approverA, initiatorB, analyst, manager, treasury,
        finance, finance2, admin,
      },
      partners: {
        originBank: partners.originBank,
        settlementInstitution: partners.settlementInstitution,
        destinationBank: partners.destinationBank,
        screeningProvider: partners.screeningProvider,
      },
      beneficiaryA, beneficiaryB,
    };
  });
}

/** Actor shapes used repeatedly by the workflow tests. */
export function actor(
  userId: string, role: string, permissions: string[], stepUpValid = true,
) {
  return {
    userId, role,
    permissions: new Set(permissions) as never,
    sessionId: randomUUID(),
    stepUpValid,
  };
}

export function settlementActor(
  userId: string, role: string, permissions: string[],
) {
  return {
    type: 'user' as const, userId, role,
    permissions: new Set(permissions) as never,
    stepUpValid: true,
  };
}

/** Drives one transaction from creation to a chosen stopping point. */
export async function createAndAdvance(
  db: TestDb,
  fixture: Fixture,
  options: {
    amount?: string;
    invoice?: string;
    purpose?: string;
    /** How far to take it. */
    stopAt: 'draft' | 'pending_compliance' | 'compliance_approved' | 'quote_issued'
      | 'awaiting_funding' | 'funding_confirmed' | 'ready_for_settlement' | 'settled' | 'completed';
    scenario?: string;
    /** Omit the source-of-funds document, to exercise the documentation rule. */
    omitSourceOfFunds?: boolean;
  },
): Promise<{ id: string; reference: string; state: string }> {
  const txnService = await import('../src/modules/transaction/service.js');
  const orgService = await import('../src/modules/org/service.js');
  const settlement = await import('../src/modules/settlement/service.js');
  const fx = await import('../src/modules/fx/quotes.js');
  const { Decimal, RATE_SCALE } = await import('../src/core/money.js');
  const { transition } = await import('../src/modules/settlement/machine.js');

  const amount = options.amount ?? '5000000.000000';
  const invoice = options.invoice ?? `INV-TEST-${Math.floor(Math.random() * 1_000_000)}`;

  return db.asOwner(SYSTEM, async (q) => {
    const invoiceDoc = await orgService.uploadDocument(q, {
      organizationId: fixture.orgAId, documentType: 'invoice',
      originalFilename: `${invoice}.pdf`, mimeType: 'application/pdf',
      bytes: Buffer.from('%PDF-1.4\nfictional test invoice\n%%EOF\n', 'latin1'),
      userId: fixture.users.initiatorA,
    });
    const links = [{ documentId: invoiceDoc.documentId, role: 'primary_invoice' }];

    if (!options.omitSourceOfFunds) {
      const sof = await orgService.uploadDocument(q, {
        organizationId: fixture.orgAId, documentType: 'source_of_funds_evidence',
        originalFilename: `sof-${invoice}.pdf`, mimeType: 'application/pdf',
        bytes: Buffer.from('%PDF-1.4\nfictional source of funds\n%%EOF\n', 'latin1'),
        userId: fixture.users.initiatorA,
      });
      links.push({ documentId: sof.documentId, role: 'source_of_funds' });
    }

    const txn = await txnService.createTransaction(q, {
      organizationId: fixture.orgAId,
      beneficiaryId: fixture.beneficiaryA,
      corridorId: fixture.corridorId,
      sendAmount: amount, sendCurrency: 'NGN', receiveCurrency: 'USD',
      purpose: options.purpose ?? 'Settlement of a fictional supplier invoice.',
      sourceOfFunds:
        'Trading revenue received into the operating account, evidenced by the attached statement.',
      invoiceNumber: invoice,
      documentLinks: links,
      initiatedBy: fixture.users.initiatorA,
    });

    if (options.stopAt === 'draft') return { ...txn, state: 'draft' };

    await txnService.submitForApproval(q, txn.id,
      actor(fixture.users.initiatorA, 'business_initiator', ['txn.initiate']));
    await txnService.businessApprove(q, {
      transactionId: txn.id,
      actor: actor(fixture.users.approverA, 'business_approver', ['txn.approve']),
      approve: true, reason: 'Authorised by the second business user for test purposes.',
    });

    if (options.stopAt === 'pending_compliance') {
      return { ...txn, state: 'pending_compliance' };
    }

    await txnService.complianceDecide(q, {
      transactionId: txn.id,
      actor: actor(fixture.users.analyst, 'compliance_analyst', ['compliance.alert.clear']),
      decision: 'approve',
      reason: 'Alerts reviewed. Documentation present and consistent. Cleared to proceed in test.',
    });

    if (options.stopAt === 'compliance_approved') {
      return { ...txn, state: 'compliance_approved' };
    }

    const quote = await fx.issueQuote(q, {
      organizationId: fixture.orgAId, corridorId: fixture.corridorId,
      sendAmount: Decimal.fromString(amount), sendCurrency: 'NGN', receiveCurrency: 'USD',
      referenceRate: Decimal.fromString('0.000625000000', RATE_SCALE),
      referenceRateSource: 'Simulated test rate.', referenceRateAt: new Date(),
      providerRate: Decimal.fromString('0.000618000000', RATE_SCALE),
      quoteSource: 'mock_liquidity_provider', isSimulated: true,
      validitySeconds: 3600, issuedBy: fixture.users.treasury,
      fees: fx.defaultFeeSchedule('NGN'),
    });
    await q.query(
      'UPDATE transaction SET fx_quote_id = $2, expected_receive_amount = $3 WHERE id = $1',
      [txn.id, quote.quoteId, quote.expectedReceivable],
    );
    await transition(q, {
      transactionId: txn.id, event: 'quote_issue', actorType: 'user',
      actorUserId: fixture.users.treasury, actorRole: 'treasury_operator',
      actorPermissions: new Set(['fx.quote.issue']) as never, stepUpValid: true,
      reason: `Quote ${quote.reference} issued at a simulated rate for test.`,
    });

    if (options.stopAt === 'quote_issued') return { ...txn, state: 'quote_issued' };

    await fx.acceptQuote(q, {
      quoteId: quote.quoteId, acceptedBy: fixture.users.approverA, organizationId: fixture.orgAId,
    });
    await settlement.acceptQuoteAndRecogniseObligation(q, txn.id,
      settlementActor(fixture.users.approverA, 'business_approver', ['fx.quote.accept']));
    await settlement.requestFunding(q, txn.id,
      settlementActor(fixture.users.treasury, 'treasury_operator', ['treasury.funding.review']));

    if (options.stopAt === 'awaiting_funding') return { ...txn, state: 'awaiting_funding' };

    await settlement.confirmFunding(q, txn.id,
      settlementActor(fixture.users.treasury, 'treasury_operator', ['treasury.funding.review']));

    if (options.stopAt === 'funding_confirmed') return { ...txn, state: 'funding_confirmed' };

    await settlement.prepareSettlement(q, txn.id,
      settlementActor(fixture.users.treasury, 'treasury_operator', ['treasury.settlement.route']));

    if (options.stopAt === 'ready_for_settlement') return { ...txn, state: 'ready_for_settlement' };

    if (options.scenario) {
      await q.query(
        `INSERT INTO simulation_directive (partner_id, transaction_id, operation, scenario, remaining_uses, created_by)
         VALUES ($1,$2,'settlement.submit',$3,1,$4)`,
        [fixture.partners.settlementInstitution, txn.id, options.scenario, fixture.users.admin],
      );
    }

    const submission = await settlement.submitSettlement(q, txn.id,
      settlementActor(fixture.users.treasury, 'treasury_operator', ['treasury.settlement.route']));

    if (options.stopAt === 'settled') return { ...txn, state: submission.finalState };

    if (submission.finalState === 'settled') {
      await settlement.confirmBeneficiaryCredit(q, txn.id, fixture.partners.destinationBank);
      await transition(q, {
        transactionId: txn.id, event: 'reconcile', actorType: 'job',
        reason: 'Matched in the test reconciliation run.',
      });
      await settlement.complete(q, txn.id,
        settlementActor(fixture.users.finance, 'finance_analyst', ['recon.run']));
    }

    const final = await q.query<{ state: string }>(
      'SELECT state FROM transaction WHERE id = $1', [txn.id],
    );
    return { ...txn, state: final.rows[0]!.state };
  });
}

export function timesReset(): number {
  return resetCount;
}
