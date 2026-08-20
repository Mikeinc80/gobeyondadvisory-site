/**
 * Service entry point.
 *
 * Startup order matters and is deliberate:
 *   1. Resolve and freeze the environment. In PRODUCTION with an unmet release gate this
 *      throws and the process exits non-zero — the absence of an approval is a startup
 *      failure, not a silent risk.
 *   2. Verify the database is reachable and that the migrations have been applied.
 *   3. Verify the ledger balances and the audit chain is intact BEFORE serving traffic.
 *      Starting up on top of a corrupted ledger and then accepting payments is worse
 *      than refusing to start.
 *   4. Start the HTTP server and the background worker.
 */
import { readFile, stat } from 'node:fs/promises';
import { join, normalize, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHttpServer } from './http/router.js';
import { buildRouter } from './http/routes.js';
import { withContext, withReadOnlyContext, closePool, one } from './db/pool.js';
import { environment, environmentSummary } from './core/env.js';
import { logger } from './core/logger.js';
import * as auth from './auth/service.js';
import { verifyLedgerIntegrity } from './modules/ledger/ledger.js';
import { verifyAuditChain } from './audit/audit.js';
import { startWorker } from './jobs/worker.js';
const HERE = fileURLToPath(new URL('.', import.meta.url));
const WEB_ROOT = join(HERE, '..', '..', '..', 'apps', 'web', 'public');
const CONTENT_TYPES = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.svg': 'image/svg+xml',
    '.png': 'image/png',
    '.ico': 'image/x-icon',
    '.woff2': 'font/woff2',
};
/**
 * Serves the web client. Every path that is not an API route and not a real file falls
 * back to index.html so the client-side router can handle it.
 */
async function serveStatic(requestPath) {
    if (requestPath.startsWith('/api/'))
        return null;
    // Path traversal defence: normalise, then confirm the result is still inside WEB_ROOT.
    const relative = requestPath === '/' ? 'index.html' : requestPath.replace(/^\/+/, '');
    const candidate = normalize(join(WEB_ROOT, relative));
    if (!candidate.startsWith(WEB_ROOT)) {
        logger.warn('path traversal attempt refused', { requestPath });
        return null;
    }
    try {
        const info = await stat(candidate);
        if (info.isFile()) {
            const body = await readFile(candidate);
            const ext = extname(candidate);
            return {
                body,
                contentType: CONTENT_TYPES[ext] ?? 'application/octet-stream',
                // index.html carries the CSP nonce placeholder.
                nonce: ext === '.html',
            };
        }
    }
    catch {
        // Not a file; fall through to the SPA entry point.
    }
    try {
        const body = await readFile(join(WEB_ROOT, 'index.html'));
        return { body, contentType: 'text/html; charset=utf-8', nonce: true };
    }
    catch {
        return null;
    }
}
async function preflight() {
    const env = environment();
    logger.info('Environment resolved', environmentSummary());
    const migrations = await withReadOnlyContext({ scope: 'system' }, (db) => one(db, 'SELECT count(*)::text AS n FROM schema_migration'));
    logger.info('Database reachable', { migrationsApplied: Number(migrations.n) });
    if (Number(migrations.n) === 0) {
        throw new Error('No migrations are recorded. Run scripts/db-reset.sh before starting the service. ' +
            'Refusing to serve traffic against an unmigrated database.');
    }
    const ledger = await withReadOnlyContext({ scope: 'system' }, (db) => verifyLedgerIntegrity(db));
    if (!ledger.trialBalanceBalanced || ledger.unbalancedJournals.length > 0) {
        throw new Error('LEDGER INTEGRITY FAILURE at startup. The trial balance does not net to zero, or an ' +
            'individual journal is unbalanced. Refusing to start: accepting payments on top of a ' +
            'broken ledger makes the problem worse and harder to unwind.\n' +
            JSON.stringify({ trialBalance: ledger.trialBalance, unbalanced: ledger.unbalancedJournals }, null, 2));
    }
    logger.info('Ledger integrity verified', {
        journals: ledger.journalCount, entries: ledger.entryCount, balanced: true,
    });
    const chain = await withReadOnlyContext({ scope: 'system' }, (db) => verifyAuditChain(db, 0));
    if (!chain.intact) {
        throw new Error('AUDIT CHAIN BROKEN at startup. The hash chain does not verify from sequence ' +
            `${chain.firstBreak?.seq}: ${chain.firstBreak?.problem}. Refusing to start. This indicates ` +
            'the audit table has been modified outside the application, which is a security incident.');
    }
    logger.info('Audit chain verified', { eventsChecked: chain.eventsChecked, intact: true });
    if (env.mode === 'PRODUCTION') {
        // Unreachable: describeEnvironment() throws first. Kept as a second, explicit guard.
        throw new Error('PRODUCTION money movement is not enabled in this build.');
    }
}
async function main() {
    await preflight();
    const router = buildRouter();
    const server = createHttpServer({
        router,
        authenticate: (token) => withContext({ scope: 'system' }, (db) => auth.resolveSession(db, token)),
        verifyCsrf: (token, csrf) => withReadOnlyContext({ scope: 'system' }, (db) => auth.verifyCsrf(db, token, csrf)),
        serveStatic: async (path) => {
            const asset = await serveStatic(path);
            if (!asset)
                return null;
            return {
                body: asset.body,
                contentType: asset.contentType,
                ...(asset.nonce ? { nonce: 'yes' } : {}),
            };
        },
    });
    const port = Number(process.env['EKORAILS_PORT'] ?? 4000);
    const host = process.env['EKORAILS_HOST'] ?? '127.0.0.1';
    const worker = startWorker();
    server.listen(port, host, () => {
        logger.info('EKORails API listening', {
            host, port, mode: environment().mode, routes: router.all().length,
            banner: environment().banner,
        });
    });
    const shutdown = async (signal) => {
        logger.info('Shutting down', { signal });
        worker.stop();
        server.close();
        await closePool();
        process.exit(0);
    };
    process.on('SIGTERM', () => void shutdown('SIGTERM'));
    process.on('SIGINT', () => void shutdown('SIGINT'));
}
main().catch((error) => {
    // Startup failures are printed in full: this is the one place where a stack trace is
    // more useful to an operator than it is to an attacker, because nothing is serving yet.
    process.stderr.write(`\nEKORails API failed to start.\n\n${error instanceof Error ? error.stack ?? error.message : String(error)}\n\n`);
    process.exit(1);
});
//# sourceMappingURL=main.js.map