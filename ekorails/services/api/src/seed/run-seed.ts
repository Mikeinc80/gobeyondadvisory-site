/**
 * Seed entry point.
 *
 * Refuses to run outside DEMO, SANDBOX or TEST. Seeding creates users with a known
 * password and fictional customer data; running it against a controlled pilot or a
 * production database would be a security incident, so it is refused at the top rather
 * than guarded by convention.
 */

import { withContext, closePool, one, useDeploymentCredentials } from '../db/pool.js';
import { environment } from '../core/env.js';
import { logger } from '../core/logger.js';
import {
  seedRolesAndPermissions, seedCorridor, seedPartners, seedRules, seedConfiguration,
  seedFeatureFlags, seedRetentionPolicies, seedApprovalMatrix, seedRequiredDocuments,
} from './reference.js';
import {
  seedLearningContent, seedGlossary, seedDecisionLog, seedRiskRegister, seedBuildJournal,
} from './learning.js';
import {
  seedInternalUsers, seedBusinesses, seedBeneficiaries, seedLiquidity, seedTransactions,
  seedIncidentAndComplaint, seedSanctionsFalsePositive, seedPepEscalation,
  DEMO_PASSWORD, DEMO_NOTICE, type DemoContext,
} from './demo.js';
import { runDailyReconciliation } from '../modules/recon/reconcile.js';
import { deliverQueued } from '../modules/notification/notify.js';
import { totpCommand } from './totp.js';
import { verifyLedgerIntegrity } from '../modules/ledger/ledger.js';
import { verifyAuditChain } from '../audit/audit.js';

async function main(): Promise<void> {
  const env = environment();

  // Seeding writes reference data the running application deliberately cannot write:
  // roles, permissions and published rule definitions. It therefore connects as the
  // schema owner. Note that the append-only triggers still apply — even the owner cannot
  // mutate an audit record or a ledger entry.
  useDeploymentCredentials();
  if (env.mode !== 'DEMO' && env.mode !== 'SANDBOX') {
    throw new Error(
      `REFUSED: seeding creates users with a known password and fictional customer data. ` +
      `It will not run with EKORAILS_ENV_MODE=${env.mode}.`,
    );
  }

  logger.info('Seeding started', { mode: env.mode, notice: DEMO_NOTICE });
  const summary: Record<string, unknown> = { environment: env.mode };

  // ---- Reference data -----------------------------------------------------
  await withContext({ scope: 'system' }, async (db) => {
    await seedRolesAndPermissions(db);
  });
  logger.info('Roles and permissions seeded');

  const internalOrgId = await withContext({ scope: 'system' }, async (db) => {
    const existing = await db.query<{ id: string }>(
      "SELECT id FROM organization WHERE display_code = 'ORG-EKORAILS'",
    );
    if (existing.rows[0]) return existing.rows[0].id;
    const row = await one<{ id: string }>(
      db,
      `INSERT INTO organization (display_code, legal_name, kind, onboarding_status)
       VALUES ('ORG-EKORAILS', 'EKORails LTD', 'internal', 'approved') RETURNING id`,
    );
    return row.id;
  });

  const users = await withContext({ scope: 'system' }, (db) => seedInternalUsers(db, internalOrgId));
  summary['internal_users'] = Object.keys(users).filter((k) => !k.endsWith('_totp')).length;

  const corridorId = await withContext({ scope: 'system' }, (db) => seedCorridor(db));
  const partners = await withContext({ scope: 'system' }, (db) => seedPartners(db));
  summary['partners'] = Object.keys(partners).length;

  await withContext({ scope: 'system' }, async (db) => {
    summary['rules'] = await seedRules(db, users['manager']!, users['founder']!);
    summary['configuration'] = await seedConfiguration(db, users['admin']!, users['founder']!);
    summary['feature_flags'] = await seedFeatureFlags(db);
    summary['retention_policies'] = await seedRetentionPolicies(db);
    summary['approval_matrix'] = await seedApprovalMatrix(db);
    summary['required_documents'] = await seedRequiredDocuments(db, corridorId);
  });
  logger.info('Reference data seeded', summary);

  // ---- Learning centre ----------------------------------------------------
  await withContext({ scope: 'system' }, async (db) => {
    const learning = await seedLearningContent(db);
    summary['learning_modules'] = learning.modules;
    summary['assessment_questions'] = learning.questions;
    summary['glossary_terms'] = await seedGlossary(db);
    summary['decisions'] = await seedDecisionLog(db);
    summary['risks'] = await seedRiskRegister(db);
    summary['build_journal'] = await seedBuildJournal(db);
  });
  logger.info('Founder Learning Center seeded');

  // ---- Demonstration data -------------------------------------------------
  // Each stage runs in its own transaction so that a partial failure leaves a
  // diagnosable state rather than an all-or-nothing rollback of an hour's work.
  const ctxBase = { corridorId, partners, internalOrgId, users };

  const orgs = await withContext({ scope: 'system' }, (db) =>
    seedBusinesses({ db, ...ctxBase } as DemoContext),
  );
  summary['organizations'] = orgs.size;

  const beneficiaries = await withContext({ scope: 'system' }, (db) =>
    seedBeneficiaries({ db, ...ctxBase } as DemoContext, orgs),
  );
  summary['beneficiaries'] = beneficiaries.size;

  await withContext({ scope: 'system' }, (db) => seedLiquidity({ db, ...ctxBase } as DemoContext));

  await withContext({ scope: 'system' }, (db) =>
    seedSanctionsFalsePositive({ db, ...ctxBase } as DemoContext),
  );
  await withContext({ scope: 'system' }, (db) =>
    seedPepEscalation({ db, ...ctxBase } as DemoContext),
  );

  const txns = await withContext({ scope: 'system' }, (db) =>
    seedTransactions({ db, ...ctxBase } as DemoContext, orgs, beneficiaries),
  );
  summary['transactions'] = txns.created;
  summary['transactions_by_outcome'] = txns.byOutcome;

  await withContext({ scope: 'system' }, (db) =>
    seedIncidentAndComplaint({ db, ...ctxBase } as DemoContext),
  );

  // ---- Reconciliation and delivery ---------------------------------------
  const recon = await withContext({ scope: 'system' }, (db) =>
    runDailyReconciliation(db, new Date(), users['finance']!),
  );
  summary['reconciliation'] = {
    runs: recon.runs.length, breaks: recon.totalBreaks, all_clean: recon.allClean,
  };

  await withContext({ scope: 'system' }, (db) => deliverQueued(db, 500));

  // ---- Integrity verification --------------------------------------------
  const ledger = await withContext({ scope: 'system' }, (db) => verifyLedgerIntegrity(db));
  const chain = await withContext({ scope: 'system' }, (db) => verifyAuditChain(db, 0));

  summary['ledger'] = {
    journals: ledger.journalCount, entries: ledger.entryCount,
    balanced: ledger.trialBalanceBalanced,
    trial_balance: ledger.trialBalance.map((t) => ({
      currency: t.currency, difference: t.difference, balanced: t.balanced,
    })),
  };
  summary['audit_chain'] = { events: chain.eventsChecked, intact: chain.intact };

  if (!ledger.trialBalanceBalanced) {
    throw new Error('Seeding produced an unbalanced ledger. Refusing to report success.');
  }
  if (!chain.intact) {
    throw new Error('Seeding produced a broken audit chain. Refusing to report success.');
  }

  process.stdout.write(`\n${'='.repeat(78)}\nEKORails demonstration environment seeded.\n${'='.repeat(78)}\n\n`);
  process.stdout.write(`${DEMO_NOTICE}\n`);
  process.stdout.write('All businesses, people, addresses, documents and bank accounts are invented.\n');
  process.stdout.write('No real identity document, bank account or personal data is present.\n\n');
  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n\n`);

  process.stdout.write('Sign-in accounts (all use the same demonstration passphrase):\n\n');
  const accounts = await withContext({ scope: 'system' }, (db) =>
    db.query<{ email: string; full_name: string; roles: string[] | null; org: string }>(
      `SELECT u.email, u.full_name,
              (SELECT array_agg(r.role_code) FROM user_role r WHERE r.user_id = u.id) AS roles,
              o.display_code AS org
         FROM app_user u JOIN organization o ON o.id = u.organization_id
        WHERE u.email_normalised <> 'system@ekorails.invalid'
        ORDER BY o.kind DESC, o.display_code, u.email`,
    ),
  );
  for (const a of accounts.rows) {
    process.stdout.write(
      `  ${a.email.padEnd(42)} ${(a.roles ?? []).join(', ').padEnd(38)} ${a.org}\n`,
    );
  }
  process.stdout.write(`\n  Passphrase: ${DEMO_PASSWORD}\n`);
  process.stdout.write(
    '\n  Every account has MFA enrolled. Retrieve a current code with:\n' +
    `    ${totpCommand()} <email>\n`,
  );
  process.stdout.write(`\n${'='.repeat(78)}\n\n`);
}

main()
  .then(() => closePool())
  .then(() => process.exit(0))
  .catch(async (error) => {
    process.stderr.write(
      `\nSeeding failed.\n\n${error instanceof Error ? error.stack ?? error.message : String(error)}\n\n`,
    );
    await closePool().catch(() => undefined);
    process.exit(1);
  });
